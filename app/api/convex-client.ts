import { auth } from "@clerk/nextjs/server"
import { ConvexHttpClient } from "convex/browser"
import { NextResponse, type NextRequest } from "next/server"

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
