import { v } from "convex/values"
import { internal } from "../_generated/api"
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../_generated/server"
import { communityPosts, type FetchLayerPost } from "../lib/fetchLayer"
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

function createdUtcMs(post: FetchLayerPost) {
  if (typeof post.createdUtc === "number") {
    return post.createdUtc > 10_000_000_000 ? post.createdUtc : post.createdUtc * 1000
  }
  if (typeof post.created_utc === "number") {
    return post.created_utc > 10_000_000_000
      ? post.created_utc
      : post.created_utc * 1000
  }
  if (typeof post.createdAt === "number") return post.createdAt
  if (typeof post.createdAt === "string") {
    const parsed = Date.parse(post.createdAt)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

function absoluteRedditUrl(value: string | undefined) {
  if (!value) return undefined
  if (value.startsWith("http://") || value.startsWith("https://")) return value
  if (value.startsWith("/")) return `https://www.reddit.com${value}`
  return value
}

function parseFetchLayerPosts(subreddit: string, payload: FetchLayerPost[]): FetchedPost[] {
  const posts: FetchedPost[] = []

  for (const item of payload) {
    const redditThingId =
      typeof item.fullname === "string"
        ? item.fullname
        : typeof item.name === "string"
          ? item.name
          : undefined
    const redditPostId =
      item.id ??
      (redditThingId?.includes("_") ? redditThingId.split("_")[1] : undefined) ??
      ""
    const title = item.title ?? ""
    const url = absoluteRedditUrl(item.url) ?? absoluteRedditUrl(item.permalink) ?? ""
    const score = typeof item.score === "number" ? item.score : 0
    const commentCount =
      typeof item.numComments === "number"
        ? item.numComments
        : typeof item.num_comments === "number"
          ? item.num_comments
          : typeof item.commentCount === "number"
            ? item.commentCount
            : 0
    const createdUtc = createdUtcMs(item)
    const permalink = absoluteRedditUrl(item.permalink)

    if (!redditPostId || !title || !url || !createdUtc) continue

    posts.push({
      redditPostId,
      redditThingId: redditThingId ?? `t3_${redditPostId}`,
      subreddit,
      title,
      selftext: trimSelftext(item.selftext ?? item.body ?? item.text),
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
      redditThingId: post.redditThingId,
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
      redditThingId: post.redditThingId,
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
    const now = Date.now()
    const cachedResults = await Promise.all(
      uniqueNames.map(async (subredditName) => {
        try {
          const cached: FetchedPost[] | null = await ctx.runQuery(
            internal.pipeline.fetchPosts.loadCachedSubreddit,
            { subredditName, now },
          )
          return { subredditName, cached }
        } catch (error) {
          console.warn(
            `Skipping cache for r/${subredditName}: ${
              error instanceof Error ? error.message : "cache check failed"
            }`,
          )
          return { subredditName, cached: null }
        }
      }),
    )

    const cacheMisses: string[] = []
    for (const result of cachedResults) {
      if (result.cached) {
        posts.push(...result.cached)
      } else {
        cacheMisses.push(result.subredditName)
      }
    }

    const fetchedResults = await Promise.all(
      cacheMisses.map(async (subredditName) => {
        try {
          const fetched = parseFetchLayerPosts(
            subredditName,
            await communityPosts(ctx, subredditName, { sort: "new", limit: 100 }),
          )
          return { subredditName, fetched }
        } catch (error) {
          console.warn(
            `Skipping r/${subredditName}: ${
              error instanceof Error ? error.message : "fetch failed"
            }`,
          )
          return null
        }
      }),
    )

    await Promise.all(
      fetchedResults.map(async (result) => {
        if (!result) return
        await ctx.runMutation(internal.pipeline.fetchPosts.upsertSubredditCache, {
          subredditName: result.subredditName,
          posts: result.fetched,
          fetchedAt: now,
        })
        posts.push(...result.fetched)
      }),
    )

    return posts
  },
})
