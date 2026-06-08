"use client"

import type { ReactNode } from "react"
import { ClerkProvider, useAuth } from "@clerk/nextjs"
import { ConvexReactClient } from "convex/react"
import { ConvexProviderWithClerk } from "convex/react-clerk"
import { ThemeProvider } from "next-themes"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

const clerkPublishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

function CoreProviders({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="astreex-theme">
      <TooltipProvider delay={120}>
        {children}
        <Toaster closeButton richColors position="top-right" />
      </TooltipProvider>
    </ThemeProvider>
  )
}

function ConvexClerkProvider({ children }: { children: ReactNode }) {
  if (!convex) {
    return <>{children}</>
  }

  return (
    <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  )
}

export function AppProviders({ children }: { children: ReactNode }) {
  const content = <CoreProviders>{children}</CoreProviders>

  if (!clerkPublishableKey) {
    return content
  }

  return (
    <ClerkProvider publishableKey={clerkPublishableKey} afterSignOutUrl="/">
      <ConvexClerkProvider>{content}</ConvexClerkProvider>
    </ClerkProvider>
  )
}
