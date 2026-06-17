import { NextResponse, type NextRequest } from "next/server"

const WINDOW_MS = 60_000
const MAX_REQUESTS = 10

// Instance-local in-memory limiter; basic DoS protection for single-instance deployments only.
const buckets = new Map<string, { count: number; resetAt: number }>()
let lastCleanupAt = 0

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
  const realIp = request.headers.get("x-real-ip")?.trim()
  const ip = forwardedFor || realIp
  if (!ip) return null
  return `${request.nextUrl.pathname}:${ip}`
}

function cleanupBuckets(now: number) {
  if (now - lastCleanupAt < WINDOW_MS) return
  lastCleanupAt = now

  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
}

export function rateLimitCreem(request: NextRequest) {
  const now = Date.now()
  cleanupBuckets(now)

  const key = clientKey(request)
  if (!key) return new NextResponse("Missing client IP", { status: 400 })

  const current = buckets.get(key)

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return null
  }

  current.count += 1
  if (current.count <= MAX_REQUESTS) return null

  const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000))
  return new NextResponse("Too many requests", {
    status: 429,
    headers: { "Retry-After": String(retryAfter) },
  })
}
