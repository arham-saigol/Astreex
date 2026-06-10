"use node"

import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export const runOnboardingPipeline = internalAction({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.runQuery(
      internal.onboarding.data.loadPipelineProject,
      { projectId: args.projectId },
    )
    if (!project) throw new Error("Project not found")
    if (project.onboardingStatus === "complete") return { status: "complete" }

    await ctx.runMutation(internal.onboarding.data.markOnboardingRunning, {
      projectId: args.projectId,
    })

    try {
      const brand = await ctx.runQuery(
        internal.onboarding.data.loadBrandForProject,
        { projectId: args.projectId },
      )
      if (!brand) throw new Error("Brand not found")

      if (brand.profileJson.trim() === "{}") {
        const scraped = await ctx.runAction(
          internal.onboarding.scrapeWebsite.scrapeWebsites,
          { projectId: args.projectId },
        )

        await ctx.runAction(
          internal.onboarding.brandAgent.generateBrandProfile,
          {
            projectId: args.projectId,
            websiteContent: scraped.websiteContent,
            competitorContent: scraped.competitorContent,
            scrapeStatus: scraped.scrapeStatus,
          },
        )
      }

      const hasSubreddits = await ctx.runQuery(
        internal.onboarding.data.hasProjectSubreddits,
        { projectId: args.projectId },
      )

      if (!hasSubreddits) {
        await ctx.runAction(
          internal.onboarding.subredditDiscovery.discoverSubreddits,
          { projectId: args.projectId },
        )
      }

      await ctx.runMutation(internal.onboarding.data.markOnboardingComplete, {
        projectId: args.projectId,
      })

      return { status: "complete" }
    } catch (error) {
      await ctx.runMutation(internal.onboarding.data.markOnboardingError, {
        projectId: args.projectId,
        error: errorMessage(error),
      })
      throw error
    }
  },
})
