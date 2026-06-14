"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import { deepseekV4Pro, filterSettings } from "../lib/ai"
import { getPipelineLimits } from "../lib/planLimits"
import { selectFilterCandidates } from "../lib/candidatePool"
import { compactIntelligenceJson } from "./intelligenceContext"

const filterResultSchema = z.object({
  ranked: z.array(z.object({
    surfacedPostId: z.string(),
    reason: z.string(),
  })),
})

function truncate(value: string | undefined, length: number) {
  if (!value) return ""
  return value.length > length ? `${value.slice(0, length)}...` : value
}

function sanitizeRankedIds(
  ranked: Array<{ surfacedPostId: string }>,
  candidateIds: Set<string>,
  fallbackIds: Array<Id<"surfacedPosts">>,
  limit: number,
) {
  const ids: Array<Id<"surfacedPosts">> = []
  const seen = new Set<string>()

  for (const item of ranked) {
    if (!candidateIds.has(item.surfacedPostId) || seen.has(item.surfacedPostId)) {
      continue
    }
    seen.add(item.surfacedPostId)
    ids.push(item.surfacedPostId as Id<"surfacedPosts">)
    if (ids.length >= limit) return ids
  }

  for (const id of fallbackIds) {
    if (seen.has(id)) continue
    seen.add(id)
    ids.push(id)
    if (ids.length >= limit) return ids
  }

  return ids
}

export const filterPosts = internalAction({
  args: {
    projectId: v.id("projects"),
    surfacedPostIds: v.array(v.id("surfacedPosts")),
  },
  handler: async (ctx, args): Promise<Array<Id<"surfacedPosts">>> => {
    const context = await ctx.runQuery(
      internal.pipeline.data.loadFilterContext,
      args,
    )
    const limits = getPipelineLimits(context.project.plan)
    const candidates = selectFilterCandidates(context.posts, limits.filterTop)
    if (candidates.length === 0) return []

    const candidateIds = new Set(candidates.map((post) => post._id))
    const promptPosts = candidates.map((post) => ({
      surfacedPostId: post._id,
      subreddit: post.subreddit,
      title: post.title ?? "",
      selftext: truncate(post.selftext, 500),
      url: post.url ?? "",
      score: post.score,
      commentCount: post.commentCount,
      postedAt: new Date(post.postedAt).toISOString(),
    }))

    let lastError: unknown = null
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await generateObject({
          model: deepseekV4Pro(),
          ...filterSettings,
          schema: filterResultSchema,
          prompt: [
            "Rank Reddit posts for a B2B founder to reply to.",
            "Prefer posts where a specific, helpful, non-promotional reply can add value.",
            "Avoid memes, ragebait, thin announcements, hiring posts, and posts with no clear business context.",
            `Return up to ${limits.filterTop} ranked IDs from the candidate list.`,
            `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "filter")}`,
            `Candidates JSON: ${JSON.stringify(promptPosts)}`,
          ].join("\n\n"),
        })

        return sanitizeRankedIds(
          result.object.ranked,
          candidateIds,
          candidates.map((post) => post._id),
          limits.filterTop,
        )
      } catch (error) {
        lastError = error
      }
    }

    throw lastError instanceof Error ? lastError : new Error("Filter agent failed")
  },
})
