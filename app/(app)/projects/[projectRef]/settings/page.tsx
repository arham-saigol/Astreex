"use client"

import { useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useClerk, useUser } from "@clerk/nextjs"
import { useMutation, useQuery } from "convex/react"
import { toast } from "sonner"
import {
  Check,
  CreditCard,
  Edit3,
  ExternalLink,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { UpgradeDialog } from "@/components/upgrade-dialog"
import { cn } from "@/lib/utils"

type Tab = "account" | "brand" | "billing"
type Plan = "starter" | "growth" | "scale"
type PlanStatus = "trialing" | "active" | "canceled" | "past_due" | "trial_expired" | "requires_subscription"
type HealthStatus = "healthy" | "warning" | "banned"
type OnboardingStatus = "in_progress" | "running" | "complete" | "error"

type ProjectIntelligenceProfile = {
  overview: string
  capabilities: string[]
  icps: string[]
  personas: string[]
  painPoints: string[]
  pricingAndCompetitorComparisons: string[]
  whereProjectLeads: string[]
  whereCompetitorsLead: string[]
  weaknesses: string[]
  futureAdvantages: string[]
  positioning: string
  redditUsefulAngles: string[]
  avoidTopics: string[]
  agentNotes: string[]
}

type RedditAccount = {
  _id: Id<"redditAccounts">
  redditUsername: string
  healthStatus: HealthStatus
  isActive: boolean
  createdAt: number
}

type SettingsContext = {
  user: {
    name: string
    email: string
    avatarUrl: string | null
  }
  project: {
    _id: Id<"projects">
    projectRef: string
    role: "owner" | "member"
    name: string
    plan: Plan
    planStatus: PlanStatus
    onboardingStatus: OnboardingStatus | null
    onboardingError: string | null
    onboardingAnalysisStartedAt: number | null
    createdAt: number
    trialEndsAt: number | null
    billingInterval: "monthly" | "annual" | null
    cancelAtPeriodEnd: boolean
    hasCreemCustomer: boolean
    accountLimit: number
    limits: {
      cardsPerDay: number
      maxSubreddits: number
      maxCompetitors: number
      maxRedditAccounts: number
    }
  }
  brand: {
    _id: Id<"projectIntelligenceProfiles">
    websiteUrl: string
    competitorUrls: string[]
    intelligenceJson: string
    scrapeStatus: "complete" | "degraded" | null
  } | null
  redditAccounts: RedditAccount[]
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "account", label: "Account" },
  { id: "brand", label: "Project Intelligence" },
  { id: "billing", label: "Billing" },
]

const emptyProfile: ProjectIntelligenceProfile = {
  overview: "",
  capabilities: [],
  icps: [],
  personas: [],
  painPoints: [],
  pricingAndCompetitorComparisons: [],
  whereProjectLeads: [],
  whereCompetitorsLead: [],
  weaknesses: [],
  futureAdvantages: [],
  positioning: "",
  redditUsefulAngles: [],
  avoidTopics: [],
  agentNotes: [],
}

const plans: Array<{
  id: Plan
  name: string
  price: number
  features: string[]
  recommended?: boolean
}> = [
  {
    id: "starter",
    name: "Starter",
    price: 29,
    features: ["150 cards/month (5/day)", "5 active subreddits", "3 tracked competitors", "1 Reddit account", "Basic analytics dashboard", "Daily health monitoring"],
  },
  {
    id: "growth",
    name: "Growth",
    price: 59,
    recommended: true,
    features: ["450 cards/month (15/day)", "15 active subreddits", "5 tracked competitors", "2 Reddit accounts", "Advanced analytics dashboard", "Daily health monitoring"],
  },
  {
    id: "scale",
    name: "Scale",
    price: 119,
    features: ["1200 cards/month (40/day)", "25 active subreddits", "10 tracked competitors", "5 Reddit accounts", "Advanced analytics dashboard", "Daily health monitoring"],
  },
]

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp))
}

function planLabel(plan: Plan) {
  return plans.find((item) => item.id === plan)?.name ?? plan
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong"
}

function normalizeArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean)
  }

  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean)
  }

  return []
}

function parseProfile(intelligenceJson?: string): ProjectIntelligenceProfile {
  if (!intelligenceJson) return emptyProfile

  try {
    const parsed = JSON.parse(intelligenceJson) as Record<string, unknown>

    return {
      overview: String(parsed.overview ?? ""),
      capabilities: normalizeArray(parsed.capabilities),
      icps: normalizeArray(parsed.icps),
      personas: normalizeArray(parsed.personas),
      painPoints: normalizeArray(parsed.painPoints),
      pricingAndCompetitorComparisons: normalizeArray(parsed.pricingAndCompetitorComparisons),
      whereProjectLeads: normalizeArray(parsed.whereProjectLeads),
      whereCompetitorsLead: normalizeArray(parsed.whereCompetitorsLead),
      weaknesses: normalizeArray(parsed.weaknesses),
      futureAdvantages: normalizeArray(parsed.futureAdvantages),
      positioning: String(parsed.positioning ?? ""),
      redditUsefulAngles: normalizeArray(parsed.redditUsefulAngles),
      avoidTopics: normalizeArray(parsed.avoidTopics),
      agentNotes: normalizeArray(parsed.agentNotes),
    }
  } catch {
    return emptyProfile
  }
}

function initialsFor(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}

function Section({
  title,
  children,
  className,
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("space-y-4", className)}>
      <h2 className="font-sans text-[16px] font-semibold text-text-primary">
        {title}
      </h2>
      {children}
    </section>
  )
}

function SettingsSkeleton() {
  return (
    <div className="mx-auto max-w-[680px] space-y-6 font-sans">
      <Skeleton className="h-8 w-36" />
      <Skeleton className="h-10 w-full rounded-full" />
      <Skeleton className="h-48 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  )
}

function HealthDot({ status }: { status: HealthStatus }) {
  return (
    <span
      className={cn(
        "inline-block size-2.5 rounded-full",
        status === "healthy" && "bg-success",
        status === "warning" && "bg-warning",
        status === "banned" && "bg-error",
      )}
    />
  )
}

function PillList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <span className="text-[14px] text-text-tertiary">Not set</span>
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item}
          className="rounded-full bg-accent-subtle px-2.5 py-1 text-[13px] font-medium text-accent"
        >
          {item}
        </span>
      ))}
    </div>
  )
}

function FieldEditor({
  label,
  value,
  multiline,
  disabled,
  onChange,
}: {
  label: string
  value: string
  multiline?: boolean
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-2">
      <span className="text-[13px] font-medium text-text-secondary">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-ring focus:ring-3 focus:ring-ring/50"
        />
      ) : (
        <Input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} />
      )}
    </label>
  )
}

function ProfileField({
  label,
  value,
  editing,
  arrayValue,
  multiline,
  canEdit = true,
  onEdit,
  onChange,
}: {
  label: string
  value: string
  editing: boolean
  arrayValue?: string[]
  multiline?: boolean
  canEdit?: boolean
  onEdit: () => void
  onChange: (value: string) => void
}) {
  return (
    <div className="group rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
      <div className="mb-1 flex items-center justify-between gap-3">
        <dt className="text-[13px] font-medium text-text-secondary">{label}</dt>
        {canEdit ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={onEdit}
            aria-label={`Edit ${label}`}
            className="opacity-0 group-hover:opacity-100 focus:opacity-100"
          >
            <Edit3 className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <dd>
        {editing ? (
          multiline ? (
            <textarea
              value={value}
              onChange={(event) => onChange(event.target.value)}
              className="min-h-24 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-ring focus:ring-3 focus:ring-ring/50"
            />
          ) : (
            <Input value={value} onChange={(event) => onChange(event.target.value)} />
          )
        ) : arrayValue ? (
          <PillList items={arrayValue} />
        ) : (
          <span className={cn("text-[14px] text-text-primary", !value && "text-text-tertiary")}>
            {value || "Not set"}
          </span>
        )}
      </dd>
    </div>
  )
}

function AccountTab({
  context,
}: {
  context: SettingsContext
}) {
  const router = useRouter()
  const { openUserProfile } = useClerk()
  const { user } = useUser()
  const updateUserName = useMutation(api.settings.updateUserName)
  const disconnectRedditAccount = useMutation(api.settings.disconnectRedditAccount)
  const deleteProject = useMutation(api.settings.deleteProject)

  const clerkName = user?.fullName || user?.firstName || ""
  const displayName = context.user.name || clerkName || "User"
  const email = user?.primaryEmailAddress?.emailAddress || context.user.email
  const avatarUrl = user?.imageUrl || context.user.avatarUrl || undefined
  const [name, setName] = useState(displayName)
  const [savingName, setSavingName] = useState(false)
  const [disconnecting, setDisconnecting] = useState<RedditAccount | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmation, setConfirmation] = useState("")
  const [isDeleting, setIsDeleting] = useState(false)

  const usedAccounts = context.redditAccounts.filter((account) => account.isActive).length
  const accountLimit = context.project.accountLimit
  const isOwner = context.project.role === "owner"
  const canConnect = isOwner && usedAccounts < accountLimit
  const canDelete =
    isOwner && (context.project.planStatus === "canceled" || !context.project.hasCreemCustomer)

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === displayName) return

    setSavingName(true)
    try {
      await updateUserName({ name })
      toast.success("Name updated.")
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSavingName(false)
    }
  }

  const handleDisconnect = async () => {
    if (!disconnecting || !isOwner) return

    try {
      await disconnectRedditAccount({ redditAccountId: disconnecting._id })
      toast.success(`u/${disconnecting.redditUsername} disconnected.`)
      setDisconnecting(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const handleDeleteProject = async () => {
    if (!isOwner) return
    setIsDeleting(true)
    try {
      const result = await deleteProject({
        projectId: context.project._id,
        confirmation,
      })
      if (result.status === "queued") {
        toast.success("Project deletion queued.")
        setDeleteOpen(false)
        router.replace("/dashboard")
        return
      }
      toast.success("Project deleted.")
      setDeleteOpen(false)
      router.replace("/dashboard")
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-8">
      <Section title="Profile">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            <Avatar size="lg">
              <AvatarImage src={avatarUrl} alt={displayName} />
              <AvatarFallback>{initialsFor(displayName)}</AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1 space-y-4">
              <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <FieldEditor label="Name" value={name} onChange={setName} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleSaveName}
                  disabled={savingName || !name.trim() || name.trim() === displayName}
                >
                  {savingName ? "Saving..." : "Save"}
                </Button>
              </div>

              <div className="space-y-2">
                <p className="text-[13px] font-medium text-text-secondary">Email</p>
                <p className="text-[14px] text-text-primary">{email || "No email on file"}</p>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="px-0 text-accent hover:bg-transparent hover:text-accent-hover"
                onClick={() => openUserProfile()}
              >
                Manage account
                <ExternalLink className="size-3.5" />
              </Button>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Connected Reddit Accounts">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-text-secondary">
              {usedAccounts} of {accountLimit} accounts used on {planLabel(context.project.plan)}.
            </p>
            {isOwner ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!canConnect}
                onClick={() =>
                  window.location.assign(
                    `/api/zernio/reddit/connect?projectRef=${encodeURIComponent(context.project.projectRef)}&returnTo=settings`,
                  )
                }
              >
                <Plus className="size-3.5" />
                Connect another account
              </Button>
            ) : null}
          </div>

          {context.redditAccounts.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center text-[14px] text-text-secondary">
              No Reddit accounts connected for this project.
            </div>
          ) : (
            <div className="divide-y divide-border rounded-xl border border-border bg-surface">
              {context.redditAccounts.map((account) => (
                <div
                  key={account._id}
                  className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <HealthDot status={account.healthStatus} />
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-medium text-text-primary">
                        u/{account.redditUsername}
                      </p>
                      <p className="text-[13px] text-text-tertiary">
                        Connected {formatDate(account.createdAt)}
                      </p>
                    </div>
                  </div>
                  {isOwner ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="justify-start text-error hover:text-error sm:justify-center"
                      onClick={() => setDisconnecting(account)}
                    >
                      Disconnect
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

      {isOwner ? (
        <Section title="Danger Zone" className="rounded-xl border border-error/30 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[14px] font-medium text-text-primary">Delete project</p>
              <p className="mt-1 text-[13px] text-text-secondary">
                Cancel the project plan before deleting project data.
              </p>
            </div>
            <Button
              type="button"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-3.5" />
              Delete project
            </Button>
          </div>
        </Section>
      ) : null}

      <Dialog open={!!disconnecting} onOpenChange={(open) => !open && setDisconnecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Disconnect Reddit account?</DialogTitle>
            <DialogDescription>
              This removes u/{disconnecting?.redditUsername} from this project.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDisconnecting(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={handleDisconnect}>
              Disconnect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              This will delete all cards, subreddits, and analytics for this project. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {!canDelete ? (
              <p className="rounded-lg border border-error/30 bg-error/5 p-3 text-[13px] text-error">
                The plan must be canceled before this project can be deleted.
              </p>
            ) : null}
            <FieldEditor
              label='Type "DELETE PROJECT" to confirm'
              value={confirmation}
              onChange={setConfirmation}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDeleteProject}
              disabled={!canDelete || confirmation !== "DELETE PROJECT" || isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ProjectIntelligenceTab({
  context,
}: {
  context: SettingsContext
}) {
  const updateProjectIntelligenceProfile = useMutation(api.settings.updateProjectIntelligenceProfile)
  const updateProjectIntelligenceUrls = useMutation(api.settings.updateProjectIntelligenceUrls)
  const retryOnboardingPipeline = useMutation(api.settings.retryOnboardingPipeline)
  const reanalyzeProjectIntelligenceProfile = useMutation(api.settings.reanalyzeProjectIntelligenceProfile)
  const profile = useMemo(
    () => parseProfile(context.brand?.intelligenceJson),
    [context.brand?.intelligenceJson],
  )
  const [draft, setDraft] = useState<ProjectIntelligenceProfile>(profile)
  const [editingField, setEditingField] = useState<keyof ProjectIntelligenceProfile | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [websiteUrl, setWebsiteUrl] = useState(context.brand?.websiteUrl ?? "")
  const [competitorUrls, setCompetitorUrls] = useState(
    context.brand?.competitorUrls.length ? context.brand.competitorUrls : [""],
  )
  const [savingUrls, setSavingUrls] = useState(false)
  const [retryingPipeline, setRetryingPipeline] = useState(false)
  const [reanalyzingIntelligence, setreanalyzingIntelligence] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const canManageProject = context.project.role === "owner"

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60 * 1000)
    return () => window.clearInterval(interval)
  }, [])

  const profileChanged = JSON.stringify(draft) !== JSON.stringify(profile)
  const urlsChanged =
    websiteUrl.trim() !== (context.brand?.websiteUrl ?? "") ||
    competitorUrls.map((url) => url.trim()).filter(Boolean).join("\n") !==
      (context.brand?.competitorUrls ?? []).join("\n")
  const websiteChanged = websiteUrl.trim() !== (context.brand?.websiteUrl ?? "")
  const isEmptyProfile = JSON.stringify(profile) === JSON.stringify(emptyProfile)
  const profileAge = context.project.onboardingAnalysisStartedAt
    ? now - context.project.onboardingAnalysisStartedAt
    : 0
  const profileIsLate = profileAge > 30 * 60 * 1000

  const setTextField = (field: keyof ProjectIntelligenceProfile, value: string) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const setArrayField = (field: keyof ProjectIntelligenceProfile, value: string) => {
    setDraft((current) => ({
      ...current,
      [field]: normalizeArray(value),
    }))
  }

  const updateCompetitorUrl = (index: number, value: string) => {
    setCompetitorUrls((current) => {
      const next = [...current]
      next[index] = value
      return next
    })
  }

  const removeCompetitorUrl = (index: number) => {
    setCompetitorUrls((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index)
      return next.length > 0 ? next : [""]
    })
  }

  const saveProfile = async () => {
    if (!canManageProject) return
    setSavingProfile(true)
    try {
      await updateProjectIntelligenceProfile({
        projectId: context.project._id,
        intelligenceJson: JSON.stringify(draft),
      })
      setEditingField(null)
      toast.success("Project Intelligence Profile updated.")
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSavingProfile(false)
    }
  }

  const saveUrls = async () => {
    if (!canManageProject) return
    setSavingUrls(true)
    try {
      await updateProjectIntelligenceUrls({
        projectId: context.project._id,
        websiteUrl,
        competitorUrls: competitorUrls.map((url) => url.trim()).filter(Boolean),
      })
      toast.success("Project intelligence URLs updated.")
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSavingUrls(false)
    }
  }

  const retryPipeline = async () => {
    if (!canManageProject) return
    setRetryingPipeline(true)
    try {
      await retryOnboardingPipeline({ projectId: context.project._id })
      toast.success("Project intelligence analysis queued.")
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setRetryingPipeline(false)
    }
  }

  const regenerateProjectIntelligenceProfile = async () => {
    if (!canManageProject) return
    setreanalyzingIntelligence(true)
    try {
      await reanalyzeProjectIntelligenceProfile({ projectId: context.project._id })
      toast.success("Project intelligence analysis queued.")
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setreanalyzingIntelligence(false)
    }
  }

  if (!context.brand) {
    return (
      <div className="space-y-4 rounded-xl border border-dashed border-border p-8 text-center text-[14px] text-text-secondary">
        <p>
          {profileIsLate
            ? "Something went wrong. Click to retry."
            : "Your Project Intelligence Profile is being generated. This usually takes a few minutes."}
        </p>
        {profileIsLate && canManageProject ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={retryPipeline}
            disabled={retryingPipeline}
          >
            <RefreshCw className="size-3.5" />
            {retryingPipeline ? "Retrying..." : "Retry"}
          </Button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <Section title="Project Intelligence Profile">
        <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
          {context.project.onboardingStatus === "error" ? (
            <div className="flex flex-col gap-3 rounded-lg border border-error/30 bg-error/5 p-3 text-[13px] text-error sm:flex-row sm:items-center sm:justify-between">
              <p>
                Project intelligence analysis failed{context.project.onboardingError ? `: ${context.project.onboardingError}` : "."}
              </p>
              {canManageProject ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={retryPipeline}
                  disabled={retryingPipeline}
                >
                  <RefreshCw className="size-3.5" />
                  {retryingPipeline ? "Retrying..." : "Retry"}
                </Button>
              ) : null}
            </div>
          ) : null}
          {context.brand.scrapeStatus === "degraded" ? (
            <p className="rounded-lg bg-muted p-3 text-[13px] text-text-secondary">
              We couldn&apos;t fully analyze your website. Consider editing your Project Intelligence Profile manually.
            </p>
          ) : null}
          {isEmptyProfile ? (
            <p className="rounded-lg bg-muted p-3 text-[13px] text-text-secondary">
              {profileIsLate
                ? "Something went wrong. Click to retry."
                : "Your Project Intelligence Profile is being generated. This usually takes a few minutes."}
            </p>
          ) : null}
          {isEmptyProfile && profileIsLate && canManageProject ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={retryPipeline}
              disabled={retryingPipeline}
            >
              <RefreshCw className="size-3.5" />
              {retryingPipeline ? "Retrying..." : "Retry"}
            </Button>
          ) : null}
          <dl className="space-y-1">
            <ProfileField
              label="Overview"
              value={draft.overview}
              multiline
              canEdit={canManageProject}
              editing={editingField === "overview"}
              onEdit={() => setEditingField("overview")}
              onChange={(value) => setTextField("overview", value)}
            />
            <ProfileField
              label="Capabilities"
              value={draft.capabilities.join(", ")}
              arrayValue={draft.capabilities}
              canEdit={canManageProject}
              editing={editingField === "capabilities"}
              onEdit={() => setEditingField("capabilities")}
              onChange={(value) => setArrayField("capabilities", value)}
            />
            <ProfileField
              label="ICPs"
              value={draft.icps.join(", ")}
              arrayValue={draft.icps}
              canEdit={canManageProject}
              editing={editingField === "icps"}
              onEdit={() => setEditingField("icps")}
              onChange={(value) => setArrayField("icps", value)}
            />
            <ProfileField
              label="Personas"
              value={draft.personas.join(", ")}
              arrayValue={draft.personas}
              canEdit={canManageProject}
              editing={editingField === "personas"}
              onEdit={() => setEditingField("personas")}
              onChange={(value) => setArrayField("personas", value)}
            />
            <ProfileField
              label="Pain Points"
              value={draft.painPoints.join(", ")}
              arrayValue={draft.painPoints}
              canEdit={canManageProject}
              editing={editingField === "painPoints"}
              onEdit={() => setEditingField("painPoints")}
              onChange={(value) => setArrayField("painPoints", value)}
            />
            <ProfileField
              label="Pricing & Comparisons"
              value={draft.pricingAndCompetitorComparisons.join(", ")}
              arrayValue={draft.pricingAndCompetitorComparisons}
              canEdit={canManageProject}
              editing={editingField === "pricingAndCompetitorComparisons"}
              onEdit={() => setEditingField("pricingAndCompetitorComparisons")}
              onChange={(value) => setArrayField("pricingAndCompetitorComparisons", value)}
            />
            <ProfileField
              label="Project Leads"
              value={draft.whereProjectLeads.join(", ")}
              arrayValue={draft.whereProjectLeads}
              canEdit={canManageProject}
              editing={editingField === "whereProjectLeads"}
              onEdit={() => setEditingField("whereProjectLeads")}
              onChange={(value) => setArrayField("whereProjectLeads", value)}
            />
            <ProfileField
              label="Competitors Lead"
              value={draft.whereCompetitorsLead.join(", ")}
              arrayValue={draft.whereCompetitorsLead}
              canEdit={canManageProject}
              editing={editingField === "whereCompetitorsLead"}
              onEdit={() => setEditingField("whereCompetitorsLead")}
              onChange={(value) => setArrayField("whereCompetitorsLead", value)}
            />
            <ProfileField
              label="Weaknesses"
              value={draft.weaknesses.join(", ")}
              arrayValue={draft.weaknesses}
              canEdit={canManageProject}
              editing={editingField === "weaknesses"}
              onEdit={() => setEditingField("weaknesses")}
              onChange={(value) => setArrayField("weaknesses", value)}
            />
            <ProfileField
              label="Future Advantages"
              value={draft.futureAdvantages.join(", ")}
              arrayValue={draft.futureAdvantages}
              canEdit={canManageProject}
              editing={editingField === "futureAdvantages"}
              onEdit={() => setEditingField("futureAdvantages")}
              onChange={(value) => setArrayField("futureAdvantages", value)}
            />
            <ProfileField
              label="Positioning"
              value={draft.positioning}
              multiline
              canEdit={canManageProject}
              editing={editingField === "positioning"}
              onEdit={() => setEditingField("positioning")}
              onChange={(value) => setTextField("positioning", value)}
            />
            <ProfileField
              label="Reddit Angles"
              value={draft.redditUsefulAngles.join(", ")}
              arrayValue={draft.redditUsefulAngles}
              canEdit={canManageProject}
              editing={editingField === "redditUsefulAngles"}
              onEdit={() => setEditingField("redditUsefulAngles")}
              onChange={(value) => setArrayField("redditUsefulAngles", value)}
            />
            <ProfileField
              label="Avoid Topics"
              value={draft.avoidTopics.join(", ")}
              arrayValue={draft.avoidTopics}
              canEdit={canManageProject}
              editing={editingField === "avoidTopics"}
              onEdit={() => setEditingField("avoidTopics")}
              onChange={(value) => setArrayField("avoidTopics", value)}
            />
            <ProfileField
              label="Agent Notes"
              value={draft.agentNotes.join(", ")}
              arrayValue={draft.agentNotes}
              canEdit={canManageProject}
              editing={editingField === "agentNotes"}
              onEdit={() => setEditingField("agentNotes")}
              onChange={(value) => setArrayField("agentNotes", value)}
            />
          </dl>

          {profileChanged && canManageProject ? (
            <div className="flex justify-end gap-2 border-t border-border pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDraft(profile)
                  setEditingField(null)
                }}
              >
                Reset
              </Button>
              <Button type="button" onClick={saveProfile} disabled={savingProfile}>
                {savingProfile ? "Saving..." : "Save intelligence"}
              </Button>
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Website & Competitor">
        <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <FieldEditor label="Website URL" value={websiteUrl} onChange={setWebsiteUrl} disabled={!canManageProject} />
          {websiteChanged ? (
            <p className="rounded-lg bg-accent-subtle p-3 text-[13px] text-accent">
              Updating your website will queue new project intelligence analysis.
            </p>
          ) : null}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] font-medium text-text-primary">Competitor URLs</p>
              <p className="text-xs text-text-tertiary">
                {competitorUrls.map((url) => url.trim()).filter(Boolean).length}/{context.project.limits.maxCompetitors}
              </p>
            </div>
            <div className="space-y-2">
              {competitorUrls.map((url, index) => (
                <div key={index} className="flex gap-2">
                  <Input
                    type="url"
                    value={url}
                    onChange={(event) => updateCompetitorUrl(index, event.target.value)}
                    placeholder="https://competitor.com"
                    disabled={!canManageProject}
                  />
                  {canManageProject ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCompetitorUrl(index)}
                      aria-label="Remove competitor"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            {canManageProject ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCompetitorUrls((current) => [...current, ""])}
                disabled={
                  competitorUrls.length >= context.project.limits.maxCompetitors
                }
              >
                <Plus className="size-3.5" />
                Add competitor
              </Button>
            ) : null}
          </div>
          {canManageProject ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                type="button"
                variant="outline"
                onClick={regenerateProjectIntelligenceProfile}
                disabled={reanalyzingIntelligence}
              >
                <RefreshCw className="size-3.5" />
                {reanalyzingIntelligence ? "Regenerating..." : "Regenerate Project Intelligence Profile"}
              </Button>
              <Button type="button" onClick={saveUrls} disabled={!urlsChanged || savingUrls}>
                {savingUrls ? "Saving..." : "Save URLs"}
              </Button>
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  )
}

function BillingTab({
  context,
}: {
  context: SettingsContext
}) {
  const [now] = useState(() => Date.now())
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
  const billing = useQuery(api.billing.getProjectBillingStatus, { projectRef: context.project.projectRef })
  const currentPlan = plans.find((plan) => plan.id === context.project.plan) ?? plans[0]
  const currentIndex = plans.findIndex((plan) => plan.id === context.project.plan)
  const isOwner = context.project.role === "owner"
  const trialEndsAt = context.project.trialEndsAt
  const daysRemaining =
    trialEndsAt === null ? 0 : Math.max(0, Math.ceil((trialEndsAt - now) / 86400000))
  const hasPortalAccess =
    (context.project.planStatus === "active" ||
      context.project.planStatus === "past_due") &&
    context.project.hasCreemCustomer
  const disabledSubreddits = billing?.disabledCounts.subreddits ?? 0
  const disabledAccounts = billing?.disabledCounts.redditAccounts ?? 0

  const openBilling = async () => {
    if (!isOwner) return
    if (!hasPortalAccess) {
      setUpgradeOpen(true)
      return
    }

    setPortalLoading(true)
    try {
      const response = await fetch("/api/creem/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectRef: context.project.projectRef }),
      })

      if (!response.ok) throw new Error(await response.text())

      const result = (await response.json()) as { portalUrl?: string }
      if (!result.portalUrl) throw new Error("Portal URL was missing")
      window.location.assign(result.portalUrl)
    } catch (error) {
      toast.error(getErrorMessage(error))
      setPortalLoading(false)
    }
  }

  return (
    <div className="space-y-8">
      <Section title="Current Plan">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-[20px] font-semibold text-text-primary">
                  {currentPlan.name}
                </h3>
                <Badge variant="secondary" className="capitalize">
                  {context.project.planStatus.replace("_", " ")}
                </Badge>
              </div>
              <p className="mt-2 text-[14px] text-text-secondary">
                ${currentPlan.price}/mo
              </p>
              {context.project.planStatus === "trialing" && trialEndsAt !== null ? (
                <p className="mt-2 text-[13px] text-text-secondary">
                  {daysRemaining} days remaining in trial. Ends {formatDate(trialEndsAt)}.
                </p>
              ) : null}
              {context.project.billingInterval ? (
                <p className="mt-2 text-[13px] text-text-secondary">
                  Billed {context.project.billingInterval}.
                </p>
              ) : null}
            </div>
            <div className="grid gap-2 text-[13px] text-text-secondary sm:text-right">
              <span>{context.project.limits.cardsPerDay} cards/day</span>
              <span>{context.project.limits.maxSubreddits} subreddits</span>
              <span>{context.project.limits.maxCompetitors} tracked competitors</span>
              <span>{context.project.limits.maxRedditAccounts} Reddit accounts</span>
            </div>
          </div>
          {context.project.cancelAtPeriodEnd ? (
            <p className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-[13px] text-text-primary">
              This subscription is scheduled to cancel at the end of the current billing period.
            </p>
          ) : null}
          {disabledSubreddits > 0 || disabledAccounts > 0 ? (
            <p className="mt-4 rounded-lg bg-muted p-3 text-[13px] text-text-secondary">
              Downgrade limits disabled {disabledSubreddits} subreddits and {disabledAccounts} Reddit accounts.
            </p>
          ) : null}
        </div>
      </Section>

      <Section title="Plan Comparison">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {plans.map((plan, index) => {
            const isCurrent = plan.id === context.project.plan
            const action = index > currentIndex ? "Upgrade" : "Downgrade"

            return (
              <div
                key={plan.id}
                className={cn(
                  "relative flex flex-col rounded-xl border bg-surface p-5 transition-all duration-150",
                  isCurrent
                    ? "border-accent shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)] ring-1 ring-accent/30"
                    : "border-border",
                )}
              >
                {isCurrent ? (
                  <span className="absolute -top-2.5 right-3 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-white">
                    Current plan
                  </span>
                ) : plan.recommended ? (
                  <span className="absolute -top-2.5 right-3 rounded-full bg-accent px-2.5 py-0.5 text-[11px] font-medium text-white">
                    Recommended
                  </span>
                ) : null}

                <div className="mb-3">
                  <h3 className="text-base font-semibold text-text-primary">
                    {plan.name}
                  </h3>
                  <p className="mt-1 text-xl font-semibold text-text-primary">
                    ${plan.price}
                    <span className="text-sm font-normal text-text-secondary">/mo</span>
                  </p>
                </div>

                <ul className="flex-1 space-y-2">
                  {plan.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-center gap-2 text-[13px] text-text-secondary"
                    >
                      <Check className="size-3.5 shrink-0 text-success" />
                      {feature}
                    </li>
                  ))}
                </ul>

                <Button
                  type="button"
                  className="mt-4 w-full"
                  variant={isCurrent ? "secondary" : "outline"}
                  disabled={isCurrent || !isOwner}
                  onClick={openBilling}
                >
                  {isCurrent ? "Current plan" : hasPortalAccess ? `${action} in portal` : action}
                </Button>
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Billing Details">
        <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <CreditCard className="size-4 text-text-tertiary" strokeWidth={1.5} />
              <p className="text-[14px] text-text-primary">
                Payment method: {context.project.hasCreemCustomer ? "Managed in Creem" : "Not configured"}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={openBilling}
              disabled={portalLoading || !isOwner}
            >
              {portalLoading
                ? "Opening..."
                : hasPortalAccess
                  ? "Manage billing"
                  : "Add billing"}
            </Button>
          </div>

          <div className="border-t border-border pt-4">
            <h3 className="text-[14px] font-semibold text-text-primary">Billing history</h3>
            <div className="mt-3 rounded-lg border border-dashed border-border p-6 text-center text-[14px] text-text-secondary">
              No invoices yet
            </div>
          </div>
        </div>
      </Section>

      <UpgradeDialog
        open={upgradeOpen}
        onOpenChange={setUpgradeOpen}
        projectRef={context.project.projectRef}
      />
    </div>
  )
}

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>(
    searchParams.get("tab") === "billing"
      ? "billing"
      : searchParams.get("tab") === "brand"
        ? "brand"
        : "account",
  )
  const params = useParams<{ projectRef: string }>()
  const projectRef = params.projectRef
  const context = useQuery(api.settings.getSettingsContext, { projectRef })

  useEffect(() => {
    const settingsPath = `/projects/${projectRef}/settings`
    if (searchParams.get("reddit_error")) {
      toast.error("Reddit connection failed. Please try again.")
      router.replace(settingsPath, { scroll: false })
    } else if (searchParams.get("reddit_connected")) {
      toast.success("Reddit account connected.")
      router.replace(settingsPath, { scroll: false })
    }
  }, [projectRef, router, searchParams])

  if (context === undefined) {
    return <SettingsSkeleton />
  }

  if (context === null) {
    return (
      <div className="mx-auto max-w-[680px] py-20 text-center font-sans">
        <h1 className="text-[24px] font-semibold text-text-primary">Settings</h1>
        <p className="mt-2 text-[14px] text-text-secondary">
          Complete onboarding to create your first project.
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[680px] space-y-6 font-sans">
      <header className="space-y-2">
        <h1 className="text-[24px] font-semibold text-text-primary">Settings</h1>
        <p className="text-[14px] text-text-secondary">{context.project.name}</p>
      </header>

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="flex min-w-max gap-4 border-b border-border">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative px-1 pb-2 text-[14px] font-medium transition-colors",
                activeTab === tab.id
                  ? "text-accent after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:bg-accent"
                  : "text-text-secondary hover:text-text-primary",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "account" ? (
        <AccountTab key={context.user.name} context={context} />
      ) : null}
      {activeTab === "brand" ? (
        <ProjectIntelligenceTab
          key={`${context.brand?.intelligenceJson ?? ""}:${context.brand?.websiteUrl ?? ""}:${context.brand?.competitorUrls.join("|") ?? ""}:${context.project.onboardingStatus ?? ""}`}
          context={context}
        />
      ) : null}
      {activeTab === "billing" ? <BillingTab context={context} /> : null}
    </div>
  )
}
