import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server"
import { requireProjectAccess } from "./lib/auth"
import { requireProjectAccessByRef } from "./lib/projectRefs"

const FIVE_MINUTES_MS = 5 * 60 * 1000

function localDateParts(timeZone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  )

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  }
}

function getTimeZoneOffsetMs(timeZone: string, timestamp: number) {
  const parts = localDateParts(timeZone, new Date(timestamp))
  const localAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  )

  return localAsUtc - timestamp
}

function localMidnightUtcMs(timeZone: string, date: Date) {
  const parts = localDateParts(timeZone, date)
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0)
  return guess - getTimeZoneOffsetMs(timeZone, guess)
}

function randomFiveToTenMinutes() {
  return FIVE_MINUTES_MS + 1 + Math.floor(Math.random() * (FIVE_MINUTES_MS - 1))
}

async function findScheduledSpacingConflicts(
  ctx: MutationCtx,
  redditAccountId: Id<"redditAccounts">,
  candidate: number,
) {
  const rows = await ctx.db
    .query("cards")
    .withIndex("by_redditAccountId_and_scheduledFor", (q) =>
      q
        .eq("redditAccountId", redditAccountId)
        .gte("scheduledFor", candidate - FIVE_MINUTES_MS)
        .lte("scheduledFor", candidate + FIVE_MINUTES_MS),
    )
    .take(50)

  return rows.filter((row) => row.status === "scheduled")
}

export const getActiveCards = query({
  args: { projectRef: v.string() },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_projectId_status", (q) =>
        q.eq("projectId", project._id).eq("status", "pending")
      )
      .order("desc")
      .take(50)

    // Filter out cards older than 7 days
    const activeCards = cards.filter((c) => c.createdAt > sevenDaysAgo)

    // Get all reddit accounts for this project to determine if multiple accounts
    const redditAccounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(10)

    const hasMultipleAccounts = redditAccounts.length > 1

    // Join with surfaced posts and reddit accounts
    const enrichedCards = await Promise.all(
      activeCards.map(async (card) => {
        const [surfacedPost, redditAccount] = await Promise.all([
          card.surfacedPostId ? ctx.db.get(card.surfacedPostId) : Promise.resolve(null),
          ctx.db.get(card.redditAccountId),
        ])

        return {
          ...card,
          surfacedPost: surfacedPost
            ? {
                subreddit: surfacedPost.subreddit,
                title: surfacedPost.title,
                score: surfacedPost.score,
                postedAt: surfacedPost.postedAt,
              }
            : null,
          redditUsername: redditAccount?.redditUsername ?? null,
          showUsername: hasMultipleAccounts,
        }
      })
    )

    return enrichedCards
  },
})

export const getFeedStatus = query({
  args: { projectRef: v.string() },
  handler: async (ctx, args) => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)

    const today = localDateParts(project.timezone, new Date())
    const localDate = `${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`
    const pipelineRun = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_projectId_and_localDate", (q) =>
        q.eq("projectId", project._id).eq("localDate", localDate),
      )
      .first()

    return {
      pipelineFailedToday: pipelineRun?.status === "failed",
    }
  },
})

export const approveCard = mutation({
  args: {
    cardId: v.id("cards"),
    editedContent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId)
    if (!card) throw new Error("Card not found")

    const project = await requireProjectAccess(ctx, card.projectId)

    if (card.status !== "pending") {
      throw new Error("Only pending cards can be approved")
    }

    const now = Date.now()
    const localMidnight = localMidnightUtcMs(project.timezone, new Date(now))
    const todaysCards = await ctx.db
      .query("cards")
      .withIndex("by_projectId_and_createdAt", (q) =>
        q.eq("projectId", project._id).gte("createdAt", localMidnight),
      )
      .take(16)

    const windowMs =
      todaysCards.length > 15 ? 18 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000
    let scheduledFor = now + Math.floor(Math.random() * windowMs)
    let latestConflictScheduledFor: number | null = null

    for (let attempt = 0; attempt < 12; attempt++) {
      const conflicts = await findScheduledSpacingConflicts(
        ctx,
        card.redditAccountId,
        scheduledFor,
      )

      if (conflicts.length === 0) {
        latestConflictScheduledFor = null
        break
      }

      latestConflictScheduledFor = Math.max(
        ...conflicts.map((conflict) => conflict.scheduledFor ?? scheduledFor),
      )
      scheduledFor += randomFiveToTenMinutes()
    }

    if (latestConflictScheduledFor !== null) {
      scheduledFor = latestConflictScheduledFor + randomFiveToTenMinutes()
    }

    await ctx.db.patch(args.cardId, {
      status: "scheduled",
      scheduledFor,
      ...(args.editedContent !== undefined ? { editedContent: args.editedContent } : {}),
      postRetryCount: 0,
      failureReason: undefined,
    })

    await ctx.scheduler.runAt(
      scheduledFor,
      internal.pipeline.poster.postToReddit,
      { cardId: args.cardId, retryAttempt: 0 },
    )
  },
})

export const declineCard = mutation({
  args: {
    cardId: v.id("cards"),
  },
  handler: async (ctx, args) => {
    const card = await ctx.db.get(args.cardId)
    if (!card) throw new Error("Card not found")

    await requireProjectAccess(ctx, card.projectId)

    if (card.status !== "pending") {
      throw new Error("Only pending cards can be declined")
    }

    await ctx.db.patch(args.cardId, {
      status: "declined",
    })
  },
})

async function expireStaleCardsBatch(ctx: MutationCtx, scheduleNext: boolean) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  const staleCards = await ctx.db
    .query("cards")
    .withIndex("by_status_and_createdAt", (q) =>
      q.eq("status", "pending").lt("createdAt", sevenDaysAgo),
    )
    .take(200)

  for (const card of staleCards) {
    await ctx.db.patch(card._id, { status: "expired" })
  }

  if (scheduleNext && staleCards.length === 200) {
    await ctx.scheduler.runAfter(0, internal.cards.expireStaleCardsInternal, {})
  }

  return { expired: staleCards.length }
}

export const expireStaleCardsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await expireStaleCardsBatch(ctx, true)
  },
})
