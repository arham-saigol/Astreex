/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import { internal } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

async function seedProfile(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "user_1",
      email: "founder@example.com",
      createdAt: Date.now(),
    })
    const projectId = await ctx.db.insert("projects", {
      userId,
      name: "Astreex",
      plan: "growth",
      planStatus: "active",
      onboardingStatus: "complete",
      timezone: "America/New_York",
      lastActiveAt: Date.now(),
      createdAt: Date.now(),
    })
    const profileId = await ctx.db.insert("projectIntelligenceProfiles", {
      projectId,
      websiteUrl: "https://astreex.example",
      competitorUrls: ["https://competitor.example"],
      intelligenceJson: JSON.stringify({ overview: "Astreex" }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    return { projectId, profileId }
  })
}

describe("project intelligence data", () => {
  test("persistUsefulProjectPages stores monitored pages and snapshots", async () => {
    const t = convexTest(schema, modules)
    const { projectId, profileId } = await seedProfile(t)

    const result = await t.mutation(internal.onboarding.data.persistUsefulProjectPages, {
      projectId,
      profileId,
      pages: [{
        sourceType: "own",
        url: "https://astreex.example/features",
        normalizedUrl: "https://astreex.example/features",
        title: "Features",
        pageKind: "features",
        normalizedText: "Useful feature page text",
        contentHash: "hash1",
      }],
    })

    const rows = await t.run(async (ctx) => ({
      pages: await ctx.db
        .query("monitoredPages")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10),
      snapshots: await ctx.db
        .query("monitoredPageSnapshots")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10),
    }))

    expect(result.saved).toBe(1)
    expect(rows.pages).toHaveLength(1)
    expect(rows.pages[0].lastContentHash).toBe("hash1")
    expect(rows.snapshots).toHaveLength(1)
    expect(rows.snapshots[0].normalizedText).toBe("Useful feature page text")
  })

  test("unchanged monitored page refresh creates no change event", async () => {
    const t = convexTest(schema, modules)
    const { projectId, profileId } = await seedProfile(t)
    const monitoredPageId = await t.run(async (ctx) => {
      return await ctx.db.insert("monitoredPages", {
        projectId,
        profileId,
        sourceType: "own",
        url: "https://astreex.example",
        normalizedUrl: "https://astreex.example",
        active: true,
        lastContentHash: "same",
        nextCheckAt: Date.now() - 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })

    await t.mutation(internal.projectIntelligenceData.markMonitoredPageUnchanged, {
      monitoredPageId,
      fetchedAt: Date.now(),
      nextCheckAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    })

    const events = await t.run(async (ctx) =>
      await ctx.db
        .query("projectIntelligenceChangeEvents")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10),
    )

    expect(events).toHaveLength(0)
  })

  test("changed monitored page refresh stores snapshot and event", async () => {
    const t = convexTest(schema, modules)
    const { projectId, profileId } = await seedProfile(t)
    const monitoredPageId = await t.run(async (ctx) => {
      return await ctx.db.insert("monitoredPages", {
        projectId,
        profileId,
        sourceType: "own",
        url: "https://astreex.example",
        normalizedUrl: "https://astreex.example",
        active: true,
        lastContentHash: "old",
        nextCheckAt: Date.now() - 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
    })

    await t.mutation(internal.projectIntelligenceData.insertChangedSnapshotAndEvent, {
      monitoredPageId,
      fetchedAt: Date.now(),
      nextCheckAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      contentHash: "new",
      normalizedText: "Changed page text",
      title: "Homepage",
    })

    const rows = await t.run(async (ctx) => ({
      page: await ctx.db.get(monitoredPageId),
      snapshots: await ctx.db
        .query("monitoredPageSnapshots")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10),
      events: await ctx.db
        .query("projectIntelligenceChangeEvents")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10),
    }))

    expect(rows.page?.lastContentHash).toBe("new")
    expect(rows.snapshots).toHaveLength(1)
    expect(rows.events).toHaveLength(1)
    expect(rows.events[0].status).toBe("pending")
  })
})
