"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import {
  deepseekHighReasoningOptions,
  deepseekV4Pro,
  originalSettings,
  replySettings,
} from "../lib/ai"
import { compactIntelligenceJson } from "./intelligenceContext"
import {
  originalPostBriefValidator,
  originalDraftValidator,
  type Draft,
  type OriginalDraft,
  type OriginalPostBrief,
  type ReplyDraft,
} from "./validators"

const replySchema = z.object({
  reply: z.string().min(1).refine((value) => value.trim().length > 0),
})

const originalPostSchema = z.object({
  title: z.string().min(1).refine((value) => value.trim().length > 0),
  body: z.string().min(1).refine((value) => value.trim().length > 0),
})

function truncate(value: string | undefined, length: number) {
  if (!value) return ""
  return value.length > length ? `${value.slice(0, length)}...` : value
}

export const generateSingleReply = internalAction({
  args: {
    projectId: v.id("projects"),
    surfacedPostId: v.id("surfacedPosts"),
    scoutRationale: v.optional(v.string()),
    opportunityRationale: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ReplyDraft> => {
    const context = await ctx.runQuery(
      internal.pipeline.data.loadReplyDraftContext,
      args,
    )

    const result = await generateObject({
      model: deepseekV4Pro(),
      ...replySettings,
      ...deepseekHighReasoningOptions,
      schema: replySchema,
      prompt: [
        "Draft one helpful Reddit reply for a B2B founder.",
        "Keep it specific, conversational, and non-promotional. Do not include links unless the post explicitly asks for resources.",
        args.scoutRationale ? `Scout rationale: ${args.scoutRationale}` : "",
        args.opportunityRationale
          ? `Opportunity rationale: ${args.opportunityRationale}`
          : "",
        `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "reply")}`,
        `Post JSON: ${JSON.stringify({
          subreddit: context.post.subreddit,
          title: context.post.title,
          selftext: truncate(context.post.selftext, 1200),
          url: context.post.url,
          score: context.post.score,
          commentCount: context.post.commentCount,
        })}`,
      ].filter(Boolean).join("\n\n"),
    })

    return {
      type: "reply",
      surfacedPostId: args.surfacedPostId,
      targetSubreddit: context.post.subreddit,
      draftContent: result.object.reply.trim(),
      scoutRationale: args.scoutRationale,
      opportunityRationale: args.opportunityRationale,
    }
  },
})

export const generateSingleOriginalPost = internalAction({
  args: {
    projectId: v.id("projects"),
    targetSubreddit: v.string(),
  },
  handler: async (ctx, args): Promise<Draft> => {
    const context = await ctx.runQuery(
      internal.pipeline.data.loadOriginalDraftContext,
      args,
    )

    const result = await generateObject({
      model: deepseekV4Pro(),
      ...originalSettings,
      ...deepseekHighReasoningOptions,
      schema: originalPostSchema,
      prompt: [
        "Draft one original Reddit post for a B2B founder.",
        "Make it useful as a standalone community post, not an ad. Avoid links, sales language, and product announcements.",
        `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "original")}`,
        `Subreddit context JSON: ${JSON.stringify(context.subreddit)}`,
      ].join("\n\n"),
    })

    const title = result.object.title.trim()
    const body = result.object.body.trim()

    return {
      type: "original",
      targetSubreddit: context.subreddit.name,
      title,
      body,
      draftContent: `${title}\n${body}`,
    }
  },
})

function originalBriefPrompt(brief: OriginalPostBrief) {
  return JSON.stringify({
    briefId: brief.briefId,
    targetSubreddit: brief.targetSubreddit,
    titleAngle: brief.titleAngle,
    bodyDirection: brief.bodyDirection,
    rationale: brief.rationale,
    signalIds: brief.signalIds,
    themeId: brief.themeId,
  })
}

export const generateOriginalPostFromBrief = internalAction({
  args: {
    projectId: v.id("projects"),
    brief: originalPostBriefValidator,
  },
  handler: async (ctx, args): Promise<OriginalDraft> => {
    const context = await ctx.runQuery(
      internal.pipeline.data.loadOriginalDraftContext,
      {
        projectId: args.projectId,
        targetSubreddit: args.brief.targetSubreddit,
      },
    )

    const result = await generateObject({
      model: deepseekV4Pro(),
      ...originalSettings,
      ...deepseekHighReasoningOptions,
      schema: originalPostSchema,
      prompt: [
        "Draft one original Reddit post for a B2B founder from this approved post brief.",
        "Make it useful as a standalone community post, not an ad. Avoid links, sales language, product announcements, fake vulnerability, and engagement bait.",
        "The title must fit the target subreddit. The body should provide a concrete observation, framework, story, or useful question that invites discussion.",
        `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "original")}`,
        `Subreddit context JSON: ${JSON.stringify(context.subreddit)}`,
        `Post brief JSON: ${originalBriefPrompt(args.brief)}`,
      ].join("\n\n"),
    })

    const title = result.object.title.trim()
    const body = result.object.body.trim()

    return {
      type: "original",
      targetSubreddit: context.subreddit.name,
      title,
      body,
      draftContent: `${title}\n${body}`,
      briefId: args.brief.briefId,
      rationale: args.brief.rationale,
    }
  },
})

export const rewriteOriginalPostFromBrief = internalAction({
  args: {
    projectId: v.id("projects"),
    brief: originalPostBriefValidator,
    currentDraft: originalDraftValidator,
    rewriteInstructions: v.string(),
  },
  handler: async (ctx, args): Promise<OriginalDraft> => {
    const context = await ctx.runQuery(
      internal.pipeline.data.loadOriginalDraftContext,
      {
        projectId: args.projectId,
        targetSubreddit: args.brief.targetSubreddit,
      },
    )

    const result = await generateObject({
      model: deepseekV4Pro(),
      ...originalSettings,
      ...deepseekHighReasoningOptions,
      schema: originalPostSchema,
      prompt: [
        "Rewrite this original Reddit post so it is safer, more useful, and better fit for the subreddit.",
        "Keep it non-promotional. Avoid links, sales language, product announcements, fake vulnerability, and engagement bait.",
        `Rewrite instructions: ${args.rewriteInstructions}`,
        `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "original")}`,
        `Subreddit context JSON: ${JSON.stringify(context.subreddit)}`,
        `Post brief JSON: ${originalBriefPrompt(args.brief)}`,
        `Current draft JSON: ${JSON.stringify({
          title: args.currentDraft.title,
          body: args.currentDraft.body,
        })}`,
      ].join("\n\n"),
    })

    const title = result.object.title.trim()
    const body = result.object.body.trim()

    return {
      type: "original",
      targetSubreddit: context.subreddit.name,
      title,
      body,
      draftContent: `${title}\n${body}`,
      briefId: args.brief.briefId,
      rationale: args.brief.rationale,
    }
  },
})
