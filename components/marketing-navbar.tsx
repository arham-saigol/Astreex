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
    <header className="sticky top-4 z-50 px-4 sm:px-6">
      <div className="mx-auto flex w-full max-w-[1060px] items-center justify-between rounded-2xl border-2 border-[#DED9C0] bg-[#FFFFEB]/92 px-4 py-3 shadow-sm backdrop-blur-xl">
        <Link href="/" className="flex items-center gap-2.5 text-[#1A1A1A]">
          <LogoMark />
          <span className="text-xl font-black tracking-[-0.04em]">Astreex</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          <Link
            href="/#workflow"
            className="rounded-xl px-4 py-2 text-sm font-bold text-[#56564B] hover:text-[#1A1A1A]"
          >
            Workflow
          </Link>
          <Link
            href="/pricing"
            className="rounded-xl px-4 py-2 text-sm font-bold text-[#56564B] hover:text-[#1A1A1A]"
          >
            Pricing
          </Link>
        </nav>

        <div className="hidden items-center gap-2.5 md:flex">
          {isSignedIn ? (
            <Link
              href="/dashboard"
              className="inline-flex h-11 items-center rounded-2xl border-2 border-[#1A1A1A] bg-[#F0D7FF] px-5 text-sm font-black text-[#1A1A1A] shadow-[3px_3px_0_#1A1A1A] transition-transform hover:-translate-y-0.5"
            >
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                className="inline-flex h-11 items-center rounded-2xl px-4 text-sm font-black text-[#56564B] hover:text-[#1A1A1A]"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                className="inline-flex h-11 items-center rounded-2xl border-2 border-[#1A1A1A] bg-[#F0D7FF] px-5 text-sm font-black text-[#1A1A1A] shadow-[3px_3px_0_#1A1A1A] transition-transform hover:-translate-y-0.5"
              >
                Start free trial
              </Link>
            </>
          )}
        </div>

        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="inline-flex size-10 items-center justify-center rounded-xl text-[#1A1A1A] transition-colors hover:bg-[#F0D7FF] md:hidden"
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      <div
        className={cn(
          "mx-auto mt-2 max-w-[1060px] overflow-hidden rounded-2xl border-2 border-[#DED9C0] bg-[#FFFFEB]/96 transition-all duration-200 md:hidden",
          mobileOpen ? "max-h-72 p-3" : "max-h-0 border-transparent p-0"
        )}
      >
        <div className="flex flex-col gap-2">
          <Link
            href="/#workflow"
            onClick={() => setMobileOpen(false)}
            className="rounded-xl px-3 py-2.5 text-sm font-black text-[#56564B] hover:bg-[#F0D7FF] hover:text-[#1A1A1A]"
          >
            Workflow
          </Link>
          <Link
            href="/pricing"
            onClick={() => setMobileOpen(false)}
            className="rounded-xl px-3 py-2.5 text-sm font-black text-[#56564B] hover:bg-[#F0D7FF] hover:text-[#1A1A1A]"
          >
            Pricing
          </Link>
          {isSignedIn ? (
            <Link
              href="/dashboard"
              onClick={() => setMobileOpen(false)}
              className="inline-flex h-11 items-center justify-center rounded-2xl border-2 border-[#1A1A1A] bg-[#F0D7FF] px-4 text-sm font-black text-[#1A1A1A]"
            >
              Go to Dashboard
            </Link>
          ) : (
            <>
              <Link
                href="/sign-in"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-11 items-center justify-center rounded-2xl border-2 border-[#1A1A1A] px-4 text-sm font-black text-[#1A1A1A]"
              >
                Sign in
              </Link>
              <Link
                href="/sign-up"
                onClick={() => setMobileOpen(false)}
                className="inline-flex h-11 items-center justify-center rounded-2xl border-2 border-[#1A1A1A] bg-[#F0D7FF] px-4 text-sm font-black text-[#1A1A1A]"
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

function LogoMark() {
  return (
    <span className="flex size-8 items-center justify-center rounded-xl border-2 border-[#1A1A1A] bg-[#034F46] text-sm font-black text-[#FFFFEB] shadow-[2px_2px_0_#1A1A1A]">
      A
    </span>
  )
}
