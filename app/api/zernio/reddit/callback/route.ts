import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { getAuthedConvexClient } from "../../../convex-client"
import { rateLimitZernioOAuth } from "../rateLimiter"
import {
  clearZernioCookies,
  errorRedirectTarget,
  getZernioAccountDetails,
  redirectTarget,
  safeReturnTo,
  zernioAccountId,
  zernioAccountProfileId,
  zernioAccountUsername,
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
  const rateLimited = await rateLimitZernioOAuth(request)
  if (rateLimited) return rateLimited

  const cookieProjectId = request.cookies.get(zernioCookieNames.projectId)?.value
  const cookieProfileId = request.cookies.get(zernioCookieNames.profileId)?.value
  const cookieState = request.cookies.get(zernioCookieNames.state)?.value
  const returnTo = safeReturnTo(
    request.cookies.get(zernioCookieNames.returnTo)?.value ?? null,
  )
  const connected = request.nextUrl.searchParams.get("connected")
  const profileId = request.nextUrl.searchParams.get("profileId")
  const accountId = request.nextUrl.searchParams.get("accountId")
  const state = request.nextUrl.searchParams.get("state")
  const error = request.nextUrl.searchParams.get("error")

  if (error) {
    return badRequest(request, returnTo, error)
  }

  if (!cookieProjectId || !cookieProfileId || !cookieState) {
    return badRequest(request, returnTo, "Missing Zernio connection context")
  }

  if (
    !isSyntacticallyValidProjectId(cookieProjectId) ||
    connected !== "reddit" ||
    profileId !== cookieProfileId ||
    state !== cookieState ||
    !accountId ||
    !isSyntacticallyValidZernioId(accountId)
  ) {
    return badRequest(request, returnTo, "Invalid Zernio callback")
  }
  const projectId = cookieProjectId as Id<"projects">

  const { client, response: authResponse } = await getAuthedConvexClient(request)
  if (!client) {
    clearZernioCookies(authResponse)
    return authResponse
  }

  try {
    const context = await client.query(api.reddit.getConnectContext, {
      projectId,
    })
    if (!context.canAddAccount) {
      throw new Error(context.message ?? "Reddit account limit reached for this plan")
    }

    const account = await getZernioAccountDetails(accountId)
    const authoritativeAccountId = zernioAccountId(account)
    const authoritativeProfileId = zernioAccountProfileId(account)
    const redditUsername = zernioAccountUsername(account)
    if (
      (authoritativeAccountId && authoritativeAccountId !== accountId) ||
      authoritativeProfileId !== cookieProfileId ||
      !redditUsername
    ) {
      return badRequest(request, returnTo, "Unauthorized Zernio account")
    }

    await client.action(api.reddit.completeZernioAccountConnect, {
      projectId,
      zernioAccountId: accountId,
      zernioProfileId: cookieProfileId,
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

function isSyntacticallyValidZernioId(value: string) {
  return /^[A-Za-z0-9_-]{3,128}$/.test(value)
}

function isSyntacticallyValidProjectId(value: string) {
  return /^[A-Za-z0-9]{16,64}$/.test(value)
}
