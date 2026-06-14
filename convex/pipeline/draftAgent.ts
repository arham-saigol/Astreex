"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { deepseekV4Pro, originalSettings, replySettings } from "../lib/ai"
import type { Draft } from "./validators"

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
  },
  handler: async (ctx, args): Promise<Draft> => {
    const context = await ctx.runQuery(
      internal.pipeline.data.loadReplyDraftContext,
      args,
    )

    const result = await generateObject({
      model: deepseekV4Pro(),
      ...replySettings,
      schema: replySchema,
      prompt: [
        "Draft one helpful Reddit reply for a B2B founder.",
        "Keep it specific, conversational, and non-promotional. Do not include links unless the post explicitly asks for resources.",
        `Project intelligence JSON: ${context.brand.intelligenceJson}`,
        `Post JSON: ${JSON.stringify({
          subreddit: context.post.subreddit,
          title: context.post.title,
          selftext: truncate(context.post.selftext, 1200),
          url: context.post.url,
          score: context.post.score,
          commentCount: context.post.commentCount,
        })}`,
      ].join("\n\n"),
    })

    return {
      type: "reply",
      surfacedPostId: args.surfacedPostId,
      targetSubreddit: context.post.subreddit,
      draftContent: result.object.reply.trim(),
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
      schema: originalPostSchema,
      prompt: [
        "Draft one original Reddit post for a B2B founder.",
        "Make it useful as a standalone community post, not an ad. Avoid links, sales language, and product announcements.",
        `Project intelligence JSON: ${context.brand.intelligenceJson}`,
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
