import { NextResponse, type NextRequest } from "next/server"

export type ZernioReturnTo = "onboarding" | "settings"

export const zernioCookieNames = {
  projectId: "zernio_reddit_project_id",
  returnTo: "zernio_reddit_return_to",
  profileId: "zernio_reddit_profile_id",
  state: "zernio_reddit_state",
} as const

export const zernioCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/api/zernio/reddit",
  maxAge: 10 * 60,
}

export function clearZernioCookies(response: NextResponse) {
  for (const name of Object.values(zernioCookieNames)) {
    response.cookies.set(name, "", {
      ...zernioCookieOptions,
      maxAge: 0,
    })
  }
}

export function safeReturnTo(value: string | null): ZernioReturnTo {
  return value === "settings" ? "settings" : "onboarding"
}

export function redirectTarget(request: NextRequest, returnTo: ZernioReturnTo) {
  if (returnTo === "settings") {
    return new URL("/settings?reddit_connected=true", request.url)
  }

  return new URL("/onboarding?step=4&reddit_connected=true", request.url)
}

export function errorRedirectTarget(
  request: NextRequest,
  returnTo: ZernioReturnTo,
  error: string,
) {
  const url =
    returnTo === "settings"
      ? new URL("/settings", request.url)
      : new URL("/onboarding?step=4", request.url)
  url.searchParams.set("reddit_error", error)
  return url
}

export function isSyntacticallyValidConvexId(value: string) {
  return /^[a-z0-9]{16,64}$/i.test(value)
}

function zernioBaseUrl() {
  return (process.env.ZERNIO_BASE_URL ?? "https://zernio.com/api/v1").replace(/\/$/, "")
}

function zernioApiKey() {
  const key = process.env.ZERNIO_API_KEY
  if (!key) throw new Error("ZERNIO_API_KEY is not configured")
  return key
}

async function fetchZernioJson<T>(
  endpoint: string,
  init: RequestInit = {},
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(`${zernioBaseUrl()}${endpoint}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${zernioApiKey()}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    })
    const body = await response.json().catch(() => null) as T
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? String((body as { error?: unknown }).error)
          : `Zernio request failed with status ${response.status}`
      throw new Error(message)
    }
    return body
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Zernio request to ${endpoint} timed out`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function createZernioProfile(name: string) {
  const body = await fetchZernioJson<{
    profile?: { _id?: string; id?: string }
    _id?: string
    id?: string
  }>("/profiles", {
    method: "POST",
    body: JSON.stringify({
      name,
      description: "Astreex Reddit distribution project",
    }),
  })
  const profileId = body.profile?._id ?? body.profile?.id ?? body._id ?? body.id
  if (!profileId) throw new Error("Zernio profile response was incomplete")
  return profileId
}

export async function getZernioConnectUrl(profileId: string, redirectUrl: string) {
  const endpoint =
    `/connect/reddit?profileId=${encodeURIComponent(profileId)}&redirect_url=${encodeURIComponent(redirectUrl)}`
  const body = await fetchZernioJson<{ authUrl?: string; url?: string }>(endpoint)
  const authUrl = body.authUrl ?? body.url
  if (!authUrl) throw new Error("Zernio connect response was incomplete")
  return authUrl
}

export async function getZernioAccountHealth(accountId: string) {
  return await fetchZernioJson<{
    status?: string
    canPost?: boolean
    needsReconnect?: boolean
    issues?: string[]
    health?: {
      status?: string
      canPost?: boolean
      needsReconnect?: boolean
      issues?: string[]
    }
  }>(`/accounts/${encodeURIComponent(accountId)}/health`)
}

type ZernioAccountDetails = {
  account?: ZernioAccountDetails
  _id?: string
  id?: string
  accountId?: string
  username?: string
  redditUsername?: string
  profileId?: string
  profile_id?: string
  ownerProfileId?: string
  profile?: string | { _id?: string; id?: string }
}

function accountDetailsBody(account: ZernioAccountDetails): ZernioAccountDetails {
  return account.account ?? account
}

export async function getZernioAccountDetails(accountId: string) {
  return await fetchZernioJson<ZernioAccountDetails>(
    `/accounts/${encodeURIComponent(accountId)}`,
  )
}

export function zernioAccountId(account: ZernioAccountDetails) {
  const body = accountDetailsBody(account)
  return body._id ?? body.id ?? body.accountId
}

export function zernioAccountUsername(account: ZernioAccountDetails) {
  const body = accountDetailsBody(account)
  return body.redditUsername ?? body.username
}

export function zernioAccountProfileId(account: ZernioAccountDetails) {
  const body = accountDetailsBody(account)
  if (typeof body.profile === "string") return body.profile
  return (
    body.profileId ??
    body.profile_id ??
    body.ownerProfileId ??
    body.profile?._id ??
    body.profile?.id
  )
}

export function normalizeAccountHealth(health: Awaited<ReturnType<typeof getZernioAccountHealth>>) {
  const source = { ...(health.health ?? {}), ...health }
  const status = source.status ?? "unknown"
  const issues = Array.isArray(source.issues) ? source.issues.map(String) : []
  const needsReconnect =
    source.needsReconnect ??
    issues.some((issue) => /reconnect|token|auth/i.test(issue)) ??
    false
  const canPost = source.canPost ?? (!needsReconnect && status !== "error")

  return { status, canPost, needsReconnect, issues }
}
