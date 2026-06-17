"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { useQuery } from "convex/react"

import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"
import { UpgradeDialog } from "@/components/upgrade-dialog"

function daysRemaining(trialEndsAt: number | null) {
  if (trialEndsAt === null) return 0
  return Math.max(0, Math.ceil((trialEndsAt - Date.now()) / 86_400_000))
}

function useProjectRefFromPath() {
  const pathname = usePathname()
  return pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
}

export function TrialCard() {
  const projectRef = useProjectRefFromPath()
  const billing = useQuery(api.billing.getProjectBillingStatus, projectRef ? { projectRef } : "skip")
  const [open, setOpen] = useState(false)

  if (!billing || billing.planStatus !== "trialing") return null

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <div>
        <p className="text-[13px] font-medium text-text-primary">
          Trial active
        </p>
        <p className="mt-1 text-[12px] text-text-secondary">
          {daysRemaining(billing.trialEndsAt)} days remaining
        </p>
      </div>
      <Button type="button" size="sm" className="w-full" onClick={() => setOpen(true)}>
        Upgrade
      </Button>
      <UpgradeDialog
        open={open}
        onOpenChange={setOpen}
        projectRef={billing.projectRef}
      />
    </div>
  )
}
