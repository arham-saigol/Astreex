import { v } from "convex/values"
import { paginationOptsValidator } from "convex/server"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { internalAction, internalMutation, internalQuery } from "../_generated/server"
import { post as fetchLayerPost, type FetchLayerComment, type FetchLayerPost } from "../lib/fetchLayer"
import { upsertDashboardRollupForPostedContent } from "../lib/dashboardAnalytics"
import { getAccountHealth, normalizeAccountHealth } from "../lib/zernio"

const batchSize = 30
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
const tenMinutesMs = 10 * 60 * 1000

const visibilityValidator = v.union(
  v.literal("visible"),
  v.literal("removed"),
  v.literal("shadow_hidden"),
)
const notificationTypeValidator = v.union(
  v.literal("reddit_health_warning"),
  v.literal("reddit_health_banned"),
)

type HealthStatus = "healthy" | "warning" | "banned"

type BatchRow = Doc<"postedContent"> & {
  backfillRedditAccountId?: Id<"redditAccounts">
  resolvedType?: "reply" | "original"
  parentUrl?: string
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = []
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )
  return results
}

function removedOrDeleted(data: {
  removed?: boolean
  deleted?: boolean
  author?: string
  body?: string
  text?: string
  selftext?: string
}) {
  return Boolean(
    data.removed ||
      data.deleted ||
      data.author === "[deleted]" ||
      data.body === "[removed]" ||
      data.body === "[deleted]" ||
      data.text === "[removed]" ||
      data.text === "[deleted]" ||
      data.selftext === "[removed]" ||
      data.selftext === "[deleted]",
  )
}

function postComments(payload: FetchLayerPost) {
  return Array.isArray(payload.comments) ? payload.comments : []
}

function commentMatches(comment: FetchLayerComment, redditId: string, thingId: string) {
  const ids = [comment.id, comment.name, comment.fullname].filter(Boolean)
  return ids.some((id) => id === redditId || id === thingId || id === `t1_${redditId}`)
}

function findComment(
  comments: FetchLayerComment[],
  redditId: string,
  thingId: string,
): FetchLayerComment | null {
  for (const comment of comments) {
    if (commentMatches(comment, redditId, thingId)) return comment
    const nested = findComment(
      [
        ...(Array.isArray(comment.replies) ? comment.replies : []),
        ...(Array.isArray(comment.comments) ? comment.comments : []),
      ],
      redditId,
      thingId,
    )
    if (nested) return nested
  }
  return null
}

function classifyPost(payload: FetchLayerPost) {
  if (removedOrDeleted(payload)) {
    return {
      visibility: "removed" as const,
      score: payload.score,
      replyCount: payload.numComments ?? payload.num_comments ?? payload.commentCount,
    }
  }

  return {
    visibility: "visible" as const,
    score: payload.score,
    replyCount: payload.numComments ?? payload.num_comments ?? payload.commentCount,
  }
}

function classifyComment(comment: FetchLayerComment | null) {
  if (!comment) {
    return {
      visibility: "shadow_hidden" as const,
      score: undefined,
      replyCount: undefined,
    }
  }

  if (removedOrDeleted(comment)) {
    return {
      visibility: "removed" as const,
      score: comment.score,
      replyCount: undefined,
    }
  }

  return {
    visibility: "visible" as const,
    score: comment.score,
    replyCount: Array.isArray(comment.replies)
      ? comment.replies.length
      : Array.isArray(comment.comments)
        ? comment.comments.length
        : undefined,
  }
}

export const checkAccountHealth = internalAction({
  args: {
    beforeCreatedAt: v.optional(v.number()),
    cutoffCreatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const beforeCreatedAt = args.beforeCreatedAt ?? Date.now() + 1
    const cutoffCreatedAt = args.cutoffCreatedAt ?? Date.now() - sevenDaysMs

    const batch: { rows: BatchRow[]; hasMore: boolean } = await ctx.runQuery(
      internal.pipeline.healthMonitor.loadRecentPostedBatch,
      { beforeCreatedAt, cutoffCreatedAt },
    )

    const affectedAccounts = new Set<Id<"redditAccounts">>()
    let lastProcessedCreatedAt: number | null = null
    let rateLimited = false

    for (let index = 0; index < batch.rows.length; index++) {
      const row = batch.rows[index]
      const type = row.resolvedType ?? row.type
      const thingId = row.redditThingId ?? `${type === "original" ? "t3" : "t1"}_${row.redditId}`
      const url =
        type === "reply"
          ? row.parentUrl ?? row.permalink
          : row.permalink ??
            `https://www.reddit.com/r/${row.subreddit}/comments/${row.redditId}`
      if (!url) continue

      let result: ReturnType<typeof classifyPost> | ReturnType<typeof classifyComment>
      try {
        const payload = await fetchLayerPost(ctx, { url, pages: 2 })
        result = type === "reply"
          ? classifyComment(findComment(postComments(payload), row.redditId, thingId))
          : classifyPost(payload)
      } catch (error) {
        rateLimited = true
        console.warn(
          `FetchLayer health check failed: ${
            error instanceof Error ? error.message : "request failed"
          }`,
        )
        await ctx.scheduler.runAfter(
          tenMinutesMs,
          internal.pipeline.healthMonitor.checkAccountHealth,
          { beforeCreatedAt, cutoffCreatedAt },
        )
        break
      }

      await ctx.runMutation(
        internal.pipeline.healthMonitor.updatePostedContentVisibility,
        {
          postedContentId: row._id,
          visibility: result.visibility,
          score: result.score,
          replyCount: result.replyCount,
          redditAccountId: row.redditAccountId ?? row.backfillRedditAccountId,
        },
      )

      const redditAccountId = row.redditAccountId ?? row.backfillRedditAccountId
      if (redditAccountId) affectedAccounts.add(redditAccountId)
      lastProcessedCreatedAt = row.createdAt

    }

    for (const redditAccountId of affectedAccounts) {
      const transition: {
        projectId: Id<"projects">
        redditAccountId: Id<"redditAccounts">
        previousHealthStatus: "healthy" | "warning" | "banned"
        healthStatus: "healthy" | "warning" | "banned"
      } | null = await ctx.runMutation(
        internal.pipeline.healthMonitor.recomputeAccountHealth,
        { redditAccountId },
      )
      if (!transition) continue

      if (transition.healthStatus === "healthy") {
        await ctx.runMutation(
          internal.pipeline.healthMonitor.resolveHealthNotifications,
          {
            projectId: transition.projectId,
            redditAccountId: transition.redditAccountId,
          },
        )
      } else if (transition.healthStatus !== transition.previousHealthStatus) {
        await ctx.runMutation(
          internal.pipeline.healthMonitor.upsertHealthNotification,
          {
            projectId: transition.projectId,
            redditAccountId: transition.redditAccountId,
            type: transition.healthStatus === "banned"
              ? "reddit_health_banned"
              : "reddit_health_warning",
            message: transition.healthStatus === "banned"
              ? "A Reddit account appears to be shadow hidden."
              : "A Reddit account has an elevated hidden content rate.",
          },
        )
      }
    }

    if (!rateLimited && batch.hasMore && lastProcessedCreatedAt !== null) {
      await ctx.scheduler.runAfter(
        0,
        internal.pipeline.healthMonitor.checkAccountHealth,
        { beforeCreatedAt: lastProcessedCreatedAt, cutoffCreatedAt },
      )
    }

    return null
  },
})

export const syncZernioProviderHealth = internalAction({
  args: {},
  handler: async (ctx) => {
    let cursor: string | null = null
    let isDone = false

    while (!isDone) {
      const accounts: {
        page: Array<{
          _id: Id<"redditAccounts">
          zernioAccountId: string
        }>
        isDone: boolean
        continueCursor: string
      } = await ctx.runQuery(
        internal.pipeline.healthMonitor.loadConnectedProviderAccounts,
        { paginationOpts: { numItems: 100, cursor } },
      )

      await mapWithConcurrency(accounts.page, 5, async (account) => {
        try {
          const health = normalizeAccountHealth(
            await getAccountHealth(ctx, account.zernioAccountId),
          )
          await ctx.runMutation(internal.reddit.updateProviderHealth, {
            redditAccountId: account._id,
            providerHealthStatus: health.status,
            providerCanPost: health.canPost,
            providerNeedsReconnect: health.needsReconnect,
            providerIssues: health.issues,
          })
        } catch (error) {
          await ctx.runMutation(internal.reddit.updateProviderHealth, {
            redditAccountId: account._id,
            providerHealthStatus: "error",
            providerCanPost: false,
            providerNeedsReconnect: false,
            providerIssues: [
              error instanceof Error ? error.message.slice(0, 240) : "Health check failed",
            ],
          })
        }
      })

      cursor = accounts.continueCursor
      isDone = accounts.isDone
    }
  },
})

export const loadConnectedProviderAccounts = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("redditAccounts")
      .paginate(args.paginationOpts)
    return {
      ...rows,
      page: rows.page
        .filter((row) => row.isActive)
        .map((row) => ({
          _id: row._id,
          zernioAccountId: row.zernioAccountId,
        })),
    }
  },
})

export const loadRecentPostedBatch = internalQuery({
  args: {
    beforeCreatedAt: v.number(),
    cutoffCreatedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("postedContent")
      .withIndex("by_createdAt", (q) =>
        q.gte("createdAt", args.cutoffCreatedAt).lt("createdAt", args.beforeCreatedAt),
      )
      .order("desc")
      .take(batchSize + 1)

    const result: BatchRow[] = []
    for (const row of rows.slice(0, batchSize)) {
      const project = await ctx.db.get(row.projectId)
      if (!project || (project.planStatus !== "active" && project.planStatus !== "trialing")) {
        continue
      }

      const card = await ctx.db.get(row.cardId)
      const surfacedPost = card?.surfacedPostId
        ? await ctx.db.get(card.surfacedPostId)
        : null
      result.push({
        ...row,
        backfillRedditAccountId: row.redditAccountId ?? card?.redditAccountId,
        resolvedType: row.type ?? card?.type,
        parentUrl: surfacedPost?.url,
      })
    }

    return { rows: result, hasMore: rows.length > batchSize }
  },
})

export const updatePostedContentVisibility = internalMutation({
  args: {
    postedContentId: v.id("postedContent"),
    visibility: visibilityValidator,
    score: v.optional(v.number()),
    replyCount: v.optional(v.number()),
    redditAccountId: v.optional(v.id("redditAccounts")),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.postedContentId)
    if (!row) return null
    if (args.redditAccountId !== undefined && args.redditAccountId !== row.redditAccountId) {
      throw new Error("Changing posted content Reddit account is not supported")
    }
    const nextScore = args.score ?? row.score
    const rollupPatch = args.score !== undefined
      ? await upsertDashboardRollupForPostedContent(ctx, row, nextScore)
      : {}

    await ctx.db.patch(args.postedContentId, {
      ...rollupPatch,
      visibility: args.visibility,
      ...(args.score !== undefined ? { score: args.score } : {}),
      ...(args.replyCount !== undefined ? { replyCount: args.replyCount } : {}),
      ...(args.redditAccountId !== undefined
        ? { redditAccountId: args.redditAccountId }
        : {}),
      lastCheckedAt: Date.now(),
    })
    return null
  },
})

export const recomputeAccountHealth = internalMutation({
  args: {
    redditAccountId: v.id("redditAccounts"),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.redditAccountId)
    if (!account) return null

    const rows = await ctx.db
      .query("postedContent")
      .withIndex("by_redditAccountId_and_createdAt", (q) =>
        q
          .eq("redditAccountId", args.redditAccountId)
          .gte("createdAt", Date.now() - sevenDaysMs),
      )
      .order("desc")
      .take(500)

    const hidden = rows.filter((row) => row.visibility === "shadow_hidden").length
    const hiddenRate = rows.length === 0 ? 0 : hidden / rows.length
    const healthStatus: HealthStatus =
      hiddenRate > 0.6 ? "banned" : hiddenRate > 0.3 ? "warning" : "healthy"

    await ctx.db.patch(args.redditAccountId, {
      healthStatus,
      lastCheckedAt: Date.now(),
    })

    return {
      projectId: account.projectId,
      redditAccountId: args.redditAccountId,
      previousHealthStatus: account.healthStatus,
      healthStatus,
    }
  },
})

export const upsertHealthNotification = internalMutation({
  args: {
    projectId: v.id("projects"),
    redditAccountId: v.id("redditAccounts"),
    type: notificationTypeValidator,
    message: v.string(),
  },
  handler: async (ctx, args) => {
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_projectId_and_type_and_redditAccountId_and_status", (q) =>
        q
          .eq("projectId", args.projectId)
          .eq("type", args.type)
          .eq("redditAccountId", args.redditAccountId)
          .eq("status", "unread"),
      )
      .first()

    const now = Date.now()
    if (unread) {
      await ctx.db.patch(unread._id, {
        message: args.message,
        updatedAt: now,
      })
      return
    }

    // TODO: Send these health alerts through Resend when email delivery is added.
    await ctx.db.insert("notifications", {
      projectId: args.projectId,
      redditAccountId: args.redditAccountId,
      type: args.type,
      status: "unread",
      message: args.message,
      createdAt: now,
      updatedAt: now,
    })
  },
})

export const resolveHealthNotifications = internalMutation({
  args: {
    projectId: v.id("projects"),
    redditAccountId: v.id("redditAccounts"),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    for (const type of ["reddit_health_warning", "reddit_health_banned"] as const) {
      const notification = await ctx.db
        .query("notifications")
        .withIndex("by_projectId_and_type_and_redditAccountId_and_status", (q) =>
          q
            .eq("projectId", args.projectId)
            .eq("type", type)
            .eq("redditAccountId", args.redditAccountId)
            .eq("status", "unread"),
        )
        .first()

      if (notification) {
        await ctx.db.patch(notification._id, {
          status: "resolved",
          updatedAt: now,
        })
      }
    }
  },
})
