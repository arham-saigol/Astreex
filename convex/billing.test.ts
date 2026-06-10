/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { afterEach, describe, expect, test, vi } from "vitest"
import { api, internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { getPlanLimits } from "./lib/planLimits"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

afterEach(() => {
  vi.unstubAllEnvs()
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
        accessToken: "encrypted",
        refreshToken: "encrypted",
        tokenExpiresAt: Date.now() + 60_000,
        isActive: true,
        healthStatus: index === count - 1 ? "warning" : "healthy",
        createdAt: Date.now() + index,
      })
    }
  })
}

describe("billing limits", () => {
  test("getPlanLimits returns user-facing limits", () => {
    expect(getPlanLimits("starter")).toEqual({
      cardsPerDay: 5,
      maxSubreddits: 10,
      maxRedditAccounts: 1,
    })
    expect(getPlanLimits("growth")).toEqual({
      cardsPerDay: 15,
      maxSubreddits: 25,
      maxRedditAccounts: 3,
    })
    expect(getPlanLimits("scale")).toEqual({
      cardsPerDay: 35,
      maxSubreddits: 50,
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

    expect(rows.subreddits.filter((row) => row.active)).toHaveLength(10)
    expect(rows.accounts.filter((row) => row.isActive)).toHaveLength(1)
  })
})

describe("starter enforcement", () => {
  test("starter cannot add an 11th active subreddit", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedBillingProject(t, {
      plan: "starter",
      planStatus: "active",
    })
    await seedActiveSubreddits(t, projectId, 10)

    await expect(
      t.withIdentity({ subject: "user_1" }).mutation(api.subreddits.addSubreddit, {
        name: "founders",
      }),
    ).rejects.toThrow(
      "You've reached the subreddit limit for your plan. Upgrade to add more.",
    )
  })

  test("starter cannot connect a second Reddit account", async () => {
    const t = convexTest(schema, modules)
    const { projectId } = await seedBillingProject(t, {
      plan: "starter",
      planStatus: "active",
    })
    await seedActiveAccounts(t, projectId, 1)

    await expect(
      t.withIdentity({ subject: "user_1" }).query(
        api.reddit.getOAuthAuthorizationContext,
        { projectId },
      ),
    ).rejects.toThrow("Reddit account limit reached for this plan")
  })
})
