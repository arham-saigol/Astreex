import { v } from "convex/values"
import { internal } from "../_generated/api"
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server"
import { withRateLimit } from "../lib/rateLimiter"
import { fetchedPostValidator, type FetchedPost } from "./validators"

const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_SELFTEXT_LENGTH = 8_000

function normalizeSubredditName(name: string) {
  const normalized = name.replace(/^r\//i, "").trim().toLowerCase()
  if (!/^[a-z0-9_]{3,21}$/.test(normalized)) return null
  return normalized
}

function trimSelftext(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.slice(0, MAX_SELFTEXT_LENGTH)
}

async function getAppAccessToken() {
  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("Reddit OAuth is not configured")
  }

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "astreex/0.1",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  })

  if (!response.ok) {
    throw new Error("Failed to create Reddit app access token")
  }

  const body = (await response.json()) as { access_token?: string }
  if (!body.access_token) throw new Error("Reddit app token response was incomplete")
  return body.access_token
}

function parseRedditListing(subreddit: string, payload: unknown): FetchedPost[] {
  const children =
    typeof payload === "object" && payload !== null &&
    "data" in payload &&
    typeof payload.data === "object" && payload.data !== null &&
    "children" in payload.data &&
    Array.isArray(payload.data.children)
      ? payload.data.children
      : []

  const posts: FetchedPost[] = []

  for (const child of children) {
    const data =
      typeof child === "object" && child !== null && "data" in child
        ? child.data
        : null
    if (typeof data !== "object" || data === null) continue

    const redditPostId = "id" in data ? String(data.id) : ""
    const title = "title" in data ? String(data.title) : ""
    const url = "url" in data ? String(data.url) : ""
    const score = "score" in data && typeof data.score === "number" ? data.score : 0
    const commentCount =
      "num_comments" in data && typeof data.num_comments === "number"
        ? data.num_comments
        : 0
    const createdUtc =
      "created_utc" in data && typeof data.created_utc === "number"
        ? data.created_utc * 1000
        : 0
    const permalink =
      "permalink" in data && typeof data.permalink === "string"
        ? `https://www.reddit.com${data.permalink}`
        : undefined

    if (!redditPostId || !title || !createdUtc) continue

    posts.push({
      redditPostId,
      subreddit,
      title,
      selftext: trimSelftext("selftext" in data ? data.selftext : undefined),
      permalink,
      url,
      score,
      commentCount,
      createdUtc,
    })
  }

  return posts
}

export const loadCachedSubreddit = internalQuery({
  args: {
    subredditName: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const cache = await ctx.db
      .query("subredditCache")
      .withIndex("by_subredditName", (q) =>
        q.eq("subredditName", args.subredditName),
      )
      .unique()

    if (!cache || cache.expiresAt <= args.now) return null

    return cache.posts.map((post) => ({
      redditPostId: post.id,
      subreddit: cache.subredditName,
      title: post.title,
      selftext: post.selftext,
      permalink: post.permalink,
      url: post.url,
      score: post.score,
      commentCount: post.commentCount,
      createdUtc: post.postedAt,
    }))
  },
})

export const upsertSubredditCache = internalMutation({
  args: {
    subredditName: v.string(),
    posts: v.array(fetchedPostValidator),
    fetchedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const cached = await ctx.db
      .query("subredditCache")
      .withIndex("by_subredditName", (q) =>
        q.eq("subredditName", args.subredditName),
      )
      .unique()

    const posts = args.posts.map((post) => ({
      id: post.redditPostId,
      title: post.title,
      selftext: post.selftext,
      permalink: post.permalink,
      url: post.url,
      score: post.score,
      commentCount: post.commentCount,
      postedAt: post.createdUtc,
    }))

    const row = {
      subredditName: args.subredditName,
      posts,
      fetchedAt: args.fetchedAt,
      expiresAt: args.fetchedAt + CACHE_TTL_MS,
    }

    if (cached) {
      await ctx.db.patch(cached._id, row)
    } else {
      await ctx.db.insert("subredditCache", row)
    }
  },
})

export const fetchRedditPosts = internalAction({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args): Promise<FetchedPost[]> => {
    const subreddits: Array<{ name: string }> = await ctx.runQuery(
      internal.pipeline.data.loadActiveSubreddits,
      { projectId: args.projectId },
    )
    const uniqueNames: string[] = [
      ...new Set<string>(
        subreddits
          .map((subreddit: { name: string }) => normalizeSubredditName(subreddit.name))
          .filter((name: string | null): name is string => name !== null),
      ),
    ]

    const posts: FetchedPost[] = []
    let appAccessToken: string | null = null

    for (const subredditName of uniqueNames) {
      const now = Date.now()
      const cached: FetchedPost[] | null = await ctx.runQuery(
        internal.pipeline.fetchPosts.loadCachedSubreddit,
        { subredditName, now },
      )

      if (cached) {
        posts.push(...cached)
        continue
      }

      appAccessToken ??= await getAppAccessToken()

      const fetched = await withRateLimit(ctx, 3, async () => {
        const response = await fetch(
          `https://oauth.reddit.com/r/${subredditName}/new.json?limit=100`,
          {
            headers: {
              Authorization: `Bearer ${appAccessToken}`,
              "User-Agent": "astreex/0.1",
            },
          },
        )

        if (!response.ok) {
          throw new Error(`Failed to fetch r/${subredditName}`)
        }

        return parseRedditListing(subredditName, await response.json())
      })

      await ctx.runMutation(internal.pipeline.fetchPosts.upsertSubredditCache, {
        subredditName,
        posts: fetched,
        fetchedAt: now,
      })
      posts.push(...fetched)
    }

    return posts
  },
})
