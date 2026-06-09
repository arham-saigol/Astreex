import { v } from "convex/values"
import { internalMutation } from "../_generated/server"
import { draftValidator } from "./validators"

export const createDailyCards = internalMutation({
  args: {
    projectId: v.id("projects"),
    selectedDrafts: v.array(draftValidator),
  },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .take(50)
    const activeAccounts = accounts.filter((account) => account.isActive)

    if (activeAccounts.length === 0) {
      return { created: 0, skipped: true }
    }

    const now = Date.now()
    let created = 0

    for (const draft of args.selectedDrafts) {
      const redditAccount = activeAccounts[created % activeAccounts.length]

      if (draft.type === "reply") {
        await ctx.db.insert("cards", {
          projectId: args.projectId,
          surfacedPostId: draft.surfacedPostId,
          redditAccountId: redditAccount._id,
          type: "reply",
          targetSubreddit: draft.targetSubreddit,
          draftContent: draft.draftContent,
          status: "pending",
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
          createdAt: now,
        })
      }

      created++
    }

    return { created, skipped: false }
  },
})
