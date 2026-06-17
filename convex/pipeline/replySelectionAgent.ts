"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import {
  deepseekHighReasoningOptions,
  deepseekMaxReasoningOptions,
  deepseekV4Pro,
  judgeSettings,
} from "../lib/ai"
import { WARMUP_PROMPT_NOTE } from "../lib/accountSafety"
import { getPipelineLimits, type Plan } from "../lib/planLimits"
import { compactIntelligenceJson } from "./intelligenceContext"
import { replyDraftValidator, type ReplyDraft } from "./validators"

const selectionSchema = z.object({
  selectedIndices: z.array(z.number().int()),
})

const notesSchema = z.object({
  notes: z.string(),
})

export function replySelectionPath(plan: Plan) {
  return plan === "scale" ? "scale" : "single"
}

export function sanitizeReplySelection(
  drafts: ReplyDraft[],
  selectedIndices: number[],
  targetCount: number,
) {
  const finalCount = Math.min(targetCount, drafts.length)
  const orderedIndices = [
    ...selectedIndices.filter((index) =>
      Number.isInteger(index) && index >= 0 && index < drafts.length,
    ),
    ...drafts.map((_, index) => index),
  ]
  const selected: number[] = []
  const seen = new Set<number>()
  const subredditCounts = new Map<string, number>()
  const uniqueSubreddits = new Set(
    drafts.map((draft) => draft.targetSubreddit.toLowerCase()),
  )
  const maxPerSubreddit = Math.max(
    1,
    Math.ceil(finalCount / Math.min(uniqueSubreddits.size || 1, finalCount || 1)),
  )

  for (const index of orderedIndices) {
    if (selected.length >= finalCount) break
    if (seen.has(index)) continue

    const subreddit = drafts[index].targetSubreddit.toLowerCase()
    const count = subredditCounts.get(subreddit) ?? 0
    if (count >= maxPerSubreddit) continue

    selected.push(index)
    seen.add(index)
    subredditCounts.set(subreddit, count + 1)
  }

  for (const index of orderedIndices) {
    if (selected.length >= finalCount) break
    if (seen.has(index)) continue

    selected.push(index)
    seen.add(index)
  }

  return selected.map((index) => drafts[index])
}

function draftsForPrompt(drafts: ReplyDraft[]) {
  return drafts.map((draft, index) => ({
    index,
    surfacedPostId: draft.surfacedPostId,
    subreddit: draft.targetSubreddit,
    draftContent: draft.draftContent,
    scoutRationale: draft.scoutRationale,
    opportunityRationale: draft.opportunityRationale,
  }))
}

async function runFinalJudge(args: {
  drafts: ReplyDraft[]
  targetCount: number
  intelligenceJson: string
  performance: unknown
  extraNotes?: string
  warmupMode?: string
}) {
  const result = await generateObject({
    model: deepseekV4Pro(),
    ...judgeSettings,
    ...deepseekMaxReasoningOptions,
    schema: selectionSchema,
    prompt: [
      "Select the strongest Reddit reply cards for today's feed.",
      `Return up to ${args.targetCount} zero-based draft indices.`,
      "Prioritize usefulness, brand fit, practical specificity, and subreddit diversity. Avoid promotional or repetitive replies.",
      args.warmupMode === "all_warmup" ? WARMUP_PROMPT_NOTE : "",
      args.extraNotes ? `Selection notes JSON: ${args.extraNotes}` : "",
      `Project intelligence JSON: ${compactIntelligenceJson(args.intelligenceJson, "judge")}`,
      `Last 7 days performance JSON: ${JSON.stringify(args.performance)}`,
      `Reply drafts JSON: ${JSON.stringify(draftsForPrompt(args.drafts))}`,
    ].join("\n\n"),
  })

  return result.object.selectedIndices
}

export const selectFinalReplies = internalAction({
  args: {
    projectId: v.id("projects"),
    drafts: v.array(replyDraftValidator),
  },
  handler: async (ctx, args): Promise<ReplyDraft[]> => {
    if (args.drafts.length === 0) return []

    const context = await ctx.runQuery(
      internal.pipeline.data.loadJudgeContext,
      { projectId: args.projectId },
    )
    const limits = getPipelineLimits(context.project.plan)
    const targetCount = limits.replyCardsPerDay

    if (replySelectionPath(context.project.plan) === "single") {
      const selectedIndices = await runFinalJudge({
        drafts: args.drafts,
        targetCount,
        intelligenceJson: context.brand.intelligenceJson,
        performance: context.performance,
        warmupMode: context.project.warmupMode,
      })
      return sanitizeReplySelection(args.drafts, selectedIndices, targetCount)
    }

    const consolidator = await generateObject({
      model: deepseekV4Pro(),
      ...judgeSettings,
      ...deepseekHighReasoningOptions,
      schema: notesSchema,
      prompt: [
        "Consolidate these reply drafts into strengths, weak spots, duplicate themes, and subreddit coverage notes.",
        `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "judge")}`,
        `Reply drafts JSON: ${JSON.stringify(draftsForPrompt(args.drafts))}`,
      ].join("\n\n"),
    })
    const advisory = await generateObject({
      model: deepseekV4Pro(),
      ...judgeSettings,
      ...deepseekHighReasoningOptions,
      schema: notesSchema,
      prompt: [
        `Advise the final selector on the best ${targetCount} reply cards for today.`,
        "Favor high-opportunity replies, coverage across communities, and low risk of sounding promotional.",
        context.project.warmupMode === "all_warmup" ? WARMUP_PROMPT_NOTE : "",
        `Consolidator notes: ${consolidator.object.notes}`,
        `Last 7 days performance JSON: ${JSON.stringify(context.performance)}`,
      ].join("\n\n"),
    })
    const selectedIndices = await runFinalJudge({
      drafts: args.drafts,
      targetCount,
      intelligenceJson: context.brand.intelligenceJson,
      performance: context.performance,
      extraNotes: JSON.stringify({
        consolidator: consolidator.object.notes,
        advisory: advisory.object.notes,
      }),
      warmupMode: context.project.warmupMode,
    })

    return sanitizeReplySelection(args.drafts, selectedIndices, targetCount)
  },
})
