import type { ActionCtx } from "../_generated/server"
import { providerFetchJson } from "./providerHttp"

export type FetchLayerCommunity = {
  name?: string
  displayName?: string
  display_name?: string
  subreddit?: string
  subscribers?: number
  memberCount?: number
  members?: number
  publicDescription?: string
  public_description?: string
  description?: string
  over18?: boolean
  nsfw?: boolean
  quarantined?: boolean
  quarantine?: boolean
  type?: string
  subredditType?: string
  rules?: unknown
}

export type FetchLayerPost = {
  id?: string
  name?: string
  fullname?: string
  title?: string
  selftext?: string
  body?: string
  text?: string
  url?: string
  permalink?: string
  score?: number
  numComments?: number
  num_comments?: number
  commentCount?: number
  createdUtc?: number
  created_utc?: number
  createdAt?: number | string
  comments?: FetchLayerComment[]
  removed?: boolean
  deleted?: boolean
  author?: string
}

export type FetchLayerUserProfile = {
  username?: string
  name?: string
  totalKarma?: number
  total_karma?: number
  karma?: number
  postKarma?: number
  post_karma?: number
  linkKarma?: number
  link_karma?: number
  commentKarma?: number
  comment_karma?: number
  accountCreatedAt?: number | string
  createdAt?: number | string
  created_at?: number | string
  createdUtc?: number
  created_utc?: number
  created?: number | string
}

export type FetchLayerComment = {
  id?: string
  name?: string
  fullname?: string
  body?: string
  text?: string
  score?: number
  replies?: FetchLayerComment[]
  comments?: FetchLayerComment[]
  removed?: boolean
  deleted?: boolean
  author?: string
}

function baseUrl() {
  return (process.env.FETCHLAYER_BASE_URL ?? "https://fetchlayer.dev/api/reddit")
    .replace(/\/$/, "")
}

function apiKey() {
  const key = process.env.FETCHLAYER_API_KEY
  if (!key) throw new Error("FETCHLAYER_API_KEY is not configured")
  return key
}

async function fetchLayerJson<T>(
  ctx: ActionCtx,
  endpoint: string,
  body: Record<string, unknown>,
) {
  return await providerFetchJson<T>(
    ctx,
    "fetchlayer",
    endpoint,
    `${baseUrl()}/${endpoint}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  )
}

function arrayFromPayload<T>(payload: unknown, keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== "object") return []
  const record = payload as Record<string, unknown>
  for (const key of keys) {
    if (Array.isArray(record[key])) return record[key] as T[]
  }
  return []
}

export async function searchCommunities(
  ctx: ActionCtx,
  query: string,
  limit = 10,
) {
  const payload = await fetchLayerJson<unknown>(ctx, "search-communities", {
    query,
    limit,
  })
  return arrayFromPayload<FetchLayerCommunity>(payload, [
    "results",
    "communities",
    "subreddits",
  ])
}

export async function communityDetails(ctx: ActionCtx, subreddit: string) {
  return await fetchLayerJson<FetchLayerCommunity | { community?: FetchLayerCommunity }>(
    ctx,
    "community-details",
    { subreddit },
  )
}

export async function communityPosts(
  ctx: ActionCtx,
  subreddit: string,
  args: { sort?: string; time?: string; limit?: number } = {},
) {
  const payload = await fetchLayerJson<unknown>(ctx, "community-posts", {
    subreddit,
    sort: args.sort ?? "new",
    time: args.time,
    limit: args.limit ?? 100,
  })
  return arrayFromPayload<FetchLayerPost>(payload, ["posts", "results"])
}

export async function userProfile(ctx: ActionCtx, username: string) {
  return await fetchLayerJson<FetchLayerUserProfile | { user?: FetchLayerUserProfile; profile?: FetchLayerUserProfile }>(
    ctx,
    "user-profile",
    { username },
  )
}

export async function searchPosts(
  ctx: ActionCtx,
  args: { query: string; sort?: string; time?: string; limit?: number },
) {
  const query = args.query.trim()
  if (!query) throw new Error("Search query is required")
  const requestedLimit = Number.isFinite(args.limit) ? Math.floor(args.limit ?? 25) : 25
  const limit = Math.min(100, Math.max(1, requestedLimit))
  const payload = await fetchLayerJson<unknown>(ctx, "search", {
    query,
    sort: args.sort ?? "relevance",
    time: args.time ?? "month",
    limit,
  })
  return arrayFromPayload<FetchLayerPost>(payload, ["posts", "results"])
}

export async function post(
  ctx: ActionCtx,
  args: { url?: string; id?: string; pages?: number },
) {
  return await fetchLayerJson<FetchLayerPost>(ctx, "post", args)
}

export async function commentPermalink(ctx: ActionCtx, url: string) {
  return await fetchLayerJson<unknown>(ctx, "comment-permalink", { url })
}

export function communityFromDetails(
  payload: FetchLayerCommunity | { community?: FetchLayerCommunity },
): FetchLayerCommunity {
  return "community" in payload && payload.community
    ? payload.community
    : payload as FetchLayerCommunity
}
