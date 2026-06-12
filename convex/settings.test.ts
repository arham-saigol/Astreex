/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

function stubRequiredEnv() {
  vi.stubEnv("DEEPSEEK_API_KEY", "test")
  vi.stubEnv("ZERNIO_API_KEY", "zernio")
  vi.stubEnv("FETCHLAYER_API_KEY", "fetchlayer")
}

beforeEach(() => {
  stubRequiredEnv()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

async function seedSettingsProject(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<{
    planStatus: "trialing" | "active" | "canceled" | "past_due" | "trial_expired"
    creemCustomerId: string
  }> = {},
) {
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
      planStatus: overrides.planStatus ?? "active",
      creemCustomerId: overrides.creemCustomerId,
      onboardingStatus: "complete",
      timezone: "America/New_York",
      lastActiveAt: Date.now(),
      createdAt: Date.now(),
    })
    const brandId = await ctx.db.insert("brands", {
      projectId,
      websiteUrl: "https://astreex.example",
      profileJson: JSON.stringify({ name: "Astreex" }),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    return { userId, projectId, brandId }
  })
}

describe("settings mutations", () => {
  test("reanalyzeBrandProfile resets profile and queues onboarding pipeline", async () => {
    const t = convexTest(schema, modules)
    const { projectId, brandId } = await seedSettingsProject(t)

    const result = await t.withIdentity({ subject: "user_1" }).mutation(
      api.settings.reanalyzeBrandProfile,
      { projectId },
    )

    const state = await t.run(async (ctx) => ({
      project: await ctx.db.get(projectId),
      brand: await ctx.db.get(brandId),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }))

    expect(result.queued).toBe(true)
    expect(state.brand?.profileJson).toBe("{}")
    expect(state.project?.onboardingStatus).toBe("running")
    expect(state.project?.onboardingError).toBeUndefined()
    expect(state.scheduled).toHaveLength(1)
  })

  test("deleteProject returns deleted when the project is removed in one batch", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedSettingsProject(t, {
      planStatus: "active",
    })

    const result = await t.withIdentity({ subject: "user_1" }).mutation(
      api.settings.deleteProject,
      { projectId, confirmation: "DELETE PROJECT" },
    )
    const project = await t.run(async (ctx) => await ctx.db.get(projectId))

    expect(result.status).toBe("deleted")
    expect(project).toBeNull()
  })

  test("deleteProject returns queued when recursive batches remain", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedSettingsProject(t, {
      planStatus: "canceled",
      creemCustomerId: "cust_1",
    })

    await t.run(async (ctx) => {
      const redditAccountId = await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: "founder",
        zernioAccountId: "zernio_founder",
        providerCanPost: true,
        isActive: true,
        healthStatus: "healthy",
        createdAt: Date.now(),
      })
      for (let index = 0; index < 101; index++) {
        await ctx.db.insert("cards", {
          projectId,
          surfacedPostId: null,
          redditAccountId,
          type: "original",
          targetSubreddit: "startups",
          draftContent: "Title\nBody",
          status: "pending",
          createdAt: Date.now() + index,
        })
      }
    })

    const result = await t.withIdentity({ subject: "user_1" }).mutation(
      api.settings.deleteProject,
      { projectId, confirmation: "DELETE PROJECT" },
    )
    const state = await t.run(async (ctx) => ({
      project: await ctx.db.get(projectId),
      scheduled: await ctx.db.system.query("_scheduled_functions").collect(),
    }))

    expect(result.status).toBe("queued")
    expect(state.project).not.toBeNull()
    expect(state.scheduled).toHaveLength(1)

    await t.mutation(internal.settings.deleteProjectBatch, {
      projectId,
      userId: state.project!.userId as Id<"users">,
    })
    const projectAfterBatch = await t.run(async (ctx) => await ctx.db.get(projectId))
    expect(projectAfterBatch).toBeNull()
  })
})

describe("project migrations", () => {
  test("backfillProjectOnboardingStatus patches missing statuses to complete", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        clerkId: "user_1",
        email: "founder@example.com",
        createdAt: Date.now(),
      })
      const projectId = await ctx.db.insert("projects", {
        userId,
        name: "Legacy",
        plan: "growth",
        planStatus: "active",
        timezone: "America/New_York",
        lastActiveAt: Date.now(),
        createdAt: Date.now(),
      })
      return { projectId }
    })

    const result = await t.mutation(
      internal.migrations.backfillProjectOnboardingStatus,
      {
        paginationOpts: { cursor: null, numItems: 10 },
      },
    )
    const verify = await t.query(
      internal.migrations.verifyProjectOnboardingStatusBackfill,
      {
        paginationOpts: { cursor: null, numItems: 10 },
      },
    )
    const project = await t.run(async (ctx) => await ctx.db.get(projectId))

    expect(result.patched).toBe(1)
    expect(project?.onboardingStatus).toBe("complete")
    expect(verify.missing).toHaveLength(0)
  })
})
