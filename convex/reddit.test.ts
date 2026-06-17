/// <reference types="vite/client" />

import { convexTest } from "convex-test"
import { describe, expect, test } from "vitest"
import { api } from "./_generated/api"
import schema from "./schema"

const modules = import.meta.glob("./**/*.ts")

describe("reddit OAuth rate limiting", () => {
  test("shared limiter blocks after limit and resets after window", async () => {
    const t = convexTest(schema, modules)

    await t.mutation(api.reddit.consumeZernioOAuthRateLimit, {
      key: "/api/zernio/reddit/connect:127.0.0.1",
      now: 1_000,
      windowMs: 1_000,
      maxRequests: 2,
    })
    const second = await t.mutation(api.reddit.consumeZernioOAuthRateLimit, {
      key: "/api/zernio/reddit/connect:127.0.0.1",
      now: 1_100,
      windowMs: 1_000,
      maxRequests: 2,
    })
    const blocked = await t.mutation(api.reddit.consumeZernioOAuthRateLimit, {
      key: "/api/zernio/reddit/connect:127.0.0.1",
      now: 1_200,
      windowMs: 1_000,
      maxRequests: 2,
    })
    const reset = await t.mutation(api.reddit.consumeZernioOAuthRateLimit, {
      key: "/api/zernio/reddit/connect:127.0.0.1",
      now: 2_001,
      windowMs: 1_000,
      maxRequests: 2,
    })

    expect(second.allowed).toBe(true)
    expect(blocked).toMatchObject({ allowed: false, retryAfter: 1 })
    expect(reset.allowed).toBe(true)
  })
})
