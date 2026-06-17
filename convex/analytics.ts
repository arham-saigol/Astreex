import { v } from "convex/values"
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { requireProjectAccess } from "./lib/auth"
import { projectRefFor, requireProjectAccessByRef } from "./lib/projectRefs"

const timeframeValidator = v.union(
  v.literal("7d"),
  v.literal("30d"),
  v.literal("all"),
)

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

type Timeframe = "7d" | "30d" | "all"

async function getAccessibleProject(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
) {
  return await requireProjectAccess(ctx, projectId)
}

function cutoffForTimeframe(timeframe: Timeframe) {
  if (timeframe === "7d") return Date.now() - 7 * DAY
  if (timeframe === "30d") return Date.now() - 30 * DAY
  return 0
}

function formatPeriod(timestamp: number, timeframe: Timeframe) {
  const date = new Date(timestamp)

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: timeframe === "all" ? undefined : "numeric",
    year: timeframe === "all" ? "numeric" : undefined,
  })
}

function emptyTrendData(timeframe: Timeframe) {
  const points = timeframe === "7d" ? 7 : 8
  const bucketSize = timeframe === "7d" ? DAY : 7 * DAY
  const now = Date.now()

  return Array.from({ length: points }, (_, index) => {
    const bucketsFromEnd = points - index - 1
    return {
      period: formatPeriod(now - bucketsFromEnd * bucketSize, timeframe),
      karma: 0,
    }
  })
}

function healthRank(status: Doc<"redditAccounts">["healthStatus"]) {
  if (status === "banned") return 2
  if (status === "warning") return 1
  return 0
}

async function getPostedContent(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  timeframe: Timeframe,
) {
  const cutoff = cutoffForTimeframe(timeframe)
  return await ctx.db
    .query("postedContent")
    .withIndex("by_projectId_and_createdAt", (q) =>
      q.eq("projectId", projectId).gte("createdAt", cutoff),
    )
    .order("desc")
    .take(500)
}

export const getDashboardContext = query({
  args: { projectRef: v.string() },
  handler: async (ctx, args) => {
    const { project, membership } = await requireProjectAccessByRef(ctx, args.projectRef)

    return {
      projectRef: projectRefFor(project),
      plan: project.plan,
      planStatus: project.planStatus,
      role: membership.role,
      lastAnalyticsRefresh: project.lastAnalyticsRefresh ?? null,
    }
  },
})

export const getDashboardMetrics = query({
  args: {
    projectRef: v.string(),
    timeframe: timeframeValidator,
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)

    const cutoff = cutoffForTimeframe(args.timeframe)
    const [postedContent, reviewedCards, accounts] = await Promise.all([
      getPostedContent(ctx, project._id, args.timeframe),
      ctx.db
        .query("cards")
        .withIndex("by_projectId_and_createdAt", (q) =>
          q.eq("projectId", project._id).gte("createdAt", cutoff),
        )
        .order("desc")
        .take(500),
      ctx.db
        .query("redditAccounts")
        .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
        .take(50),
    ])

    const decidedCards = reviewedCards.filter(
      (card) => card.status !== "pending" && card.status !== "expired",
    )
    const approvedCards = reviewedCards.filter((card) =>
      card.status === "scheduled" ||
      card.status === "posted" ||
      card.status === "approved",
    )
    const worstHealth = accounts.reduce(
      (current, account) =>
        healthRank(account.healthStatus) > healthRank(current)
          ? account.healthStatus
          : current,
      "healthy" as Doc<"redditAccounts">["healthStatus"],
    )

    return {
      postsCount: postedContent.length,
      approvalRate:
        decidedCards.length === 0
          ? 0
          : Math.round((approvedCards.length / decidedCards.length) * 100),
      karmaEarned: postedContent.reduce((sum, item) => sum + item.score, 0),
      healthStatus: worstHealth,
    }
  },
})

export const getRecentActivity = query({
  args: {
    projectRef: v.string(),
    timeframe: timeframeValidator,
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)
    const postedContent = await getPostedContent(ctx, project._id, args.timeframe)

    return await Promise.all(
      postedContent.slice(0, 10).map(async (item) => {
        const card = await ctx.db.get(item.cardId)

        return {
          id: item._id,
          subreddit: item.subreddit,
          title:
            card?.type === "original"
              ? (card.editedContent ?? card.draftContent).split("\n")[0] || "Original post"
              : card?.draftContent ?? "Reddit reply",
          score: item.score,
          postedAt: item.createdAt,
          permalink: item.permalink ?? `https://www.reddit.com/r/${item.subreddit}/`,
        }
      }),
    )
  },
})

export const getTrendData = query({
  args: {
    projectRef: v.string(),
    timeframe: timeframeValidator,
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)
    const postedContent = await getPostedContent(ctx, project._id, args.timeframe)
    const base = emptyTrendData(args.timeframe)
    if (postedContent.length === 0) return base

    const buckets = new Map(base.map((point) => [point.period, point.karma]))
    for (const item of postedContent) {
      const period = formatPeriod(item.createdAt, args.timeframe)
      buckets.set(period, (buckets.get(period) ?? 0) + item.score)
    }

    return base.map((point) => ({
      ...point,
      karma: buckets.get(point.period) ?? 0,
    }))
  },
})

export const getBestPerforming = query({
  args: {
    projectRef: v.string(),
    timeframe: timeframeValidator,
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)
    const postedContent = await getPostedContent(ctx, project._id, args.timeframe)
    const best = [...postedContent].sort((a, b) => b.score - a.score).slice(0, 5)

    return await Promise.all(
      best.map(async (item) => {
        const card = await ctx.db.get(item.cardId)

        return {
          id: item._id,
          subreddit: item.subreddit,
          score: item.score,
          snippet: card?.editedContent ?? card?.draftContent ?? "Posted content",
        }
      }),
    )
  },
})

export const getRefreshContext = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await getAccessibleProject(ctx, args.projectId)

    return {
      lastAnalyticsRefresh: project.lastAnalyticsRefresh ?? null,
    }
  },
})

export const markAnalyticsRefreshed = internalMutation({
  args: {
    projectId: v.id("projects"),
    refreshedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await getAccessibleProject(ctx, args.projectId)
    await ctx.db.patch(args.projectId, {
      lastAnalyticsRefresh: args.refreshedAt,
    })
  },
})

export const refreshAnalytics = action({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const refreshContext = await ctx.runQuery(
      internal.analytics.getRefreshContext,
      { projectId: args.projectId },
    )
    const now = Date.now()

    if (
      refreshContext.lastAnalyticsRefresh !== null &&
      now - refreshContext.lastAnalyticsRefresh < HOUR
    ) {
      return { refreshed: false }
    }

    // TODO: wire up provider analytics once available.
    return { refreshed: false }
  },
})
