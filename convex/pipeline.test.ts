/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"
import { candidatePoolSize } from "./lib/candidatePool"
import { sanitizeJudgeSelection } from "./lib/judgeSelection"
import { getPipelineLimits } from "./lib/planLimits"
import { localDateAndHour } from "./crons"
import { isValidProjectIntelligenceProfile } from "./pipeline/data"
import { stringifyRulesJson } from "./lib/rules"
import { fireworksKimiK26 } from "./lib/ai"
import {
  zernioAccountId,
  zernioAccountProfileId,
  zernioAccountUsername,
} from "./lib/zernio"

const modules = import.meta.glob("./**/*.ts")

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

function stubRequiredEnv() {
  vi.stubEnv("DEEPSEEK_API_KEY", "test")
  vi.stubEnv("ZERNIO_API_KEY", "zernio")
  vi.stubEnv("FETCHLAYER_API_KEY", "fetchlayer")
  vi.stubEnv("FIREWORKS_API_KEY", "fireworks")
}

beforeEach(() => {
  stubRequiredEnv()
})

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

async function seedRedditAccount(
  t: ReturnType<typeof convexTest>,
  projectId: Id<"projects">,
  overrides: Partial<{
    redditUsername: string
    isActive: boolean
    healthStatus: "healthy" | "warning" | "banned"
  }> = {},
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("redditAccounts", {
      projectId,
      redditUsername: overrides.redditUsername ?? "founder1",
      zernioAccountId: `zernio_${overrides.redditUsername ?? "founder1"}`,
      providerCanPost: true,
      isActive: overrides.isActive ?? true,
      healthStatus: overrides.healthStatus ?? "healthy",
      createdAt: Date.now(),
    })
  })
}

async function seedPendingCard(
  t: ReturnType<typeof convexTest>,
  projectId: Id<"projects">,
  redditAccountId: Id<"redditAccounts">,
  createdAt = Date.now(),
) {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("cards", {
      projectId,
      surfacedPostId: null,
      redditAccountId,
      type: "original",
      targetSubreddit: "startups",
      draftContent: "Title\nBody",
      status: "pending",
      createdAt,
    })
  })
}

describe("pipeline helpers", () => {
  test("plan limits match app sizing", () => {
    expect(getPipelineLimits("starter")).toMatchObject({
      cardsPerDay: 5,
      monitoredSubreddits: 5,
      trackedCompetitors: 3,
      redditAccounts: 1,
      maxRailBCandidates: 5,
      shortlistCount: 10,
      activeSubredditLimit: 5,
      inactiveBackupLimit: 5,
      activeScoreThreshold: 70,
      backupScoreThreshold: 50,
    })
    expect(getPipelineLimits("growth")).toMatchObject({
      cardsPerDay: 15,
      monitoredSubreddits: 15,
      trackedCompetitors: 5,
      redditAccounts: 2,
      maxRailBCandidates: 10,
      shortlistCount: 20,
      activeSubredditLimit: 15,
    })
    expect(getPipelineLimits("scale")).toMatchObject({
      cardsPerDay: 40,
      monitoredSubreddits: 25,
      trackedCompetitors: 10,
      redditAccounts: 5,
      maxRailBCandidates: 15,
      shortlistCount: 30,
      activeSubredditLimit: 25,
    })
  })

  test("Fireworks Kimi provider requires an API key", () => {
    vi.stubEnv("FIREWORKS_API_KEY", "")

    expect(() => fireworksKimiK26()).toThrow("FIREWORKS_API_KEY is not configured")
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

  test("stringifyRulesJson handles unsanitizable rules", () => {
    expect(stringifyRulesJson(undefined)).toBe("")
    expect(stringifyRulesJson(Symbol("bad"))).toBe("")
  })

  test("Zernio account helpers preserve top-level account fields", () => {
    const account = {
      id: "top_account",
      redditUsername: "top_user",
      profileId: "top_profile",
      account: {
        id: "nested_account",
        username: "nested_user",
        profileId: "nested_profile",
      },
    }

    expect(zernioAccountId(account)).toBe("top_account")
    expect(zernioAccountUsername(account)).toBe("top_user")
    expect(zernioAccountProfileId(account)).toBe("top_profile")
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

  test("Project Intelligence Profile validity rejects empty and malformed JSON", () => {
    expect(isValidProjectIntelligenceProfile("{}")).toBe(false)
    expect(isValidProjectIntelligenceProfile("  ")).toBe(false)
    expect(isValidProjectIntelligenceProfile("[]")).toBe(false)
    expect(isValidProjectIntelligenceProfile(JSON.stringify({ name: "Astreex" }))).toBe(true)
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
    stubRequiredEnv()
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)

    const seeded = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("pipelineRuns", {
        projectId,
        localDate: "2026-06-09",
        status: "running",
        startedAt: Date.now(),
      })
      const account1 = await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: "founder1",
        zernioAccountId: "zernio_founder1",
        providerCanPost: true,
        isActive: true,
        healthStatus: "healthy",
        createdAt: Date.now(),
      })
      const account2 = await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: "founder2",
        zernioAccountId: "zernio_founder2",
        providerCanPost: true,
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

      return { runId, account1, account2, surfacedPostId }
    })

    const result = await t.mutation(internal.pipeline.createCards.createDailyCards, {
      projectId,
      runId: seeded.runId,
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

  test("createDailyCards skips drafts already created for a pipeline run", async () => {
    stubRequiredEnv()
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)

    const seeded = await t.run(async (ctx) => {
      const runId = await ctx.db.insert("pipelineRuns", {
        projectId,
        localDate: "2026-06-09",
        status: "running",
        startedAt: Date.now(),
      })
      const redditAccountId = await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: "founder1",
        zernioAccountId: "zernio_founder1",
        providerCanPost: true,
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
      return { runId, redditAccountId, surfacedPostId }
    })

    const selectedDrafts = [
      {
        type: "reply" as const,
        surfacedPostId: seeded.surfacedPostId,
        targetSubreddit: "saas",
        draftContent: "Reply 1",
      },
    ]

    const first = await t.mutation(internal.pipeline.createCards.createDailyCards, {
      projectId,
      runId: seeded.runId,
      selectedDrafts,
    })
    const second = await t.mutation(internal.pipeline.createCards.createDailyCards, {
      projectId,
      runId: seeded.runId,
      selectedDrafts,
    })

    const cards = await t.run(async (ctx) => {
      return await ctx.db
        .query("cards")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10)
    })

    expect(first.created).toBe(1)
    expect(second.created).toBe(0)
    expect(cards).toHaveLength(1)
    expect(cards[0].redditAccountId).toBe(seeded.redditAccountId)
  })
})

describe("posting scheduler", () => {
  test("approveCard schedules a pending card within the 12 hour window", async () => {
    stubRequiredEnv()
    vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"))
    vi.spyOn(Math, "random").mockReturnValue(0.5)

    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const cardId = await seedPendingCard(t, projectId, redditAccountId)

    await t.withIdentity({ subject: "user_1" }).mutation(api.cards.approveCard, {
      cardId,
      editedContent: "Edited title\nEdited body",
    })

    const { card, scheduled } = await t.run(async (ctx) => {
      return {
        card: await ctx.db.get(cardId),
        scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      }
    })

    expect(card?.status).toBe("scheduled")
    expect(card?.editedContent).toBe("Edited title\nEdited body")
    expect(card?.postRetryCount).toBe(0)
    expect(card?.scheduledFor ?? 0).toBeGreaterThanOrEqual(Date.now())
    expect(card?.scheduledFor ?? 0).toBeLessThanOrEqual(
      Date.now() + 12 * 60 * 60 * 1000,
    )
    expect(scheduled).toHaveLength(1)
  })

  test("approveCard uses the 18 hour window after more than 15 cards today", async () => {
    stubRequiredEnv()
    vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"))
    vi.spyOn(Math, "random").mockReturnValue(0.99)

    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const today = Date.now() - 60_000

    const cardIds: Id<"cards">[] = []
    for (let index = 0; index < 16; index++) {
      cardIds.push(await seedPendingCard(t, projectId, redditAccountId, today + index))
    }

    await t.withIdentity({ subject: "user_1" }).mutation(api.cards.approveCard, {
      cardId: cardIds[0],
    })

    const card = await t.run(async (ctx) => await ctx.db.get(cardIds[0]))
    const offset = (card?.scheduledFor ?? 0) - Date.now()

    expect(card?.status).toBe("scheduled")
    expect(offset).toBeGreaterThan(12 * 60 * 60 * 1000)
    expect(offset).toBeLessThanOrEqual(18 * 60 * 60 * 1000)
  })

  test("same-account scheduled cards are spaced at least five minutes apart", async () => {
    stubRequiredEnv()
    vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"))
    vi.spyOn(Math, "random").mockReturnValue(0)

    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const firstCardId = await seedPendingCard(t, projectId, redditAccountId)
    const secondCardId = await seedPendingCard(t, projectId, redditAccountId)

    const authed = t.withIdentity({ subject: "user_1" })
    await authed.mutation(api.cards.approveCard, { cardId: firstCardId })
    await authed.mutation(api.cards.approveCard, { cardId: secondCardId })

    const cards = await t.run(async (ctx) => {
      const first = await ctx.db.get(firstCardId)
      const second = await ctx.db.get(secondCardId)
      return [first, second]
    })
    const diff = Math.abs((cards[0]?.scheduledFor ?? 0) - (cards[1]?.scheduledFor ?? 0))

    expect(diff).toBeGreaterThanOrEqual(5 * 60 * 1000)
  })

  test("multiple approvals produce varied randomized offsets", async () => {
    stubRequiredEnv()
    vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"))
    const randomValues = [0.01, 0.18, 0.33, 0.47, 0.52, 0.69, 0.74, 0.81, 0.9, 0.97]
    let randomIndex = 0
    vi.spyOn(Math, "random").mockImplementation(() => {
      const value = randomValues[randomIndex % randomValues.length]
      randomIndex++
      return value
    })

    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const cardIds: Id<"cards">[] = []
    for (let index = 0; index < 10; index++) {
      const redditAccountId = await seedRedditAccount(t, projectId, {
        redditUsername: `founder${index}`,
      })
      cardIds.push(await seedPendingCard(t, projectId, redditAccountId))
    }

    const authed = t.withIdentity({ subject: "user_1" })
    for (const cardId of cardIds) {
      await authed.mutation(api.cards.approveCard, { cardId })
    }

    const offsets = await t.run(async (ctx) => {
      const rows = []
      for (const cardId of cardIds) {
        const card = await ctx.db.get(cardId)
        rows.push((card?.scheduledFor ?? 0) - Date.now())
      }
      return rows.sort((a, b) => a - b)
    })
    const gaps = offsets.slice(1).map((offset, index) => offset - offsets[index])

    expect(new Set(offsets).size).toBeGreaterThanOrEqual(8)
    expect(new Set(gaps).size).toBeGreaterThanOrEqual(4)
  })

  test("approveCard rejects non-pending cards without scheduling again", async () => {
    stubRequiredEnv()
    vi.setSystemTime(new Date("2026-06-09T12:00:00.000Z"))
    vi.spyOn(Math, "random").mockReturnValue(0.2)

    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const cardId = await seedPendingCard(t, projectId, redditAccountId)
    const authed = t.withIdentity({ subject: "user_1" })

    await authed.mutation(api.cards.approveCard, { cardId })
    await expect(
      authed.mutation(api.cards.approveCard, { cardId }),
    ).rejects.toThrow("Only pending cards can be approved")

    const scheduled = await t.run(
      async (ctx) => await ctx.db.system.query("_scheduled_functions").collect(),
    )
    expect(scheduled).toHaveLength(1)
  })

  test("declineCard rejects non-pending cards", async () => {
    stubRequiredEnv()
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const cardId = await seedPendingCard(t, projectId, redditAccountId)
    const authed = t.withIdentity({ subject: "user_1" })

    await authed.mutation(api.cards.declineCard, { cardId })
    await expect(
      authed.mutation(api.cards.declineCard, { cardId }),
    ).rejects.toThrow("Only pending cards can be declined")
  })
})

describe("poster helpers", () => {
  test("saveZernioProfileId returns existing profile without overwriting it", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const authed = t.withIdentity({ subject: "user_1" })

    const first = await authed.mutation(internal.reddit.saveZernioProfileId, {
      projectId,
      zernioProfileId: "profile_a",
    })
    const second = await authed.mutation(internal.reddit.saveZernioProfileId, {
      projectId,
      zernioProfileId: "profile_b",
    })
    const project = await t.run(async (ctx) => await ctx.db.get(projectId))

    expect(first).toBe("profile_a")
    expect(second).toBe("profile_a")
    expect(project?.zernioProfileId).toBe("profile_a")
  })

  test("successful post mutation marks the card posted and inserts postedContent", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const cardId = await seedPendingCard(t, projectId, redditAccountId)

    await t.mutation(internal.pipeline.poster.markPostSucceeded, {
      cardId,
      redditAccountId,
      redditId: "abc123",
      redditThingId: "t3_abc123",
      permalink: "/r/startups/comments/abc123/title/",
    })

    const { card, posted } = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("postedContent")
        .withIndex("by_cardId", (q) => q.eq("cardId", cardId))
        .take(5)
      return { card: await ctx.db.get(cardId), posted: rows }
    })

    expect(card?.status).toBe("posted")
    expect(card?.redditCommentId).toBe("abc123")
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({
      redditAccountId,
      redditId: "abc123",
      redditThingId: "t3_abc123",
      type: "original",
      visibility: "visible",
    })
  })

  test("ensureZernioSubmission reuses the card/account idempotency key", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const cardId = await seedPendingCard(t, projectId, redditAccountId)

    const first = await t.mutation(internal.pipeline.poster.ensureZernioSubmission, {
      cardId,
      redditAccountId,
    })
    const second = await t.mutation(internal.pipeline.poster.ensureZernioSubmission, {
      cardId,
      redditAccountId,
    })
    const card = await t.run(async (ctx) => await ctx.db.get(cardId))

    expect(second.idempotencyKey).toBe(first.idempotencyKey)
    expect(card?.zernioSubmissionKey).toBe(first.idempotencyKey)
    expect(card?.zernioSubmissionAccountId).toBe(redditAccountId)
  })

  test("queued Zernio original post without top-level status schedules polling", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const cardId = await seedPendingCard(t, projectId, redditAccountId)
    await t.run(async (ctx) => {
      await ctx.db.patch(cardId, { status: "scheduled" })
    })
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(
        JSON.stringify({
          post: {
            id: "zernio_post_1",
            platforms: [{ platform: "reddit", status: "queued" }],
          },
        }),
        { status: 200 },
      ),
    )
    vi.stubGlobal("fetch", fetchMock)

    await t.action(internal.pipeline.poster.postToReddit, { cardId })

    const { card, scheduled } = await t.run(async (ctx) => {
      return {
        card: await ctx.db.get(cardId),
        scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
      }
    })
    expect(card?.status).toBe("scheduled")
    expect(card?.failureReason).toBeUndefined()
    expect(card?.zernioSubmissionKey).toBeTruthy()
    expect(fetchMock).toHaveBeenCalled()
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": card?.zernioSubmissionKey,
    })
    expect(scheduled).toHaveLength(1)
  })

  test("unhealthy assigned account can be replaced by another healthy active account", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const current = await seedRedditAccount(t, projectId, {
      redditUsername: "warning1",
      healthStatus: "warning",
    })
    const replacement = await seedRedditAccount(t, projectId, {
      redditUsername: "healthy1",
      healthStatus: "healthy",
    })

    const chosen = await t.query(
      internal.pipeline.poster.chooseHealthyReplacementAccount,
      { projectId, currentRedditAccountId: current },
    )

    expect(chosen?._id).toBe(replacement)
  })

  test("no healthy account leaves no replacement and card failure is recorded", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId, {
      healthStatus: "banned",
    })
    const cardId = await seedPendingCard(t, projectId, redditAccountId)

    const chosen = await t.query(
      internal.pipeline.poster.chooseHealthyReplacementAccount,
      { projectId, currentRedditAccountId: redditAccountId },
    )
    await t.mutation(internal.pipeline.poster.markPostFailed, {
      cardId,
      retryAttempt: 0,
      failureReason: "No healthy Reddit account available",
    })

    const card = await t.run(async (ctx) => await ctx.db.get(cardId))
    expect(chosen).toBeNull()
    expect(card?.status).toBe("failed")
    expect(card?.failureReason).toBe("No healthy Reddit account available")
  })
})

describe("account health monitor helpers", () => {
  test("checkAccountHealth patches visible Reddit responses", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const now = Date.now()
    const postedContentId = await t.run(async (ctx) => {
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
      return await ctx.db.insert("postedContent", {
        projectId,
        cardId,
        redditAccountId,
        redditId: "abc",
        redditThingId: "t3_abc",
        subreddit: "startups",
        score: 0,
        replyCount: 0,
        visibility: "shadow_hidden",
        lastCheckedAt: now,
        createdAt: now,
      })
    })
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      id: "abc",
      score: 12,
      numComments: 4,
    }))))

    await t.action(internal.pipeline.healthMonitor.checkAccountHealth, {
      beforeCreatedAt: now + 1,
      cutoffCreatedAt: now - 1,
    })

    const posted = await t.run(async (ctx) => await ctx.db.get(postedContentId))
    expect(posted?.visibility).toBe("visible")
    expect(posted?.score).toBe(12)
    expect(posted?.replyCount).toBe(4)
  })

  test("checkAccountHealth skips replies without URLs and patches removed replies", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const now = Date.now()
    const ids = await t.run(async (ctx) => {
      const missingCardId = await ctx.db.insert("cards", {
        projectId,
        surfacedPostId: null,
        redditAccountId,
        type: "reply",
        targetSubreddit: "startups",
        draftContent: "Reply",
        status: "posted",
        createdAt: now,
      })
      const removedCardId = await ctx.db.insert("cards", {
        projectId,
        surfacedPostId: null,
        redditAccountId,
        type: "reply",
        targetSubreddit: "startups",
        draftContent: "Reply",
        status: "posted",
        createdAt: now,
      })
      return {
        missing: await ctx.db.insert("postedContent", {
          projectId,
          cardId: missingCardId,
          redditAccountId,
          redditId: "missing",
          redditThingId: "t1_missing",
          subreddit: "startups",
          score: 0,
          replyCount: 0,
          visibility: "visible",
          lastCheckedAt: now,
          createdAt: now,
        }),
        removed: await ctx.db.insert("postedContent", {
          projectId,
          cardId: removedCardId,
          redditAccountId,
          redditId: "removed",
          redditThingId: "t1_removed",
          subreddit: "startups",
          score: 0,
          replyCount: 0,
          visibility: "visible",
          lastCheckedAt: now,
          createdAt: now + 1,
          permalink: "https://www.reddit.com/r/startups/comments/removed",
        }),
      }
    })
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = typeof init?.body === "string" ? init.body : ""
      if (body.includes("removed")) {
        return new Response(JSON.stringify({
          comments: [{ id: "removed", body: "[removed]" }],
        }))
      }
      return new Response(JSON.stringify({ comments: [] }))
    }))

    await t.action(internal.pipeline.healthMonitor.checkAccountHealth, {
      beforeCreatedAt: now + 2,
      cutoffCreatedAt: now - 1,
    })

    const rows = await t.run(async (ctx) => ({
      missing: await ctx.db.get(ids.missing),
      removed: await ctx.db.get(ids.removed),
    }))
    expect(rows.missing?.visibility).toBe("visible")
    expect(rows.removed?.visibility).toBe("removed")
  })

  test("loadRecentPostedBatch returns at most 30 rows and a continuation flag", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const now = Date.now()

    await t.run(async (ctx) => {
      for (let index = 0; index < 31; index++) {
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
          redditId: `post${index}`,
          subreddit: "startups",
          score: 0,
          replyCount: 0,
          visibility: "visible",
          lastCheckedAt: now,
          createdAt: now + index,
        })
      }
    })

    const batch = await t.query(
      internal.pipeline.healthMonitor.loadRecentPostedBatch,
      { beforeCreatedAt: now + 31, cutoffCreatedAt: now - 1 },
    )

    expect(batch.rows).toHaveLength(30)
    expect(batch.hasMore).toBe(true)
  })

  test("hidden rates update account health and notifications resolve on recovery", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const now = Date.now()

    await t.run(async (ctx) => {
      for (let index = 0; index < 10; index++) {
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
          redditId: `post${index}`,
          subreddit: "startups",
          score: 0,
          replyCount: 0,
          visibility: index < 4 ? "shadow_hidden" : "visible",
          lastCheckedAt: now,
          createdAt: now + index,
        })
      }
    })

    const warning = await t.mutation(
      internal.pipeline.healthMonitor.recomputeAccountHealth,
      { redditAccountId },
    )
    await t.mutation(internal.pipeline.healthMonitor.upsertHealthNotification, {
      projectId,
      redditAccountId,
      type: "reddit_health_warning",
      message: "Warning",
    })

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("postedContent")
        .withIndex("by_redditAccountId_and_createdAt", (q) =>
          q.eq("redditAccountId", redditAccountId),
        )
        .take(20)
      for (const row of rows) {
        await ctx.db.patch(row._id, { visibility: "visible" })
      }
    })

    const healthy = await t.mutation(
      internal.pipeline.healthMonitor.recomputeAccountHealth,
      { redditAccountId },
    )
    await t.mutation(internal.pipeline.healthMonitor.resolveHealthNotifications, {
      projectId,
      redditAccountId,
    })

    const { account, notifications } = await t.run(async (ctx) => {
      return {
        account: await ctx.db.get(redditAccountId),
        notifications: await ctx.db
          .query("notifications")
          .withIndex("by_projectId_and_status", (q) =>
            q.eq("projectId", projectId).eq("status", "resolved"),
          )
          .take(10),
      }
    })

    expect(warning?.healthStatus).toBe("warning")
    expect(healthy?.healthStatus).toBe("healthy")
    expect(account?.healthStatus).toBe("healthy")
    expect(notifications).toHaveLength(1)
  })

  test("more than 60 percent hidden marks account banned", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const now = Date.now()

    await t.run(async (ctx) => {
      for (let index = 0; index < 10; index++) {
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
          redditId: `post${index}`,
          subreddit: "startups",
          score: 0,
          replyCount: 0,
          visibility: index < 7 ? "shadow_hidden" : "visible",
          lastCheckedAt: now,
          createdAt: now + index,
        })
      }
    })

    const result = await t.mutation(
      internal.pipeline.healthMonitor.recomputeAccountHealth,
      { redditAccountId },
    )

    expect(result?.healthStatus).toBe("banned")
  })
})

describe("pipeline cleanup", () => {
  test("cleanupStaleData deletes stale surfaced posts and expired cache but not postedContent", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedProject(t)
    const redditAccountId = await seedRedditAccount(t, projectId)
    const now = Date.now()

    await t.run(async (ctx) => {
      await ctx.db.insert("surfacedPosts", {
        projectId,
        redditPostId: "old",
        subreddit: "saas",
        title: "Old",
        url: "https://reddit.com/old",
        score: 1,
        commentCount: 1,
        postedAt: now - 40 * 24 * 60 * 60 * 1000,
        surfacedAt: now - 31 * 24 * 60 * 60 * 1000,
      })
      await ctx.db.insert("subredditCache", {
        subredditName: "saas",
        posts: [],
        fetchedAt: now - 10_000,
        expiresAt: now - 1,
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
        redditId: "keep",
        subreddit: "startups",
        score: 0,
        replyCount: 0,
        visibility: "visible",
        lastCheckedAt: now,
        createdAt: now - 365 * 24 * 60 * 60 * 1000,
      })
    })

    await t.mutation(internal.pipeline.cleanup.cleanupStaleData, {})

    const counts = await t.run(async (ctx) => ({
      surfacedPosts: await ctx.db.query("surfacedPosts").take(10),
      subredditCache: await ctx.db.query("subredditCache").take(10),
      postedContent: await ctx.db.query("postedContent").take(10),
    }))

    expect(counts.surfacedPosts).toHaveLength(0)
    expect(counts.subredditCache).toHaveLength(0)
    expect(counts.postedContent).toHaveLength(1)
  })
})
