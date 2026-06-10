"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
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
type PlanStatus = "trialing" | "active" | "canceled" | "past_due" | "trial_expired"
type HealthStatus = "healthy" | "warning" | "banned"
type OnboardingStatus = "in_progress" | "running" | "complete" | "error"

type BrandProfile = {
  name: string
  tagline: string
  description: string
  targetAudience: string[]
  painPointsSolved: string[]
  keyFeatures: string[]
  tone: string
  competitors: string[]
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
    name: string
    plan: Plan
    planStatus: PlanStatus
    onboardingStatus: OnboardingStatus | null
    onboardingError: string | null
    createdAt: number
    trialEndsAt: number | null
    billingInterval: "monthly" | "annual" | null
    cancelAtPeriodEnd: boolean
    hasCreemCustomer: boolean
    accountLimit: number
    limits: {
      cardsPerDay: number
      maxSubreddits: number
      maxRedditAccounts: number
    }
  }
  brand: {
    _id: Id<"brands">
    websiteUrl: string
    competitorUrl: string
    profileJson: string
    scrapeStatus: "complete" | "degraded" | null
  } | null
  redditAccounts: RedditAccount[]
}

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "account", label: "Account" },
  { id: "brand", label: "Brand" },
  { id: "billing", label: "Billing" },
]

const emptyProfile: BrandProfile = {
  name: "",
  tagline: "",
  description: "",
  targetAudience: [],
  painPointsSolved: [],
  keyFeatures: [],
  tone: "",
  competitors: [],
}

const plans: Array<{
  id: Plan
  name: string
  price: number
  cardsPerDay: string
  subreddits: string
  accounts: number
  features: string[]
  recommended?: boolean
}> = [
  {
    id: "starter",
    name: "Starter",
    price: 29,
    cardsPerDay: "5 cards/day",
    subreddits: "10 subreddits",
    accounts: 1,
    features: ["5 cards per day", "10 subreddits monitored", "1 Reddit account", "Basic analytics"],
  },
  {
    id: "growth",
    name: "Growth",
    price: 49,
    cardsPerDay: "15 cards/day",
    subreddits: "25 subreddits",
    accounts: 3,
    recommended: true,
    features: ["15 cards per day", "25 subreddits monitored", "3 Reddit accounts", "Full analytics"],
  },
  {
    id: "scale",
    name: "Scale",
    price: 99,
    cardsPerDay: "35 cards/day",
    subreddits: "50 subreddits",
    accounts: 5,
    features: ["35 cards per day", "50 subreddits monitored", "5 Reddit accounts", "Full analytics + export"],
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

function parseProfile(profileJson?: string): BrandProfile {
  if (!profileJson) return emptyProfile

  try {
    const parsed = JSON.parse(profileJson) as Record<string, unknown>

    return {
      name: String(parsed.name ?? ""),
      tagline: String(parsed.tagline ?? ""),
      description: String(parsed.description ?? ""),
      targetAudience: normalizeArray(parsed.targetAudience),
      painPointsSolved: normalizeArray(parsed.painPointsSolved),
      keyFeatures: normalizeArray(parsed.keyFeatures),
      tone: String(parsed.tone ?? ""),
      competitors: normalizeArray(parsed.competitors),
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
  onChange,
}: {
  label: string
  value: string
  multiline?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-2">
      <span className="text-[13px] font-medium text-text-secondary">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-[14px] text-text-primary outline-none transition-colors placeholder:text-text-tertiary focus:border-ring focus:ring-3 focus:ring-ring/50"
        />
      ) : (
        <Input value={value} onChange={(event) => onChange(event.target.value)} />
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
  onEdit,
  onChange,
}: {
  label: string
  value: string
  editing: boolean
  arrayValue?: string[]
  multiline?: boolean
  onEdit: () => void
  onChange: (value: string) => void
}) {
  return (
    <div className="group rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
      <div className="mb-1 flex items-center justify-between gap-3">
        <dt className="text-[13px] font-medium text-text-secondary">{label}</dt>
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
  const canConnect = usedAccounts < accountLimit
  const canDelete =
    context.project.planStatus === "canceled" || !context.project.hasCreemCustomer

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
    if (!disconnecting) return

    try {
      await disconnectRedditAccount({ redditAccountId: disconnecting._id })
      toast.success(`u/${disconnecting.redditUsername} disconnected.`)
      setDisconnecting(null)
    } catch (error) {
      toast.error(getErrorMessage(error))
    }
  }

  const handleDeleteProject = async () => {
    setIsDeleting(true)
    try {
      const result = await deleteProject({
        projectId: context.project._id,
        confirmation,
      })
      if (result.status === "queued") {
        toast.success("Project deletion queued.")
        setDeleteOpen(false)
        return
      }
      toast.success("Project deleted.")
      setDeleteOpen(false)
      router.replace("/onboarding")
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canConnect}
              onClick={() =>
                window.location.assign(
                  `/api/reddit/authorize?projectId=${encodeURIComponent(context.project._id)}&returnTo=settings`,
                )
              }
            >
              <Plus className="size-3.5" />
              Connect another account
            </Button>
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-start text-error hover:text-error sm:justify-center"
                    onClick={() => setDisconnecting(account)}
                  >
                    Disconnect
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Section>

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

function BrandTab({
  context,
}: {
  context: SettingsContext
}) {
  const updateBrandProfile = useMutation(api.settings.updateBrandProfile)
  const updateBrandUrls = useMutation(api.settings.updateBrandUrls)
  const retryOnboardingPipeline = useMutation(api.settings.retryOnboardingPipeline)
  const reanalyzeBrandProfile = useMutation(api.settings.reanalyzeBrandProfile)
  const profile = useMemo(
    () => parseProfile(context.brand?.profileJson),
    [context.brand?.profileJson],
  )
  const [draft, setDraft] = useState<BrandProfile>(profile)
  const [editingField, setEditingField] = useState<keyof BrandProfile | null>(null)
  const [savingProfile, setSavingProfile] = useState(false)
  const [websiteUrl, setWebsiteUrl] = useState(context.brand?.websiteUrl ?? "")
  const [competitorUrl, setCompetitorUrl] = useState(context.brand?.competitorUrl ?? "")
  const [savingUrls, setSavingUrls] = useState(false)
  const [retryingPipeline, setRetryingPipeline] = useState(false)
  const [reanalyzingBrand, setReanalyzingBrand] = useState(false)
  const [now] = useState(() => Date.now())

  const profileChanged = JSON.stringify(draft) !== JSON.stringify(profile)
  const urlsChanged =
    websiteUrl.trim() !== (context.brand?.websiteUrl ?? "") ||
    competitorUrl.trim() !== (context.brand?.competitorUrl ?? "")
  const websiteChanged = websiteUrl.trim() !== (context.brand?.websiteUrl ?? "")
  const isEmptyProfile = JSON.stringify(profile) === JSON.stringify(emptyProfile)
  const profileAge = now - context.project.createdAt
  const profileIsLate = profileAge > 30 * 60 * 1000

  const setTextField = (field: keyof BrandProfile, value: string) => {
    setDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const setArrayField = (field: keyof BrandProfile, value: string) => {
    setDraft((current) => ({
      ...current,
      [field]: normalizeArray(value),
    }))
  }

  const saveProfile = async () => {
    setSavingProfile(true)
    try {
      await updateBrandProfile({
        projectId: context.project._id,
        profileJson: JSON.stringify(draft),
      })
      setEditingField(null)
      toast.success("Brand profile updated.")
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSavingProfile(false)
    }
  }

  const saveUrls = async () => {
    setSavingUrls(true)
    try {
      await updateBrandUrls({
        projectId: context.project._id,
        websiteUrl,
        competitorUrl,
      })
      toast.success("Brand URLs updated.")
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setSavingUrls(false)
    }
  }

  const retryPipeline = async () => {
    setRetryingPipeline(true)
    try {
      await retryOnboardingPipeline({ projectId: context.project._id })
      toast.success("Brand analysis queued.")
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setRetryingPipeline(false)
    }
  }

  const regenerateBrandProfile = async () => {
    setReanalyzingBrand(true)
    try {
      await reanalyzeBrandProfile({ projectId: context.project._id })
      toast.success("Brand analysis queued.")
    } catch (error) {
      toast.error(getErrorMessage(error))
    } finally {
      setReanalyzingBrand(false)
    }
  }

  if (!context.brand) {
    return (
      <div className="space-y-4 rounded-xl border border-dashed border-border p-8 text-center text-[14px] text-text-secondary">
        <p>
          {profileIsLate
            ? "Something went wrong. Click to retry."
            : "Your brand profile is being generated. This usually takes a few minutes."}
        </p>
        {profileIsLate ? (
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
      <Section title="Brand Profile">
        <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
          {context.project.onboardingStatus === "error" ? (
            <div className="flex flex-col gap-3 rounded-lg border border-error/30 bg-error/5 p-3 text-[13px] text-error sm:flex-row sm:items-center sm:justify-between">
              <p>
                Brand analysis failed{context.project.onboardingError ? `: ${context.project.onboardingError}` : "."}
              </p>
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
            </div>
          ) : null}
          {context.brand.scrapeStatus === "degraded" ? (
            <p className="rounded-lg bg-muted p-3 text-[13px] text-text-secondary">
              We couldn&apos;t fully analyze your website. Consider editing your brand profile manually.
            </p>
          ) : null}
          {isEmptyProfile ? (
            <p className="rounded-lg bg-muted p-3 text-[13px] text-text-secondary">
              {profileIsLate
                ? "Something went wrong. Click to retry."
                : "Your brand profile is being generated. This usually takes a few minutes."}
            </p>
          ) : null}
          {isEmptyProfile && profileIsLate ? (
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
              label="Name"
              value={draft.name}
              editing={editingField === "name"}
              onEdit={() => setEditingField("name")}
              onChange={(value) => setTextField("name", value)}
            />
            <ProfileField
              label="Tagline"
              value={draft.tagline}
              editing={editingField === "tagline"}
              onEdit={() => setEditingField("tagline")}
              onChange={(value) => setTextField("tagline", value)}
            />
            <ProfileField
              label="Description"
              value={draft.description}
              multiline
              editing={editingField === "description"}
              onEdit={() => setEditingField("description")}
              onChange={(value) => setTextField("description", value)}
            />
            <ProfileField
              label="Target Audience"
              value={draft.targetAudience.join(", ")}
              arrayValue={draft.targetAudience}
              editing={editingField === "targetAudience"}
              onEdit={() => setEditingField("targetAudience")}
              onChange={(value) => setArrayField("targetAudience", value)}
            />
            <ProfileField
              label="Pain Points Solved"
              value={draft.painPointsSolved.join(", ")}
              arrayValue={draft.painPointsSolved}
              editing={editingField === "painPointsSolved"}
              onEdit={() => setEditingField("painPointsSolved")}
              onChange={(value) => setArrayField("painPointsSolved", value)}
            />
            <ProfileField
              label="Key Features"
              value={draft.keyFeatures.join(", ")}
              arrayValue={draft.keyFeatures}
              editing={editingField === "keyFeatures"}
              onEdit={() => setEditingField("keyFeatures")}
              onChange={(value) => setArrayField("keyFeatures", value)}
            />
            <ProfileField
              label="Tone"
              value={draft.tone}
              editing={editingField === "tone"}
              onEdit={() => setEditingField("tone")}
              onChange={(value) => setTextField("tone", value)}
            />
            <ProfileField
              label="Competitors"
              value={draft.competitors.join(", ")}
              arrayValue={draft.competitors}
              editing={editingField === "competitors"}
              onEdit={() => setEditingField("competitors")}
              onChange={(value) => setArrayField("competitors", value)}
            />
          </dl>

          {profileChanged ? (
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
                {savingProfile ? "Saving..." : "Save profile"}
              </Button>
            </div>
          ) : null}
        </div>
      </Section>

      <Section title="Website & Competitor">
        <div className="space-y-4 rounded-xl border border-border bg-surface p-5">
          <FieldEditor label="Website URL" value={websiteUrl} onChange={setWebsiteUrl} />
          {websiteChanged ? (
            <p className="rounded-lg bg-accent-subtle p-3 text-[13px] text-accent">
              Updating your website will trigger a new brand analysis overnight.
            </p>
          ) : null}
          <FieldEditor
            label="Competitor URL"
            value={competitorUrl}
            onChange={setCompetitorUrl}
          />
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={regenerateBrandProfile}
              disabled={reanalyzingBrand}
            >
              <RefreshCw className="size-3.5" />
              {reanalyzingBrand ? "Regenerating..." : "Regenerate brand profile"}
            </Button>
            <Button type="button" onClick={saveUrls} disabled={!urlsChanged || savingUrls}>
              {savingUrls ? "Saving..." : "Save URLs"}
            </Button>
          </div>
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
  const billing = useQuery(api.billing.getProjectBillingStatus)
  const currentPlan = plans.find((plan) => plan.id === context.project.plan) ?? plans[0]
  const currentIndex = plans.findIndex((plan) => plan.id === context.project.plan)
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
    if (!hasPortalAccess) {
      setUpgradeOpen(true)
      return
    }

    setPortalLoading(true)
    try {
      const response = await fetch("/api/creem/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: context.project._id }),
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
                  disabled={isCurrent}
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
              disabled={portalLoading}
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
        projectId={context.project._id}
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
  const context = useQuery(api.settings.getSettingsContext)

  useEffect(() => {
    if (searchParams.get("reddit_error")) {
      toast.error("Reddit connection failed. Please try again.")
      router.replace("/settings", { scroll: false })
    } else if (searchParams.get("reddit_connected")) {
      toast.success("Reddit account connected.")
      router.replace("/settings", { scroll: false })
    }
  }, [router, searchParams])

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
        <BrandTab
          key={`${context.brand?.profileJson ?? ""}:${context.brand?.websiteUrl ?? ""}:${context.brand?.competitorUrl ?? ""}:${context.project.onboardingStatus ?? ""}`}
          context={context}
        />
      ) : null}
      {activeTab === "billing" ? <BillingTab context={context} /> : null}
    </div>
  )
}
