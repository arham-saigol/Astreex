"use client"

import { useState } from "react"
import Link from "next/link"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"

const plans = [
  {
    id: "starter",
    name: "Starter",
    description: "For solo founders validating a channel.",
    monthlyPrice: 29,
    annualPrice: 24,
    features: [
      "1 Reddit account",
      "5 AI reply cards per day",
      "2 original posts per week",
      "Shadow ban monitoring",
      "Email support",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    description: "For founders scaling Reddit distribution.",
    monthlyPrice: 49,
    annualPrice: 41,
    recommended: true,
    features: [
      "3 Reddit accounts",
      "15 AI reply cards per day",
      "5 original posts per week",
      "Shadow ban protection",
      "Subreddit radar",
      "Priority support",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    description: "For teams running multi-brand campaigns.",
    monthlyPrice: 99,
    annualPrice: 83,
    features: [
      "10 Reddit accounts",
      "Unlimited AI reply cards",
      "Unlimited original posts",
      "Shadow ban protection",
      "Subreddit radar + scoring",
      "Dedicated account manager",
    ],
  },
]

export function PricingCards() {
  const [annual, setAnnual] = useState(false)

  return (
    <div className="space-y-10">
      {/* Toggle */}
      <div className="flex items-center justify-center gap-3">
        <button
          onClick={() => setAnnual(false)}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium transition-all",
            !annual
              ? "bg-surface text-text-primary shadow-sm ring-1 ring-border"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          Monthly
        </button>
        <button
          onClick={() => setAnnual(true)}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium transition-all",
            annual
              ? "bg-surface text-text-primary shadow-sm ring-1 ring-border"
              : "text-text-secondary hover:text-text-primary"
          )}
        >
          Annual
        </button>
        {annual && (
          <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
            Save ~17%
          </span>
        )}
      </div>

      {/* Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {plans.map((plan) => {
          const price = annual ? plan.annualPrice : plan.monthlyPrice
          const yearlyTotal = plan.annualPrice * 12

          return (
            <div
              key={plan.id}
              className={cn(
                "relative flex flex-col rounded-2xl border bg-surface p-6 transition-shadow hover:shadow-lg",
                plan.recommended
                  ? "border-accent shadow-[0_0_0_1px_var(--accent)]"
                  : "border-border"
              )}
            >
              {plan.recommended && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground">
                    Recommended
                  </span>
                </div>
              )}

              <div className="mb-6 space-y-2">
                <h3 className="text-lg font-semibold text-text-primary">
                  {plan.name}
                </h3>
                <p className="text-sm text-text-secondary">{plan.description}</p>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span className="font-mono text-4xl font-bold tracking-tight text-text-primary">
                    ${price}
                  </span>
                  <span className="text-sm text-text-secondary">/mo</span>
                </div>
                {annual && (
                  <p className="mt-1 text-xs text-text-tertiary">
                    Billed ${yearlyTotal}/yr
                  </p>
                )}
              </div>

              <ul className="mb-8 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5">
                    <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                    <span className="text-sm text-text-secondary">{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={`/sign-up?plan=${plan.id}`}
                className={cn(
                  "inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-medium transition-colors",
                  plan.recommended
                    ? "bg-accent text-accent-foreground hover:bg-accent-hover"
                    : "border border-border bg-background text-text-primary hover:bg-muted"
                )}
              >
                Start free trial
              </Link>
            </div>
          )
        })}
      </div>
    </div>
  )
}
