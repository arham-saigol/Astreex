/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

describe("analytics refresh", () => {
  test("dashboard metrics count more than 500 posted rows", async () => {
    const t = convexTest(schema, modules)
    const now = Date.now()
    const { projectRef } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "test|user_1",
        email: "founder@example.com",
        createdAt: now,
      })
      const projectId = await ctx.db.insert("projects", {
        userId,
        publicId: "p_analytics500",
        slug: "astreex",
        name: "Astreex",
        plan: "growth",
        planStatus: "active",
        onboardingStatus: "complete",
        timezone: "America/New_York",
        lastActiveAt: now,
        createdAt: now,
      })
      const redditAccountId = await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: "founder",
        zernioAccountId: "acct_1",
        isActive: true,
        healthStatus: "healthy",
        createdAt: now,
      })
      const cardId = await ctx.db.insert("cards", {
        projectId,
        surfacedPostId: null,
        redditAccountId,
        type: "original",
        targetSubreddit: "startups",
        draftContent: "Title\nBody",
        status: "posted",
        createdAt: now,
      })
      for (let index = 0; index < 525; index++) {
        await ctx.db.insert("postedContent", {
          projectId,
          cardId,
          redditAccountId,
          redditId: `post_${index}`,
          redditThingId: `t3_post_${index}`,
          parentRedditThingId: `t3_post_${index}`,
          subreddit: "startups",
          type: "original",
          score: 1,
          replyCount: 0,
          visibility: "visible",
          lastCheckedAt: now,
          createdAt: now - index,
        })
      }
      return { projectRef: "astreex-p_analytics500" }
    })

    const metrics = await t.withIdentity({ tokenIdentifier: "test|user_1" }).query(
      api.analytics.getDashboardMetrics,
      { projectRef, timeframe: "all" },
    )

    expect(metrics.postsCount).toBe(525)
    expect(metrics.karmaEarned).toBe(525)
  })

  test("dashboard refresh candidates use 5m recent and 30m older staleness", async () => {
    const t = convexTest(schema, modules)
    const now = Date.now()
    const { projectId, redditAccountId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "test|user_1",
        email: "founder@example.com",
        createdAt: now,
      })
      const projectId = await ctx.db.insert("projects", {
        userId,
        name: "Astreex",
        plan: "growth",
        planStatus: "active",
        onboardingStatus: "complete",
        timezone: "America/New_York",
        lastActiveAt: now,
        createdAt: now,
      })
      const redditAccountId = await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: "founder",
        zernioAccountId: "acct_1",
        isActive: true,
        healthStatus: "healthy",
        createdAt: now,
      })
      const cardId = await ctx.db.insert("cards", {
        projectId,
        surfacedPostId: null,
        redditAccountId,
        type: "original",
        targetSubreddit: "startups",
        draftContent: "Title\nBody",
        status: "posted",
        createdAt: now,
      })
      for (const row of [
        { id: "fresh_recent", createdAt: now - 24 * 60 * 60 * 1000, lastCheckedAt: now - 4 * 60 * 1000 },
        { id: "stale_recent", createdAt: now - 24 * 60 * 60 * 1000, lastCheckedAt: now - 6 * 60 * 1000 },
        { id: "fresh_old", createdAt: now - 8 * 24 * 60 * 60 * 1000, lastCheckedAt: now - 29 * 60 * 1000 },
        { id: "stale_old", createdAt: now - 8 * 24 * 60 * 60 * 1000, lastCheckedAt: now - 31 * 60 * 1000 },
      ]) {
        await ctx.db.insert("postedContent", {
          projectId,
          cardId,
          redditAccountId,
          redditId: row.id,
          redditThingId: `t3_${row.id}`,
          parentRedditThingId: `t3_${row.id}`,
          subreddit: "startups",
          type: "original",
          score: 0,
          replyCount: 0,
          visibility: "visible",
          lastCheckedAt: row.lastCheckedAt,
          createdAt: row.createdAt,
        })
      }
      await ctx.db.insert("dashboardAnalyticsSessions", {
        projectId,
        sessionId: "session_1",
        timeframe: "30d",
        redditAccountIds: [redditAccountId],
        openedAt: now,
        lastHeartbeatAt: now,
        expiresAt: now + 30_000,
      })
      return { projectId, redditAccountId }
    })

    const prepared = await t.mutation(internal.analytics.prepareDashboardAnalyticsRefresh, {
      projectId,
      timeframe: "30d",
      redditAccountIds: [redditAccountId],
      sessionId: "session_1",
    })

    const parentIds = prepared.groups.map((group) => group.parentRedditThingId).sort()
    expect(parentIds).toEqual(["t3_stale_old", "t3_stale_recent"])
  })

  test("refreshAnalytics does not update lastAnalyticsRefresh while metrics are stubbed", async () => {
    const t = convexTest(schema, modules)
    const projectId = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "test|user_1",
        email: "founder@example.com",
        createdAt: Date.now(),
      })
      return await ctx.db.insert("projects", {
        userId,
        name: "Astreex",
        plan: "growth",
        planStatus: "active",
        onboardingStatus: "complete",
        timezone: "America/New_York",
        lastAnalyticsRefresh: 123,
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
      })
    })

    const result = await t.withIdentity({
      tokenIdentifier: "test|user_1",
    }).action(api.analytics.refreshAnalytics, { projectId })
    const project = await t.run(async (ctx) => await ctx.db.get(projectId))

    expect(result.refreshed).toBe(false)
    expect(project?.lastAnalyticsRefresh).toBe(123)
  })
})
