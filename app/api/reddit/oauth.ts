import { auth } from "@clerk/nextjs/server"
import { ConvexHttpClient } from "convex/browser"
import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

export type RedditOAuthReturnTo = "onboarding" | "settings"

export const oauthCookieNames = {
  state: "reddit_oauth_state",
  projectId: "reddit_oauth_project_id",
  returnTo: "reddit_oauth_return_to",
} as const

export const oauthCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/api/reddit",
  maxAge: 10 * 60,
}

export function clearOAuthCookies(response: NextResponse) {
  for (const name of Object.values(oauthCookieNames)) {
    response.cookies.set(name, "", {
      ...oauthCookieOptions,
      maxAge: 0,
    })
  }
}

export function safeReturnTo(value: string | null): RedditOAuthReturnTo {
  return value === "settings" ? "settings" : "onboarding"
}

export function redirectTarget(request: NextRequest, returnTo: RedditOAuthReturnTo) {
  if (returnTo === "settings") {
    return new URL("/settings?reddit_connected=true", request.url)
  }

  return new URL("/onboarding?step=4&reddit_connected=true", request.url)
}

export function errorRedirectTarget(
  request: NextRequest,
  returnTo: RedditOAuthReturnTo,
  error: string,
) {
  const url =
    returnTo === "settings"
      ? new URL("/settings", request.url)
      : new URL("/onboarding?step=4", request.url)
  url.searchParams.set("reddit_error", error)
  return url
}

export async function getAuthedConvexClient(request: NextRequest) {
  const session = await auth()
  if (!session.userId) {
    return {
      response: NextResponse.redirect(new URL("/sign-in", request.url)),
      client: null,
    }
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL
  if (!convexUrl) {
    return {
      response: new NextResponse("Convex is not configured", { status: 500 }),
      client: null,
    }
  }

  const token = await session.getToken({ template: "convex" })
  if (!token) {
    return {
      response: new NextResponse("Convex auth token is unavailable", { status: 401 }),
      client: null,
    }
  }

  return {
    response: null,
    client: new ConvexHttpClient(convexUrl, { auth: token }),
  }
}

export async function verifyOAuthProject(
  client: ConvexHttpClient,
  projectId: Id<"projects">,
) {
  return await client.query(api.reddit.getOAuthAuthorizationContext, {
    projectId,
  })
}
