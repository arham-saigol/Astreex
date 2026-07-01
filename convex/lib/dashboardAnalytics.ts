import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

export function dashboardDayKey(timestamp: number) {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function dashboardAccountKey(accountId: Id<"redditAccounts"> | undefined) {
  return accountId ?? "unknown"
}

export function nextAnalyticsRefreshAt(createdAt: number, now = Date.now()) {
  const age = now - createdAt
  if (age < 6 * HOUR) return now + 5 * MINUTE
  if (age < DAY) return now + 30 * MINUTE
  if (age < 7 * DAY) return now + 2 * HOUR
  if (age < 30 * DAY) return now + DAY
  return now + 7 * DAY
}

export function nextAnalyticsRetryAt(failureCount: number, now = Date.now()) {
  const failures = Math.max(1, failureCount)
  const delay = Math.min(6 * HOUR, 5 * MINUTE * 2 ** Math.min(failures - 1, 6))
  return now + delay
}

export async function upsertDashboardRollupForPostedContent(
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
  const key = dashboardAccountKey(row.redditAccountId)
  const day = dashboardDayKey(row.createdAt)
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
