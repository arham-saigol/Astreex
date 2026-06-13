import { v } from "convex/values"
import { internalMutation, internalQuery } from "../_generated/server"
import { getPlanLimits } from "../lib/planLimits"

const scrapeStatusValidator = v.union(
  v.literal("complete"),
  v.literal("degraded"),
)

const subredditDiscoveryStatusValidator = v.union(
  v.literal("complete"),
  v.literal("needs_manual_subreddits"),
)

const discoveredSubredditValidator = v.object({
  name: v.string(),
  memberCount: v.optional(v.number()),
  description: v.optional(v.string()),
  rulesJson: v.optional(v.string()),
  relevanceScore: v.number(),
  reasoning: v.string(),
  active: v.boolean(),
})

function capTrackedCompetitors(profileJson: string, maxCompetitors: number) {
  const parsed = JSON.parse(profileJson) as unknown
  if (typeof parsed !== "object" || parsed === null) return profileJson

  const competitors = (parsed as Record<string, unknown>).competitors
  if (!Array.isArray(competitors)) return profileJson

  return JSON.stringify({
    ...parsed,
    competitors: competitors.slice(0, maxCompetitors),
  })
}

export const loadPipelineProject = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectId)
  },
})

export const loadBrandForProject = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("brands")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
  },
})

export const hasProjectSubreddits = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("subreddits")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .take(1)

    return rows.length > 0
  },
})

export const markOnboardingRunning = internalMutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      onboardingStatus: "running",
      onboardingError: undefined,
      lastActiveAt: Date.now(),
    })
  },
})

export const markOnboardingComplete = internalMutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      onboardingStatus: "complete",
      onboardingError: undefined,
      lastActiveAt: Date.now(),
    })
  },
})

export const markOnboardingError = internalMutation({
  args: {
    projectId: v.id("projects"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      onboardingStatus: "error",
      onboardingError: args.error.slice(0, 1000),
      lastActiveAt: Date.now(),
    })
  },
})

export const saveBrandProfile = internalMutation({
  args: {
    projectId: v.id("projects"),
    profileJson: v.string(),
    scrapeStatus: scrapeStatusValidator,
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const brand = await ctx.db
      .query("brands")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand) throw new Error("Brand not found")
    const profileJson = capTrackedCompetitors(
      args.profileJson,
      getPlanLimits(project.plan).maxCompetitors,
    )

    await ctx.db.patch(brand._id, {
      profileJson,
      scrapeStatus: args.scrapeStatus,
      updatedAt: Date.now(),
    })
  },
})

export const setSubredditDiscoveryStatus = internalMutation({
  args: {
    projectId: v.id("projects"),
    status: subredditDiscoveryStatusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, {
      subredditDiscoveryStatus: args.status,
      lastActiveAt: Date.now(),
    })
  },
})

export const seedDiscoveredSubreddits = internalMutation({
  args: {
    projectId: v.id("projects"),
    subreddits: v.array(discoveredSubredditValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const existing = await ctx.db
      .query("subreddits")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .take(200)
    const existingNames = new Set(existing.map((row) => row.name.toLowerCase()))
    let created = 0

    for (const subreddit of args.subreddits) {
      const name = subreddit.name.replace(/^r\//i, "").trim().toLowerCase()
      if (!/^[a-z0-9_]{3,21}$/.test(name) || existingNames.has(name)) continue

      await ctx.db.insert("subreddits", {
        projectId: args.projectId,
        name,
        memberCount: subreddit.memberCount,
        description: subreddit.description,
        rulesJson: subreddit.rulesJson,
        relevanceScore: Math.max(0, Math.min(100, subreddit.relevanceScore)),
        reasoning: subreddit.reasoning,
        active: subreddit.active,
        addedBy: "agent",
        createdAt: now,
      })
      existingNames.add(name)
      created++
    }

    if (created > 0) {
      await ctx.db.patch(args.projectId, {
        subredditDiscoveryStatus: "complete",
        lastActiveAt: now,
      })
    }

    return { created }
  },
})
