import { v } from "convex/values"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "../_generated/server"
import { ProviderHttpError } from "../lib/providerHttp"
import {
  createRedditPost,
  getPost,
  replyToInboxPost,
  type ZernioCommentResponse,
  type ZernioPostResponse,
} from "../lib/zernio"

const tenMinutesMs = 10 * 60 * 1000
const statusPollMs = 30 * 1000

type AccountContext = {
  _id: Id<"redditAccounts">
  projectId: Id<"projects">
  isActive: boolean
  healthStatus: "healthy" | "warning" | "banned"
  zernioAccountId: string
  providerCanPost?: boolean
  providerNeedsReconnect?: boolean
}

type PostContext = {
  card: Doc<"cards">
  project: Doc<"projects">
  assignedAccount: AccountContext | null
  surfacedPost: Doc<"surfacedPosts"> | null
}

type SubmitResult = {
  redditId?: string
  redditThingId?: string
  zernioPostId?: string
  status?: string
  platformStatus?: string
  permalink?: string
  error?: string
}

function shortFailureReason(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 240)
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

function absoluteRedditUrl(value: string | undefined) {
  if (!value) return undefined
  if (value.startsWith("http://") || value.startsWith("https://")) return value
  if (value.startsWith("/")) return `https://www.reddit.com${value}`
  return value
}

function postBody(response: ZernioPostResponse) {
  return response.post ?? response
}

function redditPlatform(response: ZernioPostResponse) {
  return postBody(response).platforms?.find((item) => item.platform === "reddit")
}

function extractCreatedPost(response: ZernioPostResponse) {
  const body = postBody(response)
  const platform = redditPlatform(response)
  const redditId = platform?.platformPostId
  const redditThingId = redditId
    ? redditId.includes("_")
      ? redditId
      : `t3_${redditId}`
    : undefined

  return {
    zernioPostId: body._id ?? body.id,
    status: body.status,
    platformStatus: platform?.status,
    redditId: redditId?.includes("_") ? redditId.split("_")[1] : redditId,
    redditThingId,
    permalink: absoluteRedditUrl(platform?.platformPostUrl ?? platform?.url),
    error: platform?.error,
  }
}

function extractCreatedComment(response: ZernioCommentResponse) {
  const body = response.comment ?? response
  const redditId = body.redditId ?? body.id ?? body._id
  const redditThingId =
    body.thingId ??
    (redditId
      ? redditId.includes("_")
        ? redditId
        : `t1_${redditId}`
      : undefined)

  return {
    redditId: redditId?.includes("_") ? redditId.split("_")[1] : redditId,
    redditThingId,
    permalink: absoluteRedditUrl(body.permalink),
  }
}

function isPublished(status: string | undefined) {
  return status === "published" || status === "success" || status === "posted"
}

function isTerminalFailure(status: string | undefined) {
  return status === "failed" || status === "error" || status === "rejected"
}

async function submitToZernio(
  ctx: ActionCtx,
  account: AccountContext,
  card: Doc<"cards">,
  surfacedPost: Doc<"surfacedPosts"> | null,
): Promise<SubmitResult> {
  const content = contentForCard(card)

  if (card.type === "reply") {
    if (!surfacedPost) {
      throw new Error("Reply card is missing surfaced post")
    }

    const parentThingId = surfacedPost.redditThingId ?? `t3_${surfacedPost.redditPostId}`
    const result = extractCreatedComment(await replyToInboxPost(ctx, {
      accountId: account.zernioAccountId,
      postId: parentThingId,
      message: content,
    }))
    if (!result.redditId) {
      throw new Error("Zernio response did not include created comment")
    }
    return result
  }

  const { title, body } = parseOriginalContent(content)
  if (!title) throw new Error("Original post title is missing")
  if (!card.targetSubreddit) throw new Error("Original post subreddit is missing")

  const result = extractCreatedPost(await createRedditPost(ctx, {
    accountId: account.zernioAccountId,
    subreddit: card.targetSubreddit,
    title,
    content: body,
  }))
  if (isTerminalFailure(result.status) || isTerminalFailure(result.platformStatus)) {
    throw new Error(result.error ?? "Zernio post failed")
  }
  return result
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
    if (
      !account ||
      !account.isActive ||
      account.healthStatus !== "healthy" ||
      account.providerCanPost === false ||
      account.providerNeedsReconnect === true
    ) {
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

      const result = await submitToZernio(
        ctx,
        account,
        context.card,
        context.surfacedPost,
      )

      if (
        context.card.type === "original" &&
        result.zernioPostId &&
        !isPublished(result.status) &&
        !isPublished(result.platformStatus) &&
        result.status !== undefined
      ) {
        await ctx.scheduler.runAfter(
          statusPollMs,
          internal.pipeline.poster.pollZernioPostStatus,
          {
            cardId: args.cardId,
            redditAccountId: account._id,
            zernioPostId: result.zernioPostId,
            retryAttempt,
          },
        )
        return null
      }

      await ctx.runMutation(internal.pipeline.poster.markPostSucceeded, {
        cardId: args.cardId,
        redditAccountId: account._id,
        redditId: result.redditId ?? result.zernioPostId ?? "unknown",
        redditThingId: result.redditThingId,
        zernioPostId: result.zernioPostId,
        permalink: result.permalink,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : "Zernio post failed"
      const status = error instanceof ProviderHttpError ? error.status : undefined
      const isRetryable =
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504

      if (status === 401 || status === 403) {
        await ctx.runMutation(internal.reddit.setAccountHealthStatus, {
          redditAccountId: account._id,
          healthStatus: "warning",
        })
      }

      if (isRetryable && retryAttempt < 3) {
        await scheduleRetry(ctx, args.cardId, retryAttempt, message)
        return null
      }

      await ctx.runMutation(internal.pipeline.poster.markPostFailed, {
        cardId: args.cardId,
        retryAttempt,
        failureReason: shortFailureReason(message),
      })
    }

    return null
  },
})

export const pollZernioPostStatus = internalAction({
  args: {
    cardId: v.id("cards"),
    redditAccountId: v.id("redditAccounts"),
    zernioPostId: v.string(),
    retryAttempt: v.number(),
    pollAttempt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const pollAttempt = args.pollAttempt ?? 0
    const context: PostContext | null = await ctx.runQuery(
      internal.pipeline.poster.loadPostContext,
      { cardId: args.cardId },
    )
    if (!context || context.card.status !== "scheduled") return null

    try {
      const result = extractCreatedPost(await getPost(ctx, args.zernioPostId))
      if (isTerminalFailure(result.status) || isTerminalFailure(result.platformStatus)) {
        await ctx.runMutation(internal.pipeline.poster.markPostFailed, {
          cardId: args.cardId,
          retryAttempt: args.retryAttempt,
          failureReason: result.error ?? "Zernio post failed",
        })
        return null
      }

      if (
        result.redditId &&
        (isPublished(result.status) || isPublished(result.platformStatus))
      ) {
        await ctx.runMutation(internal.pipeline.poster.markPostSucceeded, {
          cardId: args.cardId,
          redditAccountId: args.redditAccountId,
          redditId: result.redditId,
          redditThingId: result.redditThingId,
          zernioPostId: args.zernioPostId,
          permalink: result.permalink,
        })
        return null
      }

      if (pollAttempt < 4) {
        await ctx.scheduler.runAfter(
          statusPollMs,
          internal.pipeline.poster.pollZernioPostStatus,
          { ...args, pollAttempt: pollAttempt + 1 },
        )
        return null
      }

      await ctx.runMutation(internal.pipeline.poster.markPostFailed, {
        cardId: args.cardId,
        retryAttempt: args.retryAttempt,
        failureReason: "Zernio post did not publish in time",
      })
    } catch (error) {
      const status = error instanceof ProviderHttpError ? error.status : undefined
      if (
        pollAttempt < 4 &&
        (status === 429 || status === 500 || status === 502 || status === 503)
      ) {
        await ctx.scheduler.runAfter(
          statusPollMs,
          internal.pipeline.poster.pollZernioPostStatus,
          { ...args, pollAttempt: pollAttempt + 1 },
        )
        return null
      }
      await ctx.runMutation(internal.pipeline.poster.markPostFailed, {
        cardId: args.cardId,
        retryAttempt: args.retryAttempt,
        failureReason: shortFailureReason(
          error instanceof Error ? error.message : "Zernio status check failed",
        ),
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
            zernioAccountId: assignedAccount.zernioAccountId,
            providerCanPost: assignedAccount.providerCanPost,
            providerNeedsReconnect: assignedAccount.providerNeedsReconnect,
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
        account.healthStatus === "healthy" &&
        account.providerCanPost !== false &&
        account.providerNeedsReconnect !== true,
    )

    if (!replacement) return null

    return {
      _id: replacement._id,
      projectId: replacement.projectId,
      isActive: replacement.isActive,
      healthStatus: replacement.healthStatus,
      zernioAccountId: replacement.zernioAccountId,
      providerCanPost: replacement.providerCanPost,
      providerNeedsReconnect: replacement.providerNeedsReconnect,
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
    zernioPostId: v.optional(v.string()),
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
      zernioPostId: args.zernioPostId,
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
