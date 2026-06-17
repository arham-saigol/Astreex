"use client"

import { useEffect, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"

import { BillingOverlay } from "@/components/billing-overlay"
import { AppShellEffects } from "@/components/app-shell-effects"
import { NotificationBanner } from "@/components/notification-banner"
import { Sidebar } from "@/components/sidebar"
import { WarmupDialog } from "@/components/warmup-dialog"

function OnboardingGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const status = useQuery(api.onboarding.getOnboardingStatus)
  const shouldRedirect =
    status !== undefined && status.isAuthenticated && !status.hasCompletedOnboarding

  useEffect(() => {
    if (shouldRedirect) {
      router.replace("/onboarding")
    }
  }, [router, shouldRedirect])

  // Loading — show nothing to avoid flash
  if (status === undefined) {
    return null
  }

  // Not authenticated — let Clerk middleware handle it
  if (!status.isAuthenticated) {
    return null
  }

  // Hasn't completed onboarding — redirect
  if (shouldRedirect) return null

  return <>{children}</>
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <OnboardingGate>
      <div className="min-h-screen bg-background">
        <Sidebar />
        <AppShellEffects />
        <WarmupDialog />

        {/* Main content */}
        <div className="lg:pl-[240px]">
          <BillingOverlay />

          {/* Spacer for mobile top bar */}
          <div className="h-12 lg:hidden" />

          <main className="mx-auto max-w-4xl px-6 py-6">
            <NotificationBanner />
            {children}
          </main>
        </div>
      </div>
    </OnboardingGate>
  )
}
