import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getAuthedConvexClient } from "../../../convex-client"
import {
  createZernioProfile,
  errorRedirectTarget,
  getZernioConnectUrl,
  isSyntacticallyValidConvexId,
  safeReturnTo,
  zernioCookieNames,
  zernioCookieOptions,
} from "../shared"

export const runtime = "nodejs"

export async function GET(request: NextRequest) {
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get("returnTo"))
  const projectId = request.nextUrl.searchParams.get("projectId")
  if (!projectId) {
    return NextResponse.redirect(
      errorRedirectTarget(request, returnTo, "Missing projectId"),
    )
  }

  if (!isSyntacticallyValidConvexId(projectId)) {
    return new NextResponse("Invalid projectId", { status: 400 })
  }

  const { client, response } = await getAuthedConvexClient(request)
  if (!client) return response

  try {
    const context = await client.query(api.reddit.getConnectContext, {
      projectId: projectId as Id<"projects">,
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

    let zernioProfileId = context.zernioProfileId ?? undefined
    if (!zernioProfileId) {
      zernioProfileId = await createZernioProfile(context.projectName)
      await client.mutation(api.reddit.saveZernioProfileId, {
        projectId: projectId as Id<"projects">,
        zernioProfileId,
      })
    }

    const callbackUrl = new URL("/api/zernio/reddit/callback", request.url)
    const authUrl = await getZernioConnectUrl(
      zernioProfileId,
      callbackUrl.toString(),
    )
    const redirect = NextResponse.redirect(authUrl)
    const secure = request.nextUrl.protocol === "https:"

    redirect.cookies.set(zernioCookieNames.projectId, projectId, {
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

    return redirect
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zernio connect failed"
    return NextResponse.redirect(errorRedirectTarget(request, returnTo, message))
  }
}
