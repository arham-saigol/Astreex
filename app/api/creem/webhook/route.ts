import { createHmac, timingSafeEqual } from "node:crypto"
import { ConvexHttpClient } from "convex/browser"
import { NextResponse, type NextRequest } from "next/server"

import { api } from "@/convex/_generated/api"
import { getPlanIntervalForCreemProductId } from "@/lib/creemProducts"

export const runtime = "nodejs"

type WebhookPayload = Record<string, unknown>

function objectValue(value: unknown): WebhookPayload {
  return value && typeof value === "object" ? value as WebhookPayload : {}
}

function stringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value
  }
  return undefined
}

function metadataFrom(...values: unknown[]) {
  for (const value of values) {
    if (value && typeof value === "object") {
      return value as Record<string, unknown>
    }
  }
  return {}
}

function extractSignatureCandidates(signature: string) {
  return signature
    .split(",")
    .map((part) => part.trim())
    .flatMap((part) => {
      const [, value] = part.split("=")
      return value ? [value.trim(), part] : [part]
    })
    .filter(Boolean)
}

function verifySignature(body: string, signature: string | null) {
  const secret = process.env.CREEM_WEBHOOK_SECRET
  if (!secret || !signature) return false

  const expected = createHmac("sha256", secret).update(body).digest("hex")
  const expectedBuffer = Buffer.from(expected, "hex")

  for (const candidate of extractSignatureCandidates(signature)) {
    const normalized = candidate.startsWith("sha256=")
      ? candidate.slice("sha256=".length)
      : candidate
    if (!/^[a-f0-9]{64}$/i.test(normalized)) continue

    const receivedBuffer = Buffer.from(normalized, "hex")
    if (
      receivedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(receivedBuffer, expectedBuffer)
    ) {
      return true
    }
  }

  return false
}

function extractWebhook(body: WebhookPayload) {
  const eventType = stringValue(body.eventType, body.type) ?? "unknown"
  const object = objectValue(body.object ?? body.payload)
  const customer = objectValue(object.customer)
  const subscription = objectValue(object.subscription)
  const product = objectValue(object.product)
  const order = objectValue(object.order)
  const firstItem = Array.isArray(subscription.items)
    ? objectValue(subscription.items[0])
    : {}
  const itemProduct = objectValue(firstItem.product)
  const metadata = metadataFrom(
    object.metadata,
    subscription.metadata,
    order.metadata,
    body.metadata,
  )
  const customerId = stringValue(
    object.customerId,
    object.customer_id,
    customer.id,
    subscription.customerId,
    subscription.customer_id,
    typeof object.customer === "string" ? object.customer : undefined,
  )
  const subscriptionId = stringValue(
    object.subscriptionId,
    object.subscription_id,
    subscription.id,
    typeof object.subscription === "string" ? object.subscription : undefined,
  )
  const productId = stringValue(
    object.productId,
    object.product_id,
    product.id,
    firstItem.productId,
    firstItem.product_id,
    itemProduct.id,
  )
  const mappedProduct = productId
    ? getPlanIntervalForCreemProductId(productId)
    : null
  const plan = stringValue(metadata.plan, object.plan, mappedProduct?.plan)
  const interval = stringValue(
    metadata.interval,
    object.interval,
    mappedProduct?.interval,
  )

  return {
    eventType,
    projectId: stringValue(metadata.projectId, object.projectId),
    customerId,
    subscriptionId,
    productId,
    plan,
    interval,
  }
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text()
  const signature = request.headers.get("creem-signature")

  if (!verifySignature(rawBody, signature)) {
    return new NextResponse("Invalid signature", { status: 401 })
  }

  let parsed: WebhookPayload
  try {
    parsed = JSON.parse(rawBody) as WebhookPayload
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 })
  }

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL
  const secret = process.env.CREEM_WEBHOOK_SECRET
  if (!convexUrl || !secret) {
    return new NextResponse("Webhook is not configured", { status: 500 })
  }

  const event = extractWebhook(parsed)
  const client = new ConvexHttpClient(convexUrl)

  try {
    await client.mutation(api.billing.handleCreemWebhook, {
      secret,
      eventType: event.eventType,
      projectId: event.projectId,
      customerId: event.customerId,
      subscriptionId: event.subscriptionId,
      productId: event.productId,
      plan:
        event.plan === "starter" ||
        event.plan === "growth" ||
        event.plan === "scale"
          ? event.plan
          : undefined,
      interval:
        event.interval === "monthly" || event.interval === "annual"
          ? event.interval
          : undefined,
    })
  } catch (error) {
    console.error("Creem webhook handling failed", error)
    return new NextResponse("Webhook handling failed", { status: 500 })
  }

  return Response.json({ received: true })
}
