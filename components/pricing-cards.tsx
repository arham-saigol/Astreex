"use client"

import { useState } from "react"
import Link from "next/link"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

export type PricingPlan = "starter" | "growth" | "scale"
export type PricingInterval = "monthly" | "annual"

const plans = [
  {
    id: "starter" as const,
    name: "Starter",
    description: "For solo founders validating Reddit as a channel.",
    monthlyPrice: 29,
    annualPrice: 24,
    features: [
      "150 cards/month (5/day)",
      "5 active subreddits",
      "3 tracked competitors",
      "1 Reddit account",
      "Basic analytics dashboard",
      "Daily health monitoring",
    ],
  },
  {
    id: "growth" as const,
    name: "Growth",
    description: "For founders turning Reddit into a weekly motion.",
    monthlyPrice: 59,
    annualPrice: 49,
    recommended: true,
    features: [
      "450 cards/month (15/day)",
      "15 active subreddits",
      "5 tracked competitors",
      "2 Reddit accounts",
      "Advanced analytics dashboard",
      "Daily health monitoring",
    ],
  },
  {
    id: "scale" as const,
    name: "Scale",
    description: "For teams running multi-brand distribution.",
    monthlyPrice: 119,
    annualPrice: 99,
    features: [
      "1200 cards/month (40/day)",
      "25 active subreddits",
      "10 tracked competitors",
      "5 Reddit accounts",
      "Advanced analytics dashboard",
      "Daily health monitoring",
    ],
  },
]

export function PricingCards({
  interval,
  showToggle = true,
  onSelect,
}: {
  interval?: PricingInterval
  showToggle?: boolean
  onSelect?: (plan: PricingPlan) => void
}) {
  const [internalInterval, setInternalInterval] =
    useState<PricingInterval>("annual")
  const activeInterval = interval ?? internalInterval
  const annual = activeInterval === "annual"

  const setInterval = (value: PricingInterval) => {
    if (interval === undefined) setInternalInterval(value)
  }

  return (
    <div className="space-y-10">
      {showToggle ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setInterval("monthly")}
            aria-pressed={!annual}
            className={cn(
              "rounded-2xl border-2 border-[#1A1A1A] px-4 py-2 text-sm font-black transition-transform",
              !annual
                ? "bg-[#F0D7FF] text-[#1A1A1A] shadow-[3px_3px_0_#1A1A1A]"
                : "bg-[#FFFFEB] text-[#56564B] hover:text-[#1A1A1A]"
            )}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval("annual")}
            aria-pressed={annual}
            className={cn(
              "rounded-2xl border-2 border-[#1A1A1A] px-4 py-2 text-sm font-black transition-transform",
              annual
                ? "bg-[#F0D7FF] text-[#1A1A1A] shadow-[3px_3px_0_#1A1A1A]"
                : "bg-[#FFFFEB] text-[#56564B] hover:text-[#1A1A1A]"
            )}
          >
            Annual
          </button>
          <span className="rounded-full bg-[#034F46] px-3 py-1.5 text-xs font-black uppercase tracking-[0.14em] text-[#FFFFEB]">
            2 months free
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => {
          const price = annual ? plan.annualPrice : plan.monthlyPrice
          const yearlyTotal = plan.annualPrice * 12

          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-[2rem] border-2 border-[#1A1A1A] p-6 text-[#1A1A1A]",
                plan.recommended
                  ? "bg-[#F0D7FF] shadow-[8px_8px_0_#1A1A1A]"
                  : "bg-[#FFFFEB] shadow-[5px_5px_0_rgba(26,26,26,0.9)]"
              )}
            >
              {plan.recommended && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="rounded-full border-2 border-[#1A1A1A] bg-[#034F46] px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-[#FFFFEB]">
                    Most popular
                  </span>
                </div>
              )}

              <div className="mb-7 space-y-2 pt-2">
                <h3 className="font-heading text-5xl font-medium leading-none tracking-[-0.04em]">
                  {plan.name}
                </h3>
                <p className="text-sm font-semibold leading-relaxed text-[#56564B]">
                  {plan.description}
                </p>
              </div>

              <div className="mb-7 border-y-2 border-[#1A1A1A] py-5">
                <div className="flex items-baseline gap-1">
                  <span className="font-heading text-7xl font-medium leading-none tracking-[-0.05em]">
                    ${price}
                  </span>
                  <span className="text-sm font-black text-[#56564B]">/mo</span>
                </div>
                {annual && (
                  <p className="mt-1 text-xs font-bold text-[#8B8A7C]">
                    Billed ${yearlyTotal}/yr
                  </p>
                )}
              </div>

              <ul className="mb-8 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-[#034F46]" />
                    <span className="text-sm font-semibold text-[#56564B]">
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>

              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(plan.id)}
                  className={cn(
                    "inline-flex h-12 items-center justify-center rounded-2xl border-2 border-[#1A1A1A] px-4 text-sm font-black transition-transform hover:-translate-y-0.5",
                    plan.recommended
                      ? "bg-[#1A1A1A] text-[#FFFFEB]"
                      : "bg-[#F0D7FF] text-[#1A1A1A]"
                  )}
                >
                  Select {plan.name}
                </button>
              ) : (
                <Link
                  href={`/sign-up?plan=${plan.id}`}
                  className={cn(
                    "inline-flex h-12 items-center justify-center rounded-2xl border-2 border-[#1A1A1A] px-4 text-sm font-black transition-transform hover:-translate-y-0.5",
                    plan.recommended
                      ? "bg-[#1A1A1A] text-[#FFFFEB]"
                      : "bg-[#F0D7FF] text-[#1A1A1A]"
                  )}
                >
                  Start free trial
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
