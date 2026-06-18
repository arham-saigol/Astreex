import { v } from "convex/values"
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Doc, Id } from "./_generated/dataModel"
import { post as fetchLayerPost, type FetchLayerComment, type FetchLayerPost } from "./lib/fetchLayer"
import { ProviderHttpError } from "./lib/providerHttp"
import { requireProjectAccess } from "./lib/auth"
import { projectRefFor, requireProjectAccessByRef } from "./lib/projectRefs"
import {
  getRedditInboxThread,
  zernioCommentReplyCount,
  zernioCommentScore,
  zernioPostReplyCount,
  zernioPostScore,
  type ZernioInboxComment,
  type ZernioInboxThread,
} from "./lib/zernio"

const timeframeValidator = v.union(
  v.literal("7d"),
  v.literal("30d"),
  v.literal("all"),
)
const trafficClassValidator = v.union(v.literal("posting"), v.literal("analytics"))
const visibilityValidator = v.union(
  v.literal("visible"),
  v.literal("removed"),
  v.literal("shadow_hidden"),
)
const sourceValidator = v.union(v.literal("zernio"), v.literal("fetchlayer"))

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const FIVE_MINUTES = 5 * MINUTE
const THIRTY_MINUTES = 30 * MINUTE
const SESSION_TTL = 45 * 1000
const LOCK_TTL = 2 * MINUTE
const ANALYTICS_CONCURRENCY = 3
const ZERNIO_GLOBAL_RPM = 600
const ZERNIO_POSTING_RESERVE_RPM = 120
const FETCHLAYER_FALLBACKS_PER_RUN = 3

type Timeframe = "7d" | "30d" | "all"
type Visibility = Doc<"postedContent">["visibility"]
type AccountFilter = Set<Id<"redditAccounts">> | null

type RefreshRow = {
  postedContentId: Id<"postedContent">
  redditId: string
  redditThingId?: string
  type?: "reply" | "original"
  score: number
  replyCount: number
  visibility: Visibility
  createdAt: number
}

type RefreshGroup = {
  key: string
  projectId: Id<"projects">
  zernioAccountId: string
  parentRedditThingId: string
  subreddit: string
  parentPermalink?: string
  fallbackEligible: boolean
  rows: RefreshRow[]
}

function cutoffForTimeframe(timeframe: Timeframe, now = Date.now()) {
  if (timeframe === "7d") return now - 7 * DAY
  if (timeframe === "30d") return now - 30 * DAY
  return 0
}

function dayKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

function monthKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 7)
}

function displayDay(key: string) {
  const [year, month, day] = key.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  })
}

function displayMonth(key: string) {
  const [year, month] = key.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
  })
}

function addDays(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return dayKey(date.getTime())
}

function addMonths(key: string, months: number) {
  const [year, month] = key.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1 + months, 1))
  return monthKey(date.getTime())
}

function accountKey(accountId: Id<"redditAccounts"> | undefined) {
  return accountId ?? "unknown"
}

function healthRank(status: Doc<"redditAccounts">["healthStatus"]) {
  if (status === "banned") return 2
  if (status === "warning") return 1
  return 0
}

function isSelectedAccount(accountFilter: AccountFilter, accountId: Id<"redditAccounts"> | undefined) {
  return accountFilter === null || (accountId !== undefined && accountFilter.has(accountId))
}

function analyticsStaleAfter(createdAt: number, now = Date.now()) {
  return now - createdAt < 7 * DAY ? FIVE_MINUTES : THIRTY_MINUTES
}

function isAnalyticsStale(row: Pick<Doc<"postedContent">, "createdAt" | "lastCheckedAt" | "lastAnalyticsAttemptAt">, now = Date.now()) {
  const checkedAt = row.lastAnalyticsAttemptAt ?? row.lastCheckedAt
  return now - checkedAt >= analyticsStaleAfter(row.createdAt, now)
}

function shortError(error: unknown) {
  return (error instanceof Error ? error.message : "Analytics refresh failed")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240)
}

async function validateAccountFilter(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  redditAccountIds: Id<"redditAccounts">[] | undefined,
): Promise<AccountFilter> {
  if (!redditAccountIds || redditAccountIds.length === 0) return null

  const uniqueIds = [...new Set(redditAccountIds)]
  for (const accountId of uniqueIds) {
    const account = await ctx.db.get(accountId)
    if (!account || account.projectId !== projectId || !account.isActive) {
      throw new Error("Invalid Reddit account filter")
    }
  }
  return new Set(uniqueIds)
}

async function getPostedContent(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  timeframe: Timeframe,
  accountFilter: AccountFilter,
) {
  const cutoff = cutoffForTimeframe(timeframe)
  const rows: Doc<"postedContent">[] = []
  for await (const row of ctx.db
    .query("postedContent")
    .withIndex("by_projectId_and_createdAt", (q) =>
      q.eq("projectId", projectId).gte("createdAt", cutoff),
    )
    .order("desc")) {
    if (isSelectedAccount(accountFilter, row.redditAccountId)) rows.push(row)
  }
  return rows
}

async function getRollups(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  timeframe: Timeframe,
  accountFilter: AccountFilter,
) {
  const cutoff = cutoffForTimeframe(timeframe)
  const cutoffDay = dayKey(cutoff)
  const rows: Doc<"dashboardDailyRollups">[] = []
  for await (const row of ctx.db
    .query("dashboardDailyRollups")
    .withIndex("by_projectId_and_day", (q) =>
      q.eq("projectId", projectId).gte("day", cutoffDay),
    )) {
    if (timeframe !== "all" && row.day < cutoffDay) continue
    if (isSelectedAccount(accountFilter, row.redditAccountId)) rows.push(row)
  }
  return rows
}

async function getRollupOrContentTotals(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  timeframe: Timeframe,
  accountFilter: AccountFilter,
) {
  const rollups = await getRollups(ctx, projectId, timeframe, accountFilter)
  const contentFallback = await getPostedContent(ctx, projectId, timeframe, accountFilter)
  const allRowsRolledUp =
    contentFallback.length > 0 &&
    contentFallback.every((row) => row.dashboardRollupAppliedAt !== undefined)

  if (rollups.length > 0 && allRowsRolledUp) {
    return {
      postsCount: rollups.reduce((sum, row) => sum + row.postsCount, 0),
      karmaEarned: rollups.reduce((sum, row) => sum + row.karmaEarned, 0),
      rollups,
      contentFallback: null,
    }
  }

  return {
    postsCount: contentFallback.length,
    karmaEarned: contentFallback.reduce((sum, row) => sum + row.score, 0),
    rollups,
    contentFallback,
  }
}

async function getApprovalRate(
  ctx: QueryCtx,
  projectId: Id<"projects">,
  timeframe: Timeframe,
  accountFilter: AccountFilter,
) {
  const cutoff = cutoffForTimeframe(timeframe)
  let decided = 0
  let approved = 0

  for await (const card of ctx.db
    .query("cards")
    .withIndex("by_projectId_and_createdAt", (q) =>
      q.eq("projectId", projectId).gte("createdAt", cutoff),
    )) {
    if (!isSelectedAccount(accountFilter, card.redditAccountId)) continue
    if (card.status === "pending" || card.status === "expired") continue
    decided += 1
    if (
      card.status === "scheduled" ||
      card.status === "posted" ||
      card.status === "approved"
    ) {
      approved += 1
    }
  }

  return decided === 0 ? 0 : Math.round((approved / decided) * 100)
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

function idsMatch(ids: Array<string | undefined>, redditId: string, thingId: string) {
  return ids.filter(Boolean).some((id) =>
    id === redditId || id === thingId || id === `t1_${redditId}` || id === `t3_${redditId}`,
  )
}

function zernioCommentMatches(comment: ZernioInboxComment, redditId: string, thingId: string) {
  return idsMatch([
    comment.id,
    comment._id,
    comment.commentId,
    comment.redditId,
    comment.thingId,
    comment.name,
    comment.fullname,
  ], redditId, thingId)
}

function findZernioComment(
  comments: ZernioInboxComment[],
  redditId: string,
  thingId: string,
): ZernioInboxComment | null {
  for (const comment of comments) {
    if (zernioCommentMatches(comment, redditId, thingId)) return comment
    const nested = findZernioComment(
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

function classifyZernioPost(thread: ZernioInboxThread) {
  if (thread.post && removedOrDeleted(thread.post)) {
    return {
      visibility: "removed" as const,
      score: zernioPostScore(thread),
      replyCount: zernioPostReplyCount(thread),
    }
  }
  return {
    visibility: "visible" as const,
    score: zernioPostScore(thread),
    replyCount: zernioPostReplyCount(thread),
  }
}

function classifyZernioComment(comment: ZernioInboxComment | null) {
  if (!comment) {
    return { visibility: "shadow_hidden" as const, score: undefined, replyCount: undefined }
  }
  if (removedOrDeleted(comment)) {
    return {
      visibility: "removed" as const,
      score: zernioCommentScore(comment),
      replyCount: zernioCommentReplyCount(comment),
    }
  }
  return {
    visibility: "visible" as const,
    score: zernioCommentScore(comment),
    replyCount: zernioCommentReplyCount(comment),
  }
}

function fetchLayerPostComments(payload: FetchLayerPost) {
  return Array.isArray(payload.comments) ? payload.comments : []
}

function fetchLayerCommentMatches(comment: FetchLayerComment, redditId: string, thingId: string) {
  return idsMatch([comment.id, comment.name, comment.fullname], redditId, thingId)
}

function findFetchLayerComment(
  comments: FetchLayerComment[],
  redditId: string,
  thingId: string,
): FetchLayerComment | null {
  for (const comment of comments) {
    if (fetchLayerCommentMatches(comment, redditId, thingId)) return comment
    const nested = findFetchLayerComment(
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

function classifyFetchLayerPost(payload: FetchLayerPost) {
  const base = {
    score: payload.score,
    replyCount: payload.numComments ?? payload.num_comments ?? payload.commentCount,
  }
  return { ...base, visibility: removedOrDeleted(payload) ? "removed" as const : "visible" as const }
}

function classifyFetchLayerComment(comment: FetchLayerComment | null) {
  if (!comment) return { visibility: "shadow_hidden" as const, score: undefined, replyCount: undefined }
  const replyCount = Array.isArray(comment.replies)
    ? comment.replies.length
    : Array.isArray(comment.comments)
      ? comment.comments.length
      : undefined
  return {
    visibility: removedOrDeleted(comment) ? "removed" as const : "visible" as const,
    score: comment.score,
    replyCount,
  }
}

function classifyZernioRow(thread: ZernioInboxThread, row: RefreshRow) {
  const type = row.type ?? (row.redditThingId?.startsWith("t3_") ? "original" : "reply")
  if (type === "original") return classifyZernioPost(thread)
  const thingId = row.redditThingId ?? `t1_${row.redditId}`
  return classifyZernioComment(findZernioComment(thread.comments, row.redditId, thingId))
}

function classifyFetchLayerRow(payload: FetchLayerPost, row: RefreshRow) {
  const type = row.type ?? (row.redditThingId?.startsWith("t3_") ? "original" : "reply")
  if (type === "original") return classifyFetchLayerPost(payload)
  const thingId = row.redditThingId ?? `t1_${row.redditId}`
  return classifyFetchLayerComment(findFetchLayerComment(fetchLayerPostComments(payload), row.redditId, thingId))
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
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
  return results
}

async function activeSessionExists(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  sessionId: string,
  now: number,
) {
  const session = await ctx.db
    .query("dashboardAnalyticsSessions")
    .withIndex("by_projectId_and_sessionId", (q) =>
      q.eq("projectId", projectId).eq("sessionId", sessionId),
    )
    .unique()
  return Boolean(session && !session.closedAt && session.expiresAt > now)
}

async function upsertRollupForPostedContent(
  ctx: MutationCtx,
  row: Pick<
    Doc<"postedContent">,
    | "projectId"
    | "redditAccountId"
    | "createdAt"
    | "score"
    | "dashboardRollupAppliedAt"
    | "dashboardRollupScore"
  >,
  nextScore: number,
) {
  const key = accountKey(row.redditAccountId)
  const day = dayKey(row.createdAt)
  const now = Date.now()
  const existing = await ctx.db
    .query("dashboardDailyRollups")
    .withIndex("by_projectId_and_accountKey_and_day", (q) =>
      q.eq("projectId", row.projectId).eq("accountKey", key).eq("day", day),
    )
    .unique()
  const wasApplied = row.dashboardRollupAppliedAt !== undefined
  const previousRollupScore = row.dashboardRollupScore ?? row.score

  if (!existing) {
    await ctx.db.insert("dashboardDailyRollups", {
      projectId: row.projectId,
      redditAccountId: row.redditAccountId,
      accountKey: key,
      day,
      postsCount: 1,
      karmaEarned: nextScore,
      lastActivityAt: row.createdAt,
      updatedAt: now,
    })
  } else {
    await ctx.db.patch(existing._id, {
      postsCount: existing.postsCount + (wasApplied ? 0 : 1),
      karmaEarned: existing.karmaEarned + (wasApplied ? nextScore - previousRollupScore : nextScore),
      lastActivityAt: Math.max(existing.lastActivityAt, row.createdAt),
      updatedAt: now,
    })
  }

  return {
    dashboardRollupAppliedAt: now,
    dashboardRollupScore: nextScore,
  }
}

export const getDashboardContext = query({
  args: { projectRef: v.string() },
  handler: async (ctx, args) => {
    const { project, membership } = await requireProjectAccessByRef(ctx, args.projectRef)
    const accounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(50)

    return {
      projectRef: projectRefFor(project),
      plan: project.plan,
      planStatus: project.planStatus,
      role: membership.role,
      lastAnalyticsRefresh: project.lastAnalyticsRefresh ?? null,
      redditAccounts: accounts
        .filter((account) => account.isActive)
        .map((account) => ({
          _id: account._id,
          redditUsername: account.redditUsername,
        })),
    }
  },
})

export const getDashboardMetrics = query({
  args: {
    projectRef: v.string(),
    timeframe: timeframeValidator,
    redditAccountIds: v.optional(v.array(v.id("redditAccounts"))),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)
    const accountFilter = await validateAccountFilter(ctx, project._id, args.redditAccountIds)

    const [totals, approvalRate, accounts] = await Promise.all([
      getRollupOrContentTotals(ctx, project._id, args.timeframe, accountFilter),
      getApprovalRate(ctx, project._id, args.timeframe, accountFilter),
      ctx.db
        .query("redditAccounts")
        .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
        .take(50),
    ])

    const worstHealth = accounts
      .filter((account) => isSelectedAccount(accountFilter, account._id))
      .reduce(
        (current, account) =>
          healthRank(account.healthStatus) > healthRank(current)
            ? account.healthStatus
            : current,
        "healthy" as Doc<"redditAccounts">["healthStatus"],
      )

    const content = totals.contentFallback ?? await getPostedContent(ctx, project._id, args.timeframe, accountFilter)
    const lastUpdatedAt = content.length === 0
      ? project.lastAnalyticsRefresh ?? null
      : Math.max(...content.map((item) => item.lastCheckedAt))
    const staleCount = content.filter((item) => isAnalyticsStale(item)).length
    const failedCount = content.filter((item) => item.lastAnalyticsError).length

    return {
      postsCount: totals.postsCount,
      approvalRate,
      karmaEarned: totals.karmaEarned,
      healthStatus: worstHealth,
      lastUpdatedAt,
      staleCount,
      failedCount,
      status: failedCount > 0 ? "retrying" : staleCount > 0 ? "stale" : "fresh",
    }
  },
})

export const getRecentActivity = query({
  args: {
    projectRef: v.string(),
    timeframe: timeframeValidator,
    redditAccountIds: v.optional(v.array(v.id("redditAccounts"))),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)
    const accountFilter = await validateAccountFilter(ctx, project._id, args.redditAccountIds)
    const cutoff = cutoffForTimeframe(args.timeframe)
    const postedContent: Doc<"postedContent">[] = []

    for await (const row of ctx.db
      .query("postedContent")
      .withIndex("by_projectId_and_createdAt", (q) =>
        q.eq("projectId", project._id).gte("createdAt", cutoff),
      )
      .order("desc")) {
      if (!isSelectedAccount(accountFilter, row.redditAccountId)) continue
      postedContent.push(row)
      if (postedContent.length >= 10) break
    }

    return await Promise.all(
      postedContent.map(async (item) => {
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
          permalink: item.permalink ?? item.parentPermalink ?? `https://www.reddit.com/r/${item.subreddit}/`,
        }
      }),
    )
  },
})

export const getTrendData = query({
  args: {
    projectRef: v.string(),
    timeframe: timeframeValidator,
    redditAccountIds: v.optional(v.array(v.id("redditAccounts"))),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)
    const accountFilter = await validateAccountFilter(ctx, project._id, args.redditAccountIds)
    const totals = await getRollupOrContentTotals(ctx, project._id, args.timeframe, accountFilter)
    const contentFallback = totals.contentFallback

    if (args.timeframe !== "all") {
      const days = args.timeframe === "7d" ? 7 : 30
      const today = dayKey(Date.now())
      const start = addDays(today, -(days - 1))
      const buckets = new Map<string, number>()
      for (let index = 0; index < days; index++) buckets.set(addDays(start, index), 0)

      if (contentFallback) {
        for (const item of contentFallback) {
          const key = dayKey(item.createdAt)
          if (buckets.has(key)) buckets.set(key, (buckets.get(key) ?? 0) + item.score)
        }
      } else {
        for (const row of totals.rollups) {
          if (buckets.has(row.day)) buckets.set(row.day, (buckets.get(row.day) ?? 0) + row.karmaEarned)
        }
      }

      return [...buckets.entries()].map(([key, karma]) => ({ period: displayDay(key), karma }))
    }

    const monthTotals = new Map<string, number>()
    if (contentFallback) {
      for (const item of contentFallback) {
        const key = monthKey(item.createdAt)
        monthTotals.set(key, (monthTotals.get(key) ?? 0) + item.score)
      }
    } else {
      for (const row of totals.rollups) {
        const key = row.day.slice(0, 7)
        monthTotals.set(key, (monthTotals.get(key) ?? 0) + row.karmaEarned)
      }
    }
    if (monthTotals.size === 0) return []

    const start = [...monthTotals.keys()].sort()[0]
    const end = monthKey(Date.now())
    const result: Array<{ period: string; karma: number }> = []
    for (let key = start; key <= end; key = addMonths(key, 1)) {
      result.push({ period: displayMonth(key), karma: monthTotals.get(key) ?? 0 })
    }
    return result
  },
})

export const getBestPerforming = query({
  args: {
    projectRef: v.string(),
    timeframe: timeframeValidator,
    redditAccountIds: v.optional(v.array(v.id("redditAccounts"))),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)
    const accountFilter = await validateAccountFilter(ctx, project._id, args.redditAccountIds)
    const postedContent = await getPostedContent(ctx, project._id, args.timeframe, accountFilter)
    const best = postedContent.sort((a, b) => b.score - a.score).slice(0, 5)

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

export const heartbeatDashboardAnalyticsSession = mutation({
  args: {
    projectRef: v.string(),
    timeframe: timeframeValidator,
    redditAccountIds: v.array(v.id("redditAccounts")),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)
    await validateAccountFilter(ctx, project._id, args.redditAccountIds)
    const now = Date.now()
    const existing = await ctx.db
      .query("dashboardAnalyticsSessions")
      .withIndex("by_projectId_and_sessionId", (q) =>
        q.eq("projectId", project._id).eq("sessionId", args.sessionId),
      )
      .unique()

    if (existing) {
      await ctx.db.patch(existing._id, {
        timeframe: args.timeframe,
        redditAccountIds: args.redditAccountIds,
        lastHeartbeatAt: now,
        expiresAt: now + SESSION_TTL,
        closedAt: undefined,
      })
      return { sessionId: args.sessionId }
    }

    await ctx.db.insert("dashboardAnalyticsSessions", {
      projectId: project._id,
      sessionId: args.sessionId,
      timeframe: args.timeframe,
      redditAccountIds: args.redditAccountIds,
      openedAt: now,
      lastHeartbeatAt: now,
      expiresAt: now + SESSION_TTL,
    })
    return { sessionId: args.sessionId }
  },
})

export const closeDashboardAnalyticsSession = mutation({
  args: {
    projectRef: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)
    const existing = await ctx.db
      .query("dashboardAnalyticsSessions")
      .withIndex("by_projectId_and_sessionId", (q) =>
        q.eq("projectId", project._id).eq("sessionId", args.sessionId),
      )
      .unique()
    if (existing) await ctx.db.patch(existing._id, { closedAt: Date.now(), expiresAt: Date.now() })
    return null
  },
})

export const requestDashboardAnalyticsRefresh = mutation({
  args: {
    projectRef: v.string(),
    timeframe: timeframeValidator,
    redditAccountIds: v.array(v.id("redditAccounts")),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)
    await validateAccountFilter(ctx, project._id, args.redditAccountIds)
    const now = Date.now()
    if (!(await activeSessionExists(ctx, project._id, args.sessionId, now))) {
      return { scheduled: false }
    }
    await ctx.scheduler.runAfter(0, internal.analytics.runDashboardAnalyticsRefresh, {
      projectId: project._id,
      timeframe: args.timeframe,
      redditAccountIds: args.redditAccountIds,
      sessionId: args.sessionId,
    })
    return { scheduled: true }
  },
})

export const acquireZernioTrafficSlot = internalMutation({
  args: { trafficClass: trafficClassValidator },
  handler: async (ctx, args) => {
    const now = Date.now()
    const resetAt = Math.floor(now / MINUTE) * MINUTE + MINUTE
    const key = "zernio:global"
    const existing = await ctx.db
      .query("oauthRateLimitBuckets")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique()
    const count = existing && existing.resetAt > now ? existing.count : 0
    const limit = args.trafficClass === "analytics"
      ? ZERNIO_GLOBAL_RPM - ZERNIO_POSTING_RESERVE_RPM
      : ZERNIO_GLOBAL_RPM

    if (count >= limit) return { allowed: false, retryAfterMs: Math.max(resetAt - now, 1000) }

    if (existing) {
      await ctx.db.patch(existing._id, { count: count + 1, resetAt, updatedAt: now })
    } else {
      await ctx.db.insert("oauthRateLimitBuckets", { key, count: 1, resetAt, updatedAt: now })
    }
    return { allowed: true }
  },
})

export const prepareDashboardAnalyticsRefresh = internalMutation({
  args: {
    projectId: v.id("projects"),
    timeframe: timeframeValidator,
    redditAccountIds: v.array(v.id("redditAccounts")),
    sessionId: v.string(),
  },
  handler: async (ctx, args): Promise<{ groups: RefreshGroup[]; retryAfterMs?: number }> => {
    const now = Date.now()
    if (!(await activeSessionExists(ctx, args.projectId, args.sessionId, now))) {
      return { groups: [] }
    }
    const accountFilter = await validateAccountFilter(ctx, args.projectId, args.redditAccountIds)
    const cutoff = cutoffForTimeframe(args.timeframe, now)
    const rows = await ctx.db
      .query("postedContent")
      .withIndex("by_projectId_and_createdAt", (q) =>
        q.eq("projectId", args.projectId).gte("createdAt", cutoff),
      )
      .order("desc")
      .take(150)

    const grouped = new Map<string, RefreshGroup>()
    for (const row of rows) {
      if (!isSelectedAccount(accountFilter, row.redditAccountId)) continue
      if (!isAnalyticsStale(row, now)) continue

      const account = row.redditAccountId ? await ctx.db.get(row.redditAccountId) : null
      if (!account || account.projectId !== args.projectId || !account.isActive) continue

      const card = await ctx.db.get(row.cardId)
      const type = row.type ?? card?.type
      const surfacedPost = card?.surfacedPostId ? await ctx.db.get(card.surfacedPostId) : null
      const parentRedditThingId = row.parentRedditThingId ?? (
        type === "reply"
          ? surfacedPost?.redditThingId ?? (surfacedPost ? `t3_${surfacedPost.redditPostId}` : undefined)
          : row.redditThingId ?? `t3_${row.redditId}`
      )
      if (!parentRedditThingId) continue
      if (!row.parentRedditThingId || !row.parentPermalink) {
        await ctx.db.patch(row._id, {
          parentRedditThingId,
          parentPermalink: row.parentPermalink ?? (type === "reply" ? surfacedPost?.url : row.permalink),
        })
      }

      const key = `${args.projectId}:${account.zernioAccountId}:${parentRedditThingId}`
      let group = grouped.get(key)
      if (!group) {
        const existingLock = await ctx.db
          .query("dashboardAnalyticsLocks")
          .withIndex("by_key", (q) => q.eq("key", key))
          .first()
        if (existingLock && existingLock.expiresAt > now) continue
        if (existingLock) {
          await ctx.db.patch(existingLock._id, { acquiredAt: now, expiresAt: now + LOCK_TTL })
        } else {
          await ctx.db.insert("dashboardAnalyticsLocks", {
            key,
            projectId: args.projectId,
            zernioAccountId: account.zernioAccountId,
            parentRedditThingId,
            acquiredAt: now,
            expiresAt: now + LOCK_TTL,
          })
        }
        group = {
          key,
          projectId: args.projectId,
          zernioAccountId: account.zernioAccountId,
          parentRedditThingId,
          subreddit: row.subreddit,
          parentPermalink: row.parentPermalink ?? (type === "reply" ? surfacedPost?.url : row.permalink),
          fallbackEligible: false,
          rows: [],
        }
        grouped.set(key, group)
      }

      group.fallbackEligible = group.fallbackEligible || Boolean(
        (row.analyticsFailureCount ?? 0) >= 2 &&
          now - row.lastCheckedAt > THIRTY_MINUTES &&
          (!row.fetchLayerFallbackCooldownUntil || row.fetchLayerFallbackCooldownUntil <= now),
      )
      group.rows.push({
        postedContentId: row._id,
        redditId: row.redditId,
        redditThingId: row.redditThingId,
        type,
        score: row.score,
        replyCount: row.replyCount,
        visibility: row.visibility,
        createdAt: row.createdAt,
      })
    }

    return { groups: [...grouped.values()].slice(0, 12) }
  },
})

export const applyDashboardAnalyticsGroup = internalMutation({
  args: {
    groupKey: v.string(),
    source: sourceValidator,
    results: v.array(v.object({
      postedContentId: v.id("postedContent"),
      score: v.optional(v.number()),
      replyCount: v.optional(v.number()),
      visibility: visibilityValidator,
    })),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    for (const result of args.results) {
      const row = await ctx.db.get(result.postedContentId)
      if (!row) continue
      const nextScore = result.score ?? row.score
      const rollupPatch = await upsertRollupForPostedContent(ctx, row, nextScore)
      await ctx.db.patch(result.postedContentId, {
        ...rollupPatch,
        score: nextScore,
        replyCount: result.replyCount ?? row.replyCount,
        visibility: result.visibility,
        lastCheckedAt: now,
        lastAnalyticsAttemptAt: now,
        lastAnalyticsError: undefined,
        analyticsFailureCount: 0,
        lastAnalyticsSource: args.source,
        ...(args.source === "fetchlayer"
          ? {
              fetchLayerFallbackLastAttemptAt: now,
              fetchLayerFallbackCooldownUntil: now + DAY,
            }
          : {}),
      })
    }

    const lock = await ctx.db
      .query("dashboardAnalyticsLocks")
      .withIndex("by_key", (q) => q.eq("key", args.groupKey))
      .first()
    if (lock) await ctx.db.patch(lock._id, { expiresAt: now })
    return null
  },
})

export const markDashboardAnalyticsGroupFailed = internalMutation({
  args: {
    groupKey: v.string(),
    postedContentIds: v.array(v.id("postedContent")),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    for (const postedContentId of args.postedContentIds) {
      const row = await ctx.db.get(postedContentId)
      if (!row) continue
      await ctx.db.patch(postedContentId, {
        lastAnalyticsAttemptAt: now,
        lastAnalyticsError: args.error,
        analyticsFailureCount: (row.analyticsFailureCount ?? 0) + 1,
      })
    }
    const lock = await ctx.db
      .query("dashboardAnalyticsLocks")
      .withIndex("by_key", (q) => q.eq("key", args.groupKey))
      .first()
    if (lock) await ctx.db.patch(lock._id, { expiresAt: now })
    return null
  },
})

export const acquireFetchLayerFallbackSlot = internalMutation({
  args: {
    projectId: v.id("projects"),
    parentRedditThingId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const day = dayKey(now)
    const projectKey = `fetchlayer:fallback:${args.projectId}:${day}`
    const threadKey = `fetchlayer:fallback:${args.projectId}:${args.parentRedditThingId}`
    const resetAt = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate() + 1)

    const [projectUsage, threadUsage] = await Promise.all([
      ctx.db.query("analyticsFallbackUsage").withIndex("by_key", (q) => q.eq("key", projectKey)).unique(),
      ctx.db.query("analyticsFallbackUsage").withIndex("by_key", (q) => q.eq("key", threadKey)).unique(),
    ])

    if (projectUsage && projectUsage.resetAt > now && projectUsage.count >= 25) return { allowed: false }
    if (threadUsage && threadUsage.resetAt > now && threadUsage.count >= 1) return { allowed: false }

    if (projectUsage) {
      await ctx.db.patch(projectUsage._id, {
        count: projectUsage.resetAt > now ? projectUsage.count + 1 : 1,
        resetAt,
        updatedAt: now,
      })
    } else {
      await ctx.db.insert("analyticsFallbackUsage", { key: projectKey, projectId: args.projectId, count: 1, resetAt, updatedAt: now })
    }

    if (threadUsage) {
      await ctx.db.patch(threadUsage._id, { count: 1, resetAt: now + DAY, updatedAt: now })
    } else {
      await ctx.db.insert("analyticsFallbackUsage", { key: threadKey, projectId: args.projectId, count: 1, resetAt: now + DAY, updatedAt: now })
    }

    return { allowed: true }
  },
})

export const runDashboardAnalyticsRefresh = internalAction({
  args: {
    projectId: v.id("projects"),
    timeframe: timeframeValidator,
    redditAccountIds: v.array(v.id("redditAccounts")),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const prepared: { groups: RefreshGroup[] } = await ctx.runMutation(
      internal.analytics.prepareDashboardAnalyticsRefresh,
      args,
    )
    let fallbackFetches = 0

    await mapWithConcurrency(prepared.groups, ANALYTICS_CONCURRENCY, async (group) => {
      try {
        const thread = await getRedditInboxThread(ctx, {
          accountId: group.zernioAccountId,
          postId: group.parentRedditThingId,
          subreddit: group.subreddit,
        })
        await ctx.runMutation(internal.analytics.applyDashboardAnalyticsGroup, {
          groupKey: group.key,
          source: "zernio",
          results: group.rows.map((row) => ({
            postedContentId: row.postedContentId,
            ...classifyZernioRow(thread, row),
          })),
        })
        return
      } catch (error) {
        const retryAfterMs = error instanceof ProviderHttpError ? error.retryAfterMs : undefined
        if (retryAfterMs) {
          await ctx.scheduler.runAfter(retryAfterMs, internal.analytics.runDashboardAnalyticsRefresh, args)
        }

        if (group.fallbackEligible && fallbackFetches < FETCHLAYER_FALLBACKS_PER_RUN && group.parentPermalink) {
          fallbackFetches += 1
          const slot: { allowed: boolean } = await ctx.runMutation(
            internal.analytics.acquireFetchLayerFallbackSlot,
            { projectId: group.projectId, parentRedditThingId: group.parentRedditThingId },
          )
          if (slot.allowed) {
            try {
              const payload = await fetchLayerPost(ctx, { url: group.parentPermalink, pages: 2 })
              await ctx.runMutation(internal.analytics.applyDashboardAnalyticsGroup, {
                groupKey: group.key,
                source: "fetchlayer",
                results: group.rows.map((row) => ({
                  postedContentId: row.postedContentId,
                  ...classifyFetchLayerRow(payload, row),
                })),
              })
              return
            } catch {
              // Keep the original Zernio failure below; FetchLayer is only a fallback.
            }
          }
        }

        await ctx.runMutation(internal.analytics.markDashboardAnalyticsGroupFailed, {
          groupKey: group.key,
          postedContentIds: group.rows.map((row) => row.postedContentId),
          error: shortError(error),
        })
      }
    })

    await ctx.runMutation(internal.analytics.markAnalyticsRefreshed, {
      projectId: args.projectId,
      refreshedAt: Date.now(),
    })
    return null
  },
})

export const backfillDashboardAnalyticsMetadata = internalMutation({
  args: {
    beforeCreatedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const beforeCreatedAt = args.beforeCreatedAt ?? Date.now() + 1
    const rows = await ctx.db
      .query("postedContent")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", beforeCreatedAt))
      .order("desc")
      .take(100)

    for (const row of rows) {
      const card = await ctx.db.get(row.cardId)
      const type = row.type ?? card?.type
      const surfacedPost = card?.surfacedPostId ? await ctx.db.get(card.surfacedPostId) : null
      const parentRedditThingId = row.parentRedditThingId ?? (
        type === "reply"
          ? surfacedPost?.redditThingId ?? (surfacedPost ? `t3_${surfacedPost.redditPostId}` : undefined)
          : row.redditThingId ?? `t3_${row.redditId}`
      )
      await ctx.db.patch(row._id, {
        ...(parentRedditThingId ? { parentRedditThingId } : {}),
        parentPermalink: row.parentPermalink ?? (type === "reply" ? surfacedPost?.url : row.permalink),
      })
      const rollupPatch = await upsertRollupForPostedContent(ctx, row, row.score)
      await ctx.db.patch(row._id, rollupPatch)
    }

    if (rows.length === 100) {
      await ctx.scheduler.runAfter(0, internal.analytics.backfillDashboardAnalyticsMetadata, {
        beforeCreatedAt: rows[rows.length - 1].createdAt,
      })
    }

    return { processed: rows.length }
  },
})

export const getRefreshContext = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await requireProjectAccess(ctx, args.projectId)
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

    return { refreshed: false }
  },
})
