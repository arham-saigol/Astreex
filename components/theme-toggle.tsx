"use client"

import { useSyncExternalStore } from "react"
import { MoonStar, SunMedium } from "lucide-react"
import { useTheme } from "next-themes"

import { Toggle } from "@/components/ui/toggle"

function subscribe() {
  return () => {}
}

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)
  const isDark = mounted && resolvedTheme === "dark"

  return (
    <Toggle
      pressed={isDark}
      aria-label="Toggle theme"
      onPressedChange={(pressed) => setTheme(pressed ? "dark" : "light")}
      className="data-[pressed]:bg-accent data-[pressed]:text-accent-foreground"
    >
      {isDark ? <MoonStar className="size-4" /> : <SunMedium className="size-4" />}
    </Toggle>
  )
}
