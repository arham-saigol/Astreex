"use client"

import { useQuery } from "convex/react"

import { api } from "@/convex/_generated/api"
import { BillingStatusBanner } from "@/components/billing-status-banner"
import { UpgradeDialog } from "@/components/upgrade-dialog"

export function BillingOverlay() {
  const billing = useQuery(api.billing.getProjectBillingStatus)

  return (
    <>
      <BillingStatusBanner />
      {billing?.planStatus === "trial_expired" ? (
        <UpgradeDialog
          open
          onOpenChange={() => {}}
          projectId={billing.projectId}
          nonDismissable
        />
      ) : null}
    </>
  )
}
