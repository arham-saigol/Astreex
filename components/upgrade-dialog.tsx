"use client"

import { useState } from "react"
import { toast } from "sonner"

import {
  PricingCards,
  type PricingInterval,
  type PricingPlan,
} from "@/components/pricing-cards"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export function UpgradeDialog({
  open,
  onOpenChange,
  projectId,
  nonDismissable = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectId: string
  nonDismissable?: boolean
}) {
  const [interval, setInterval] = useState<PricingInterval>("monthly")
  const [loadingPlan, setLoadingPlan] = useState<PricingPlan | null>(null)

  const startCheckout = async (plan: PricingPlan) => {
    setLoadingPlan(plan)
    try {
      const response = await fetch("/api/creem/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, plan, interval }),
      })

      if (!response.ok) {
        throw new Error(await response.text())
      }

      const result = (await response.json()) as { checkoutUrl?: string }
      if (!result.checkoutUrl) {
        throw new Error("Checkout URL was missing")
      }

      window.location.assign(result.checkoutUrl)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Checkout failed")
      setLoadingPlan(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nonDismissable) onOpenChange(nextOpen)
      }}
    >
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-5xl"
        showCloseButton={!nonDismissable}
      >
        <DialogHeader>
          <DialogTitle>Choose a plan</DialogTitle>
          <DialogDescription>
            Select a Creem plan to activate billing for this project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => setInterval("monthly")}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              interval === "monthly"
                ? "bg-surface text-text-primary shadow-sm ring-1 ring-border"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval("annual")}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              interval === "annual"
                ? "bg-surface text-text-primary shadow-sm ring-1 ring-border"
                : "text-text-secondary hover:text-text-primary"
            }`}
          >
            Annual
          </button>
        </div>

        {loadingPlan ? (
          <p className="text-center text-[13px] text-text-secondary">
            Opening Creem checkout...
          </p>
        ) : null}

        <PricingCards
          interval={interval}
          showToggle={false}
          onSelect={startCheckout}
        />
      </DialogContent>
    </Dialog>
  )
}
