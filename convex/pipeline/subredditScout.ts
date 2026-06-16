"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { deepseekHighReasoningOptions, deepseekV4Pro, judgeSettings } from "../lib/ai"
import { getPipelineLimits } from "../lib/planLimits"
import { compactIntelligenceJson } from "./intelligenceContext"
import {
  scoutedPostValidator,
  surfacedPostCandidateValidator,
  type ScoutedPost,
  type SurfacedPostCandidate,
} from "./validators"

const scoutSchema = z.object({
  ranked: z.array(z.object({
    surfacedPostId: z.string(),
    reason: z.string().optional(),
  })),
})

function truncate(value: string | undefined, length: number) {
  if (!value) return ""
  return value.length > length ? `${value.slice(0, length)}...` : value
}

function fallbackCandidates(candidates: SurfacedPostCandidate[]) {
  return [...candidates].sort((a, b) => {
    const scoreA =
      Math.log1p(Math.max(0, a.commentCount)) * 8 +
      Math.log1p(Math.max(0, a.score)) -
      Math.max(0, Date.now() - a.postedAt) / 3_600_000
    const scoreB =
      Math.log1p(Math.max(0, b.commentCount)) * 8 +
      Math.log1p(Math.max(0, b.score)) -
      Math.max(0, Date.now() - b.postedAt) / 3_600_000
    return scoreB - scoreA
  })
}

function normalizeSubredditName(name: string) {
  const normalized = name.replace(/^r\//i, "").trim().toLowerCase()
  if (!/^[a-z0-9_]{3,21}$/.test(normalized)) return null
  return normalized
}

export function sanitizeScoutOutput(
  ranked: Array<{ surfacedPostId: string; reason?: string }>,
  candidates: SurfacedPostCandidate[],
  limit: number,
) {
  const byId = new Map(candidates.map((candidate) => [
    String(candidate.surfacedPostId),
    candidate,
  ]))
  const selected: ScoutedPost[] = []
  const seen = new Set<string>()

  for (const item of ranked) {
    const candidate = byId.get(String(item.surfacedPostId))
    if (!candidate || seen.has(item.surfacedPostId)) continue

    selected.push({
      surfacedPostId: candidate.surfacedPostId,
      subreddit: candidate.subreddit,
      scoutRationale: item.reason?.trim() || undefined,
    })
    seen.add(item.surfacedPostId)
    if (selected.length >= limit) return selected
  }

  for (const candidate of fallbackCandidates(candidates)) {
    if (seen.has(candidate.surfacedPostId)) continue

    selected.push({
      surfacedPostId: candidate.surfacedPostId,
      subreddit: candidate.subreddit,
      scoutRationale: "Deterministic fallback ranking",
    })
    seen.add(candidate.surfacedPostId)
    if (selected.length >= limit) return selected
  }

  return selected
}

export const runSubredditScout = internalAction({
  args: {
    projectId: v.id("projects"),
    subreddit: v.string(),
    candidates: v.array(surfacedPostCandidateValidator),
  },
  returns: v.array(scoutedPostValidator),
  handler: async (ctx, args): Promise<ScoutedPost[]> => {
    const subreddit = normalizeSubredditName(args.subreddit)
    if (!subreddit) return []

    const candidates = args.candidates.filter(
      (candidate) => normalizeSubredditName(candidate.subreddit) === subreddit,
    )
    if (candidates.length === 0) return []

    const context = await ctx.runQuery(
      internal.pipeline.data.loadReplyPipelineContext,
      {
        projectId: args.projectId,
        surfacedPostIds: candidates.map((candidate) => candidate.surfacedPostId),
      },
    )
    const limits = getPipelineLimits(context.project.plan)
    const promptPosts = candidates.map((post) => ({
      surfacedPostId: post.surfacedPostId,
      redditPostId: post.redditPostId,
      subreddit: post.subreddit,
      title: post.title,
      selftext: truncate(post.selftext, 600),
      url: post.url,
      score: post.score,
      commentCount: post.commentCount,
      postedAt: new Date(post.postedAt).toISOString(),
    }))

    const result = await generateObject({
      model: deepseekV4Pro(),
      ...judgeSettings,
      ...deepseekHighReasoningOptions,
      schema: scoutSchema,
      prompt: [
        `Scout r/${subreddit} for strong reply opportunities for a B2B founder.`,
        "Return post IDs that are specific, recent, discussion-worthy, and likely to benefit from a helpful non-promotional reply.",
        "Avoid memes, thin announcements, ragebait, and posts where a brand reply would feel intrusive.",
        `Return up to ${limits.maxScoutPostsPerSubreddit} surfacedPostId values from the candidates.`,
        `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "filter")}`,
        `Candidates JSON: ${JSON.stringify(promptPosts)}`,
      ].join("\n\n"),
    })

    return sanitizeScoutOutput(
      result.object.ranked,
      candidates,
      limits.maxScoutPostsPerSubreddit,
    )
  },
})
