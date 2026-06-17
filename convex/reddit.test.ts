/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { afterEach, describe, expect, test, vi } from "vitest"
import { internal } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

afterEach(() => {
  vi.useRealTimers()
})

describe("reddit OAuth rate limiting", () => {
  test("shared limiter blocks after limit and resets after window", async () => {
    const t = convexTest(schema, modules)

    const key = "/api/zernio/reddit/connect:127.0.0.1"
    vi.useFakeTimers()
    vi.setSystemTime(1_000)

    for (let index = 0; index < 20; index++) {
      const result = await t.mutation(internal.reddit.consumeZernioOAuthRateLimit, { key })
      expect(result.allowed).toBe(true)
    }

    const blocked = await t.mutation(internal.reddit.consumeZernioOAuthRateLimit, { key })

    vi.setSystemTime(61_001)
    const reset = await t.mutation(internal.reddit.consumeZernioOAuthRateLimit, { key })

    expect(blocked).toMatchObject({ allowed: false, retryAfter: 60 })
    expect(reset.allowed).toBe(true)
  })
})
