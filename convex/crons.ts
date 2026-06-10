import { cronJobs, paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { internalAction, internalQuery } from "./_generated/server"

const planStatusValidator = v.union(v.literal("trialing"), v.literal("active"))

export function localDateAndHour(timeZone: string, date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)

  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  )

  return {
    localDate: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
  }
}

export const pageProjectsByPlanStatus = internalQuery({
  args: {
    planStatus: planStatusValidator,
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_planStatus", (q) => q.eq("planStatus", args.planStatus))
      .paginate(args.paginationOpts)
  },
})

export const checkTimezones = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = new Date()
    const statuses: Array<"trialing" | "active"> = ["active", "trialing"]

    for (const planStatus of statuses) {
      let cursor: string | null = null
      let isDone = false

      while (!isDone) {
        const page: {
          page: Array<{ _id: Id<"projects">; timezone: string }>
          continueCursor: string
          isDone: boolean
        } = await ctx.runQuery(
          internal.crons.pageProjectsByPlanStatus,
          {
            planStatus,
            paginationOpts: { numItems: 100, cursor },
          },
        )

        for (const project of page.page) {
          try {
            const local = localDateAndHour(project.timezone, now)
            if (local.hour !== 7) continue

            const trial = await ctx.runMutation(
              internal.billing.expireTrialIfNeeded,
              {
                projectId: project._id,
                now: now.getTime(),
              },
            )
            if (trial.expired) continue

            await ctx.runAction(
              internal.pipeline.orchestrator.runDailyPipeline,
              {
                projectId: project._id,
                localDate: local.localDate,
              },
            )
          } catch (error) {
            console.error("Timezone pipeline check failed", project._id, error)
          }
        }

        cursor = page.continueCursor
        isDone = page.isDone
      }
    }
  },
})

const crons = cronJobs()

crons.cron("hourly timezone check", "0 * * * *", internal.crons.checkTimezones, {})
crons.cron("daily stale card expiration", "0 0 * * *", internal.cards.expireStaleCardsInternal, {})
crons.cron("daily account health monitor", "0 22 * * *", internal.pipeline.healthMonitor.checkAccountHealth, {})
crons.cron("daily stale pipeline cleanup", "0 3 * * *", internal.pipeline.cleanup.cleanupStaleData, {})

export default crons
