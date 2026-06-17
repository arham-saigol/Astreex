import { ConvexHttpClient } from "convex/browser"
import { NextResponse, type NextRequest } from "next/server"

import { internal } from "@/convex/_generated/api"
import type { FunctionReference } from "convex/server"

const WINDOW_MS = 60_000
const MAX_REQUESTS = 20
const CONVEX_TIMEOUT_MS = 1_500

type OAuthRateLimitMutation = FunctionReference<
  "mutation",
  "public",
  { key: string },
  { allowed: boolean; retryAfter: number }
>

const consumeZernioOAuthRateLimit =
  internal.reddit.consumeZernioOAuthRateLimit as unknown as OAuthRateLimitMutation

const buckets = new Map<string, { count: number; resetAt: number }>()

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")
  const ip =
    forwardedFor?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  return `${request.nextUrl.pathname}:${ip}`
}

function tooManyRequests(retryAfter: number) {
  return new NextResponse("Too many requests", {
    status: 429,
    headers: { "Retry-After": String(retryAfter) },
  })
}

function localRateLimit(key: string, now: number) {
  const current = buckets.get(key)

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return null
  }

  current.count += 1
  if (current.count <= MAX_REQUESTS) return null

  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  return tooManyRequests(retryAfter)
}

export async function rateLimitZernioOAuth(request: NextRequest) {
  const now = Date.now()
  const key = clientKey(request)
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL
  const convexAdminKey = process.env.CONVEX_DEPLOY_KEY ?? process.env.CONVEX_SELF_HOSTED_ADMIN_KEY

  if (convexUrl && convexAdminKey) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), CONVEX_TIMEOUT_MS)

    try {
      const client = new ConvexHttpClient(convexUrl, {
        fetch: (input, init) => fetch(input, { ...init, signal: controller.signal }),
      })
      const adminClient = client as unknown as { setAdminAuth: (token: string) => void }
      adminClient.setAdminAuth(convexAdminKey)
      const result = await client.mutation(
        consumeZernioOAuthRateLimit,
        { key },
        { skipQueue: true },
      )
      return result.allowed ? null : tooManyRequests(result.retryAfter)
    } catch (error) {
      console.warn("Convex OAuth rate limiter unavailable; using local fallback", error)
    } finally {
      clearTimeout(timeout)
    }
  }

  return localRateLimit(key, now)
}
