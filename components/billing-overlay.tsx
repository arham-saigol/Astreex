"use client"

import { usePathname } from "next/navigation"
import { useQuery } from "convex/react"

import { api } from "@/convex/_generated/api"
import { BillingStatusBanner } from "@/components/billing-status-banner"
import { UpgradeDialog } from "@/components/upgrade-dialog"

function useProjectRefFromPath() {
  const pathname = usePathname()
  return pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
}

export function BillingOverlay() {
  const projectRef = useProjectRefFromPath()
  const billing = useQuery(api.billing.getProjectBillingStatus, projectRef ? { projectRef } : "skip")

  return (
    <>
      <BillingStatusBanner />
      {billing?.planStatus === "trial_expired" ? (
        <UpgradeDialog
          open
          onOpenChange={() => {}}
          projectRef={billing.projectRef}
          nonDismissable
        />
      ) : null}
    </>
  )
}
