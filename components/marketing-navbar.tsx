"use client"

import { useState } from "react"
import Link from "next/link"
import { useAuth } from "@clerk/nextjs"
import { Menu, X } from "lucide-react"

import { cn } from "@/lib/utils"

export function MarketingNavbar() {
  const [mobileOpen, setMobileOpen] = useState(false)

  let isSignedIn = false
  try {
    const auth = useAuth()
    isSignedIn = !!auth.isSignedIn
  } catch {
    // Clerk not configured — treat as unauthenticated
  }

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-[1080px] items-center justify-between px-6 py-3.5">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-accent">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              className="size-4 text-white"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="text-lg font-semibold tracking-tight text-text-primary">
            Astreex
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          <Link
            href="/pricing"
            className="rounded-lg px-3.5 py-2 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
          >
            Pricing
          </Link>
        </nav>

        {/* Desktop right side */}
        <div className="hidden items-center gap-2.5 md:flex">
          {isSignedIn ? (
            <Link
              href="/dashboard"
              className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-text-secondary transition-colors hover:text-text-primary"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex h-9 items-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
              >
                Start free trial
              </Link>
            </>
          )}
        </div>

        {/* Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="inline-flex size-9 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-muted md:hidden"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      <div
        className={cn(
          "overflow-hidden border-t border-border/50 bg-background/95 backdrop-blur-md transition-all duration-200 md:hidden",
          mobileOpen ? "max-h-64 py-4" : "max-h-0 py-0"
        )}
      >
        <div className="mx-auto flex max-w-[1080px] flex-col gap-2 px-6">
          <Link
            href="/pricing"
            onClick={() => setMobileOpen(false)}
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:bg-muted hover:text-text-primary"
          >
            Pricing
          </Link>
          <div className="my-1 h-px bg-border/60" />
          {isSignedIn ? (
            <Link
              href="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
            >
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-text-primary transition-colors hover:bg-muted"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground transition-colors hover:bg-accent-hover"
              >
                Start free trial
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
