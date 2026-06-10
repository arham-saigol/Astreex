"use client"

import { useState, useCallback } from "react"
import { ArrowLeft, CheckCircle2, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { OnboardingData, Plan } from "./page"

interface Props {
  data: OnboardingData
  onBack: () => void
  onComplete: () => void
  onConnectReddit: () => Promise<void>
  isSubmitting: boolean
  error: string | null
}

const planSlots: Record<Plan, number> = {
  starter: 1,
  growth: 3,
  scale: 5,
}

export function StepReddit({
  data,
  onBack,
  onComplete,
  onConnectReddit,
  isSubmitting,
  error,
}: Props) {
  const [isConnecting, setIsConnecting] = useState(false)
  const maxSlots = planSlots[data.plan]
  const connectedAccounts = data.redditAccounts
  const hasAtLeastOne = connectedAccounts.length > 0
  const canAddMore = connectedAccounts.length < maxSlots

  const connectReddit = useCallback(async () => {
    setIsConnecting(true)
    try {
      await onConnectReddit()
    } catch (error) {
      console.error("Reddit connection failed:", error)
      setIsConnecting(false)
    }
  }, [onConnectReddit])

  return (
    <div className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold text-text-primary">
          Connect your Reddit accounts
        </h1>
        <p className="text-sm text-text-secondary">
          We&apos;ll post approved content on your behalf. Add at least one account.
        </p>
      </div>

      <div className="space-y-3 pt-4">
        {/* Connected accounts */}
        {connectedAccounts.map((account, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4"
          >
            <CheckCircle2 className="size-5 text-success" />
            <span className="text-sm font-medium text-text-primary">
              u/{account.username}
            </span>
            <span className="ml-auto text-xs text-text-tertiary">Connected</span>
          </div>
        ))}

        {/* Connect button */}
        {connectedAccounts.length === 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-4">
            <div className="flex-1">
              <p className="text-sm font-medium text-text-primary">Reddit account</p>
              <p className="text-xs text-text-tertiary">Required</p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={connectReddit}
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting…" : "Connect"}
            </Button>
          </div>
        )}

        {/* Add another account */}
        {hasAtLeastOne && canAddMore && (
          <button
            type="button"
            onClick={connectReddit}
            disabled={isConnecting}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-sm text-text-secondary transition-colors hover:border-accent/40 hover:text-text-primary disabled:opacity-50"
          >
            <Plus className="size-4" />
            {isConnecting ? "Connecting…" : "Connect another account"}
          </button>
        )}

        {hasAtLeastOne && canAddMore && (
          <p className="text-center text-xs text-text-tertiary">
            Recommended — distributes posts across accounts for safety
          </p>
        )}
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="ghost" size="lg" onClick={onBack} aria-label="Go back">
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          type="button"
          className="flex-1"
          size="lg"
          onClick={onComplete}
          disabled={!hasAtLeastOne || isSubmitting}
        >
          {isSubmitting ? "Setting up…" : "Start my trial"}
        </Button>
      </div>
      {error ? <p className="text-center text-xs text-error">{error}</p> : null}

      {/* Skip link */}
      <div className="text-center">
        <button
          type="button"
          onClick={onComplete}
          disabled={!hasAtLeastOne || isSubmitting}
          className="text-xs text-text-tertiary underline-offset-2 transition-colors hover:text-text-secondary hover:underline disabled:opacity-50"
        >
          Skip for now — I&apos;ll connect later
        </button>
      </div>
    </div>
  )
}
