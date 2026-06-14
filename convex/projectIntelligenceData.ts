import { paginationOptsValidator } from "convex/server"
import { v } from "convex/values"
import { internalMutation, internalQuery } from "./_generated/server"

export const listDueMonitoredPages = internalQuery({
  args: {
    now: v.number(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("monitoredPages")
      .withIndex("by_active_and_nextCheckAt", (q) =>
        q.eq("active", true).lte("nextCheckAt", args.now),
      )
      .paginate(args.paginationOpts)
  },
})

export const markMonitoredPageUnchanged = internalMutation({
  args: {
    monitoredPageId: v.id("monitoredPages"),
    fetchedAt: v.number(),
    nextCheckAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.monitoredPageId, {
      lastFetchedAt: args.fetchedAt,
      nextCheckAt: args.nextCheckAt,
      updatedAt: args.fetchedAt,
    })
  },
})

export const insertChangedSnapshotAndEvent = internalMutation({
  args: {
    monitoredPageId: v.id("monitoredPages"),
    fetchedAt: v.number(),
    nextCheckAt: v.number(),
    contentHash: v.string(),
    normalizedText: v.string(),
    title: v.optional(v.string()),
    exaId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.monitoredPageId)
    if (!page) throw new Error("Monitored page not found")

    const previousSnapshotId = page.lastSnapshotId
    const newSnapshotId = await ctx.db.insert("monitoredPageSnapshots", {
      projectId: page.projectId,
      monitoredPageId: page._id,
      fetchedAt: args.fetchedAt,
      contentHash: args.contentHash,
      normalizedText: args.normalizedText,
      title: args.title,
      exaId: args.exaId,
    })

    await ctx.db.patch(page._id, {
      title: args.title ?? page.title,
      lastFetchedAt: args.fetchedAt,
      nextCheckAt: args.nextCheckAt,
      lastContentHash: args.contentHash,
      lastSnapshotId: newSnapshotId,
      updatedAt: args.fetchedAt,
    })

    const eventId = await ctx.db.insert("projectIntelligenceChangeEvents", {
      projectId: page.projectId,
      monitoredPageId: page._id,
      previousSnapshotId,
      newSnapshotId,
      status: "pending",
      createdAt: args.fetchedAt,
    })

    return { eventId, newSnapshotId }
  },
})

export const loadChangeEvaluationContext = internalQuery({
  args: {
    eventId: v.id("projectIntelligenceChangeEvents"),
  },
  handler: async (ctx, args) => {
    const event = await ctx.db.get(args.eventId)
    if (!event) throw new Error("Change event not found")
    const page = await ctx.db.get(event.monitoredPageId)
    if (!page) throw new Error("Monitored page not found")
    const profile = await ctx.db.get(page.profileId)
    if (!profile) throw new Error("Project intelligence profile not found")
    const previousSnapshot = event.previousSnapshotId
      ? await ctx.db.get(event.previousSnapshotId)
      : null
    const newSnapshot = await ctx.db.get(event.newSnapshotId)
    if (!newSnapshot) throw new Error("New snapshot not found")

    return { event, page, profile, previousSnapshot, newSnapshot }
  },
})

export const markChangeEventNotSignificant = internalMutation({
  args: {
    eventId: v.id("projectIntelligenceChangeEvents"),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: "not_significant",
      summary: args.summary,
      processedAt: Date.now(),
    })
  },
})

export const markChangeEventProfileUpdated = internalMutation({
  args: {
    eventId: v.id("projectIntelligenceChangeEvents"),
    profileId: v.id("projectIntelligenceProfiles"),
    intelligenceJson: v.string(),
    summary: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.profileId, {
      intelligenceJson: args.intelligenceJson,
      updatedAt: Date.now(),
    })
    await ctx.db.patch(args.eventId, {
      status: "profile_updated",
      summary: args.summary,
      processedAt: Date.now(),
    })
  },
})

export const markChangeEventFailed = internalMutation({
  args: {
    eventId: v.id("projectIntelligenceChangeEvents"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.eventId, {
      status: "failed",
      summary: args.error.slice(0, 1000),
      processedAt: Date.now(),
    })
  },
})
