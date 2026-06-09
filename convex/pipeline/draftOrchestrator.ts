import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { getPipelineLimits } from "../lib/planLimits"
import type { Draft } from "./validators"

export const generateAllDrafts = internalAction({
  args: {
    projectId: v.id("projects"),
    filteredPostIds: v.array(v.id("surfacedPosts")),
  },
  handler: async (ctx, args): Promise<Draft[]> => {
    const readiness = await ctx.runQuery(
      internal.pipeline.data.getProjectReadiness,
      { projectId: args.projectId },
    )
    if (!readiness.ready) return []

    const limits = getPipelineLimits(readiness.project.plan)
    const subreddits = await ctx.runQuery(
      internal.pipeline.data.loadActiveSubreddits,
      { projectId: args.projectId },
    )

    const replyIds = args.filteredPostIds.slice(0, limits.replyDrafts)
    const originalTargets = Array.from(
      { length: subreddits.length === 0 ? 0 : limits.originalDrafts },
      (_, index) => subreddits[index % subreddits.length]?.name,
    ).filter((name): name is string => Boolean(name))

    const replyCalls = replyIds.map((surfacedPostId: Id<"surfacedPosts">) =>
      ctx.runAction(internal.pipeline.draftAgent.generateSingleReply, {
        projectId: args.projectId,
        surfacedPostId,
      }),
    )
    const originalCalls = originalTargets.map((targetSubreddit) =>
      ctx.runAction(internal.pipeline.draftAgent.generateSingleOriginalPost, {
        projectId: args.projectId,
        targetSubreddit,
      }),
    )

    const results = await Promise.allSettled([...replyCalls, ...originalCalls])
    const drafts: Draft[] = []

    for (const result of results) {
      if (result.status === "fulfilled") {
        drafts.push(result.value as Draft)
      } else {
        console.error("Draft generation failed", result.reason)
      }
    }

    return drafts
  },
})
