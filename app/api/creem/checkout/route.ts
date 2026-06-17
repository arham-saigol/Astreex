import { currentUser } from "@clerk/nextjs/server"
import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import { createCreemClient } from "@/lib/creemClient"
import {
  getCreemProductId,
  type CreemBillingInterval,
  type CreemPlan,
} from "@/lib/creemProducts"
import { getAuthedConvexClient } from "../../convex-client"

export const runtime = "nodejs"

const plans = new Set<CreemPlan>(["starter", "growth", "scale"])
const intervals = new Set<CreemBillingInterval>(["monthly", "annual"])

function isPlan(value: unknown): value is CreemPlan {
  return typeof value === "string" && plans.has(value as CreemPlan)
}

function isInterval(value: unknown): value is CreemBillingInterval {
  return typeof value === "string" && intervals.has(value as CreemBillingInterval)
}

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 })
  }

  const { projectRef, plan, interval } = body as {
    projectRef?: unknown
    plan?: unknown
    interval?: unknown
  }

  if (typeof projectRef !== "string" || !isPlan(plan) || !isInterval(interval)) {
    return new NextResponse("Invalid checkout request", { status: 400 })
  }

  const { client, response } = await getAuthedConvexClient(request)
  if (!client) return response

  const user = await currentUser()
  const email = user?.primaryEmailAddress?.emailAddress

  try {
    const project = await client.query(api.billing.getCheckoutProject, {
      projectRef,
    })
    const productId = getCreemProductId(plan, interval)
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin
    const successUrl = new URL(`/projects/${encodeURIComponent(projectRef)}/settings?tab=billing&checkout=success`, appUrl)
    const creem = createCreemClient()
    const checkout = await creem.checkouts.create({
      productId,
      customer: project.creemCustomerId
        ? { id: project.creemCustomerId }
        : email
          ? { email }
          : undefined,
      successUrl: successUrl.toString(),
      metadata: {
        projectId: project.projectId,
        plan,
        interval,
      },
    })

    if (!checkout.checkoutUrl) {
      return new NextResponse("Creem did not return a checkout URL", { status: 502 })
    }

    return Response.json({ checkoutUrl: checkout.checkoutUrl })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create checkout"
    return new NextResponse(message, { status: 500 })
  }
}
