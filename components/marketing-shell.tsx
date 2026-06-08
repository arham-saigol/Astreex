import type { ReactNode } from "react"

import { MarketingFooter } from "@/components/marketing-footer"
import { MarketingNavbar } from "@/components/marketing-navbar"

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <MarketingNavbar />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  )
}
