import { v } from "convex/values"
import { internalMutation, internalQuery } from "../_generated/server"

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

const usefulPageValidator = v.object({
  sourceType: v.union(v.literal("own"), v.literal("competitor")),
  competitorIndex: v.optional(v.number()),
  url: v.string(),
  normalizedUrl: v.string(),
  title: v.optional(v.string()),
  pageKind: v.optional(v.string()),
  normalizedText: v.string(),
  contentHash: v.string(),
  exaId: v.optional(v.string()),
})

export const loadPipelineProject = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectId)
  },
})

export const loadProjectIntelligenceProfile = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectIntelligenceProfiles")
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

export const saveProjectIntelligenceProfile = internalMutation({
  args: {
    projectId: v.id("projects"),
    intelligenceJson: v.string(),
    scrapeStatus: scrapeStatusValidator,
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) throw new Error("Project not found")

    const brand = await ctx.db
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand) throw new Error("Project intelligence profile not found")

    await ctx.db.patch(brand._id, {
      intelligenceJson: args.intelligenceJson,
      scrapeStatus: args.scrapeStatus,
      updatedAt: Date.now(),
    })
  },
})

export const createProjectIntelligenceBuild = internalMutation({
  args: {
    projectId: v.id("projects"),
    profileId: v.id("projectIntelligenceProfiles"),
    model: v.string(),
    sourcePageCount: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("projectIntelligenceBuilds", {
      projectId: args.projectId,
      profileId: args.profileId,
      status: "running",
      model: args.model,
      sourcePageCount: args.sourcePageCount,
      usefulPageCount: 0,
      startedAt: Date.now(),
    })
  },
})

export const finishProjectIntelligenceBuild = internalMutation({
  args: {
    buildId: v.id("projectIntelligenceBuilds"),
    status: v.union(v.literal("complete"), v.literal("failed")),
    usefulPageCount: v.number(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.buildId, {
      status: args.status,
      usefulPageCount: args.usefulPageCount,
      finishedAt: Date.now(),
      error: args.error,
    })
  },
})

export const persistUsefulProjectPages = internalMutation({
  args: {
    projectId: v.id("projects"),
    profileId: v.id("projectIntelligenceProfiles"),
    pages: v.array(usefulPageValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const nextCheckAt = now + 7 * 24 * 60 * 60 * 1000
    const incomingUrls = new Set(args.pages.map((page) => page.normalizedUrl))
    let saved = 0

    for (const page of args.pages.slice(0, 80)) {
      const existing = await ctx.db
        .query("monitoredPages")
        .withIndex("by_projectId_and_normalizedUrl", (q) =>
          q.eq("projectId", args.projectId).eq("normalizedUrl", page.normalizedUrl),
        )
        .first()

      const pagePatch = {
        profileId: args.profileId,
        sourceType: page.sourceType,
        competitorIndex: page.competitorIndex,
        url: page.url,
        normalizedUrl: page.normalizedUrl,
        title: page.title,
        pageKind: page.pageKind,
        active: true,
        lastFetchedAt: now,
        nextCheckAt,
        lastContentHash: page.contentHash,
        updatedAt: now,
      }

      const monitoredPageId = existing
        ? existing._id
        : await ctx.db.insert("monitoredPages", {
            projectId: args.projectId,
            ...pagePatch,
            createdAt: now,
          })

      if (existing) {
        await ctx.db.patch(existing._id, pagePatch)
      }

      const snapshotId = await ctx.db.insert("monitoredPageSnapshots", {
        projectId: args.projectId,
        monitoredPageId,
        fetchedAt: now,
        contentHash: page.contentHash,
        normalizedText: page.normalizedText,
        title: page.title,
        exaId: page.exaId,
      })

      await ctx.db.patch(monitoredPageId, {
        lastSnapshotId: snapshotId,
      })
      saved++
    }

    for await (const page of ctx.db
      .query("monitoredPages")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))) {
      if (
        page.profileId === args.profileId &&
        page.active &&
        !incomingUrls.has(page.normalizedUrl)
      ) {
        await ctx.db.patch(page._id, {
          active: false,
          updatedAt: now,
        })
      }
    }

    return { saved }
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
