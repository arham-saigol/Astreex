/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { getSubredditDiscoveryLimits } from "./lib/planLimits"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

function stubRequiredEnv() {
  vi.stubEnv("DEEPSEEK_API_KEY", "test")
  vi.stubEnv("REDDIT_CLIENT_ID", "client")
  vi.stubEnv("REDDIT_CLIENT_SECRET", "secret")
  vi.stubEnv(
    "REDDIT_TOKEN_ENCRYPTION_KEY",
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  )
}

beforeEach(() => {
  stubRequiredEnv()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

async function seedPipelineProject(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      clerkId: "user_1",
      email: "founder@example.com",
      createdAt: Date.now(),
    })
    const projectId = await ctx.db.insert("projects", {
      userId,
      name: "Astreex",
      plan: "scale",
      planStatus: "trialing",
      onboardingStatus: "running",
      timezone: "America/New_York",
      lastActiveAt: Date.now(),
      createdAt: Date.now(),
    })
    const brandId = await ctx.db.insert("brands", {
      projectId,
      websiteUrl: "https://astreex.example",
      profileJson: "{}",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    return { userId, projectId, brandId }
  })
}

describe("onboarding pipeline helpers", () => {
  test("subreddit discovery limits match onboarding sizing", () => {
    expect(getSubredditDiscoveryLimits("starter")).toEqual({
      discoverCount: 15,
      activeCount: 10,
    })
    expect(getSubredditDiscoveryLimits("growth")).toEqual({
      discoverCount: 30,
      activeCount: 25,
    })
    expect(getSubredditDiscoveryLimits("scale")).toEqual({
      discoverCount: 50,
      activeCount: 45,
    })
  })

  test("seedDiscoveredSubreddits stores agent rows with active buffer", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedPipelineProject(t)

    await t.mutation(internal.onboarding.data.seedDiscoveredSubreddits, {
      projectId,
      subreddits: Array.from({ length: 50 }, (_, index) => ({
        name: `subreddit_${index}`,
        memberCount: 20_000 + index,
        relevanceScore: 90 - index,
        reasoning: `Reason ${index}`,
        active: index < 45,
      })),
    })

    const rows = await t.run(async (ctx) => {
      return await ctx.db
        .query("subreddits")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(60)
    })

    expect(rows).toHaveLength(50)
    expect(rows.every((row) => row.addedBy === "agent")).toBe(true)
    expect(rows.filter((row) => row.active)).toHaveLength(45)
  })

  test("onboarding status mutations patch running complete and error states", async () => {
    const t = convexTest(schema, modules)
    const { projectId, brandId } = await seedPipelineProject(t)

    await t.mutation(internal.onboarding.data.markOnboardingRunning, { projectId })
    await t.mutation(internal.onboarding.data.saveBrandProfile, {
      projectId,
      profileJson: JSON.stringify({ name: "Astreex" }),
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

  test("completeOnboarding schedules the backend pipeline", async () => {
    const t = convexTest(schema, modules)

    const result = await t.withIdentity({
      subject: "user_1",
      email: "founder@example.com",
    }).mutation(api.onboarding.completeOnboarding, {
      projectName: "Astreex",
      websiteUrl: "https://astreex.example",
      plan: "growth",
      timezone: "America/New_York",
    })

    const state = await t.run(async (ctx) => ({
      project: await ctx.db.get(result.projectId as Id<"projects">),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }))

    expect(state.project?.onboardingStatus).toBe("running")
    expect(state.scheduled).toHaveLength(1)
  })

  test("completeOnboarding validates URL protocol and length", async () => {
    const t = convexTest(schema, modules)
    const authed = t.withIdentity({
      subject: "user_1",
      email: "founder@example.com",
    })

    await expect(
      authed.mutation(api.onboarding.completeOnboarding, {
        projectName: "Astreex",
        websiteUrl: "ftp://astreex.example",
        plan: "growth",
        timezone: "America/New_York",
      }),
    ).rejects.toThrow("Website URL must start with http:// or https://")

    await expect(
      authed.mutation(api.onboarding.completeOnboarding, {
        projectName: "A".repeat(101),
        websiteUrl: "https://astreex.example",
        plan: "growth",
        timezone: "America/New_York",
      }),
    ).rejects.toThrow("Project name is too long")
  })
})
