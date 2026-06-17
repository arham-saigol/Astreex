/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import { internal } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

async function seedProject(t: ReturnType<typeof convexTest>) {
  return await t.run(async (ctx) => {
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
      lastActiveAt: Date.now(),
      createdAt: Date.now(),
    })
  })
}

describe("manual subreddit insertion", () => {
  test("rejects low scores and stores scored values", async () => {
    const t = convexTest(schema, modules)
    const projectId = await seedProject(t)

    await expect(t.mutation(internal.subreddits.insertManualSubreddit, {
      projectId,
      name: "badfit",
      relevanceScore: 19,
      reasoning: "Poor audience fit",
    })).rejects.toThrow("QUALITY_GATE:19")

    const result = await t.mutation(internal.subreddits.insertManualSubreddit, {
      projectId,
      name: "founders",
      memberCount: 42_000,
      description: "Founder discussion",
      rulesJson: "[]",
      relevanceScore: 82,
      reasoning: "Strong audience fit",
    })
    const row = await t.run(async (ctx) => await ctx.db.get(result.id))

    expect(row).toMatchObject({
      name: "founders",
      memberCount: 42_000,
      relevanceScore: 82,
      reasoning: "Strong audience fit",
      active: true,
      addedBy: "user",
    })
  })
})
