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
        internal.onboarding.data.loadProjectIntelligenceProfile,
        { projectId: args.projectId },
      )
      if (!brand) throw new Error("Project intelligence profile not found")

      if (brand.intelligenceJson.trim() === "{}") {
        const scraped = await ctx.runAction(
          internal.onboarding.scrapeProjectSources.scrapeProjectSources,
          { projectId: args.projectId },
        )
        const filtered = await ctx.runAction(
          internal.onboarding.pageFiltering.filterUsefulProjectPages,
          {
            projectId: args.projectId,
            pages: scraped.pages,
          },
        )

        await ctx.runAction(
          internal.onboarding.projectIntelligenceAgent.generateProjectIntelligenceProfile,
          {
            projectId: args.projectId,
            usefulPages: filtered.usefulPages,
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
