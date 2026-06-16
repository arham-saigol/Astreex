import { v } from "convex/values"
import { internalQuery } from "../_generated/server"
import type { Doc } from "../_generated/dataModel"
import { getPipelineLimits, getPlanLimits } from "../lib/planLimits"

const RECENT_CANDIDATE_WINDOW_MS = 48 * 60 * 60 * 1000

function normalizeSubredditName(name: string) {
  return name.replace(/^r\//i, "").trim().toLowerCase()
}

export function isValidProjectIntelligenceProfile(intelligenceJson: string) {
  try {
    const parsed = JSON.parse(intelligenceJson)
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
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand || !isValidProjectIntelligenceProfile(brand.intelligenceJson)) {
      return { ready: false as const, reason: "missing_project_intelligence_profile" }
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
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand || !isValidProjectIntelligenceProfile(brand.intelligenceJson)) {
      throw new Error("Project intelligence profile is missing")
    }

    const posts = (await Promise.all(
      args.surfacedPostIds.map((surfacedPostId) => ctx.db.get(surfacedPostId)),
    )).filter(
      (post): post is Doc<"surfacedPosts"> =>
        post !== null && post.projectId === args.projectId,
    )

    return {
      project: {
        _id: project._id,
        plan: project.plan,
      },
      brand: {
        intelligenceJson: brand.intelligenceJson,
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
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    const post = await ctx.db.get(args.surfacedPostId)

    if (!brand || !isValidProjectIntelligenceProfile(brand.intelligenceJson)) {
      throw new Error("Project intelligence profile is missing")
    }
    if (!post || post.projectId !== args.projectId) {
      throw new Error("Surfaced post not found")
    }

    return {
      brand: {
        intelligenceJson: brand.intelligenceJson,
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
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand || !isValidProjectIntelligenceProfile(brand.intelligenceJson)) {
      throw new Error("Project intelligence profile is missing")
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
        intelligenceJson: brand.intelligenceJson,
      },
      subreddit: {
        name: subreddit.name,
        memberCount: subreddit.memberCount ?? null,
        reasoning: subreddit.reasoning,
      },
    }
  },
})

export const loadRecentUncardedCandidates = internalQuery({
  args: {
    projectId: v.id("projects"),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) return []

    const limits = getPipelineLimits(project.plan)
    const subreddits = await ctx.db
      .query("subreddits")
      .withIndex("by_projectId_active", (q) =>
        q.eq("projectId", args.projectId).eq("active", true),
      )
      .take(100)
    const activeSubreddits = subreddits
      .sort((a, b) => {
        if (a.relevanceScore !== b.relevanceScore) {
          return b.relevanceScore - a.relevanceScore
        }
        return a._creationTime - b._creationTime
      })
      .slice(0, limits.monitoredSubreddits)

    const cutoff = (args.now ?? Date.now()) - RECENT_CANDIDATE_WINDOW_MS
    const perSubredditLimit = limits.opportunityShardMaxPosts
    const groups = []

    for (const subreddit of activeSubreddits) {
      const subredditName = normalizeSubredditName(subreddit.name)
      const posts = await ctx.db
        .query("surfacedPosts")
        .withIndex("by_projectId_and_subreddit_and_postedAt", (q) =>
          q
            .eq("projectId", args.projectId)
            .eq("subreddit", subredditName)
            .gte("postedAt", cutoff),
        )
        .order("desc")
        .take(perSubredditLimit)

      const candidates = []
      for (const post of posts) {
        const existingCard = await ctx.db
          .query("cards")
          .withIndex("by_projectId_and_surfacedPostId", (q) =>
            q.eq("projectId", args.projectId).eq("surfacedPostId", post._id),
          )
          .take(1)

        if (existingCard.length > 0) continue

        candidates.push({
          surfacedPostId: post._id,
          redditPostId: post.redditPostId,
          subreddit: post.subreddit,
          title: post.title,
          selftext: post.selftext,
          url: post.url,
          score: post.score,
          commentCount: post.commentCount,
          postedAt: post.postedAt,
        })
      }

      groups.push({ subreddit: subredditName, candidates })
    }

    return groups
  },
})

export const loadReplyPipelineContext = internalQuery({
  args: {
    projectId: v.id("projects"),
    surfacedPostIds: v.array(v.id("surfacedPosts")),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const brand = await ctx.db
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand || !isValidProjectIntelligenceProfile(brand.intelligenceJson)) {
      throw new Error("Project intelligence profile is missing")
    }

    const posts = (await Promise.all(
      args.surfacedPostIds.map((surfacedPostId) => ctx.db.get(surfacedPostId)),
    )).filter(
      (post): post is Doc<"surfacedPosts"> =>
        post !== null && post.projectId === args.projectId,
    )

    return {
      project: {
        plan: project.plan,
      },
      brand: {
        intelligenceJson: brand.intelligenceJson,
      },
      posts,
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
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand || !isValidProjectIntelligenceProfile(brand.intelligenceJson)) {
      throw new Error("Project intelligence profile is missing")
    }

    const postedSince = Date.now() - 7 * 24 * 60 * 60 * 1000
    const postedRows = await ctx.db
      .query("postedContent")
      .withIndex("by_projectId_and_createdAt", (q) =>
        q.eq("projectId", args.projectId).gte("createdAt", postedSince),
      )
      .order("desc")
      .take(200)

    const performance = await Promise.all(postedRows.map(async (row) => {
      const card = await ctx.db.get(row.cardId)
      const surfacedPost = card?.surfacedPostId
        ? await ctx.db.get(card.surfacedPostId)
        : null
      return {
        subreddit: row.subreddit,
        type: card?.type ?? null,
        title: surfacedPost?.title ?? "Original post",
        score: row.score,
        replyCount: row.replyCount,
        visibility: row.visibility,
        createdAt: row.createdAt,
      }
    }))

    return {
      project: {
        plan: project.plan,
      },
      brand: {
        intelligenceJson: brand.intelligenceJson,
      },
      performance,
    }
  },
})
