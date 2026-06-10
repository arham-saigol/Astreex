import { v } from "convex/values"
import { internal } from "../_generated/api"
import type { Doc, Id } from "../_generated/dataModel"
import { internalAction, internalMutation, internalQuery } from "../_generated/server"

const batchSize = 30
const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
const tenMinutesMs = 10 * 60 * 1000
const userAgent = "astreex/0.1"

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
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function deriveThingId(row: BatchRow) {
  if (row.redditThingId) return row.redditThingId
  if (row.resolvedType === "original" || row.type === "original") {
    return `t3_${row.redditId}`
  }
  return `t1_${row.redditId}`
}

function removedOrDeleted(data: Record<string, unknown>) {
  return Boolean(
    data.removed_by_category ||
      data.banned_by ||
      data.author === "[deleted]" ||
      data.body === "[removed]" ||
      data.body === "[deleted]" ||
      data.selftext === "[removed]" ||
      data.selftext === "[deleted]",
  )
}

function classifyListing(json: unknown, thingId: string) {
  const root = json as {
    data?: {
      children?: Array<{ data?: Record<string, unknown> }>
    }
  }
  const child = root?.data?.children?.find((item) => item.data?.name === thingId)
  if (!child?.data) {
    return {
      visibility: "shadow_hidden" as const,
      score: undefined,
      replyCount: undefined,
    }
  }

  if (removedOrDeleted(child.data)) {
    return {
      visibility: "removed" as const,
      score: typeof child.data.score === "number" ? child.data.score : undefined,
      replyCount: typeof child.data.num_comments === "number"
        ? child.data.num_comments
        : undefined,
    }
  }

  const replies = child.data.replies as
    | { data?: { children?: unknown[] } }
    | string
    | undefined
  const visibleReplies =
    replies && typeof replies === "object" && Array.isArray(replies.data?.children)
      ? replies.data.children.length
      : undefined

  return {
    visibility: "visible" as const,
    score: typeof child.data.score === "number" ? child.data.score : undefined,
    replyCount: typeof child.data.num_comments === "number"
      ? child.data.num_comments
      : visibleReplies,
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
      const thingId = deriveThingId(row)
      const response = await fetch(
        `https://www.reddit.com/api/info.json?id=${encodeURIComponent(thingId)}`,
        { headers: { "User-Agent": userAgent } },
      )

      if (response.status === 429) {
        rateLimited = true
        await ctx.scheduler.runAfter(
          tenMinutesMs,
          internal.pipeline.healthMonitor.checkAccountHealth,
          { beforeCreatedAt, cutoffCreatedAt },
        )
        break
      }

      if (!response.ok) {
        rateLimited = true
        console.warn(`Reddit health check failed with status ${response.status}`)
        await ctx.scheduler.runAfter(
          tenMinutesMs,
          internal.pipeline.healthMonitor.checkAccountHealth,
          { beforeCreatedAt, cutoffCreatedAt },
        )
        break
      }

      const json = await response.json()
      const result = classifyListing(json, thingId)

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

      if (index < batch.rows.length - 1) {
        await wait(2000)
      }
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
      result.push({
        ...row,
        backfillRedditAccountId: row.redditAccountId ?? card?.redditAccountId,
        resolvedType: row.type ?? card?.type,
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
    await ctx.db.patch(args.postedContentId, {
      visibility: args.visibility,
      ...(args.score !== undefined ? { score: args.score } : {}),
      ...(args.replyCount !== undefined ? { replyCount: args.replyCount } : {}),
      ...(args.redditAccountId !== undefined
        ? { redditAccountId: args.redditAccountId }
        : {}),
      lastCheckedAt: Date.now(),
    })
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
