import { v } from "convex/values"
import { internalMutation } from "../_generated/server"
import { draftValidator, type Draft } from "./validators"

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
