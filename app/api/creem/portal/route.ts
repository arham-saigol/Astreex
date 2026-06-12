import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { createCreemClient } from "@/lib/creemClient"
import { getAuthedConvexClient } from "../../convex-client"

export const runtime = "nodejs"

export async function POST(request: NextRequest) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 })
  }

  const { projectId } = body as { projectId?: unknown }
  if (typeof projectId !== "string") {
    return new NextResponse("Invalid portal request", { status: 400 })
  }

  const { client, response } = await getAuthedConvexClient(request)
  if (!client) return response

  try {
    const project = await client.query(api.billing.getPortalProject, {
      projectId: projectId as Id<"projects">,
    })
    const creem = createCreemClient()
    const links = await creem.customers.generateBillingLinks({
      customerId: project.creemCustomerId,
    })

    return Response.json({ portalUrl: links.customerPortalLink })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create portal link"
    return new NextResponse(message, { status: 500 })
  }
}
