"use client"

import type { ReactNode } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "convex/react"
import { api } from "@/convex/_generated/api"

import { Sidebar } from "@/components/sidebar"

function OnboardingGate({ children }: { children: ReactNode }) {
  const router = useRouter()
  const status = useQuery(api.onboarding.getOnboardingStatus)

  // Loading — show nothing to avoid flash
  if (status === undefined) {
    return null
  }

  // Not authenticated — let Clerk middleware handle it
  if (!status.isAuthenticated) {
    return null
  }

  // Hasn't completed onboarding — redirect
  if (!status.hasCompletedOnboarding) {
    router.replace("/onboarding")
    return null
  }

  return <>{children}</>
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <OnboardingGate>
      <div className="min-h-screen bg-background">
        <Sidebar />

        {/* Main content */}
        <div className="lg:pl-[240px]">
          {/* Spacer for mobile top bar */}
          <div className="h-12 lg:hidden" />

          <main className="mx-auto max-w-4xl px-6 py-6">
            {children}
          </main>
        </div>
      </div>
    </OnboardingGate>
  )
}
