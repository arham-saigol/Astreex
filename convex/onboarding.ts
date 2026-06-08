import { v } from "convex/values"
import { mutation, query } from "./_generated/server"

export const getOnboardingStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return { isAuthenticated: false, hasCompletedOnboarding: false }
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique()

    if (!user) {
      return { isAuthenticated: true, hasCompletedOnboarding: false }
    }

    const project = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first()

    return {
      isAuthenticated: true,
      hasCompletedOnboarding: !!project,
    }
  },
})

export const completeOnboarding = mutation({
  args: {
    projectName: v.string(),
    websiteUrl: v.string(),
    competitorUrl: v.optional(v.string()),
    plan: v.union(v.literal("starter"), v.literal("growth"), v.literal("scale")),
    timezone: v.string(),
    redditAccount: v.optional(
      v.object({
        username: v.string(),
        accessToken: v.string(),
        refreshToken: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      throw new Error("Not authenticated")
    }

    // Get or create user
    let user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique()

    if (!user) {
      const userId = await ctx.db.insert("users", {
        clerkId: identity.subject,
        email: identity.email ?? "",
        name: identity.name,
        avatarUrl: identity.pictureUrl,
        createdAt: Date.now(),
      })
      user = (await ctx.db.get(userId))!
    }

    const now = Date.now()
    const sevenDays = 7 * 24 * 60 * 60 * 1000

    // Create project
    const projectId = await ctx.db.insert("projects", {
      userId: user._id,
      name: args.projectName,
      plan: args.plan,
      planStatus: "trialing",
      trialEndsAt: now + sevenDays,
      timezone: args.timezone,
      lastActiveAt: now,
      createdAt: now,
    })

    // Create brand
    await ctx.db.insert("brands", {
      projectId,
      websiteUrl: args.websiteUrl,
      competitorUrl: args.competitorUrl,
      profileJson: "{}",
      createdAt: now,
      updatedAt: now,
    })

    // Create reddit account if connected
    if (args.redditAccount) {
      await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: args.redditAccount.username,
        accessToken: args.redditAccount.accessToken,
        refreshToken: args.redditAccount.refreshToken,
        tokenExpiresAt: now + 60 * 60 * 1000,
        isActive: true,
        healthStatus: "healthy",
        createdAt: now,
      })
    }

    return { projectId }
  },
})
