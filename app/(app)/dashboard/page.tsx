"use client"

import { useState } from "react"
import Link from "next/link"
import { useQuery } from "convex/react"
import { Plus } from "lucide-react"

import { api } from "@/convex/_generated/api"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type PlanStatus = "trialing" | "active" | "canceled" | "past_due" | "trial_expired" | "requires_subscription"

function statusLabel(status: PlanStatus, onboardingStatus: string | null) {
  if (onboardingStatus === "in_progress" || onboardingStatus === "running") return "Setup incomplete"
  if (status === "trialing") return "Trialing"
  if (status === "past_due") return "Past due"
  if (status === "trial_expired") return "Trial expired"
  if (status === "requires_subscription") return "Subscription required"
  if (status === "active") return "Active"
  return "Canceled"
}

export default function ProjectDashboardPage() {
  const data = useQuery(api.projects.listAccessibleProjects)
  const [invitedProject] = useState(() =>
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("invitedProject") : null,
  )

  if (data === undefined) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </div>
    )
  }

  const projects = data?.projects ?? []

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-sans text-[24px] font-semibold text-text-primary">Projects</h1>
          <p className="mt-1 text-[14px] text-text-secondary">Choose a workspace to continue.</p>
        </div>
        <Link href="/onboarding?new=1" className={buttonVariants()}><Plus className="size-4" />Create project</Link>
      </header>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
          <h2 className="text-[18px] font-semibold text-text-primary">No projects yet</h2>
          <p className="mt-2 text-[14px] text-text-secondary">Create your first project when you are ready.</p>
          <Link href="/onboarding?new=1" className={buttonVariants({ className: "mt-5" })}>Create project</Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => {
            const highlighted = invitedProject === project.publicId
            return (
              <Link
                key={project.projectRef}
                href={`/projects/${project.projectRef}/dashboard`}
                className={cn(
                  "rounded-xl border bg-surface p-5 transition-colors hover:border-accent/50 hover:bg-muted/40",
                  highlighted ? "border-accent ring-2 ring-accent/20" : "border-border",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-[18px] font-semibold text-text-primary">{project.name}</h2>
                    <p className="mt-1 text-[13px] capitalize text-text-secondary">{project.role}</p>
                  </div>
                  <Badge variant="secondary">{statusLabel(project.planStatus, project.onboardingStatus)}</Badge>
                </div>
                <p className="mt-8 text-[13px] text-text-tertiary">/{project.projectRef}</p>
              </Link>
            )
          })}

          <Link
            href="/onboarding?new=1"
            className="flex min-h-40 items-center justify-center rounded-xl border border-dashed border-border bg-surface p-5 text-[14px] font-medium text-text-secondary transition-colors hover:border-accent/50 hover:text-accent"
          >
            <Plus className="mr-2 size-4" /> Create new project
          </Link>
        </div>
      )}
    </div>
  )
}
