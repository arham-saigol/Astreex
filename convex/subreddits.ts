import { v } from "convex/values"
import { mutation, query } from "./_generated/server"
import { getPlanLimits } from "./lib/planLimits"

const SUBREDDIT_LIMIT_ERROR =
  "You've reached the subreddit limit for your plan. Upgrade to add more."

export const getSubreddits = query({
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

    const subreddits = await ctx.db
      .query("subreddits")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(200)

    // Sort by relevance descending, inactive at end
    subreddits.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return b.relevanceScore - a.relevanceScore
    })

    return subreddits
  },
})

export const getRadarStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) return null

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique()
    if (!user) return null

    const project = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first()
    if (!project) return null

    return {
      onboardingStatus: project.onboardingStatus ?? null,
      onboardingError: project.onboardingError ?? null,
      subredditDiscoveryStatus: project.subredditDiscoveryStatus ?? null,
    }
  },
})

export const toggleSubreddit = mutation({
  args: {
    subredditId: v.id("subreddits"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const subreddit = await ctx.db.get(args.subredditId)
    if (!subreddit) throw new Error("Subreddit not found")

    // Verify ownership
    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique()
    if (!user) throw new Error("User not found")

    const project = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first()
    if (!project || subreddit.projectId !== project._id) {
      throw new Error("Unauthorized")
    }

    if (args.active && subreddit.relevanceScore < 20) {
      throw new Error("QUALITY_GATE")
    }

    if (args.active && !subreddit.active) {
      const limits = getPlanLimits(project.plan)
      const activeSubs = await ctx.db
        .query("subreddits")
        .withIndex("by_projectId_active", (q) =>
          q.eq("projectId", project._id).eq("active", true)
        )
        .take(limits.maxSubreddits)

      if (activeSubs.length >= limits.maxSubreddits) {
        throw new Error(SUBREDDIT_LIMIT_ERROR)
      }
    }

    // If deactivating, enforce minimum 5 active
    if (!args.active) {
      const activeSubs = await ctx.db
        .query("subreddits")
        .withIndex("by_projectId_active", (q) =>
          q.eq("projectId", project._id).eq("active", true)
        )
        .take(6)

      if (activeSubs.length <= 5) {
        throw new Error("MINIMUM_ACTIVE")
      }
    }

    await ctx.db.patch(args.subredditId, { active: args.active })
  },
})

export const addSubreddit = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) throw new Error("Not authenticated")

    const user = await ctx.db
      .query("users")
      .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
      .unique()
    if (!user) throw new Error("User not found")

    const project = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first()
    if (!project) throw new Error("No project found")

    // Normalize name: strip r/ prefix and whitespace
    const cleanName = args.name.replace(/^r\//i, "").trim().toLowerCase()
    if (!/^[a-z0-9_]{3,21}$/.test(cleanName)) {
      throw new Error("INVALID_SUBREDDIT_NAME")
    }

    // Check for duplicate
    const existing = await ctx.db
      .query("subreddits")
      .withIndex("by_projectId_and_name", (q) =>
        q.eq("projectId", project._id).eq("name", cleanName),
      )
      .first()
    if (existing) throw new Error("DUPLICATE")

    const limits = getPlanLimits(project.plan)
    const activeSubs = await ctx.db
      .query("subreddits")
      .withIndex("by_projectId_active", (q) =>
        q.eq("projectId", project._id).eq("active", true)
      )
      .take(limits.maxSubreddits)

    if (activeSubs.length >= limits.maxSubreddits) {
      throw new Error(SUBREDDIT_LIMIT_ERROR)
    }

    // Hardcoded scoring for now — will be replaced by AI agent
    const relevanceScore = 75
    const reasoning = "Added by user"

    // Quality gate
    if (relevanceScore < 20) {
      throw new Error(`QUALITY_GATE:${relevanceScore}`)
    }

    const id = await ctx.db.insert("subreddits", {
      projectId: project._id,
      name: cleanName,
      relevanceScore,
      reasoning,
      active: true,
      addedBy: "user",
      createdAt: Date.now(),
    })

    return { id, relevanceScore, name: cleanName }
  },
})
