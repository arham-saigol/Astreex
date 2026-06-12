import type { ActionCtx } from "../_generated/server"
import { providerFetchJson } from "./providerHttp"

export type ZernioAccountHealth = {
  status?: string
  canPost?: boolean
  needsReconnect?: boolean
  issues?: string[]
  health?: {
    status?: string
    canPost?: boolean
    needsReconnect?: boolean
    issues?: string[]
  }
}

export type ZernioPostResponse = {
  post?: {
    _id?: string
    id?: string
    status?: string
    platforms?: Array<{
      platform?: string
      status?: string
      platformPostId?: string
      platformPostUrl?: string
      url?: string
      error?: string
    }>
  }
  _id?: string
  id?: string
  status?: string
  platforms?: Array<{
    platform?: string
    status?: string
    platformPostId?: string
    platformPostUrl?: string
    url?: string
    error?: string
  }>
}

export type ZernioCommentResponse = {
  comment?: {
    id?: string
    _id?: string
    redditId?: string
    thingId?: string
    permalink?: string
  }
  id?: string
  _id?: string
  redditId?: string
  thingId?: string
  permalink?: string
}

function baseUrl() {
  return (process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1").replace(/\/$/, "")
}

function apiKey() {
  const key = process.env.ZERNIO_API_KEY
  if (!key) throw new Error("ZERNIO_API_KEY is not configured")
  return key
}

async function zernioJson<T>(
  ctx: ActionCtx,
  endpoint: string,
  init: RequestInit = {},
) {
  return await providerFetchJson<T>(
    ctx,
    "zernio",
    endpoint,
    `${baseUrl()}${endpoint}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    },
  )
}

export async function getAccountHealth(ctx: ActionCtx, accountId: string) {
  return await zernioJson<ZernioAccountHealth>(
    ctx,
    `/accounts/${encodeURIComponent(accountId)}/health`,
  )
}

export async function getRedditSubreddits(ctx: ActionCtx, accountId: string) {
  return await zernioJson<unknown>(
    ctx,
    `/accounts/${encodeURIComponent(accountId)}/reddit-subreddits`,
  )
}

export async function getRedditFlairs(
  ctx: ActionCtx,
  accountId: string,
  subreddit: string,
) {
  const endpoint =
    `/accounts/${encodeURIComponent(accountId)}/reddit-flairs?subreddit=${encodeURIComponent(subreddit)}`
  return await zernioJson<unknown>(ctx, endpoint)
}

export async function validateSubreddit(ctx: ActionCtx, name: string) {
  return await zernioJson<unknown>(
    ctx,
    `/tools/validate/subreddit?name=${encodeURIComponent(name)}`,
  )
}

export async function createRedditPost(
  ctx: ActionCtx,
  args: {
    accountId: string
    subreddit: string
    title: string
    content: string
  },
) {
  return await zernioJson<ZernioPostResponse>(ctx, "/posts", {
    method: "POST",
    body: JSON.stringify({
      content: args.content,
      publishNow: true,
      platforms: [
        {
          platform: "reddit",
          accountId: args.accountId,
          platformSpecificData: {
            subreddit: args.subreddit,
            title: args.title,
          },
        },
      ],
    }),
  })
}

export async function getPost(ctx: ActionCtx, postId: string) {
  return await zernioJson<ZernioPostResponse>(
    ctx,
    `/posts/${encodeURIComponent(postId)}`,
  )
}

export async function replyToInboxPost(
  ctx: ActionCtx,
  args: {
    accountId: string
    postId: string
    message: string
  },
) {
  return await zernioJson<ZernioCommentResponse>(
    ctx,
    `/inbox/comments/${encodeURIComponent(args.postId)}`,
    {
      method: "POST",
      body: JSON.stringify({
        accountId: args.accountId,
        message: args.message,
      }),
    },
  )
}

export function normalizeAccountHealth(health: ZernioAccountHealth) {
  const source = health.health ?? health
  const status = source.status ?? "unknown"
  const issues = Array.isArray(source.issues) ? source.issues.map(String) : []
  const needsReconnect =
    source.needsReconnect ??
    issues.some((issue) => /reconnect|token|auth/i.test(issue)) ??
    false
  const canPost = source.canPost ?? (!needsReconnect && status !== "error")

  return { status, canPost, needsReconnect, issues }
}
