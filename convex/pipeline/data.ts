import { v } from "convex/values"
import { internalQuery } from "../_generated/server"
import { getPlanLimits } from "../lib/planLimits"

export function isValidBrandProfile(profileJson: string) {
  try {
    const parsed = JSON.parse(profileJson)
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length > 0
    )
  } catch {
    return false
  }
}

export const getProjectReadiness = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) return { ready: false as const, reason: "missing_project" }
    if (project.planStatus !== "active" && project.planStatus !== "trialing") {
      return { ready: false as const, reason: "inactive_plan" }
    }

    const brand = await ctx.db
      .query("brands")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand || !isValidBrandProfile(brand.profileJson)) {
      return { ready: false as const, reason: "missing_brand_profile" }
    }

    const subreddits = await ctx.db
      .query("subreddits")
      .withIndex("by_projectId_active", (q) =>
        q.eq("projectId", args.projectId).eq("active", true),
      )
      .take(1)
    if (subreddits.length === 0) {
      return { ready: false as const, reason: "no_active_subreddits" }
    }

    return {
      ready: true as const,
      project: {
        _id: project._id,
        plan: project.plan,
        timezone: project.timezone,
      },
      brand: {
        profileJson: brand.profileJson,
      },
    }
  },
})

export const loadActiveSubreddits = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) return []

    const limits = getPlanLimits(project.plan)
    const subreddits = await ctx.db
      .query("subreddits")
      .withIndex("by_projectId_active", (q) =>
        q.eq("projectId", args.projectId).eq("active", true),
      )
      .take(100)

    return subreddits
      .sort((a, b) => {
        if (a.relevanceScore !== b.relevanceScore) {
          return b.relevanceScore - a.relevanceScore
        }
        return a._creationTime - b._creationTime
      })
      .slice(0, limits.maxSubreddits)
  },
})

export const loadFilterContext = internalQuery({
  args: {
    projectId: v.id("projects"),
    surfacedPostIds: v.array(v.id("surfacedPosts")),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const brand = await ctx.db
      .query("brands")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand || !isValidBrandProfile(brand.profileJson)) {
      throw new Error("Brand profile is missing")
    }

    const posts = []
    for (const surfacedPostId of args.surfacedPostIds) {
      const post = await ctx.db.get(surfacedPostId)
      if (post && post.projectId === args.projectId) posts.push(post)
    }

    return {
      project: {
        _id: project._id,
        plan: project.plan,
      },
      brand: {
        profileJson: brand.profileJson,
      },
      posts,
    }
  },
})

export const loadReplyDraftContext = internalQuery({
  args: {
    projectId: v.id("projects"),
    surfacedPostId: v.id("surfacedPosts"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const brand = await ctx.db
      .query("brands")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    const post = await ctx.db.get(args.surfacedPostId)

    if (!brand || !isValidBrandProfile(brand.profileJson)) {
      throw new Error("Brand profile is missing")
    }
    if (!post || post.projectId !== args.projectId) {
      throw new Error("Surfaced post not found")
    }

    return {
      brand: {
        profileJson: brand.profileJson,
      },
      post,
    }
  },
})

export const loadOriginalDraftContext = internalQuery({
  args: {
    projectId: v.id("projects"),
    targetSubreddit: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const brand = await ctx.db
      .query("brands")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand || !isValidBrandProfile(brand.profileJson)) {
      throw new Error("Brand profile is missing")
    }

    const limits = getPlanLimits(project.plan)
    const subreddits = await ctx.db
      .query("subreddits")
      .withIndex("by_projectId_active", (q) =>
        q.eq("projectId", args.projectId).eq("active", true),
      )
      .take(100)
    const cappedSubreddits = subreddits
      .sort((a, b) => {
        if (a.relevanceScore !== b.relevanceScore) {
          return b.relevanceScore - a.relevanceScore
        }
        return a._creationTime - b._creationTime
      })
      .slice(0, limits.maxSubreddits)

    const subreddit = cappedSubreddits.find(
      (item) => item.name.toLowerCase() === args.targetSubreddit.toLowerCase(),
    )
    if (!subreddit) throw new Error("Target subreddit is not active")

    return {
      brand: {
        profileJson: brand.profileJson,
      },
      subreddit: {
        name: subreddit.name,
        memberCount: subreddit.memberCount ?? null,
        reasoning: subreddit.reasoning,
      },
    }
  },
})

export const loadJudgeContext = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const brand = await ctx.db
      .query("brands")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand || !isValidBrandProfile(brand.profileJson)) {
      throw new Error("Brand profile is missing")
    }

    const postedSince = Date.now() - 7 * 24 * 60 * 60 * 1000
    const postedRows = await ctx.db
      .query("postedContent")
      .withIndex("by_projectId_and_createdAt", (q) =>
        q.eq("projectId", args.projectId).gte("createdAt", postedSince),
      )
      .order("desc")
      .take(200)

    const performance = []
    for (const row of postedRows) {
      const card = await ctx.db.get(row.cardId)
      const surfacedPost = card?.surfacedPostId
        ? await ctx.db.get(card.surfacedPostId)
        : null
      performance.push({
        subreddit: row.subreddit,
        type: card?.type ?? null,
        title: surfacedPost?.title ?? "Original post",
        score: row.score,
        replyCount: row.replyCount,
        visibility: row.visibility,
        createdAt: row.createdAt,
      })
    }

    return {
      project: {
        plan: project.plan,
      },
      brand: {
        profileJson: brand.profileJson,
      },
      performance,
    }
  },
})
