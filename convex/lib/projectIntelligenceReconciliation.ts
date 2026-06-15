import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import type { MutationCtx } from "../_generated/server"

function sameUrls(a: string[], b: string[]) {
  return a.length === b.length && a.every((url, index) => url === b[index])
}

export async function reconcileProjectIntelligenceUrls(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">
    profileId: Id<"projectIntelligenceProfiles">
    previousWebsiteUrl: string
    nextWebsiteUrl: string
    previousCompetitorUrls: string[]
    nextCompetitorUrls: string[]
  },
) {
  const websiteChanged = args.nextWebsiteUrl !== args.previousWebsiteUrl
  const competitorsChanged = !sameUrls(args.nextCompetitorUrls, args.previousCompetitorUrls)
  if (!websiteChanged && !competitorsChanged) return false

  const now = Date.now()
  if (competitorsChanged) {
    for await (const page of ctx.db
      .query("monitoredPages")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))) {
      if (page.sourceType === "competitor" && page.active) {
        await ctx.db.patch(page._id, {
          active: false,
          updatedAt: now,
        })
      }
    }
  }

  await ctx.db.patch(args.profileId, {
    intelligenceJson: "{}",
    updatedAt: now,
  })
  await ctx.db.patch(args.projectId, {
    onboardingStatus: "running",
    onboardingError: undefined,
    lastActiveAt: now,
  })
  await ctx.scheduler.runAfter(0, internal.onboarding.pipeline.runOnboardingPipeline, {
    projectId: args.projectId,
  })

  return true
}
