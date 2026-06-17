import { v } from "convex/values"
import { internalMutation, type MutationCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import {
  isReadyRedditAccount,
  isUsableRedditAccount,
  normalizeSubredditName,
} from "../lib/accountSafety"
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

async function eligibleAccountsForSubreddit(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  subredditName: string | null | undefined,
) {
  if (!subredditName) return []
  const subreddit = normalizeSubredditName(subredditName)
  const usableAccounts: Array<Doc<"redditAccounts">> = []
  for await (const account of ctx.db
    .query("redditAccounts")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))) {
    if (!isUsableRedditAccount(account)) continue
    usableAccounts.push(account)
    if (usableAccounts.length >= 50) break
  }
  const usableAccountIds = new Set(usableAccounts.map((account) => account._id))
  const accessRows = await ctx.db
    .query("redditSubredditAccess")
    .withIndex("by_projectId_and_subreddit", (q) =>
      q.eq("projectId", projectId).eq("subreddit", subreddit),
    )
    .take(50)
  const postableAccountIds = new Set(
    accessRows
      .filter((row) => row.canPost && usableAccountIds.has(row.redditAccountId))
      .map((row) => row.redditAccountId),
  )
  const postableAccounts = usableAccounts.filter((account) =>
    postableAccountIds.has(account._id),
  )
  const readyAccounts = postableAccounts.filter(isReadyRedditAccount)
  const hasReadyAccount = usableAccounts.some(isReadyRedditAccount)

  return hasReadyAccount && readyAccounts.length > 0 ? readyAccounts : postableAccounts
}

export const createDailyCards = internalMutation({
  args: {
    projectId: v.id("projects"),
    runId: v.id("pipelineRuns"),
    selectedDrafts: v.array(draftValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    let created = 0
    let sawEligibleAccount = false

    for (const draft of args.selectedDrafts) {
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

      const eligibleAccounts = await eligibleAccountsForSubreddit(
        ctx,
        args.projectId,
        draft.targetSubreddit,
      )
      if (eligibleAccounts.length === 0) continue
      sawEligibleAccount = true
      const redditAccount = eligibleAccounts[created % eligibleAccounts.length]

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

    return { created, skipped: !sawEligibleAccount }
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

    const now = Date.now()
    let created = 0
    let sawEligibleAccount = false

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

      const eligibleAccounts = await eligibleAccountsForSubreddit(
        ctx,
        args.projectId,
        draft.targetSubreddit,
      )
      if (eligibleAccounts.length === 0) continue
      sawEligibleAccount = true
      const redditAccount = eligibleAccounts[created % eligibleAccounts.length]

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

    return { created, skipped: !sawEligibleAccount }
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

    const now = Date.now()
    let created = 0
    let sawEligibleAccount = false

    for (const draft of args.selectedDrafts) {
      const eligibleAccounts = await eligibleAccountsForSubreddit(
        ctx,
        args.projectId,
        draft.targetSubreddit,
      )
      if (eligibleAccounts.length === 0) continue
      sawEligibleAccount = true

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

      const redditAccount = eligibleAccounts[created % eligibleAccounts.length]

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

    return { created, skipped: !sawEligibleAccount }
  },
})
