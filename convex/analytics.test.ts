/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { afterEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

afterEach(() => {
  vi.useRealTimers()
})

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

  test("timeboxed dashboard refresh requests use due analytics rows beyond the newest posts", async () => {
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
        publicId: "p_refreshdue",
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
      for (let index = 0; index < 300; index++) {
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
          nextAnalyticsRefreshAt: now + 60_000,
          createdAt: now - index,
        })
      }
      await ctx.db.insert("postedContent", {
        projectId,
        cardId,
        redditAccountId,
        redditId: "older_due",
        redditThingId: "t3_older_due",
        parentRedditThingId: "t3_older_due",
        subreddit: "startups",
        type: "original",
        score: 0,
        replyCount: 0,
        visibility: "visible",
        lastCheckedAt: now - 60 * 60 * 1000,
        lastAnalyticsAttemptAt: now - 60 * 60 * 1000,
        nextAnalyticsRefreshAt: now - 1,
        createdAt: now - 24 * 60 * 60 * 1000,
      })
      await ctx.db.insert("dashboardAnalyticsSessions", {
        projectId,
        sessionId: "session_1",
        timeframe: "7d",
        redditAccountIds: [],
        openedAt: now,
        lastHeartbeatAt: now,
        expiresAt: now + 30_000,
      })
      return { projectRef: "astreex-p_refreshdue" }
    })

    const result = await t.withIdentity({ tokenIdentifier: "test|user_1" }).mutation(
      api.analytics.requestDashboardAnalyticsRefresh,
      { projectRef, timeframe: "7d", redditAccountIds: [], sessionId: "session_1" },
    )

    expect(result.scheduled).toBe(true)
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

  test("recent activity merges selected account rows before limiting", async () => {
    const t = convexTest(schema, modules)
    const now = Date.now()
    const { projectRef, firstAccountId, secondAccountId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "test|user_1",
        email: "founder@example.com",
        createdAt: now,
      })
      const projectId = await ctx.db.insert("projects", {
        userId,
        publicId: "p_recentaccounts",
        slug: "astreex",
        name: "Astreex",
        plan: "growth",
        planStatus: "active",
        onboardingStatus: "complete",
        timezone: "America/New_York",
        lastActiveAt: now,
        createdAt: now,
      })
      const firstAccountId = await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: "first",
        zernioAccountId: "acct_1",
        isActive: true,
        healthStatus: "healthy",
        createdAt: now,
      })
      const secondAccountId = await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: "second",
        zernioAccountId: "acct_2",
        isActive: true,
        healthStatus: "healthy",
        createdAt: now,
      })
      const firstCardId = await ctx.db.insert("cards", {
        projectId,
        surfacedPostId: null,
        redditAccountId: firstAccountId,
        type: "original",
        targetSubreddit: "first",
        draftContent: "First\nBody",
        status: "posted",
        createdAt: now,
      })
      const secondCardId = await ctx.db.insert("cards", {
        projectId,
        surfacedPostId: null,
        redditAccountId: secondAccountId,
        type: "original",
        targetSubreddit: "second",
        draftContent: "Second\nBody",
        status: "posted",
        createdAt: now,
      })
      for (let index = 0; index < 10; index++) {
        await ctx.db.insert("postedContent", {
          projectId,
          cardId: firstCardId,
          redditAccountId: firstAccountId,
          redditId: `first_${index}`,
          redditThingId: `t3_first_${index}`,
          parentRedditThingId: `t3_first_${index}`,
          subreddit: "first",
          type: "original",
          score: 0,
          replyCount: 0,
          visibility: "visible",
          lastCheckedAt: now,
          createdAt: now - 10_000 - index,
        })
      }
      await ctx.db.insert("postedContent", {
        projectId,
        cardId: secondCardId,
        redditAccountId: secondAccountId,
        redditId: "second_new",
        redditThingId: "t3_second_new",
        parentRedditThingId: "t3_second_new",
        subreddit: "second",
        type: "original",
        score: 0,
        replyCount: 0,
        visibility: "visible",
        lastCheckedAt: now,
        createdAt: now,
      })
      return { projectRef: "astreex-p_recentaccounts", firstAccountId, secondAccountId }
    })

    const activity = await t.withIdentity({ tokenIdentifier: "test|user_1" }).query(
      api.analytics.getRecentActivity,
      { projectRef, timeframe: "all", redditAccountIds: [firstAccountId, secondAccountId] },
    )

    expect(activity).toHaveLength(10)
    expect(activity[0].subreddit).toBe("second")
  })

  test("timeboxed rollup totals preserve exact cutoff timestamps", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-08T16:00:00.000Z"))
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
        publicId: "p_rollupcutoff",
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
      await ctx.db.insert("dashboardDailyRollups", {
        projectId,
        redditAccountId,
        accountKey: redditAccountId,
        day: "2026-01-01",
        postsCount: 2,
        karmaEarned: 8,
        lastActivityAt: Date.parse("2026-01-01T17:00:00.000Z"),
        updatedAt: now,
      })
      await ctx.db.insert("postedContent", {
        projectId,
        cardId,
        redditAccountId,
        redditId: "outside",
        redditThingId: "t3_outside",
        parentRedditThingId: "t3_outside",
        subreddit: "startups",
        type: "original",
        score: 5,
        replyCount: 0,
        visibility: "visible",
        lastCheckedAt: now,
        dashboardRollupAppliedAt: now,
        dashboardRollupScore: 5,
        createdAt: Date.parse("2026-01-01T15:00:00.000Z"),
      })
      await ctx.db.insert("postedContent", {
        projectId,
        cardId,
        redditAccountId,
        redditId: "inside",
        redditThingId: "t3_inside",
        parentRedditThingId: "t3_inside",
        subreddit: "startups",
        type: "original",
        score: 3,
        replyCount: 0,
        visibility: "visible",
        lastCheckedAt: now,
        dashboardRollupAppliedAt: now,
        dashboardRollupScore: 3,
        createdAt: Date.parse("2026-01-01T17:00:00.000Z"),
      })
      return { projectRef: "astreex-p_rollupcutoff" }
    })

    const metrics = await t.withIdentity({ tokenIdentifier: "test|user_1" }).query(
      api.analytics.getDashboardMetrics,
      { projectRef, timeframe: "7d" },
    )

    expect(metrics.postsCount).toBe(1)
    expect(metrics.karmaEarned).toBe(3)
  })

  test("health monitor score updates keep dashboard rollups in sync", async () => {
    const t = convexTest(schema, modules)
    const now = Date.now()
    const { postedContentId, projectId, redditAccountId, day } = await t.run(async (ctx) => {
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
      const day = new Date(now).toISOString().slice(0, 10)
      await ctx.db.insert("dashboardDailyRollups", {
        projectId,
        redditAccountId,
        accountKey: redditAccountId,
        day,
        postsCount: 1,
        karmaEarned: 1,
        lastActivityAt: now,
        updatedAt: now,
      })
      const postedContentId = await ctx.db.insert("postedContent", {
        projectId,
        cardId,
        redditAccountId,
        redditId: "post_1",
        redditThingId: "t3_post_1",
        parentRedditThingId: "t3_post_1",
        subreddit: "startups",
        type: "original",
        score: 1,
        replyCount: 0,
        visibility: "visible",
        lastCheckedAt: now,
        dashboardRollupAppliedAt: now,
        dashboardRollupScore: 1,
        createdAt: now,
      })
      return { postedContentId, projectId, redditAccountId, day }
    })

    await t.mutation(internal.pipeline.healthMonitor.updatePostedContentVisibility, {
      postedContentId,
      visibility: "visible",
      score: 7,
    })
    const { rollup, postedContent } = await t.run(async (ctx) => {
      const rollup = await ctx.db
        .query("dashboardDailyRollups")
        .withIndex("by_projectId_and_accountKey_and_day", (q) =>
          q.eq("projectId", projectId).eq("accountKey", redditAccountId).eq("day", day),
        )
        .unique()
      const postedContent = await ctx.db.get(postedContentId)
      return { rollup, postedContent }
    })

    expect(rollup?.postsCount).toBe(1)
    expect(rollup?.karmaEarned).toBe(7)
    expect(postedContent?.score).toBe(7)
    expect(postedContent?.dashboardRollupScore).toBe(7)
  })
})
