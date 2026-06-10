"use client"

import { useEffect } from "react"
import { usePathname } from "next/navigation"

const titles: Record<string, string> = {
  "/dashboard": "Dashboard | Astreex",
  "/feed": "Feed | Astreex",
  "/radar": "Radar | Astreex",
  "/settings": "Settings | Astreex",
}

export function AppShellEffects() {
  const pathname = usePathname()

  useEffect(() => {
    const matchingPath = Object.keys(titles).find((path) =>
      pathname.startsWith(path),
    )
    document.title = matchingPath
      ? titles[matchingPath]
      : "Astreex - Reddit Growth on Autopilot"
  }, [pathname])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") {
        return
      }

      const target = event.target as HTMLElement | null
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return

      const searchInput = document.querySelector<HTMLInputElement>(
        'input[type="search"], input[placeholder*="Search" i]',
      )
      if (!searchInput) return

      event.preventDefault()
      searchInput.focus()
      searchInput.select()
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  return null
}
