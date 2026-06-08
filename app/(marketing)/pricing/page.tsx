import type { Metadata } from "next"

import { PricingCards } from "@/components/pricing-cards"

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple pricing for Astreex — Reddit growth on autopilot. 7-day free trial on all plans.",
}

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-[1080px] px-6 py-20 md:py-28">
      <div className="mb-4 text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-[2rem]">
          Pricing
        </h1>
      </div>
      <p className="mb-12 text-center text-sm text-text-secondary">
        7-day free trial on all plans. No credit card required.
      </p>

      <PricingCards />
    </div>
  )
}
