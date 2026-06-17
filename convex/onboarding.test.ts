/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { getSubredditDiscoveryLimits } from "./lib/planLimits"
import { selectSubredditsDeterministically } from "./onboarding/subredditDiscovery"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

function stubRequiredEnv() {
  vi.stubEnv("DEEPSEEK_API_KEY", "test")
  vi.stubEnv("ZERNIO_API_KEY", "zernio")
  vi.stubEnv("FETCHLAYER_API_KEY", "fetchlayer")
  vi.stubEnv("FIREWORKS_API_KEY", "fireworks")
}

beforeEach(() => {
  stubRequiredEnv()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

async function seedPipelineProject(
  t: ReturnType<typeof convexTest>,
  plan: "starter" | "growth" | "scale" = "scale",
) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      tokenIdentifier: "test|user_1",
      email: "founder@example.com",
      createdAt: Date.now(),
    })
    const projectId = await ctx.db.insert("projects", {
      userId,
      name: "Astreex",
      plan,
      planStatus: "trialing",
      onboardingStatus: "running",
      timezone: "America/New_York",
      lastActiveAt: Date.now(),
      createdAt: Date.now(),
    })
    const brandId = await ctx.db.insert("projectIntelligenceProfiles", {
      projectId,
      websiteUrl: "https://astreex.example",
      competitorUrls: [],
      intelligenceJson: "{}",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    return { userId, projectId, brandId }
  })
}

describe("onboarding pipeline helpers", () => {
  test("subreddit discovery limits match onboarding sizing", () => {
    expect(getSubredditDiscoveryLimits("starter")).toMatchObject({
      discoverCount: 10,
      activeCount: 5,
      maxRailBCandidates: 5,
      activeScoreThreshold: 70,
      backupScoreThreshold: 50,
    })
    expect(getSubredditDiscoveryLimits("growth")).toMatchObject({
      discoverCount: 20,
      activeCount: 15,
      maxRailBCandidates: 10,
    })
    expect(getSubredditDiscoveryLimits("scale")).toMatchObject({
      discoverCount: 30,
      activeCount: 25,
      maxRailBCandidates: 15,
    })
  })

  test("seedDiscoveredSubreddits stores agent rows with active buffer", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedPipelineProject(t)

    await t.mutation(internal.onboarding.data.seedDiscoveredSubreddits, {
      projectId,
      subreddits: Array.from({ length: 30 }, (_, index) => ({
        name: `subreddit_${index}`,
        memberCount: 20_000 + index,
        relevanceScore: 90 - index,
        reasoning: `Reason ${index}`,
        active: index < 25,
      })),
    })

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("subreddits")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(40)
    })

    expect(rows).toHaveLength(30)
    expect(rows.every((row) => row.addedBy === "agent")).toBe(true)
    expect(rows.filter((row) => row.active)).toHaveLength(25)
  })

  test("saveProjectIntelligenceProfile persists intelligence JSON", async () => {
    const t = convexTest(schema, modules)
    const { projectId, brandId } = await seedPipelineProject(t, "starter")

    await t.mutation(internal.onboarding.data.saveProjectIntelligenceProfile, {
      projectId,
      intelligenceJson: JSON.stringify({
        overview: "Astreex helps founders distribute on Reddit.",
        capabilities: ["monitoring"],
      }),
      scrapeStatus: "complete",
    })

    const brand = await t.run(async (ctx) => await ctx.db.get(brandId))
    const profile = JSON.parse(brand?.intelligenceJson ?? "{}") as Record<string, unknown>

    expect(profile.overview).toBe("Astreex helps founders distribute on Reddit.")
    expect(brand?.scrapeStatus).toBe("complete")
  })

  test("prepareOnboardingProject enforces competitor URL plan limits", async () => {
    const t = convexTest(schema, modules)
    const authed = t.withIdentity({
      tokenIdentifier: "test|user_1",
      email: "founder@example.com",
    })

    await expect(
      authed.mutation(api.onboarding.prepareOnboardingProject, {
        projectName: "Astreex",
        websiteUrl: "https://astreex.example",
        competitorUrls: [
          "https://a.example",
          "https://b.example",
          "https://c.example",
          "https://d.example",
        ],
        plan: "starter",
        timezone: "America/New_York",
      }),
    ).rejects.toThrow("Your plan supports up to 3 tracked competitors")
  })

  test("completeOnboarding accepts growth and scale competitor limits", async () => {
    const growth = convexTest(schema, modules)
    await growth.withIdentity({
      tokenIdentifier: "test|user_growth",
      email: "growth@example.com",
    }).mutation(api.onboarding.prepareOnboardingProject, {
      projectName: "Growth",
      websiteUrl: "https://growth.example",
      competitorUrls: Array.from({ length: 5 }, (_, index) => `https://g${index}.example`),
      plan: "growth",
      timezone: "America/New_York",
    })

    const scale = convexTest(schema, modules)
    await scale.withIdentity({
      tokenIdentifier: "test|user_scale",
      email: "scale@example.com",
    }).mutation(api.onboarding.prepareOnboardingProject, {
      projectName: "Scale",
      websiteUrl: "https://scale.example",
      competitorUrls: Array.from({ length: 10 }, (_, index) => `https://s${index}.example`),
      plan: "scale",
      timezone: "America/New_York",
    })
  })

  test("prepareOnboardingProject rejects duplicate competitor URLs", async () => {
    const t = convexTest(schema, modules)
    await expect(
      t.withIdentity({
        tokenIdentifier: "test|user_1",
        email: "founder@example.com",
      }).mutation(api.onboarding.prepareOnboardingProject, {
        projectName: "Astreex",
        websiteUrl: "https://astreex.example",
        competitorUrls: ["https://a.example", "https://a.example/"],
        plan: "growth",
        timezone: "America/New_York",
      }),
    ).rejects.toThrow("Competitor URL contains duplicate URLs")
  })

  test("deterministic subreddit selection uses thresholds without force-fill", () => {
    const selected = selectSubredditsDeterministically([
      { name: "aaa", rail: "A", reason: "", relevanceScore: 95, audienceFit: "", topicFit: "", promotionRisk: "", contentOpportunities: [], reasoning: "", redFlags: [], memberCount: 30_000 },
      { name: "bbb", rail: "A", reason: "", relevanceScore: 69, audienceFit: "", topicFit: "", promotionRisk: "", contentOpportunities: [], reasoning: "", redFlags: [], memberCount: 30_000 },
      { name: "ccc", rail: "B", reason: "", relevanceScore: 49, audienceFit: "", topicFit: "", promotionRisk: "", contentOpportunities: [], reasoning: "", redFlags: [], memberCount: 30_000 },
    ], {
      activeSubredditLimit: 5,
      inactiveBackupLimit: 5,
      activeScoreThreshold: 70,
      backupScoreThreshold: 50,
    })

    expect(selected.map((item) => [item.name, item.active])).toEqual([
      ["aaa", true],
      ["bbb", false],
    ])
  })

  test("onboarding status mutations patch running complete and error states", async () => {
    const t = convexTest(schema, modules)
    const { projectId, brandId } = await seedPipelineProject(t)

    await t.mutation(internal.onboarding.data.markOnboardingRunning, { projectId })
    await t.mutation(internal.onboarding.data.saveProjectIntelligenceProfile, {
      projectId,
      intelligenceJson: JSON.stringify({ name: "Astreex" }),
      scrapeStatus: "degraded",
    })
    await t.mutation(internal.onboarding.data.markOnboardingError, {
      projectId,
      error: "Discovery failed",
    })
    let state = await t.run(async (ctx) => ({
      project: await ctx.db.get(projectId),
      brand: await ctx.db.get(brandId),
    }))

    expect(state.project?.onboardingStatus).toBe("error")
    expect(state.project?.onboardingError).toBe("Discovery failed")
    expect(state.brand?.scrapeStatus).toBe("degraded")

    await t.mutation(internal.onboarding.data.markOnboardingComplete, { projectId })
    state = await t.run(async (ctx) => ({
      project: await ctx.db.get(projectId),
      brand: await ctx.db.get(brandId),
    }))

    expect(state.project?.onboardingStatus).toBe("complete")
    expect(state.project?.onboardingError).toBeUndefined()
  })

  test("tokenIdentifier lookup works", async () => {
    const t = convexTest(schema, modules)
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        tokenIdentifier: "https://issuer.example|canonical_user",
        email: "founder@example.com",
        createdAt: Date.now(),
      })
      await ctx.db.insert("projects", {
        userId,
        publicId: "p_tokenstatus",
        slug: "astreex",
        name: "Astreex",
        plan: "growth",
        planStatus: "active",
        onboardingStatus: "complete",
        timezone: "America/New_York",
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
      })
    })

    const status = await t.withIdentity({
      tokenIdentifier: "https://issuer.example|canonical_user",
    }).query(api.onboarding.getOnboardingStatus, {})

    expect(status.hasCompletedOnboarding).toBe(true)
  })

  test("completeOnboarding rejects zero active Reddit accounts", async () => {
    const t = convexTest(schema, modules)
    const authed = t.withIdentity({
      tokenIdentifier: "test|user_1",
      email: "founder@example.com",
    })
    const draft = await authed.mutation(api.onboarding.prepareOnboardingProject, {
      projectName: "Astreex",
      websiteUrl: "https://astreex.example",
      plan: "growth",
      timezone: "America/New_York",
    })

    await expect(
      authed.mutation(api.onboarding.completeOnboarding, {
        projectRef: draft.projectRef,
      }),
    ).rejects.toThrow("Connect at least one Reddit account to continue")
  })

  test("prepareOnboardingProject validates and stores timezone", async () => {
    const t = convexTest(schema, modules)
    const authed = t.withIdentity({
      tokenIdentifier: "test|user_1",
      email: "founder@example.com",
    })

    await expect(authed.mutation(api.onboarding.prepareOnboardingProject, {
      projectName: "Astreex",
      websiteUrl: "https://astreex.example",
      plan: "growth",
      timezone: "Mars/Base",
    })).rejects.toThrow("Invalid timezone")

    const result = await authed.mutation(api.onboarding.prepareOnboardingProject, {
      projectName: "Astreex",
      websiteUrl: "https://astreex.example",
      plan: "growth",
      timezone: " America/New_York ",
    })
    const project = await t.run(async (ctx) => await ctx.db.get(result.projectId))
    expect(project?.timezone).toBe("America/New_York")
  })

  test("completeOnboarding schedules the backend pipeline", async () => {
    const t = convexTest(schema, modules)
    const authed = t.withIdentity({
      tokenIdentifier: "test|user_1",
      email: "founder@example.com",
    })

    const draft = await authed.mutation(api.onboarding.prepareOnboardingProject, {
      projectName: "Astreex",
      websiteUrl: "https://astreex.example",
      plan: "growth",
      timezone: "America/New_York",
    })
    await t.run(async (ctx) => {
      await ctx.db.insert("redditAccounts", {
        projectId: draft.projectId as Id<"projects">,
        redditUsername: "founder",
        zernioAccountId: "acct_1",
        isActive: true,
        healthStatus: "healthy",
        createdAt: Date.now(),
      })
    })

    const result = await authed.mutation(api.onboarding.completeOnboarding, {
      projectRef: draft.projectRef,
    })

    const state = await t.run(async (ctx) => ({
      project: await ctx.db.get(result.projectId as Id<"projects">),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }))

    expect(state.project?.onboardingStatus).toBe("running")
    expect(state.scheduled).toHaveLength(1)
  })

  test("prepareOnboardingProject validates URL protocol and length", async () => {
    const t = convexTest(schema, modules)
    const authed = t.withIdentity({
      tokenIdentifier: "test|user_1",
      email: "founder@example.com",
    })

    await expect(
      authed.mutation(api.onboarding.prepareOnboardingProject, {
        projectName: "Astreex",
        websiteUrl: "ftp://astreex.example",
        plan: "growth",
        timezone: "America/New_York",
      }),
    ).rejects.toThrow("Website URL must start with http:// or https://")

    await expect(
      authed.mutation(api.onboarding.prepareOnboardingProject, {
        projectName: "A".repeat(101),
        websiteUrl: "https://astreex.example",
        plan: "growth",
        timezone: "America/New_York",
      }),
    ).rejects.toThrow("Project name is too long")
  })
})
