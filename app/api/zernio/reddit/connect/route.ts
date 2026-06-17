import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import { getAuthedConvexClient } from "../../../convex-client"
import { rateLimitZernioOAuth } from "../rateLimiter"
import {
  errorRedirectTarget,
  getZernioConnectUrl,
  safeReturnTo,
  zernioCookieNames,
  zernioCookieOptions,
} from "../shared"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const rateLimited = await rateLimitZernioOAuth(request)
  if (rateLimited) return rateLimited

  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"))
  const projectRef = request.nextUrl.searchParams.get("projectRef")
  if (!projectRef) {
    return NextResponse.redirect(
      errorRedirectTarget(request, returnTo, "Missing projectRef"),
    )
  }

  const { client, response } = await getAuthedConvexClient(request)
  if (!client) return response

  try {
    const resolved = await client.query(api.projects.getProjectByRefForServer, {
      projectRef,
    })
    const context = await client.action(api.reddit.ensureZernioProfileForConnect, {
      projectId: resolved.projectId,
    })
    if (!context.canAddAccount) {
      return NextResponse.redirect(
        errorRedirectTarget(
          request,
          returnTo,
          context.message ?? "Reddit account limit reached for this plan",
        ),
      )
    }

    const zernioProfileId = context.zernioProfileId
    if (!zernioProfileId) throw new Error("Zernio profile response was incomplete")

    const state = crypto.randomUUID()
    const callbackUrl = new URL("/api/zernio/reddit/callback", request.url)
    callbackUrl.searchParams.set("state", state)
    const authUrl = await getZernioConnectUrl(
      zernioProfileId,
      callbackUrl.toString(),
    )
    const redirect = NextResponse.redirect(authUrl)
    const secure = request.nextUrl.protocol === "https:"

    redirect.cookies.set(zernioCookieNames.projectId, projectRef, {
      ...zernioCookieOptions,
      secure,
    })
    redirect.cookies.set(zernioCookieNames.returnTo, returnTo, {
      ...zernioCookieOptions,
      secure,
    })
    redirect.cookies.set(zernioCookieNames.profileId, zernioProfileId, {
      ...zernioCookieOptions,
      secure,
    })
    redirect.cookies.set(zernioCookieNames.state, state, {
      ...zernioCookieOptions,
      secure,
    })

    return redirect
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zernio connect failed"
    return NextResponse.redirect(errorRedirectTarget(request, returnTo, message))
  }
}
