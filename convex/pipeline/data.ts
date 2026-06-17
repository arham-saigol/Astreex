import { v } from "convex/values"
import { internalQuery, type QueryCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { getPipelineLimits, getPlanLimits } from "../lib/planLimits"
import {
  isReadyRedditAccount,
  isUsableRedditAccount,
  normalizeSubredditName,
} from "../lib/accountSafety"

const RECENT_CANDIDATE_WINDOW_MS = 48 * 60 * 60 * 1000

type WarmupMode = "none" | "ready" | "partial_warmup" | "all_warmup"

function warmupModeFromAccounts(accounts: Doc<"redditAccounts">[]): WarmupMode {
  const usable = accounts.filter(isUsableRedditAccount)
  if (usable.length === 0) return "none"
  const ready = usable.filter(isReadyRedditAccount)
  if (ready.length === 0) return "all_warmup"
  return ready.length === usable.length ? "ready" : "partial_warmup"
}

async function safetyContext(ctx: { db: QueryCtx["db"] }, projectId: Id<"projects">) {
  const accounts = await ctx.db
    .query("redditAccounts")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(50)
  const usableAccounts = accounts.filter(isUsableRedditAccount)
  const readyAccounts = usableAccounts.filter(isReadyRedditAccount)
  const accountsAllowedForNormalMode = readyAccounts.length > 0
    ? readyAccounts
    : usableAccounts
  const usableAccountIds = new Set(
    accountsAllowedForNormalMode.map((account) => account._id),
  )
  const accessRows = await ctx.db
    .query("redditSubredditAccess")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(500)
  const postableSubreddits = new Set(
    accessRows
      .filter((row) => row.canPost && usableAccountIds.has(row.redditAccountId))
      .map((row) => row.subreddit),
  )

  return {
    warmupMode: warmupModeFromAccounts(accounts),
    postableSubreddits,
  }
}

function filterPostableSubreddits<T extends { name: string }>(
  subreddits: T[],
  postableSubreddits: Set<string>,
) {
  return subreddits.filter((subreddit) =>
    postableSubreddits.has(normalizeSubredditName(subreddit.name)),
  )
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
      .take(100)
    if (subreddits.length === 0) {
      return { ready: false as const, reason: "no_active_subreddits" }
    }
    const safety = await safetyContext(ctx, args.projectId)
    if (filterPostableSubreddits(subreddits, safety.postableSubreddits).length === 0) {
      return { ready: false as const, reason: "no_postable_subreddits" }
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

    const safety = await safetyContext(ctx, args.projectId)

    return filterPostableSubreddits(subreddits, safety.postableSubreddits)
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

    const safety = await safetyContext(ctx, args.projectId)

    return {
      project: {
        _id: project._id,
        plan: project.plan,
        warmupMode: safety.warmupMode,
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

    const safety = await safetyContext(ctx, args.projectId)

    return {
      safety: {
        warmupMode: safety.warmupMode,
      },
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
    const safety = await safetyContext(ctx, args.projectId)
    const cappedSubreddits = filterPostableSubreddits(subreddits, safety.postableSubreddits)
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
      safety: {
        warmupMode: safety.warmupMode,
      },
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
    const safety = await safetyContext(ctx, args.projectId)
    const activeSubreddits = filterPostableSubreddits(subreddits, safety.postableSubreddits)
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
          .first()

        if (existingCard) continue

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

    const safety = await safetyContext(ctx, args.projectId)

    return {
      project: {
        plan: project.plan,
        warmupMode: safety.warmupMode,
      },
      brand: {
        intelligenceJson: brand.intelligenceJson,
      },
      posts,
    }
  },
})

export const loadOriginalPipelineContext = internalQuery({
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

    const limits = getPipelineLimits(project.plan)
    const safety = await safetyContext(ctx, args.projectId)
    const activeSubreddits = filterPostableSubreddits(
      await ctx.db
        .query("subreddits")
        .withIndex("by_projectId_active", (q) =>
          q.eq("projectId", args.projectId).eq("active", true),
        )
        .take(100),
      safety.postableSubreddits,
    )
      .sort((a, b) => {
        if (a.relevanceScore !== b.relevanceScore) {
          return b.relevanceScore - a.relevanceScore
        }
        return a._creationTime - b._creationTime
      })
      .slice(0, limits.activeSubredditLimit)

    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
    const recentPostRows = await Promise.all(activeSubreddits.map((subreddit) =>
      ctx.db
        .query("surfacedPosts")
        .withIndex("by_projectId_and_subreddit_and_postedAt", (q) =>
          q
            .eq("projectId", args.projectId)
            .eq("subreddit", normalizeSubredditName(subreddit.name))
            .gte("postedAt", cutoff),
        )
        .order("desc")
        .take(10),
    ))
    const recentPosts: Array<{
      _id: Id<"surfacedPosts">
      redditPostId: string
      subreddit: string
      title: string
      selftext?: string
      url: string
      score: number
      commentCount: number
      postedAt: number
    }> = recentPostRows.flatMap((posts) => posts.map((post) => ({
      _id: post._id,
      redditPostId: post.redditPostId,
      subreddit: post.subreddit,
      title: post.title,
      selftext: post.selftext,
      url: post.url,
      score: post.score,
      commentCount: post.commentCount,
      postedAt: post.postedAt,
    })))

    const postedSince = Date.now() - 14 * 24 * 60 * 60 * 1000
    const postedRows = await ctx.db
      .query("postedContent")
      .withIndex("by_projectId_and_createdAt", (q) =>
        q.eq("projectId", args.projectId).gte("createdAt", postedSince),
      )
      .order("desc")
      .take(100)

    const performance = await Promise.all(postedRows.map(async (row) => {
      const card = await ctx.db.get(row.cardId)
      return {
        subreddit: row.subreddit,
        type: card?.type ?? null,
        score: row.score,
        replyCount: row.replyCount,
        visibility: row.visibility,
        createdAt: row.createdAt,
      }
    }))

    return {
      project: {
        plan: project.plan,
        warmupMode: safety.warmupMode,
      },
      brand: {
        intelligenceJson: brand.intelligenceJson,
      },
      subreddits: activeSubreddits.map((subreddit) => ({
        name: normalizeSubredditName(subreddit.name),
        memberCount: subreddit.memberCount ?? null,
        description: subreddit.description ?? null,
        rulesJson: subreddit.rulesJson ?? null,
        relevanceScore: subreddit.relevanceScore,
        reasoning: subreddit.reasoning,
      })),
      recentPosts,
      performance,
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
    const safety = await safetyContext(ctx, args.projectId)

    return {
      project: {
        plan: project.plan,
        warmupMode: safety.warmupMode,
      },
      brand: {
        intelligenceJson: brand.intelligenceJson,
      },
      performance,
    }
  },
})
