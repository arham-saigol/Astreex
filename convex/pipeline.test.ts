/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { candidatePoolSize } from "./lib/candidatePool"
import { sanitizeJudgeSelection } from "./lib/judgeSelection"
import { getPipelineLimits } from "./lib/planLimits"
import { localDateAndHour } from "./crons"

const modules = import.meta.glob("./**/*.ts")

async function seedProject(t: ReturnType<typeof convexTest>) {
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
    return { userId, projectId }
  })
}

describe("pipeline helpers", () => {
  test("plan limits match app sizing", () => {
    expect(getPipelineLimits("starter")).toMatchObject({
      cardsPerDay: 5,
      monitoredSubreddits: 10,
      redditAccounts: 1,
    })
    expect(getPipelineLimits("growth")).toMatchObject({
      cardsPerDay: 15,
      monitoredSubreddits: 25,
      redditAccounts: 3,
    })
    expect(getPipelineLimits("scale")).toMatchObject({
      cardsPerDay: 35,
      monitoredSubreddits: 50,
      redditAccounts: 5,
    })
  })

  test("timezone matcher computes local date and hour", () => {
    const date = new Date("2026-06-09T11:00:00.000Z")

    expect(localDateAndHour("America/New_York", date)).toEqual({
      localDate: "2026-06-09",
      hour: 7,
    })
    expect(localDateAndHour("Asia/Karachi", date)).toEqual({
      localDate: "2026-06-09",
      hour: 16,
    })
  })

  test("candidate pool size is bounded", () => {
    expect(candidatePoolSize(5)).toBe(40)
    expect(candidatePoolSize(20)).toBe(80)
    expect(candidatePoolSize(100)).toBe(180)
  })

  test("judge sanitization removes invalid indices and enforces originals", () => {
    const drafts = [
      {
        type: "reply" as const,
        surfacedPostId: "p1" as Id<"surfacedPosts">,
        targetSubreddit: "saas",
        draftContent: "Reply 1",
      },
      {
        type: "reply" as const,
        surfacedPostId: "p2" as Id<"surfacedPosts">,
        targetSubreddit: "saas",
        draftContent: "Reply 2",
      },
      {
        type: "original" as const,
        targetSubreddit: "startups",
        title: "Title",
        body: "Body",
        draftContent: "Title\nBody",
      },
    ]

    const selected = sanitizeJudgeSelection(
      drafts,
      [99, 0, 0, 1],
      { ...getPipelineLimits("starter"), cardsPerDay: 2, minOriginals: 1 },
    )

    expect(selected).toHaveLength(2)
    expect(selected.some((draft) => draft.type === "original")).toBe(true)
  })
})

describe("pipeline Convex mutations", () => {
  test("subreddit cache is shared and expires after six hours", async () => {
    const t = convexTest(schema, modules)
    const now = Date.now()

    await t.mutation(internal.pipeline.fetchPosts.upsertSubredditCache, {
      subredditName: "saas",
      fetchedAt: now,
      posts: [
        {
          redditPostId: "abc",
          subreddit: "saas",
          title: "How do you find customers?",
          selftext: "Question body",
          permalink: "https://www.reddit.com/r/saas/comments/abc",
          url: "https://www.reddit.com/r/saas/comments/abc",
          score: 12,
          commentCount: 4,
          createdUtc: now,
        },
      ],
    })

    const hit = await t.query(internal.pipeline.fetchPosts.loadCachedSubreddit, {
      subredditName: "saas",
      now: now + 1_000,
    })
    const miss = await t.query(internal.pipeline.fetchPosts.loadCachedSubreddit, {
      subredditName: "saas",
      now: now + 7 * 60 * 60 * 1000,
    })

    expect(hit).toHaveLength(1)
    expect(hit?.[0].redditPostId).toBe("abc")
    expect(miss).toBeNull()
  })

  test("storeNewPosts dedupes and drops posts older than 48 hours", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const now = Date.now()

    const inserted = await t.mutation(internal.pipeline.storePosts.storeNewPosts, {
      projectId,
      posts: [
        {
          redditPostId: "new",
          subreddit: "saas",
          title: "New post",
          url: "https://reddit.com/new",
          score: 5,
          commentCount: 3,
          createdUtc: now,
        },
        {
          redditPostId: "new",
          subreddit: "saas",
          title: "Duplicate post",
          url: "https://reddit.com/new",
          score: 5,
          commentCount: 3,
          createdUtc: now,
        },
        {
          redditPostId: "old",
          subreddit: "saas",
          title: "Old post",
          url: "https://reddit.com/old",
          score: 5,
          commentCount: 3,
          createdUtc: now - 49 * 60 * 60 * 1000,
        },
      ],
    })
    const secondInsert = await t.mutation(internal.pipeline.storePosts.storeNewPosts, {
      projectId,
      posts: [
        {
          redditPostId: "new",
          subreddit: "saas",
          title: "New post",
          url: "https://reddit.com/new",
          score: 5,
          commentCount: 3,
          createdUtc: now,
        },
      ],
    })

    expect(inserted).toHaveLength(1)
    expect(secondInsert).toHaveLength(0)
  })

  test("createDailyCards assigns accounts round-robin and formats originals", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)

    const seeded = await t.run(async (ctx) => {
      const account1 = await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: "founder1",
        accessToken: "encrypted",
        refreshToken: "encrypted",
        tokenExpiresAt: Date.now() + 60_000,
        isActive: true,
        healthStatus: "healthy",
        createdAt: Date.now(),
      })
      const account2 = await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: "founder2",
        accessToken: "encrypted",
        refreshToken: "encrypted",
        tokenExpiresAt: Date.now() + 60_000,
        isActive: true,
        healthStatus: "healthy",
        createdAt: Date.now(),
      })
      const surfacedPostId = await ctx.db.insert("surfacedPosts", {
        projectId,
        redditPostId: "abc",
        subreddit: "saas",
        title: "Question",
        url: "https://reddit.com/abc",
        score: 1,
        commentCount: 1,
        postedAt: Date.now(),
        surfacedAt: Date.now(),
      })

      return { account1, account2, surfacedPostId }
    })

    const result = await t.mutation(internal.pipeline.createCards.createDailyCards, {
      projectId,
      selectedDrafts: [
        {
          type: "reply",
          surfacedPostId: seeded.surfacedPostId,
          targetSubreddit: "saas",
          draftContent: "Reply 1",
        },
        {
          type: "original",
          targetSubreddit: "startups",
          title: "Original title",
          body: "Original body",
          draftContent: "Original title\nOriginal body",
        },
        {
          type: "reply",
          surfacedPostId: seeded.surfacedPostId,
          targetSubreddit: "saas",
          draftContent: "Reply 2",
        },
      ],
    })

    const cards = await t.run(async (ctx) => {
      return await ctx.db
        .query("cards")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10)
    })

    expect(result.created).toBe(3)
    expect(cards.map((card) => card.redditAccountId)).toEqual([
      seeded.account1,
      seeded.account2,
      seeded.account1,
    ])
    expect(cards[1].surfacedPostId).toBeNull()
    expect(cards[1].draftContent).toBe("Original title\nOriginal body")
  })
})
