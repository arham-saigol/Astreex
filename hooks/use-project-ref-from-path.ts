"use client"

import { usePathname } from "next/navigation"

export function useProjectRefFromPath() {
  const pathname = usePathname()
  return pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
}
