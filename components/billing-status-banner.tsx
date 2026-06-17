"use client"

import { useState } from "react"
import { usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { toast } from "sonner"

import { api } from "@/convex/_generated/api"
import { Button } from "@/components/ui/button"

function useProjectRefFromPath() {
  const pathname = usePathname()
  return pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
}

export function BillingStatusBanner() {
  const projectRef = useProjectRefFromPath()
  const billing = useQuery(api.billing.getProjectBillingStatus, projectRef ? { projectRef } : "skip")
  const [loading, setLoading] = useState(false)

  if (!billing || billing.planStatus !== "past_due") return null

  const openPortal = async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/creem/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRef: billing.projectRef }),
      })

      if (!response.ok) throw new Error(await response.text())

      const result = (await response.json()) as { portalUrl?: string }
      if (!result.portalUrl) throw new Error("Portal URL was missing")
      window.location.assign(result.portalUrl)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Billing portal failed")
      setLoading(false)
    }
  }

  return (
    <div className="border-b border-warning/30 bg-warning/10 px-4 py-2 text-[13px] text-text-primary">
      <div className="mx-auto flex max-w-4xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p>Your payment needs attention. Card generation is paused until billing is updated.</p>
        {billing.hasCreemCustomer ? (
          <Button type="button" size="sm" variant="outline" onClick={openPortal} disabled={loading}>
            {loading ? "Opening..." : "Manage billing"}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
