"use client"

import { useQuery } from "convex/react"

import { api } from "@/convex/_generated/api"
import { BillingStatusBanner } from "@/components/billing-status-banner"
import { UpgradeDialog } from "@/components/upgrade-dialog"
import { useProjectRefFromPath } from "@/hooks/use-project-ref-from-path"

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
