import { NextResponse, type NextRequest } from "next/server"

const WINDOW_MS = 60_000
const MAX_REQUESTS = 10

const buckets = new Map<string, { count: number; resetAt: number }>()

function clientKey(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for")
  const ip =
    forwardedFor?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  return `${request.nextUrl.pathname}:${ip}`
}

export function rateLimitCreem(request: NextRequest) {
  const now = Date.now()
  const key = clientKey(request)
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
