"use client"

import { useMemo, useState } from "react"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"

function ageDays(createdAt: number | null) {
  if (!createdAt) return "unknown age"
  const days = Math.max(0, Math.floor((Date.now() - createdAt) / 86_400_000))
  return `${days} day${days === 1 ? "" : "s"} old`
}

export function WarmupDialog() {
  const status = useQuery(api.reddit.getWarmupStatus)
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null)

  const key = useMemo(() => {
    if (!status || status.mode === "ready" || status.mode === "none") return null
    const accounts = status.affectedAccounts
      .map((account) => `${account._id}:${account.activityStatus}:${account.activityCheckedAt ?? 0}`)
      .join("|")
    return `astreex:warmup:${status.projectId}:${status.mode}:${accounts}`
  }, [status])

  const acknowledged = key
    ? acknowledgedKey === key ||
      (typeof window !== "undefined" && localStorage.getItem(key) === "1")
    : false

  if (!status || !key || acknowledged || status.affectedAccounts.length === 0) {
    return null
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-2xl">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-accent">
          Reddit warm-up
        </p>
        <h2 className="mt-2 font-serif text-2xl font-medium text-text-primary">
          We&apos;ll start with community-first participation.
        </h2>
        <p className="mt-3 text-sm leading-6 text-text-secondary">
          Accounts below {status.thresholds.totalKarma} karma or younger than {status.thresholds.accountAgeDays} days get lower-risk cards: helpful replies, no links, no CTAs, and no sales language. Warm-up ends automatically after the next activity sync once thresholds are met.
        </p>

        <div className="mt-5 space-y-2">
          {status.affectedAccounts.map((account) => (
            <div key={account._id} className="rounded-lg border border-border/70 bg-muted/40 p-3 text-sm">
              <div className="font-medium text-text-primary">u/{account.redditUsername}</div>
              <div className="mt-1 text-text-secondary">
                {account.totalKarma ?? "Unknown"} karma · {ageDays(account.accountCreatedAt)}
              </div>
            </div>
          ))}
        </div>

        <Button
          className="mt-6 w-full"
          onClick={() => {
            localStorage.setItem(key, "1")
            setAcknowledgedKey(key)
          }}
        >
          Continue in warm-up
        </Button>
      </div>
    </div>
  )
}
