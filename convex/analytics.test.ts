/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import { api } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

describe("analytics refresh", () => {
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
