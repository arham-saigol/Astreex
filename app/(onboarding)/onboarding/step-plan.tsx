"use client"

import { ArrowLeft, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { OnboardingData, Plan } from "./page"

interface Props {
  data: OnboardingData
  updateData: (partial: Partial<OnboardingData>) => void
  onNext: () => void
  onBack: () => void
}

const plans: {
  id: Plan
  name: string
  price: number
  features: string[]
  recommended?: boolean
}[] = [
  {
    id: "starter",
    name: "Starter",
    price: 29,
    features: [
      "5 cards per day",
      "10 subreddits monitored",
      "1 Reddit account",
      "Basic analytics",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    price: 49,
    recommended: true,
    features: [
      "15 cards per day",
      "25 subreddits monitored",
      "3 Reddit accounts",
      "Full analytics",
    ],
  },
  {
    id: "scale",
    name: "Scale",
    price: 99,
    features: [
      "35 cards per day",
      "50 subreddits monitored",
      "5 Reddit accounts",
      "Full analytics + export",
    ],
  },
]

export function StepPlan({ data, updateData, onNext, onBack }: Props) {
  const selectedPlan = plans.find((p) => p.id === data.plan)

  return (
    <div className="w-full space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold text-text-primary">
          Choose your plan
        </h1>
        <p className="text-sm text-text-secondary">
          All plans include a 7-day free trial. No credit card required.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-3">
        {plans.map((plan) => {
          const isSelected = data.plan === plan.id
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => updateData({ plan: plan.id })}
              className={`relative flex flex-col rounded-xl border p-5 text-left transition-all duration-150 ${
                isSelected
                  ? "border-accent shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)] ring-1 ring-accent/30"
                  : "border-border hover:border-accent/40 hover:shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)]"
              }`}
            >
              {plan.recommended && (
                <span className="absolute -top-2.5 right-3 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-white">
                  Recommended
                </span>
              )}

              <div className="mb-3">
                <h3 className="text-base font-semibold text-text-primary">
                  {plan.name}
                </h3>
                <p className="mt-1 text-xl font-semibold text-text-primary">
                  ${plan.price}
                  <span className="text-sm font-normal text-text-secondary">/mo</span>
                </p>
              </div>

              <ul className="flex-1 space-y-2">
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-center gap-2 text-sm text-text-secondary"
                  >
                    <Check className="size-3.5 shrink-0 text-success" />
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="mt-4">
                <span
                  className={`inline-block w-full rounded-lg py-2 text-center text-sm font-medium transition-colors ${
                    isSelected
                      ? "bg-accent text-white"
                      : "bg-secondary text-text-primary"
                  }`}
                >
                  Start free trial
                </span>
              </div>
            </button>
          )
        })}
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="ghost" size="lg" onClick={onBack}>
          <ArrowLeft className="size-4" />
        </Button>
        <Button type="button" className="flex-1" size="lg" onClick={onNext}>
          Continue with {selectedPlan?.name}
        </Button>
      </div>
    </div>
  )
}
