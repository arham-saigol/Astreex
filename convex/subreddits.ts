import { v } from "convex/values"
import { internal } from "./_generated/api"
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server"
import { getPlanLimits } from "./lib/planLimits"
import { validateSubreddit } from "./lib/zernio"
import { getCurrentProjectOrNull, requireAuthenticatedUser } from "./lib/auth"

const SUBREDDIT_LIMIT_ERROR =
  "You've reached the subreddit limit for your plan. Upgrade to add more."

export const getSubreddits = query({
  args: {},
  handler: async (ctx) => {
    const current = await getCurrentProjectOrNull(ctx)
    if (!current) return []

    const { project } = current

    const subreddits = await ctx.db
      .query("subreddits")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(200)

    const accounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(50)
    const activeAccounts = accounts.filter((account) => account.isActive)

    const accessRows = await Promise.all(subreddits.map((subreddit) =>
      ctx.db
        .query("redditSubredditAccess")
        .withIndex("by_projectId_and_subreddit", (q) =>
          q.eq("projectId", project._id).eq("subreddit", subreddit.name.toLowerCase()),
        )
        .take(50),
    ))
    const activeAccountIds = new Set(activeAccounts.map((account) => account._id))
    const usernameById = new Map(activeAccounts.map((account) => [
      account._id,
      account.redditUsername,
    ]))

    const enrichedSubreddits = subreddits.map((subreddit, index) => {
      const rows = accessRows[index].filter((row) => activeAccountIds.has(row.redditAccountId))
      const postableAccountUsernames = rows
        .filter((row) => row.canPost)
        .map((row) => usernameById.get(row.redditAccountId))
        .filter((username): username is string => Boolean(username))
      const blockedAccountUsernames = rows
        .filter((row) => !row.canPost)
        .map((row) => usernameById.get(row.redditAccountId))
        .filter((username): username is string => Boolean(username))
      const checkedAccountIds = new Set(rows.map((row) => row.redditAccountId))
      const hasPendingSync = activeAccounts.some((account) => !checkedAccountIds.has(account._id))
      const postingAccessStatus = postableAccountUsernames.length > 0
        ? "postable"
        : hasPendingSync
          ? "unknown"
          : "blocked"

      return {
        ...subreddit,
        postingAccessStatus,
        postableAccountUsernames,
        blockedAccountUsernames,
      }
    })

    // Sort by relevance descending, inactive at end
    enrichedSubreddits.sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return b.relevanceScore - a.relevanceScore
    })

    return enrichedSubreddits
  },
})

export const getRadarStatus = query({
  args: {},
  handler: async (ctx) => {
    const current = await getCurrentProjectOrNull(ctx)
    if (!current) return null

    const { project } = current

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
    const user = await requireAuthenticatedUser(ctx)

    const subreddit = await ctx.db.get(args.subredditId)
    if (!subreddit) throw new Error("Subreddit not found")

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

function normalizeSubredditName(name: string) {
  const cleanName = name.replace(/^r\//i, "").trim().toLowerCase()
  if (!/^[a-z0-9_]{3,21}$/.test(cleanName)) {
    throw new Error("INVALID_SUBREDDIT_NAME")
  }
  return cleanName
}

function validZernioValidation(payload: unknown) {
  if (!payload || typeof payload !== "object") return false
  const record = payload as Record<string, unknown>
  return record.valid === true && record.exists === true && record.ok === true
}

export const loadManualAddContext = internalQuery({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const current = await getCurrentProjectOrNull(ctx)
    if (!current) throw new Error("No project found")

    const { project } = current
    const cleanName = normalizeSubredditName(args.name)

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

    return { projectId: project._id, cleanName }
  },
})

export const insertManualSubreddit = internalMutation({
  args: {
    projectId: v.id("projects"),
    name: v.string(),
    memberCount: v.optional(v.number()),
    description: v.optional(v.string()),
    rulesJson: v.optional(v.string()),
    relevanceScore: v.number(),
    reasoning: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("No project found")

    const cleanName = normalizeSubredditName(args.name)

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

    const relevanceScore = Math.round(args.relevanceScore)
    const reasoning = args.reasoning.trim()

    // Quality gate
    if (relevanceScore < 20) {
      throw new Error(`QUALITY_GATE:${relevanceScore}`)
    }
    if (!reasoning) throw new Error("Scoring reasoning is required")

    const id = await ctx.db.insert("subreddits", {
      projectId: project._id,
      name: cleanName,
      memberCount: args.memberCount,
      description: args.description,
      rulesJson: args.rulesJson,
      relevanceScore,
      reasoning,
      active: true,
      addedBy: "user",
      createdAt: Date.now(),
    })

    return { id, relevanceScore, reasoning, name: cleanName }
  },
})

export const addSubreddit = action({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args): Promise<{
    id: string
    relevanceScore: number
    reasoning: string
    name: string
  }> => {
    const context: { projectId: string; cleanName: string } = await ctx.runQuery(
      internal.subreddits.loadManualAddContext,
      { name: args.name },
    )

    const validation = await validateSubreddit(ctx, context.cleanName)
    if (!validZernioValidation(validation)) {
      throw new Error("INVALID_SUBREDDIT_NAME")
    }

    const scored: {
      name: string
      memberCount?: number
      description?: string
      rulesJson?: string
      relevanceScore: number
      reasoning: string
    } = await ctx.runAction(internal.onboarding.subredditDiscovery.scoreManualSubreddit, {
      projectId: context.projectId as never,
      name: context.cleanName,
    })

    const result = await ctx.runMutation(internal.subreddits.insertManualSubreddit, {
      projectId: context.projectId as never,
      name: scored.name,
      memberCount: scored.memberCount,
      description: scored.description?.slice(0, 1000),
      rulesJson: scored.rulesJson,
      relevanceScore: scored.relevanceScore,
      reasoning: scored.reasoning,
    })
    try {
      await ctx.runAction(internal.reddit.refreshProjectSubredditAccess, {
        projectId: context.projectId as never,
      })
    } catch {
      console.warn("Subreddit access refresh failed after manual add")
    }
    return result
  },
})
