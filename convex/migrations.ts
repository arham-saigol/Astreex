import { v } from "convex/values"
import { paginationOptsValidator } from "convex/server"
import { internal } from "./_generated/api"
import { internalMutation, internalQuery } from "./_generated/server"

export const backfillProjectOnboardingStatus = internalMutation({
  args: {
    paginationOpts: paginationOptsValidator,
    dryRun: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("projects")
      .paginate(args.paginationOpts)
    let patched = 0

    for (const project of page.page) {
      if (project.onboardingStatus !== undefined) continue
      patched++
      if (!args.dryRun) {
        await ctx.db.patch(project._id, { onboardingStatus: "complete" })
      }
    }

    if (!args.dryRun && !page.isDone) {
      await ctx.scheduler.runAfter(
        0,
        internal.migrations.backfillProjectOnboardingStatus,
        {
          paginationOpts: {
            cursor: page.continueCursor,
            numItems: args.paginationOpts.numItems,
          },
        },
      )
    }

    return {
      scanned: page.page.length,
      patched,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    }
  },
})

export const verifyProjectOnboardingStatusBackfill = internalQuery({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("projects")
      .paginate(args.paginationOpts)
    const missing = page.page
      .filter((project) => project.onboardingStatus === undefined)
      .map((project) => project._id)

    return {
      scanned: page.page.length,
      missing,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    }
  },
})
