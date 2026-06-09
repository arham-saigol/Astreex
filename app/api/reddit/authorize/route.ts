import { NextResponse, type NextRequest } from "next/server"

import type { Id } from "@/convex/_generated/dataModel"
import {
  getAuthedConvexClient,
  oauthCookieNames,
  oauthCookieOptions,
  safeReturnTo,
  verifyOAuthProject,
} from "../oauth"

export const runtime = "nodejs"

function randomState() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString("base64url")
}

export async function GET(request: NextRequest) {
  const clientId = process.env.REDDIT_CLIENT_ID
  const redirectUri = process.env.REDDIT_REDIRECT_URI

  if (!clientId || !redirectUri) {
    return new NextResponse("Reddit OAuth is not configured", { status: 500 })
  }

  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) {
    return new NextResponse("Missing projectId", { status: 400 })
  }

  const { client, response } = await getAuthedConvexClient(request)
  if (!client) return response

  try {
    await verifyOAuthProject(client, projectId as Id<"projects">)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Project is not authorized"
    return new NextResponse(message, { status: 403 })
  }

  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"))
  const state = randomState()
  const redditUrl = new URL("https://www.reddit.com/api/v1/authorize")
  redditUrl.searchParams.set("client_id", clientId)
  redditUrl.searchParams.set("response_type", "code")
  redditUrl.searchParams.set("state", state)
  redditUrl.searchParams.set("redirect_uri", redirectUri)
  redditUrl.searchParams.set("duration", "permanent")
  redditUrl.searchParams.set("scope", "identity submit read")

  const redirect = NextResponse.redirect(redditUrl)
  const secure = request.nextUrl.protocol === "https:"

  redirect.cookies.set(oauthCookieNames.state, state, {
    ...oauthCookieOptions,
    secure,
  })
  redirect.cookies.set(oauthCookieNames.projectId, projectId, {
    ...oauthCookieOptions,
    secure,
  })
  redirect.cookies.set(oauthCookieNames.returnTo, returnTo, {
    ...oauthCookieOptions,
    secure,
  })

  return redirect
}
