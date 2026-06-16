"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import {
  deepseekHighReasoningOptions,
  deepseekMaxReasoningOptions,
  deepseekV4Pro,
  judgeSettings,
} from "../lib/ai"
import { getPipelineLimits, type Plan } from "../lib/planLimits"
import { compactIntelligenceJson } from "./intelligenceContext"
import {
  replyOpportunityValidator,
  scoutedPostValidator,
  type ReplyOpportunity,
  type ScoutedPost,
} from "./validators"

const judgeSchema = z.object({
  selected: z.array(z.object({
    surfacedPostId: z.string(),
    reason: z.string().optional(),
  })),
})

type ReplyPipelineContext = {
  project: { plan: Plan }
  brand: { intelligenceJson: string }
  posts: Doc<"surfacedPosts">[]
}

type OpportunitySelectionResult = {
  opportunities: ReplyOpportunity[]
  shardCount: number
}

function truncate(value: string | undefined, length: number) {
  if (!value) return ""
  return value.length > length ? `${value.slice(0, length)}...` : value
}

function postScore(post: Doc<"surfacedPosts">) {
  return (
    Math.log1p(Math.max(0, post.commentCount)) * 8 +
    Math.log1p(Math.max(0, post.score)) -
    Math.max(0, Date.now() - post.postedAt) / 3_600_000
  )
}

export function balancedShards<T>(items: T[], maxShardSize: number) {
  if (items.length === 0) return []

  const shardCount = Math.ceil(items.length / maxShardSize)
  const shards: T[][] = []
  let cursor = 0

  for (let shardIndex = 0; shardIndex < shardCount; shardIndex++) {
    const remainingItems = items.length - cursor
    const remainingShards = shardCount - shardIndex
    const shardSize = Math.ceil(remainingItems / remainingShards)
    shards.push(items.slice(cursor, cursor + shardSize))
    cursor += shardSize
  }

  return shards
}

export function shardReturnCount(
  replyDraftTarget: number,
  shardCount: number,
  shardSize: number,
) {
  return Math.min(shardSize, Math.ceil((replyDraftTarget / shardCount) * 2))
}

function dedupeScoutedPosts(scoutedPosts: ScoutedPost[]) {
  const deduped: ScoutedPost[] = []
  const seen = new Set<string>()

  for (const post of scoutedPosts) {
    if (seen.has(post.surfacedPostId)) continue
    seen.add(post.surfacedPostId)
    deduped.push(post)
  }

  return deduped
}

function sanitizeOpportunities(
  selected: Array<{ surfacedPostId: string; reason?: string }>,
  candidates: ScoutedPost[],
  posts: Doc<"surfacedPosts">[],
  limit: number,
) {
  const candidateById = new Map(candidates.map((candidate) => [
    String(candidate.surfacedPostId),
    candidate,
  ]))
  const postById = new Map(posts.map((post) => [String(post._id), post]))
  const opportunities: ReplyOpportunity[] = []
  const seen = new Set<string>()

  for (const item of selected) {
    const candidate = candidateById.get(item.surfacedPostId)
    const post = postById.get(item.surfacedPostId)
    if (!candidate || !post || seen.has(item.surfacedPostId)) continue

    opportunities.push({
      surfacedPostId: post._id,
      targetSubreddit: post.subreddit,
      scoutRationale: candidate.scoutRationale,
      opportunityRationale: item.reason?.trim() || candidate.scoutRationale,
    })
    seen.add(item.surfacedPostId)
    if (opportunities.length >= limit) return opportunities
  }

  const fallbackPosts = [...posts].sort((a, b) => postScore(b) - postScore(a))
  for (const post of fallbackPosts) {
    if (seen.has(post._id) || !candidateById.has(post._id)) continue

    const candidate = candidateById.get(post._id)
    opportunities.push({
      surfacedPostId: post._id,
      targetSubreddit: post.subreddit,
      scoutRationale: candidate?.scoutRationale,
      opportunityRationale: candidate?.scoutRationale ?? "Deterministic fallback ranking",
    })
    seen.add(post._id)
    if (opportunities.length >= limit) return opportunities
  }

  return opportunities
}

export function sanitizeOpportunityMerge(
  candidates: ReplyOpportunity[],
  selectedIds: string[],
  limit: number,
) {
  const byId = new Map(candidates.map((candidate) => [
    String(candidate.surfacedPostId),
    candidate,
  ]))
  const selected: ReplyOpportunity[] = []
  const seen = new Set<string>()

  for (const id of selectedIds) {
    const candidate = byId.get(id)
    if (!candidate || seen.has(id)) continue

    selected.push(candidate)
    seen.add(id)
    if (selected.length >= limit) return selected
  }

  for (const candidate of candidates) {
    if (seen.has(candidate.surfacedPostId)) continue

    selected.push(candidate)
    seen.add(candidate.surfacedPostId)
    if (selected.length >= limit) return selected
  }

  return selected
}

function promptPosts(posts: Doc<"surfacedPosts">[], scouted: ScoutedPost[]) {
  const scoutById = new Map(scouted.map((post) => [
    String(post.surfacedPostId),
    post.scoutRationale,
  ]))

  return posts.map((post) => ({
    surfacedPostId: post._id,
    subreddit: post.subreddit,
    title: post.title,
    selftext: truncate(post.selftext, 700),
    url: post.url,
    score: post.score,
    commentCount: post.commentCount,
    postedAt: new Date(post.postedAt).toISOString(),
    scoutRationale: scoutById.get(String(post._id)),
  }))
}

async function runOpportunityJudge(
  candidates: ScoutedPost[],
  posts: Doc<"surfacedPosts">[],
  intelligenceJson: string,
  limit: number,
  reasoning: "high" | "max",
) {
  const result = await generateObject({
    model: deepseekV4Pro(),
    ...judgeSettings,
    ...(reasoning === "max"
      ? deepseekMaxReasoningOptions
      : deepseekHighReasoningOptions),
    schema: judgeSchema,
    prompt: [
      "Choose Reddit posts that deserve a high-quality reply draft today.",
      "Prefer posts where the founder can add specific experience, practical advice, or useful clarification without sounding promotional.",
      `Return up to ${limit} surfacedPostId values from the candidates.`,
      `Project intelligence JSON: ${compactIntelligenceJson(intelligenceJson, "judge")}`,
      `Candidates JSON: ${JSON.stringify(promptPosts(posts, candidates))}`,
    ].join("\n\n"),
  })

  return sanitizeOpportunities(result.object.selected, candidates, posts, limit)
}

export const selectReplyOpportunities = internalAction({
  args: {
    projectId: v.id("projects"),
    scoutedPosts: v.array(scoutedPostValidator),
  },
  returns: v.object({
    opportunities: v.array(replyOpportunityValidator),
    shardCount: v.number(),
  }),
  handler: async (ctx, args): Promise<OpportunitySelectionResult> => {
    const candidates = dedupeScoutedPosts(args.scoutedPosts)
    if (candidates.length === 0) {
      return { opportunities: [], shardCount: 0 }
    }

    const context: ReplyPipelineContext = await ctx.runQuery(
      internal.pipeline.data.loadReplyPipelineContext,
      {
        projectId: args.projectId,
        surfacedPostIds: candidates.map((candidate) => candidate.surfacedPostId),
      },
    )
    const limits = getPipelineLimits(context.project.plan)
    const postsById: Map<string, Doc<"surfacedPosts">> = new Map(
      context.posts.map((post) => [String(post._id), post]),
    )
    const validCandidates: ScoutedPost[] = candidates.filter((candidate) =>
      postsById.has(String(candidate.surfacedPostId)),
    )
    if (validCandidates.length === 0) {
      return { opportunities: [], shardCount: 0 }
    }

    if (validCandidates.length <= limits.opportunityShardMaxPosts) {
      const opportunities = await runOpportunityJudge(
        validCandidates,
        validCandidates
          .map((candidate) => postsById.get(String(candidate.surfacedPostId)))
          .filter((post): post is Doc<"surfacedPosts"> => Boolean(post)),
        context.brand.intelligenceJson,
        limits.replyDraftTarget,
        "max",
      )
      return { opportunities, shardCount: 1 }
    }

    const shards: ScoutedPost[][] = balancedShards(
      validCandidates,
      limits.opportunityShardMaxPosts,
    )
    const shardResults = await Promise.all(shards.map(async (shard) => {
      const shardPosts = shard
        .map((candidate) => postsById.get(String(candidate.surfacedPostId)))
        .filter((post): post is Doc<"surfacedPosts"> => Boolean(post))
      return await runOpportunityJudge(
        shard,
        shardPosts,
        context.brand.intelligenceJson,
        shardReturnCount(limits.replyDraftTarget, shards.length, shard.length),
        "high",
      )
    }))

    const mergedCandidates = shardResults.flat()
    const mergeResult = await generateObject({
      model: deepseekV4Pro(),
      ...judgeSettings,
      ...deepseekMaxReasoningOptions,
      schema: z.object({
        selectedIds: z.array(z.string()),
      }),
      prompt: [
        "Merge shard-selected Reddit reply opportunities into the final draft queue.",
        `Return up to ${limits.replyDraftTarget} surfacedPostId values.`,
        "Prioritize the strongest reply opportunities while keeping subreddit diversity where possible.",
        `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "judge")}`,
        `Candidates JSON: ${JSON.stringify(mergedCandidates)}`,
      ].join("\n\n"),
    })

    return {
      opportunities: sanitizeOpportunityMerge(
        mergedCandidates,
        mergeResult.object.selectedIds,
        limits.replyDraftTarget,
      ),
      shardCount: shards.length,
    }
  },
})
