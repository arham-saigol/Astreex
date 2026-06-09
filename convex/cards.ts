import { v } from "convex/values"
import { internal } from "./_generated/api"
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server"

export const getActiveCards = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return []

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique()
    if (!user) return []

    const project = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first()
    if (!project) return []

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

    const cards = await ctx.db
      .query("cards")
      .withIndex("by_projectId_status", (q) =>
        q.eq("projectId", project._id).eq("status", "pending")
      )
      .order("desc")
      .take(50)

    // Filter out cards older than 7 days
    const activeCards = cards.filter((c) => c.createdAt > sevenDaysAgo)

    // Get all reddit accounts for this project to determine if multiple accounts
    const redditAccounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(10)

    const hasMultipleAccounts = redditAccounts.length > 1

    // Join with surfaced posts and reddit accounts
    const enrichedCards = await Promise.all(
      activeCards.map(async (card) => {
        const surfacedPost = card.surfacedPostId
          ? await ctx.db.get(card.surfacedPostId)
          : null

        const redditAccount = await ctx.db.get(card.redditAccountId)

        return {
          ...card,
          surfacedPost: surfacedPost
            ? {
                subreddit: surfacedPost.subreddit,
                title: surfacedPost.title,
                score: surfacedPost.score,
                postedAt: surfacedPost.postedAt,
              }
            : null,
          redditUsername: redditAccount?.redditUsername ?? null,
          showUsername: hasMultipleAccounts,
        }
      })
    )

    return enrichedCards
  },
})

export const approveCard = mutation({
  args: {
    cardId: v.id("cards"),
    editedContent: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const card = await ctx.db.get(args.cardId)
    if (!card) throw new Error("Card not found")

    // Verify ownership
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique()
    if (!user) throw new Error("User not found")

    const project = await ctx.db.get(card.projectId)
    if (!project || project.userId !== user._id) {
      throw new Error("Not authorized")
    }

    await ctx.db.patch(args.cardId, {
      status: "approved",
      ...(args.editedContent !== undefined ? { editedContent: args.editedContent } : {}),
    })
  },
})

export const declineCard = mutation({
  args: {
    cardId: v.id("cards"),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const card = await ctx.db.get(args.cardId)
    if (!card) throw new Error("Card not found")

    // Verify ownership
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique()
    if (!user) throw new Error("User not found")

    const project = await ctx.db.get(card.projectId)
    if (!project || project.userId !== user._id) {
      throw new Error("Not authorized")
    }

    await ctx.db.patch(args.cardId, {
      status: "declined",
    })
  },
})

async function expireStaleCardsBatch(ctx: MutationCtx, scheduleNext: boolean) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  const staleCards = await ctx.db
    .query("cards")
    .withIndex("by_status_and_createdAt", (q) =>
      q.eq("status", "pending").lt("createdAt", sevenDaysAgo),
    )
    .take(200)

  for (const card of staleCards) {
    await ctx.db.patch(card._id, { status: "expired" })
  }

  if (scheduleNext && staleCards.length === 200) {
    await ctx.scheduler.runAfter(0, internal.cards.expireStaleCardsInternal, {})
  }

  return { expired: staleCards.length }
}

export const expireStaleCards = mutation({
  args: {},
  handler: async (ctx) => {
    return await expireStaleCardsBatch(ctx, false)
  },
})

export const expireStaleCardsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    return await expireStaleCardsBatch(ctx, true)
  },
})
