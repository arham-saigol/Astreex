"use client"

import { useMemo, useState } from "react"
import { usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { AlertTriangle, Info, X } from "lucide-react"

import { api } from "@/convex/_generated/api"
import { cn } from "@/lib/utils"

const dismissalKey = "astreex-dismissed-notifications"
const dismissalTtl = 24 * 60 * 60 * 1000

type Dismissals = Record<string, number>
type BannerSeverity = "info" | "warning" | "critical"

function readDismissals(): Dismissals {
  if (typeof window === "undefined") return {}

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(dismissalKey) ?? "{}",
    ) as Dismissals
    const now = Date.now()

    return Object.fromEntries(
      Object.entries(parsed).filter(([, expiresAt]) => expiresAt > now),
    )
  } catch {
    return {}
  }
}

function writeDismissals(dismissals: Dismissals) {
  window.localStorage.setItem(dismissalKey, JSON.stringify(dismissals))
}

function bannerClasses(severity: BannerSeverity) {
  if (severity === "critical") {
    return "border-error/30 bg-error/10 text-error"
  }

  if (severity === "warning") {
    return "border-warning/30 bg-warning/10 text-text-primary"
  }

  return "border-accent/30 bg-accent-subtle text-accent"
}

function useProjectRefFromPath() {
  const pathname = usePathname()
  return pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
}

export function NotificationBanner() {
  const projectRef = useProjectRefFromPath()
  const notifications = useQuery(api.notifications.getActiveBanners, projectRef ? { projectRef } : "skip")
  const [dismissals, setDismissals] = useState<Dismissals>(() => readDismissals())
  const [now, setNow] = useState(() => Date.now())

  const visibleNotifications = useMemo(() => {
    return (notifications ?? []).filter(
      (notification) => (dismissals[notification.id] ?? 0) <= now,
    )
  }, [dismissals, notifications, now])

  if (!notifications || visibleNotifications.length === 0) return null

  return (
    <div className="mb-5 space-y-2">
      {visibleNotifications.map((notification) => {
        const Icon = notification.severity === "info" ? Info : AlertTriangle

        return (
          <div
            key={notification.id}
            className={cn(
              "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-[13px]",
              bannerClasses(notification.severity),
            )}
          >
            <Icon className="mt-0.5 size-4 shrink-0" strokeWidth={1.7} />
            <p className="min-w-0 flex-1">{notification.message}</p>
            <button
              type="button"
              aria-label="Dismiss notification"
              onClick={() => {
                const currentTime = Date.now()
                const next = {
                  ...dismissals,
                  [notification.id]: currentTime + dismissalTtl,
                }
                setDismissals(next)
                setNow(currentTime)
                writeDismissals(next)
              }}
              className="rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100"
            >
              <X className="size-4" strokeWidth={1.7} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
