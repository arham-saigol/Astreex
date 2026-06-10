export type CreemPlan = "starter" | "growth" | "scale"
export type CreemBillingInterval = "monthly" | "annual"

const PRODUCT_ENV: Record<CreemPlan, Record<CreemBillingInterval, string>> = {
  starter: {
    monthly: "CREEM_PRODUCT_STARTER_MONTHLY",
    annual: "CREEM_PRODUCT_STARTER_ANNUAL",
  },
  growth: {
    monthly: "CREEM_PRODUCT_GROWTH_MONTHLY",
    annual: "CREEM_PRODUCT_GROWTH_ANNUAL",
  },
  scale: {
    monthly: "CREEM_PRODUCT_SCALE_MONTHLY",
    annual: "CREEM_PRODUCT_SCALE_ANNUAL",
  },
}

// Required Creem dashboard products:
// Starter Monthly -> CREEM_PRODUCT_STARTER_MONTHLY
// Starter Annual -> CREEM_PRODUCT_STARTER_ANNUAL
// Growth Monthly -> CREEM_PRODUCT_GROWTH_MONTHLY
// Growth Annual -> CREEM_PRODUCT_GROWTH_ANNUAL
// Scale Monthly -> CREEM_PRODUCT_SCALE_MONTHLY
// Scale Annual -> CREEM_PRODUCT_SCALE_ANNUAL
export function getCreemProductId(
  plan: CreemPlan,
  interval: CreemBillingInterval,
) {
  const envName = PRODUCT_ENV[plan][interval]
  const productId = process.env[envName]

  if (!productId) {
    throw new Error(`${envName} is not configured`)
  }

  return productId
}

export function getPlanIntervalForCreemProductId(productId: string) {
  for (const plan of Object.keys(PRODUCT_ENV) as CreemPlan[]) {
    for (const interval of Object.keys(PRODUCT_ENV[plan]) as CreemBillingInterval[]) {
      const envName = PRODUCT_ENV[plan][interval]
      if (process.env[envName] === productId) {
        return { plan, interval }
      }
    }
  }

  return null
}
