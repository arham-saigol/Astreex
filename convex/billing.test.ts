/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { getPlanLimits } from "./lib/planLimits"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

afterEach(() => {
  vi.unstubAllEnvs()
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

async function seedBillingProject(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<{
    plan: "starter" | "growth" | "scale"
    planStatus: "trialing" | "active" | "canceled" | "past_due" | "trial_expired"
    trialEndsAt: number
    creemCustomerId: string
    creemSubscriptionId: string
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
      plan: overrides.plan ?? "growth",
      planStatus: overrides.planStatus ?? "trialing",
      trialEndsAt: overrides.trialEndsAt,
      creemCustomerId: overrides.creemCustomerId,
      creemSubscriptionId: overrides.creemSubscriptionId,
      onboardingStatus: "complete",
      timezone: "America/New_York",
      lastActiveAt: Date.now(),
      createdAt: Date.now(),
    })

    return { userId, projectId }
  })
}

async function seedActiveSubreddits(
  t: ReturnType<typeof convexTest>,
  projectId: Id<"projects">,
  count: number,
) {
  await t.run(async (ctx) => {
    for (let index = 0; index < count; index++) {
      await ctx.db.insert("subreddits", {
        projectId,
        name: `subreddit_${index}`,
        relevanceScore: index,
        reasoning: "Seeded",
        active: true,
        addedBy: "user",
        createdAt: Date.now() + index,
      })
    }
  })
}

async function seedActiveAccounts(
  t: ReturnType<typeof convexTest>,
  projectId: Id<"projects">,
  count: number,
) {
  await t.run(async (ctx) => {
    for (let index = 0; index < count; index++) {
      await ctx.db.insert("redditAccounts", {
        projectId,
        redditUsername: `founder${index}`,
        zernioAccountId: `zernio_${index}`,
        providerCanPost: true,
        isActive: true,
        healthStatus: index === count - 1 ? "warning" : "healthy",
        createdAt: Date.now() + index,
      })
    }
  })
}

describe("billing limits", () => {
  test("getPlanLimits returns user-facing limits", () => {
    expect(getPlanLimits("starter")).toMatchObject({
      cardsPerDay: 5,
      maxSubreddits: 5,
      maxCompetitors: 3,
      maxRedditAccounts: 1,
    })
    expect(getPlanLimits("growth")).toMatchObject({
      cardsPerDay: 15,
      maxSubreddits: 15,
      maxCompetitors: 5,
      maxRedditAccounts: 2,
    })
    expect(getPlanLimits("scale")).toMatchObject({
      cardsPerDay: 40,
      maxSubreddits: 25,
      maxCompetitors: 10,
      maxRedditAccounts: 5,
    })
  })

  test("trial expiry flips trialing projects to trial_expired", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedBillingProject(t, {
      planStatus: "trialing",
      trialEndsAt: 100,
    })

    const result = await t.mutation(internal.billing.expireTrialIfNeeded, {
      projectId,
      now: 101,
    })
    const project = await t.run(async (ctx) => await ctx.db.get(projectId))

    expect(result.expired).toBe(true)
    expect(project?.planStatus).toBe("trial_expired")
  })
})

describe("Creem webhook handling", () => {
  test("checkout completed sets Creem IDs and activates the project idempotently", async () => {
    vi.stubEnv("CREEM_WEBHOOK_SECRET", "secret")
    const t = convexTest(schema, modules)
    const { projectId } = await seedBillingProject(t)

    const args = {
      secret: "secret",
      eventType: "checkout.completed",
      projectId,
      customerId: "cust_1",
      subscriptionId: "sub_1",
      plan: "starter" as const,
      interval: "monthly" as const,
    }

    await t.mutation(api.billing.handleCreemWebhook, args)
    await t.mutation(api.billing.handleCreemWebhook, args)

    const project = await t.run(async (ctx) => await ctx.db.get(projectId))
    expect(project).toMatchObject({
      creemCustomerId: "cust_1",
      creemSubscriptionId: "sub_1",
      plan: "starter",
      billingInterval: "monthly",
      planStatus: "active",
      cancelAtPeriodEnd: false,
    })
  })

  test("subscription events update status correctly", async () => {
    vi.stubEnv("CREEM_WEBHOOK_SECRET", "secret")
    const t = convexTest(schema, modules)
    const { projectId } = await seedBillingProject(t, {
      planStatus: "active",
      creemCustomerId: "cust_1",
      creemSubscriptionId: "sub_1",
    })

    await t.mutation(api.billing.handleCreemWebhook, {
      secret: "secret",
      eventType: "subscription.scheduled_cancel",
      subscriptionId: "sub_1",
    })
    let project = await t.run(async (ctx) => await ctx.db.get(projectId))
    expect(project?.planStatus).toBe("active")
    expect(project?.cancelAtPeriodEnd).toBe(true)

    await t.mutation(api.billing.handleCreemWebhook, {
      secret: "secret",
      eventType: "subscription.past_due",
      subscriptionId: "sub_1",
    })
    project = await t.run(async (ctx) => await ctx.db.get(projectId))
    expect(project?.planStatus).toBe("past_due")

    await t.mutation(api.billing.handleCreemWebhook, {
      secret: "secret",
      eventType: "subscription.canceled",
      subscriptionId: "sub_1",
    })
    project = await t.run(async (ctx) => await ctx.db.get(projectId))
    expect(project?.planStatus).toBe("canceled")
    expect(project?.cancelAtPeriodEnd).toBe(false)
  })

  test("downgrades auto-disable excess subreddits and accounts", async () => {
    vi.stubEnv("CREEM_WEBHOOK_SECRET", "secret")
    const t = convexTest(schema, modules)
    const { projectId } = await seedBillingProject(t, {
      plan: "scale",
      planStatus: "active",
      creemCustomerId: "cust_1",
      creemSubscriptionId: "sub_1",
    })
    await seedActiveSubreddits(t, projectId, 12)
    await seedActiveAccounts(t, projectId, 3)

    await t.mutation(api.billing.handleCreemWebhook, {
      secret: "secret",
      eventType: "subscription.active",
      subscriptionId: "sub_1",
      plan: "starter",
      interval: "annual",
    })

    const rows = await t.run(async (ctx) => ({
      subreddits: await ctx.db
        .query("subreddits")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(20),
      accounts: await ctx.db
        .query("redditAccounts")
        .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
        .take(10),
    }))

    expect(rows.subreddits.filter((row) => row.active)).toHaveLength(5)
    expect(rows.accounts.filter((row) => row.isActive)).toHaveLength(1)
  })
})

describe("starter enforcement", () => {
  test("duplicate subreddit detection works past the first 200 rows", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedBillingProject(t, {
      plan: "scale",
      planStatus: "active",
    })

    await t.run(async (ctx) => {
      for (let index = 0; index < 200; index++) {
        await ctx.db.insert("subreddits", {
          projectId,
          name: `seeded_${index}`,
          relevanceScore: 50,
          reasoning: "Seeded",
          active: false,
          addedBy: "user",
          createdAt: Date.now() + index,
        })
      }
      await ctx.db.insert("subreddits", {
        projectId,
        name: "targetsub",
        relevanceScore: 50,
        reasoning: "Seeded",
        active: false,
        addedBy: "user",
        createdAt: Date.now() + 201,
      })
    })

    await expect(
      t.withIdentity({ subject: "user_1" }).action(api.subreddits.addSubreddit, {
        name: "targetsub",
      }),
    ).rejects.toThrow("DUPLICATE")
  })

  test("starter cannot add a 6th active subreddit", async () => {
    stubRequiredEnv()
    const t = convexTest(schema, modules)
    const { projectId } = await seedBillingProject(t, {
      plan: "starter",
      planStatus: "active",
    })
    await seedActiveSubreddits(t, projectId, 5)

    await expect(
      t.withIdentity({ subject: "user_1" }).action(api.subreddits.addSubreddit, {
        name: "founders",
      }),
    ).rejects.toThrow(
      "You've reached the subreddit limit for your plan. Upgrade to add more.",
    )
  })

  test("starter cannot connect a second Reddit account", async () => {
    stubRequiredEnv()
    const t = convexTest(schema, modules)
    const { projectId } = await seedBillingProject(t, {
      plan: "starter",
      planStatus: "active",
    })
    await seedActiveAccounts(t, projectId, 1)

    const context = await t.withIdentity({ subject: "user_1" }).query(
      api.reddit.getConnectContext,
      { projectId },
    )

    expect(context).toMatchObject({
      canAddAccount: false,
      accountLimit: 1,
      usedAccounts: 1,
      message: "Reddit account limit reached for this plan",
    })
  })
})
