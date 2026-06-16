import { v } from "convex/values"
import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import {
  draftValidator,
  originalDraftValidator,
  replyDraftValidator,
  type Draft,
  type OriginalDraft,
  type ReplyDraft,
} from "./validators"

function stableHash(value: string) {
  let hash = 5381
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

function draftKey(draft: Draft) {
  if (draft.type === "reply") {
    return stableHash(JSON.stringify({
      type: draft.type,
      surfacedPostId: draft.surfacedPostId,
      targetSubreddit: draft.targetSubreddit,
      draftContent: draft.draftContent,
    }))
  }

  return stableHash(JSON.stringify({
    type: draft.type,
    targetSubreddit: draft.targetSubreddit,
    title: draft.title,
    body: draft.body,
  }))
}

function replyDraftKey(draft: ReplyDraft) {
  return stableHash(JSON.stringify({
    type: draft.type,
    surfacedPostId: draft.surfacedPostId,
    targetSubreddit: draft.targetSubreddit,
    draftContent: draft.draftContent,
  }))
}

function originalDraftKey(draft: OriginalDraft) {
  return stableHash(JSON.stringify({
    type: draft.type,
    targetSubreddit: draft.targetSubreddit,
    title: draft.title,
    body: draft.body,
    briefId: draft.briefId,
  }))
}

async function healthyAccounts(ctx: MutationCtx, projectId: Id<"projects">) {
  const accounts = ctx.db
    .query("redditAccounts")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
  const healthy: Array<Doc<"redditAccounts">> = []

  for await (const account of accounts) {
    if (
      account.isActive &&
      account.healthStatus === "healthy" &&
      account.providerCanPost !== false &&
      account.providerNeedsReconnect !== true
    ) {
      healthy.push(account)
      if (healthy.length >= 50) break
    }
  }

  return healthy
}

export const createDailyCards = internalMutation({
  args: {
    projectId: v.id("projects"),
    runId: v.id("pipelineRuns"),
    selectedDrafts: v.array(draftValidator),
  },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .take(50)
    const activeAccounts = accounts.filter(
      (account) =>
        account.isActive &&
        account.healthStatus === "healthy" &&
        account.providerCanPost !== false &&
        account.providerNeedsReconnect !== true,
    )

    if (activeAccounts.length === 0) {
      return { created: 0, skipped: true }
    }

    const now = Date.now()
    let created = 0

    for (const [index, draft] of args.selectedDrafts.entries()) {
      const key = draftKey(draft)
      const existing = await ctx.db
        .query("cards")
        .withIndex("by_projectId_and_pipelineRunId_and_draftKey", (q) =>
          q
            .eq("projectId", args.projectId)
            .eq("pipelineRunId", args.runId)
            .eq("draftKey", key),
        )
        .first()
      if (existing) continue

      const redditAccount = activeAccounts[index % activeAccounts.length]

      if (draft.type === "reply") {
        await ctx.db.insert("cards", {
          projectId: args.projectId,
          surfacedPostId: draft.surfacedPostId,
          redditAccountId: redditAccount._id,
          type: "reply",
          targetSubreddit: draft.targetSubreddit,
          draftContent: draft.draftContent,
          status: "pending",
          pipelineRunId: args.runId,
          draftKey: key,
          createdAt: now,
        })
      } else {
        await ctx.db.insert("cards", {
          projectId: args.projectId,
          surfacedPostId: null,
          redditAccountId: redditAccount._id,
          type: "original",
          targetSubreddit: draft.targetSubreddit,
          draftContent: `${draft.title}\n${draft.body}`,
          status: "pending",
          pipelineRunId: args.runId,
          draftKey: key,
          createdAt: now,
        })
      }

      created++
    }

    return { created, skipped: false }
  },
})

export const createDailyReplyCards = internalMutation({
  args: {
    projectId: v.id("projects"),
    runId: v.id("pipelineRuns"),
    selectedDrafts: v.array(replyDraftValidator),
  },
  handler: async (ctx, args) => {
    const pipelineRun = await ctx.db.get(args.runId)
    if (!pipelineRun || pipelineRun.projectId !== args.projectId) {
      return { created: 0, skipped: false }
    }

    const activeAccounts = await healthyAccounts(ctx, args.projectId)

    if (activeAccounts.length === 0) {
      return { created: 0, skipped: true }
    }

    const now = Date.now()
    let created = 0

    for (const draft of args.selectedDrafts) {
      const key = replyDraftKey(draft)
      const existing = await ctx.db
        .query("cards")
        .withIndex("by_projectId_and_pipelineRunId_and_draftKey", (q) =>
          q
            .eq("projectId", args.projectId)
            .eq("pipelineRunId", args.runId)
            .eq("draftKey", key),
        )
        .first()
      if (existing) continue

      const surfacedPost = await ctx.db.get(draft.surfacedPostId)
      if (!surfacedPost || surfacedPost.projectId !== args.projectId) continue

      const redditAccount = activeAccounts[created % activeAccounts.length]

      await ctx.db.insert("cards", {
        projectId: args.projectId,
        surfacedPostId: draft.surfacedPostId,
        redditAccountId: redditAccount._id,
        type: "reply",
        targetSubreddit: draft.targetSubreddit,
        draftContent: draft.draftContent,
        status: "pending",
        pipelineRunId: args.runId,
        draftKey: key,
        createdAt: now,
      })

      created++
    }

    return { created, skipped: false }
  },
})

export const createDailyOriginalCards = internalMutation({
  args: {
    projectId: v.id("projects"),
    runId: v.id("pipelineRuns"),
    selectedDrafts: v.array(originalDraftValidator),
  },
  handler: async (ctx, args) => {
    const pipelineRun = await ctx.db.get(args.runId)
    if (!pipelineRun || pipelineRun.projectId !== args.projectId) {
      return { created: 0, skipped: false }
    }

    const activeAccounts = await healthyAccounts(ctx, args.projectId)

    if (activeAccounts.length === 0) {
      return { created: 0, skipped: true }
    }

    const now = Date.now()
    let created = 0

    for (const draft of args.selectedDrafts) {
      const key = originalDraftKey(draft)
      const existing = await ctx.db
        .query("cards")
        .withIndex("by_projectId_and_pipelineRunId_and_draftKey", (q) =>
          q
            .eq("projectId", args.projectId)
            .eq("pipelineRunId", args.runId)
            .eq("draftKey", key),
        )
        .first()
      if (existing) continue

      const redditAccount = activeAccounts[created % activeAccounts.length]

      await ctx.db.insert("cards", {
        projectId: args.projectId,
        surfacedPostId: null,
        redditAccountId: redditAccount._id,
        type: "original",
        targetSubreddit: draft.targetSubreddit,
        draftContent: draft.draftContent,
        status: "pending",
        pipelineRunId: args.runId,
        draftKey: key,
        createdAt: now,
      })

      created++
    }

    return { created, skipped: false }
  },
})
