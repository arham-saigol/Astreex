"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useAction, useQuery, useMutation } from "convex/react"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { toast } from "sonner"
import { Plus, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

// ---------- Helpers ----------

function relevanceDotColor(score: number) {
  if (score >= 80) return "#3D9A5F"
  if (score >= 50) return "#D4932A"
  if (score >= 20) return "#C9524A"
  return "#9C9590"
}

function abbreviateCount(count: number | undefined): string {
  if (!count) return "—"
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(count >= 100_000 ? 0 : 1)}K`
  return count.toLocaleString()
}

function formatDate(ts: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(ts))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : ""
}

// ---------- Types ----------

type Subreddit = {
  _id: Id<"subreddits"> | string
  _creationTime: number
  name: string
  memberCount?: number
  relevanceScore: number
  reasoning: string
  active: boolean
  addedBy: "agent" | "user"
  createdAt: number
  pending?: boolean
}

type RadarStatus = {
  onboardingStatus: "in_progress" | "running" | "complete" | "error" | null
  onboardingError: string | null
  subredditDiscoveryStatus: "complete" | "needs_manual_subreddits" | null
} | null

// ---------- Components ----------

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onChange(!checked)
      }}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200",
        checked ? "bg-accent" : "bg-border",
        disabled && "cursor-not-allowed opacity-50"
      )}
      style={{ minWidth: 36, minHeight: 20 }}
    >
      <span
        className={cn(
          "pointer-events-none block size-2.5 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-[22px]" : "translate-x-[4px]"
        )}
      />
    </button>
  )
}

function SubredditRow({
  sub,
  isSelected,
  onSelect,
  onToggle,
}: {
  sub: Subreddit
  isSelected: boolean
  onSelect: () => void
  onToggle: (active: boolean) => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 transition-colors duration-100",
        "hover:bg-muted/60",
        isSelected && "bg-muted/80",
        !sub.active && "opacity-55"
      )}
      style={{ height: 56, minHeight: 44 }}
    >
      {/* Relevance dot */}
      <span
        className="shrink-0 rounded-full"
        style={{
          width: 8,
          height: 8,
          backgroundColor: relevanceDotColor(sub.relevanceScore),
        }}
      />

      {/* Name */}
      <span className="truncate text-sm font-medium text-text-primary">
        r/{sub.name}
      </span>

      {/* Member count */}
      <span className="ml-auto shrink-0 text-[13px] text-text-secondary">
        {abbreviateCount(sub.memberCount)} members
      </span>

      {/* Toggle */}
      <div className="shrink-0 pl-3">
        <Toggle checked={sub.active} onChange={onToggle} disabled={sub.pending} />
      </div>
    </button>
  )
}

function DetailPanel({
  sub,
  onClose,
}: {
  sub: Subreddit
  onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  // Close on outside click
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    // Delay listener to avoid the row click closing it immediately
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", onClick)
    }, 50)
    return () => {
      clearTimeout(timer)
      document.removeEventListener("mousedown", onClick)
    }
  }, [onClose])

  const scorePercent = Math.min(sub.relevanceScore, 100)

  return (
    <div
      ref={panelRef}
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-border bg-surface shadow-2xl",
        "animate-in slide-in-from-bottom duration-200",
        "md:inset-y-0 md:right-0 md:left-auto md:max-h-none md:w-[360px] md:rounded-none md:border-t-0 md:border-l md:shadow-[-4px_0_24px_rgba(0,0,0,0.06)] md:slide-in-from-right"
      )}
    >
      <PanelContent sub={sub} onClose={onClose} scorePercent={scorePercent} />
    </div>
  )
}

function PanelContent({
  sub,
  onClose,
  scorePercent,
}: {
  sub: Subreddit
  onClose: () => void
  scorePercent: number
}) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-semibold text-text-primary">r/{sub.name}</h2>
        <Button variant="ghost" size="icon-sm" onClick={onClose}>
          <X className="size-4" />
        </Button>
      </div>

      {/* Score */}
      <div className="mt-6 space-y-2">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold text-text-primary">
            {sub.relevanceScore}
          </span>
          <span className="text-sm text-text-secondary">/100 relevance</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${scorePercent}%`,
              backgroundColor: relevanceDotColor(sub.relevanceScore),
            }}
          />
        </div>
      </div>

      {/* Meta */}
      <dl className="mt-6 space-y-3 text-sm">
        <div className="flex justify-between">
          <dt className="text-text-secondary">Members</dt>
          <dd className="font-medium text-text-primary">
            {sub.memberCount ? sub.memberCount.toLocaleString() : "—"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-text-secondary">Added by</dt>
          <dd className="font-medium text-text-primary capitalize">
            {sub.addedBy === "agent" ? "Agent" : "You"}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-text-secondary">Date added</dt>
          <dd className="font-medium text-text-primary">
            {formatDate(sub.createdAt)}
          </dd>
        </div>
      </dl>

      {/* Reasoning */}
      {sub.reasoning && (
        <div className="mt-6 rounded-lg border border-border/60 bg-muted/40 p-4">
          <p className="font-serif text-[15px] italic leading-relaxed text-text-secondary">
            &ldquo;{sub.reasoning}&rdquo;
          </p>
        </div>
      )}
    </div>
  )
}

function AddSubredditInput({
  onDone,
  onOptimisticAdd,
  onOptimisticSuccess,
  onOptimisticFailure,
}: {
  onDone: () => void
  onOptimisticAdd: (subreddit: Subreddit) => void
  onOptimisticSuccess: (tempId: string, subreddit: Subreddit) => void
  onOptimisticFailure: (tempId: string) => void
}) {
  const [value, setValue] = useState("")
  const [loading, setLoading] = useState(false)
  const addSubreddit = useAction(api.subreddits.addSubreddit)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async () => {
    const name = value.trim()
    if (!name || loading) return

    setLoading(true)
    const cleanName = name.replace(/^r\//i, "").trim().toLowerCase()
    const now = Date.now()
    const tempId = `temp-${now}-${Math.random().toString(36).slice(2)}`
    onOptimisticAdd({
      _id: tempId,
      _creationTime: now,
      name: cleanName,
      relevanceScore: 75,
      reasoning: "Added by user",
      active: true,
      addedBy: "user",
      createdAt: now,
      pending: true,
    })
    setValue("")
    onDone()
    try {
      const result = await addSubreddit({ name })
      if (result) {
        onOptimisticSuccess(tempId, {
          _id: result.id,
          _creationTime: now,
          name: result.name,
          relevanceScore: result.relevanceScore,
          reasoning: "Added by user",
          active: true,
          addedBy: "user",
          createdAt: now,
        })
      }
      if (result && result.relevanceScore < 40) {
        toast.warning(
          `r/${result.name} has low relevance (score: ${result.relevanceScore}/100). This may reduce recommendation quality.`
        )
      } else if (result) {
        toast.success(`r/${result.name} added to your radar.`)
      }
    } catch (err: unknown) {
      onOptimisticFailure(tempId)
      const msg = getErrorMessage(err)
      if (msg.includes("DUPLICATE")) {
        toast.error("That subreddit is already on your radar.")
      } else if (msg.includes("INVALID_SUBREDDIT_NAME")) {
        toast.error("Enter a valid subreddit name without r/.")
      } else if (msg.includes("QUALITY_GATE:")) {
        const score = msg.split("QUALITY_GATE:")[1]
        toast.error(
          `r/${name} isn't relevant enough to your brand (score: ${score}/100). Try a subreddit closer to your niche.`
        )
      } else {
        toast.error("Failed to add subreddit. Please try again.")
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2">
      <span className="shrink-0 text-sm text-text-secondary">r/</span>
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") handleSubmit()
          if (e.key === "Escape") onDone()
        }}
        placeholder="Subreddit name (without r/)"
        className="h-7 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
        disabled={loading}
      />
      <Button
        variant="ghost"
        size="xs"
        onClick={handleSubmit}
        disabled={!value.trim() || loading}
        className="text-accent"
      >
        {loading ? "Adding…" : "Add"}
      </Button>
      <Button variant="ghost" size="icon-xs" onClick={onDone}>
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

function ManualSubredditNotice({ status }: { status: RadarStatus | undefined }) {
  if (status?.subredditDiscoveryStatus !== "needs_manual_subreddits") return null

  return (
    <p className="rounded-lg border border-border bg-muted/60 p-3 text-sm text-text-secondary">
      We need more info to build your radar. Add a few relevant subreddits manually to start daily recommendations.
    </p>
  )
}

// ---------- Main Page ----------

export default function RadarPage() {
  const subreddits = useQuery(api.subreddits.getSubreddits)
  const radarStatus = useQuery(api.subreddits.getRadarStatus)
  const toggleSubreddit = useMutation(api.subreddits.toggleSubreddit)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showAddInput, setShowAddInput] = useState(false)
  const [optimisticToggles, setOptimisticToggles] = useState<
    Record<string, boolean>
  >({})
  const [optimisticAdds, setOptimisticAdds] = useState<Subreddit[]>([])

  const selectedSub =
    [...(subreddits ?? []), ...optimisticAdds].find((s) => s._id === selectedId) ??
    null

  const handleToggle = useCallback(
    async (id: Id<"subreddits"> | string, newActive: boolean) => {
      if (String(id).startsWith("temp-")) return

      // Check minimum before optimistic update
      if (!newActive) {
        const currentActive =
          subreddits?.filter((s: Subreddit) => {
            const opt = optimisticToggles[s._id]
            return opt !== undefined ? opt : s.active
          }).length ?? 0

        if (currentActive <= 5) {
          toast.error(
            "You need at least 5 active subreddits for daily recommendations to work."
          )
          return
        }
      }

      // Optimistic update
      setOptimisticToggles((prev) => ({ ...prev, [id]: newActive }))

      try {
        await toggleSubreddit({ subredditId: id as Id<"subreddits">, active: newActive })
      } catch (err: unknown) {
        // Revert optimistic update
        setOptimisticToggles((prev) => {
          const next = { ...prev }
          delete next[id]
          return next
        })
        if (getErrorMessage(err).includes("MINIMUM_ACTIVE")) {
          toast.error(
            "You need at least 5 active subreddits for daily recommendations to work."
          )
        } else {
          toast.error("Failed to update subreddit. Please try again.")
        }
      }
    },
    [subreddits, optimisticToggles, toggleSubreddit]
  )

  // Apply optimistic toggles to render list
  const displayList = [
    ...(subreddits ?? []),
    ...optimisticAdds.filter(
      (optimistic) =>
        !(subreddits ?? []).some(
          (subreddit: Subreddit) =>
            subreddit._id === optimistic._id || subreddit.name === optimistic.name,
        ),
    ),
  ]
    .map((s) => ({
      ...s,
      active:
        optimisticToggles[s._id] !== undefined
          ? optimisticToggles[s._id]
          : s.active,
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1
      return b.relevanceScore - a.relevanceScore
    })

  const activeCount = displayList.filter((s) => s.active).length

  // Loading state
  if (subreddits === undefined) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-7 w-48 animate-pulse rounded bg-muted" />
          <div className="h-8 w-32 animate-pulse rounded bg-muted" />
        </div>
        <div className="space-y-1">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex h-14 items-center gap-3 rounded-lg px-3"
            >
              <Skeleton className="size-2 rounded-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="ml-auto h-3.5 w-16" />
              <Skeleton className="h-5 w-9 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  // Empty state
  if (subreddits.length === 0 && optimisticAdds.length === 0 && !showAddInput) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-text-primary">Radar</h1>
          <Button
            variant="ghost"
            size="sm"
            className="text-accent"
            onClick={() => setShowAddInput(true)}
          >
            <Plus className="size-4" data-icon="inline-start" />
            Add subreddit
          </Button>
        </div>
        <ManualSubredditNotice status={radarStatus} />
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-6 py-16 text-center">
          <p className="text-sm font-medium text-text-primary">
            Setting up your subreddits...
          </p>
          <p className="mt-2 max-w-md text-sm text-text-secondary">
            This usually takes a few minutes after onboarding. Refresh the page if it&apos;s been more than 10 minutes.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-text-primary">
          Radar{" "}
          <span className="text-base font-normal text-text-secondary">
            ({activeCount} active)
          </span>
        </h1>
        <Button
          variant="ghost"
          size="sm"
          className="text-accent"
          onClick={() => setShowAddInput(true)}
        >
          <Plus className="size-4" data-icon="inline-start" />
          Add subreddit
        </Button>
      </div>

      {/* Add input */}
      {showAddInput && (
        <AddSubredditInput
          onDone={() => setShowAddInput(false)}
          onOptimisticAdd={(subreddit) =>
            setOptimisticAdds((prev) => [subreddit, ...prev])
          }
          onOptimisticSuccess={(tempId, subreddit) =>
            setOptimisticAdds((prev) =>
              prev.map((item) => (item._id === tempId ? subreddit : item)),
            )
          }
          onOptimisticFailure={(tempId) =>
            setOptimisticAdds((prev) => prev.filter((item) => item._id !== tempId))
          }
        />
      )}
      <ManualSubredditNotice status={radarStatus} />

      {/* List */}
      <div className="space-y-0.5">
        {displayList?.map((sub) => (
          <SubredditRow
            key={sub._id}
            sub={sub}
            isSelected={selectedId === sub._id}
            onSelect={() =>
              setSelectedId(selectedId === sub._id ? null : sub._id)
            }
            onToggle={(active) => handleToggle(sub._id, active)}
          />
        ))}
      </div>

      {/* Detail panel */}
      {selectedSub && (
        <DetailPanel
          sub={selectedSub}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  )
}
