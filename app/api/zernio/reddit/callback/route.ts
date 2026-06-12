import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getAuthedConvexClient } from "../../../convex-client"
import {
  clearZernioCookies,
  errorRedirectTarget,
  getZernioAccountHealth,
  normalizeAccountHealth,
  redirectTarget,
  safeReturnTo,
  zernioCookieNames,
} from "../shared"

export const runtime = "nodejs"

function badRequest(
  request: NextRequest,
  returnTo: ReturnType<typeof safeReturnTo>,
  message: string,
) {
  const response = NextResponse.redirect(
    errorRedirectTarget(request, returnTo, message),
  )
  clearZernioCookies(response)
  return response
}

export async function GET(request: NextRequest) {
  const cookieProjectId = request.cookies.get(zernioCookieNames.projectId)?.value
  const cookieProfileId = request.cookies.get(zernioCookieNames.profileId)?.value
  const returnTo = safeReturnTo(
    request.cookies.get(zernioCookieNames.returnTo)?.value ?? null,
  )
  const connected = request.nextUrl.searchParams.get("connected")
  const profileId = request.nextUrl.searchParams.get("profileId")
  const accountId = request.nextUrl.searchParams.get("accountId")
  const username = request.nextUrl.searchParams.get("username")
  const error = request.nextUrl.searchParams.get("error")

  if (error) {
    return badRequest(request, returnTo, error)
  }

  if (!cookieProjectId || !cookieProfileId) {
    return badRequest(request, returnTo, "Missing Zernio connection context")
  }

  if (
    connected !== "reddit" ||
    profileId !== cookieProfileId ||
    !accountId ||
    !username
  ) {
    return badRequest(request, returnTo, "Invalid Zernio callback")
  }

  const { client, response: authResponse } = await getAuthedConvexClient(request)
  if (!client) {
    clearZernioCookies(authResponse)
    return authResponse
  }

  try {
    const context = await client.query(api.reddit.getConnectContext, {
      projectId: cookieProjectId as Id<"projects">,
    })
    if (!context.canAddAccount) {
      throw new Error(context.message ?? "Reddit account limit reached for this plan")
    }

    const providerHealth = normalizeAccountHealth(
      await getZernioAccountHealth(accountId),
    )
    await client.mutation(api.reddit.upsertZernioAccount, {
      projectId: cookieProjectId as Id<"projects">,
      redditUsername: username,
      zernioAccountId: accountId,
      providerHealthStatus: providerHealth.status,
      providerCanPost: providerHealth.canPost,
      providerNeedsReconnect: providerHealth.needsReconnect,
      providerIssues: providerHealth.issues,
    })

    const response = NextResponse.redirect(redirectTarget(request, returnTo))
    clearZernioCookies(response)
    return response
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zernio callback failed"
    const response = NextResponse.redirect(
      errorRedirectTarget(request, returnTo, message),
    )
    clearZernioCookies(response)
    return response
  }
}
