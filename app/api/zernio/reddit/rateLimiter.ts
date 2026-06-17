import { ConvexHttpClient } from "convex/browser"
import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"

const WINDOW_MS = 60_000
const MAX_REQUESTS = 20

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

  if (convexUrl) {
    try {
      const client = new ConvexHttpClient(convexUrl)
      const result = await client.mutation(api.reddit.consumeZernioOAuthRateLimit, {
        key,
        now,
        windowMs: WINDOW_MS,
        maxRequests: MAX_REQUESTS,
      })
      return result.allowed ? null : tooManyRequests(result.retryAfter)
    } catch (error) {
      console.warn("Convex OAuth rate limiter unavailable; using local fallback", error)
    }
  }

  return localRateLimit(key, now)
}
