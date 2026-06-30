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

  test("growth analytics are enforced server-side", async () => {
    const t = convexTest(schema, modules)
    const now = Date.now()
    const { projectRef } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "test|user_1",
        email: "founder@example.com",
        createdAt: now,
      })
      await ctx.db.insert("projects", {
        userId,
        publicId: "p_starteranalytics",
        slug: "astreex",
        name: "Astreex",
        plan: "starter",
        planStatus: "active",
        onboardingStatus: "complete",
        timezone: "America/New_York",
        lastActiveAt: now,
        createdAt: now,
      })
      return { projectRef: "astreex-p_starteranalytics" }
    })

    const authed = t.withIdentity({ tokenIdentifier: "test|user_1" })
    await expect(authed.query(api.analytics.getTrendData, { projectRef, timeframe: "30d" }))
      .rejects.toThrow("Growth analytics")
    await expect(authed.query(api.analytics.getBestPerforming, { projectRef, timeframe: "30d" }))
      .rejects.toThrow("Growth analytics")
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

  test("dashboard refresh considers older stale candidates and only locks returned groups", async () => {
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

      for (let index = 0; index < 150; index++) {
        await ctx.db.insert("postedContent", {
          projectId,
          cardId,
          redditAccountId,
          redditId: `fresh_${index}`,
          redditThingId: `t3_fresh_${index}`,
          parentRedditThingId: `t3_fresh_${index}`,
          subreddit: "startups",
          type: "original",
          score: 0,
          replyCount: 0,
          visibility: "visible",
          lastCheckedAt: now,
          lastAnalyticsAttemptAt: now,
          createdAt: now - index,
        })
      }

      for (let index = 0; index < 13; index++) {
        await ctx.db.insert("postedContent", {
          projectId,
          cardId,
          redditAccountId,
          redditId: `stale_${index}`,
          redditThingId: `t3_stale_${index}`,
          parentRedditThingId: `t3_stale_${index}`,
          subreddit: "startups",
          type: "original",
          score: 0,
          replyCount: 0,
          visibility: "visible",
          lastCheckedAt: now - 60 * 60 * 1000,
          lastAnalyticsAttemptAt: now - 60 * 60 * 1000,
          createdAt: now - 10 * 24 * 60 * 60 * 1000 - index,
        })
      }

      await ctx.db.insert("dashboardAnalyticsSessions", {
        projectId,
        sessionId: "session_1",
        timeframe: "all",
        redditAccountIds: [redditAccountId],
        openedAt: now,
        lastHeartbeatAt: now,
        expiresAt: now + 30_000,
      })
      return { projectId, redditAccountId }
    })

    const prepared = await t.mutation(internal.analytics.prepareDashboardAnalyticsRefresh, {
      projectId,
      timeframe: "all",
      redditAccountIds: [redditAccountId],
      sessionId: "session_1",
    })

    const locks = await t.run(async (ctx) => await ctx.db.query("dashboardAnalyticsLocks").take(20))
    expect(prepared.groups).toHaveLength(12)
    expect(prepared.groups.some((group) => group.parentRedditThingId.startsWith("t3_stale_"))).toBe(true)
    expect(locks).toHaveLength(12)
  })

  test("dashboard refresh requests coalesce per visible dashboard", async () => {
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
        publicId: "p_refreshcoalesce",
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
      await ctx.db.insert("postedContent", {
        projectId,
        cardId,
        redditAccountId,
        redditId: "post_1",
        redditThingId: "t3_post_1",
        parentRedditThingId: "t3_post_1",
        subreddit: "startups",
        type: "original",
        score: 0,
        replyCount: 0,
        visibility: "visible",
        lastCheckedAt: now - 60 * 60 * 1000,
        nextAnalyticsRefreshAt: now - 1,
        createdAt: now,
      })
      await ctx.db.insert("dashboardAnalyticsSessions", {
        projectId,
        sessionId: "session_1",
        timeframe: "30d",
        redditAccountIds: [],
        openedAt: now,
        lastHeartbeatAt: now,
        expiresAt: now + 30_000,
      })
      return { projectRef: "astreex-p_refreshcoalesce" }
    })

    const authed = t.withIdentity({ tokenIdentifier: "test|user_1" })
    const first = await authed.mutation(api.analytics.requestDashboardAnalyticsRefresh, {
      projectRef,
      timeframe: "30d",
      redditAccountIds: [],
      sessionId: "session_1",
    })
    const second = await authed.mutation(api.analytics.requestDashboardAnalyticsRefresh, {
      projectRef,
      timeframe: "30d",
      redditAccountIds: [],
      sessionId: "session_1",
    })
    const jobs = await t.run(async (ctx) => await ctx.db.query("dashboardAnalyticsRefreshJobs").take(10))

    expect(first.scheduled).toBe(true)
    expect(second.scheduled).toBe(false)
    expect(jobs).toHaveLength(1)
  })

  test("dashboard refresh ignores stale rows outside the selected timeframe", async () => {
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
      await ctx.db.insert("postedContent", {
        projectId,
        cardId,
        redditAccountId,
        redditId: "old_stale",
        redditThingId: "t3_old_stale",
        parentRedditThingId: "t3_old_stale",
        subreddit: "startups",
        type: "original",
        score: 0,
        replyCount: 0,
        visibility: "visible",
        lastCheckedAt: now - 60 * 60 * 1000,
        nextAnalyticsRefreshAt: now - 1,
        createdAt: now - 10 * 24 * 60 * 60 * 1000,
      })
      await ctx.db.insert("dashboardAnalyticsSessions", {
        projectId,
        sessionId: "session_1",
        timeframe: "7d",
        redditAccountIds: [redditAccountId],
        openedAt: now,
        lastHeartbeatAt: now,
        expiresAt: now + 30_000,
      })
      return { projectId, redditAccountId }
    })

    const prepared = await t.mutation(internal.analytics.prepareDashboardAnalyticsRefresh, {
      projectId,
      timeframe: "7d",
      redditAccountIds: [redditAccountId],
      sessionId: "session_1",
    })

    expect(prepared.groups).toHaveLength(0)
  })

  test("growth analytics require an active entitlement", async () => {
    const t = convexTest(schema, modules)
    const now = Date.now()
    const { projectRef } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "test|user_1",
        email: "founder@example.com",
        createdAt: now,
      })
      await ctx.db.insert("projects", {
        userId,
        publicId: "p_pastdueanalytics",
        slug: "astreex",
        name: "Astreex",
        plan: "growth",
        planStatus: "past_due",
        onboardingStatus: "complete",
        timezone: "America/New_York",
        lastActiveAt: now,
        createdAt: now,
      })
      return { projectRef: "astreex-p_pastdueanalytics" }
    })

    await expect(t.withIdentity({ tokenIdentifier: "test|user_1" }).query(
      api.analytics.getTrendData,
      { projectRef, timeframe: "30d" },
    )).rejects.toThrow("Growth analytics")
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
