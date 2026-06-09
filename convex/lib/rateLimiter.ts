import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalMutation, type ActionCtx } from "../_generated/server"

type Priority = 1 | 2 | 3

const RETRY_WAIT_MS: Record<Priority, number> = {
  1: 5_000,
  2: 15_000,
  3: 30_000,
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withRateLimit<T>(
  ctx: ActionCtx,
  priority: Priority,
  fn: () => Promise<T>,
) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const reserved: boolean = await ctx.runMutation(
      internal.lib.rateLimiter.reserveRedditSlot,
      { priority },
    )

    if (reserved) return await fn()
    if (attempt < 3) await wait(RETRY_WAIT_MS[priority])
  }

  throw new Error("Reddit rate limit capacity was not available")
}

export const reserveRedditSlot = internalMutation({
  args: {
    priority: v.union(v.literal(1), v.literal(2), v.literal(3)),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const oneMinuteAgo = now - 60_000
    const staleBefore = now - 5 * 60_000

    const staleRows = await ctx.db
      .query("rateLimitLog")
      .withIndex("by_service_and_requestedAt", (q) =>
        q.eq("service", "reddit").lt("requestedAt", staleBefore),
      )
      .take(20)

    for (const row of staleRows) {
      await ctx.db.delete(row._id)
    }

    const recentRows = await ctx.db
      .query("rateLimitLog")
      .withIndex("by_service_and_requestedAt", (q) =>
        q.eq("service", "reddit").gte("requestedAt", oneMinuteAgo),
      )
      .take(101)

    const recentCount = recentRows.length
    const canRun =
      recentCount < 90 ||
      (recentCount < 100 && args.priority === 1)

    if (!canRun) return false

    await ctx.db.insert("rateLimitLog", {
      service: "reddit",
      priority: args.priority,
      requestedAt: now,
      createdAt: now,
    })

    return true
  },
})
