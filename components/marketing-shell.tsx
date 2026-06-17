import type { CSSProperties, ReactNode } from "react"

import { MarketingFooter } from "@/components/marketing-footer"
import { MarketingNavbar } from "@/components/marketing-navbar"

const marketingTheme = {
  colorScheme: "light",
  "--background": "#ffffeb",
  "--foreground": "#1a1a1a",
  "--surface": "#fffef0",
  "--surface-raised": "#ffffff",
  "--border": "#dedbc5",
  "--muted": "#f6f4df",
  "--text-primary": "#1a1a1a",
  "--text-secondary": "#56564b",
  "--text-tertiary": "#8b8a7c",
  "--accent": "#034f46",
  "--accent-foreground": "#ffffeb",
} as CSSProperties

export function MarketingShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="min-h-screen bg-[#FFFFEB] text-[#1A1A1A]"
      style={marketingTheme}
    >
      <MarketingNavbar />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  )
}
