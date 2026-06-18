import { internal } from "../_generated/api"
import type { ActionCtx } from "../_generated/server"
import { ProviderHttpError, providerFetchJson } from "./providerHttp"

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

export type ZernioAccountDetails = {
  account?: ZernioAccountDetails
  _id?: string
  id?: string
  accountId?: string
  username?: string
  redditUsername?: string
  profileId?: string
  profile_id?: string
  ownerProfileId?: string
  profile?: string | { _id?: string; id?: string }
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
  success?: boolean
  data?: {
    commentId?: string
    isReply?: boolean
    cid?: string
    permalink?: string
  }
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

export type ZernioInboxComment = {
  id?: string
  _id?: string
  commentId?: string
  redditId?: string
  thingId?: string
  name?: string
  fullname?: string
  body?: string
  text?: string
  score?: number
  likeCount?: number
  likes?: number
  replyCount?: number
  repliesCount?: number
  replies?: ZernioInboxComment[]
  comments?: ZernioInboxComment[]
  removed?: boolean
  deleted?: boolean
  author?: string
}

export type ZernioInboxThread = {
  post?: {
    id?: string
    _id?: string
    redditId?: string
    thingId?: string
    name?: string
    fullname?: string
    score?: number
    likeCount?: number
    numComments?: number
    num_comments?: number
    commentCount?: number
    replyCount?: number
    permalink?: string
    url?: string
    removed?: boolean
    deleted?: boolean
    author?: string
    selftext?: string
    body?: string
    text?: string
  }
  comments: ZernioInboxComment[]
  raw: unknown
}

type ZernioTrafficClass = "posting" | "analytics"

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
  trafficClass: ZernioTrafficClass = "posting",
) {
  const slot: { allowed: boolean; retryAfterMs?: number } = await ctx.runMutation(
    internal.analytics.acquireZernioTrafficSlot,
    { trafficClass },
  )
  if (!slot.allowed) {
    throw new ProviderHttpError("zernio", endpoint, 429, { error: "Zernio rate limit reserved" }, {
      retryAfterMs: slot.retryAfterMs,
      retryable: true,
    })
  }

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

export async function createZernioProfile(ctx: ActionCtx, name: string) {
  const body = await zernioJson<{
    profile?: { _id?: string; id?: string }
    _id?: string
    id?: string
  }>(ctx, "/profiles", {
    method: "POST",
    body: JSON.stringify({
      name,
      description: "Astreex Reddit distribution project",
    }),
  })
  const profileId = body.profile?._id ?? body.profile?.id ?? body._id ?? body.id
  if (!profileId) throw new Error("Zernio profile response was incomplete")
  return profileId
}

export async function deleteZernioProfile(ctx: ActionCtx, profileId: string) {
  await zernioJson<unknown>(ctx, `/profiles/${encodeURIComponent(profileId)}`, {
    method: "DELETE",
  })
}

export async function getAccountDetails(ctx: ActionCtx, accountId: string) {
  return await zernioJson<ZernioAccountDetails>(
    ctx,
    `/accounts/${encodeURIComponent(accountId)}`,
  )
}

function accountDetailsBody(account: ZernioAccountDetails): ZernioAccountDetails {
  return account.account ? { ...account.account, ...account } : account
}

export function zernioAccountId(account: ZernioAccountDetails) {
  const body = accountDetailsBody(account)
  return body._id ?? body.id ?? body.accountId
}

export function zernioAccountUsername(account: ZernioAccountDetails) {
  const body = accountDetailsBody(account)
  return body.redditUsername ?? body.username
}

export function zernioAccountProfileId(account: ZernioAccountDetails) {
  const body = accountDetailsBody(account)
  if (typeof body.profile === "string") return body.profile
  return (
    body.profileId ??
    body.profile_id ??
    body.ownerProfileId ??
    body.profile?._id ??
    body.profile?.id
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
    idempotencyKey?: string
  },
) {
  return await zernioJson<ZernioPostResponse>(ctx, "/posts", {
    method: "POST",
    headers: args.idempotencyKey
      ? { "Idempotency-Key": args.idempotencyKey }
      : undefined,
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

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null
}

function readCommentsPayload(payload: unknown) {
  const body = readRecord(payload)
  const data = readRecord(body?.data) ?? body
  const post = readRecord(data?.post) ?? readRecord(data?.submission) ?? readRecord(data?.thread)
  const comments =
    Array.isArray(data?.comments) ? data.comments :
    Array.isArray(data?.items) ? data.items :
    Array.isArray(data?.results) ? data.results :
    Array.isArray(data) ? data : []
  const cursor =
    typeof data?.cursor === "string" ? data.cursor :
    typeof data?.nextCursor === "string" ? data.nextCursor :
    typeof data?.next_cursor === "string" ? data.next_cursor :
    null

  return { post, comments: comments as ZernioInboxComment[], cursor }
}

export async function getRedditInboxComments(
  ctx: ActionCtx,
  args: {
    accountId: string
    postId: string
    subreddit: string
    limit?: number
    cursor?: string | null
  },
) {
  const params = new URLSearchParams({
    accountId: args.accountId,
    subreddit: args.subreddit,
    limit: String(args.limit ?? 100),
  })
  if (args.cursor) params.set("cursor", args.cursor)
  const endpoint = `/inbox/comments/${encodeURIComponent(args.postId)}?${params.toString()}`
  return await zernioJson<unknown>(ctx, endpoint, {}, "analytics")
}

export async function getRedditInboxThread(
  ctx: ActionCtx,
  args: { accountId: string; postId: string; subreddit: string },
): Promise<ZernioInboxThread> {
  let cursor: string | null = null
  let post: ZernioInboxThread["post"] | undefined
  const comments: ZernioInboxComment[] = []
  let raw: unknown = null

  for (let page = 0; page < 10; page++) {
    raw = await getRedditInboxComments(ctx, { ...args, cursor, limit: 100 })
    const parsed = readCommentsPayload(raw)
    if (!post && parsed.post) post = parsed.post as ZernioInboxThread["post"]
    comments.push(...parsed.comments)
    if (!parsed.cursor) break
    cursor = parsed.cursor
  }

  return { post, comments, raw }
}

export function zernioPostScore(thread: ZernioInboxThread) {
  const post = thread.post
  return typeof post?.score === "number"
    ? post.score
    : typeof post?.likeCount === "number"
      ? post.likeCount
      : undefined
}

export function zernioPostReplyCount(thread: ZernioInboxThread) {
  const post = thread.post
  return typeof post?.numComments === "number"
    ? post.numComments
    : typeof post?.num_comments === "number"
      ? post.num_comments
      : typeof post?.commentCount === "number"
        ? post.commentCount
        : typeof post?.replyCount === "number"
          ? post.replyCount
          : undefined
}

export function zernioCommentScore(comment: ZernioInboxComment | null) {
  return typeof comment?.likeCount === "number"
    ? comment.likeCount
    : typeof comment?.score === "number"
      ? comment.score
      : typeof comment?.likes === "number"
        ? comment.likes
        : undefined
}

export function zernioCommentReplyCount(comment: ZernioInboxComment | null) {
  return typeof comment?.replyCount === "number"
    ? comment.replyCount
    : typeof comment?.repliesCount === "number"
      ? comment.repliesCount
      : Array.isArray(comment?.replies)
        ? comment.replies.length
        : Array.isArray(comment?.comments)
          ? comment.comments.length
          : undefined
}

export async function replyToInboxPost(
  ctx: ActionCtx,
  args: {
    accountId: string
    postId: string
    message: string
    idempotencyKey?: string
  },
) {
  return await zernioJson<ZernioCommentResponse>(
    ctx,
    `/inbox/comments/${encodeURIComponent(args.postId)}`,
    {
      method: "POST",
      headers: args.idempotencyKey
        ? { "Idempotency-Key": args.idempotencyKey }
        : undefined,
      body: JSON.stringify({
        accountId: args.accountId,
        message: args.message,
      }),
    },
  )
}

export function normalizeAccountHealth(health: ZernioAccountHealth) {
  const source = { ...(health.health ?? {}), ...health }
  const status = source.status ?? "unknown"
  const issues = Array.isArray(source.issues) ? source.issues.map(String) : []
  const needsReconnect =
    source.needsReconnect ??
    issues.some((issue) => /reconnect|token|auth/i.test(issue)) ??
    false
  const canPost = source.canPost ?? (!needsReconnect && status !== "error")

  return { status, canPost, needsReconnect, issues }
}
