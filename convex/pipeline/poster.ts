import { v } from "convex/values"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../_generated/server"
import { withRateLimit } from "../lib/rateLimiter"

const userAgent = "astreex/0.1"
const tenMinutesMs = 10 * 60 * 1000

type AccountContext = {
  _id: Id<"redditAccounts">
  projectId: Id<"projects">
  isActive: boolean
  healthStatus: "healthy" | "warning" | "banned"
}

type PostContext = {
  card: Doc<"cards">
  project: Doc<"projects">
  assignedAccount: AccountContext | null
  surfacedPost: Doc<"surfacedPosts"> | null
}

type RedditWriteResult = {
  ok: boolean
  status: number
  json: unknown
}

function shortFailureReason(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240)
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function contentForCard(card: Doc<"cards">) {
  return (card.editedContent ?? card.draftContent).trim()
}

function parseOriginalContent(content: string) {
  const lines = content.split(/\r?\n/)
  const title = (lines.shift() ?? "").trim().slice(0, 300)
  const body = lines.join("\n").trim()
  return { title, body }
}

function redditJsonErrors(json: unknown) {
  if (!json || typeof json !== "object") return []
  const root = json as {
    json?: { errors?: unknown }
    errors?: unknown
  }
  const errors = root.json?.errors ?? root.errors
  return Array.isArray(errors) ? errors : []
}

function hasRateLimitError(json: unknown) {
  return redditJsonErrors(json).some((error) => {
    if (!Array.isArray(error)) return false
    return String(error[0] ?? "").toUpperCase() === "RATELIMIT"
  })
}

function hasRedditErrors(json: unknown) {
  return redditJsonErrors(json).length > 0
}

function extractCreatedThing(json: unknown) {
  const root = json as {
    json?: {
      data?: {
        things?: Array<{ data?: { name?: string; id?: string; permalink?: string } }>
        name?: string
        id?: string
        permalink?: string
      }
    }
  }
  const data = root?.json?.data
  const firstThing = data?.things?.[0]?.data
  const name = firstThing?.name ?? data?.name
  const id = firstThing?.id ?? data?.id ?? (name?.includes("_") ? name.split("_")[1] : undefined)
  const permalink = firstThing?.permalink ?? data?.permalink

  return {
    redditThingId: name,
    redditId: id,
    permalink,
  }
}

async function submitToReddit(
  ctx: ActionCtx,
  token: string,
  card: Doc<"cards">,
  surfacedPost: Doc<"surfacedPosts"> | null,
) {
  const content = contentForCard(card)

  return await withRateLimit(ctx, 2, async (): Promise<RedditWriteResult> => {
    if (card.type === "reply") {
      if (!surfacedPost) {
        throw new Error("Reply card is missing surfaced post")
      }

      const body = new URLSearchParams({
        api_type: "json",
        thing_id: `t3_${surfacedPost.redditPostId}`,
        text: content,
      })
      const response = await fetchWithTimeout("https://oauth.reddit.com/api/comment", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": userAgent,
        },
        body,
      }, 10_000)

      return { ok: response.ok, status: response.status, json: await response.json() }
    }

    const { title, body: text } = parseOriginalContent(content)
    if (!title) throw new Error("Original post title is missing")
    if (!card.targetSubreddit) throw new Error("Original post subreddit is missing")

    const body = new URLSearchParams({
      api_type: "json",
      sr: card.targetSubreddit,
      kind: "self",
      title,
      text,
    })
    const response = await fetchWithTimeout("https://oauth.reddit.com/api/submit", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body,
    }, 10_000)

    return { ok: response.ok, status: response.status, json: await response.json() }
  })
}

async function scheduleRetry(
  ctx: ActionCtx,
  cardId: Id<"cards">,
  retryAttempt: number,
  reason: string,
) {
  await ctx.runMutation(internal.pipeline.poster.markPostAttempt, {
    cardId,
    retryAttempt: retryAttempt + 1,
    failureReason: shortFailureReason(reason),
  })
  await ctx.scheduler.runAfter(
    tenMinutesMs,
    internal.pipeline.poster.postToReddit,
    { cardId, retryAttempt: retryAttempt + 1 },
  )
}

export const postToReddit = internalAction({
  args: {
    cardId: v.id("cards"),
    retryAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const retryAttempt = args.retryAttempt ?? 0
    const context: PostContext | null = await ctx.runQuery(
      internal.pipeline.poster.loadPostContext,
      { cardId: args.cardId },
    )
    if (!context) return null
    if (context.card.status !== "scheduled" && context.card.status !== "approved") {
      return null
    }

    let account = context.assignedAccount
    if (!account || !account.isActive || account.healthStatus !== "healthy") {
      const replacement: AccountContext | null = await ctx.runQuery(
        internal.pipeline.poster.chooseHealthyReplacementAccount,
        {
          projectId: context.card.projectId,
          currentRedditAccountId: context.card.redditAccountId,
        },
      )

      if (!replacement) {
        await ctx.runMutation(internal.pipeline.poster.markPostFailed, {
          cardId: args.cardId,
          retryAttempt,
          failureReason: "No healthy Reddit account available",
        })
        return null
      }

      await ctx.runMutation(internal.pipeline.poster.reassignCardAccount, {
        cardId: args.cardId,
        redditAccountId: replacement._id,
      })
      account = replacement
    }

    try {
      await ctx.runMutation(internal.pipeline.poster.markPostAttempt, {
        cardId: args.cardId,
        retryAttempt,
      })

      const token: string = await ctx.runAction(internal.reddit.getValidToken, {
        redditAccountId: account._id,
      })
      const result = await submitToReddit(
        ctx,
        token,
        context.card,
        context.surfacedPost,
      )

      if (result.status === 401 || result.status === 403) {
        await ctx.runMutation(internal.reddit.setAccountHealthStatus, {
          redditAccountId: account._id,
          healthStatus: "warning",
        })
        await ctx.runMutation(internal.pipeline.poster.markPostFailed, {
          cardId: args.cardId,
          retryAttempt,
          failureReason: "Reddit authorization failed",
        })
        return null
      }

      if (result.status === 429 || hasRateLimitError(result.json)) {
        if (retryAttempt < 3) {
          await scheduleRetry(ctx, args.cardId, retryAttempt, "Reddit rate limit")
          return null
        }

        await ctx.runMutation(internal.pipeline.poster.markPostFailed, {
          cardId: args.cardId,
          retryAttempt,
          failureReason: "Reddit rate limit",
        })
        return null
      }

      if (!result.ok || hasRedditErrors(result.json)) {
        await ctx.runMutation(internal.pipeline.poster.markPostFailed, {
          cardId: args.cardId,
          retryAttempt,
          failureReason: "Reddit post failed",
        })
        return null
      }

      const created = extractCreatedThing(result.json)
      if (!created.redditId) {
        await ctx.runMutation(internal.pipeline.poster.markPostFailed, {
          cardId: args.cardId,
          retryAttempt,
          failureReason: "Reddit response did not include created content",
        })
        return null
      }

      await ctx.runMutation(internal.pipeline.poster.markPostSucceeded, {
        cardId: args.cardId,
        redditAccountId: account._id,
        redditId: created.redditId,
        redditThingId: created.redditThingId,
        permalink: created.permalink,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Reddit post failed"
      const isCapacityError = message.includes("rate limit capacity")

      if (isCapacityError && retryAttempt < 3) {
        await scheduleRetry(ctx, args.cardId, retryAttempt, message)
        return null
      }

      await ctx.runMutation(internal.pipeline.poster.markPostFailed, {
        cardId: args.cardId,
        retryAttempt,
        failureReason: isCapacityError
          ? "Reddit rate limit capacity was not available"
          : shortFailureReason(message),
      })
    }

    return null
  },
})

export const loadPostContext = internalQuery({
  args: {
    cardId: v.id("cards"),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId)
    if (!card) return null

    const project = await ctx.db.get(card.projectId)
    const assignedAccount = await ctx.db.get(card.redditAccountId)
    const surfacedPost = card.surfacedPostId
      ? await ctx.db.get(card.surfacedPostId)
      : null

    if (!project) return null

    return {
      card,
      project,
      assignedAccount: assignedAccount
        ? {
            _id: assignedAccount._id,
            projectId: assignedAccount.projectId,
            isActive: assignedAccount.isActive,
            healthStatus: assignedAccount.healthStatus,
          }
        : null,
      surfacedPost,
    }
  },
})

export const chooseHealthyReplacementAccount = internalQuery({
  args: {
    projectId: v.id("projects"),
    currentRedditAccountId: v.id("redditAccounts"),
  },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .take(50)

    const replacement = accounts.find(
      (account) =>
        account._id !== args.currentRedditAccountId &&
        account.isActive &&
        account.healthStatus === "healthy",
    )

    if (!replacement) return null

    return {
      _id: replacement._id,
      projectId: replacement.projectId,
      isActive: replacement.isActive,
      healthStatus: replacement.healthStatus,
    }
  },
})

export const markPostAttempt = internalMutation({
  args: {
    cardId: v.id("cards"),
    retryAttempt: v.number(),
    failureReason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.cardId, {
      postRetryCount: args.retryAttempt,
      lastPostAttemptAt: Date.now(),
      ...(args.failureReason !== undefined ? { failureReason: args.failureReason } : {}),
    })
  },
})

export const markPostSucceeded = internalMutation({
  args: {
    cardId: v.id("cards"),
    redditAccountId: v.id("redditAccounts"),
    redditId: v.string(),
    redditThingId: v.optional(v.string()),
    permalink: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId)
    if (!card) throw new Error("Card not found")

    const postedAt = Date.now()
    const subreddit = card.targetSubreddit ?? "unknown"
    const redditThingId =
      args.redditThingId ??
      `${card.type === "reply" ? "t1" : "t3"}_${args.redditId}`

    await ctx.db.patch(args.cardId, {
      status: "posted",
      postedAt,
      redditCommentId: args.redditId,
      redditAccountId: args.redditAccountId,
      lastPostAttemptAt: postedAt,
      failureReason: undefined,
    })

    await ctx.db.insert("postedContent", {
      projectId: card.projectId,
      cardId: args.cardId,
      redditAccountId: args.redditAccountId,
      redditId: args.redditId,
      redditThingId,
      subreddit,
      type: card.type,
      permalink: args.permalink,
      score: 0,
      replyCount: 0,
      visibility: "visible",
      lastCheckedAt: postedAt,
      createdAt: postedAt,
    })
  },
})

export const markPostFailed = internalMutation({
  args: {
    cardId: v.id("cards"),
    retryAttempt: v.number(),
    failureReason: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.cardId, {
      status: "failed",
      failureReason: shortFailureReason(args.failureReason),
      postRetryCount: args.retryAttempt,
      lastPostAttemptAt: Date.now(),
    })
  },
})

export const reassignCardAccount = internalMutation({
  args: {
    cardId: v.id("cards"),
    redditAccountId: v.id("redditAccounts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.cardId, {
      redditAccountId: args.redditAccountId,
    })
  },
})
