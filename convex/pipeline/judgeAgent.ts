"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { deepseekV4Pro, judgeSettings } from "../lib/ai"
import { getPipelineLimits } from "../lib/planLimits"
import { sanitizeJudgeSelection } from "../lib/judgeSelection"
import { draftValidator, type Draft } from "./validators"

const judgeSchema = z.object({
  selectedIndices: z.array(z.number().int()),
})

function draftForPrompt(draft: Draft, index: number) {
  if (draft.type === "reply") {
    return {
      index,
      type: draft.type,
      subreddit: draft.targetSubreddit,
      content: draft.draftContent,
      surfacedPostId: draft.surfacedPostId,
    }
  }

  return {
    index,
    type: draft.type,
    subreddit: draft.targetSubreddit,
    title: draft.title,
    body: draft.body,
  }
}

export const selectCards = internalAction({
  args: {
    projectId: v.id("projects"),
    drafts: v.array(draftValidator),
  },
  handler: async (ctx, args): Promise<Draft[]> => {
    if (args.drafts.length === 0) return []

    const context = await ctx.runQuery(
      internal.pipeline.data.loadJudgeContext,
      { projectId: args.projectId },
    )
    const limits = getPipelineLimits(context.project.plan)

    let lastError: unknown = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await generateObject({
          model: deepseekV4Pro(),
          ...judgeSettings,
          schema: judgeSchema,
          prompt: [
            "Select the strongest Reddit cards for today's feed.",
            `Return exactly ${Math.min(limits.cardsPerDay, args.drafts.length)} zero-based draft indices when enough drafts exist.`,
            `Include at least ${limits.minOriginals} original posts when that many are available.`,
            "Prefer usefulness, brand fit, and subreddit diversity. Avoid promotional or repetitive drafts.",
            `Brand profile JSON: ${context.brand.profileJson}`,
            `Last 7 days performance JSON: ${JSON.stringify(context.performance)}`,
            `Drafts JSON: ${JSON.stringify(args.drafts.map(draftForPrompt))}`,
          ].join("\n\n"),
        })

        return sanitizeJudgeSelection(
          args.drafts,
          result.object.selectedIndices,
          limits,
        )
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Judge agent failed")
  },
})
