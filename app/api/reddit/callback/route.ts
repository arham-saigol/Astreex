import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import {
  clearOAuthCookies,
  errorRedirectTarget,
  getAuthedConvexClient,
  oauthCookieNames,
  redirectTarget,
  safeReturnTo,
} from "../oauth"

export const runtime = "nodejs"

type RedditTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
}

type RedditMeResponse = {
  name?: string
}

function badRequest(message: string) {
  const response = new NextResponse(message, { status: 400 })
  clearOAuthCookies(response)
  return response
}

async function exchangeCodeForToken(code: string) {
  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  const redirectUri = process.env.REDDIT_REDIRECT_URI

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Reddit OAuth is not configured")
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
  })

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "astreex/0.1",
    },
    body,
  })

  if (!response.ok) {
    throw new Error("Reddit token exchange failed")
  }

  const tokenResponse = (await response.json()) as RedditTokenResponse
  if (
    !tokenResponse.access_token ||
    !tokenResponse.refresh_token ||
    !tokenResponse.expires_in
  ) {
    throw new Error("Reddit token response was incomplete")
  }

  return tokenResponse as Required<RedditTokenResponse>
}

async function fetchRedditMe(accessToken: string) {
  const response = await fetch("https://oauth.reddit.com/api/v1/me", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "astreex/0.1",
    },
  })

  if (!response.ok) {
    throw new Error("Failed to load Reddit identity")
  }

  const me = (await response.json()) as RedditMeResponse
  if (!me.name) {
    throw new Error("Reddit identity response was incomplete")
  }

  return me.name
}

export async function GET(request: NextRequest) {
  const cookieState = request.cookies.get(oauthCookieNames.state)?.value
  const cookieProjectId = request.cookies.get(oauthCookieNames.projectId)?.value
  const returnTo = safeReturnTo(
    request.cookies.get(oauthCookieNames.returnTo)?.value ?? null,
  )
  const state = request.nextUrl.searchParams.get("state")
  const code = request.nextUrl.searchParams.get("code")
  const redditError = request.nextUrl.searchParams.get("error")

  if (!cookieState || !state || cookieState !== state) {
    return badRequest("Invalid OAuth state")
  }

  if (!cookieProjectId) {
    return badRequest("Missing OAuth project")
  }

  if (redditError) {
    const response = NextResponse.redirect(
      errorRedirectTarget(request, returnTo, redditError),
    )
    clearOAuthCookies(response)
    return response
  }

  if (!code) {
    return badRequest("Missing OAuth code")
  }

  const { client, response } = await getAuthedConvexClient(request)
  if (!client) {
    clearOAuthCookies(response)
    return response
  }

  try {
    const token = await exchangeCodeForToken(code)
    const redditUsername = await fetchRedditMe(token.access_token)

    await client.mutation(api.reddit.upsertOAuthAccount, {
      projectId: cookieProjectId as Id<"projects">,
      redditUsername,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenExpiresAt: Date.now() + token.expires_in * 1000,
    })

    const response = NextResponse.redirect(redirectTarget(request, returnTo))
    clearOAuthCookies(response)
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reddit OAuth failed"
    const response = NextResponse.redirect(
      errorRedirectTarget(request, returnTo, message),
    )
    clearOAuthCookies(response)
    return response
  }
}
