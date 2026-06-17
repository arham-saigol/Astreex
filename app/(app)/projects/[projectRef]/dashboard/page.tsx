"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useQuery } from "convex/react"
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ArrowUpRight, Download } from "lucide-react"

import { api } from "@/convex/_generated/api"
import { Button, buttonVariants } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type Timeframe = "7d" | "30d" | "all"
type Plan = "starter" | "growth" | "scale"
type HealthStatus = "healthy" | "warning" | "banned"

const timeframes: Array<{ label: string; value: Timeframe }> = [
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "All", value: "all" },
]

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength - 1).trimEnd()}...`
}

function timeAgo(timestamp: number) {
  const diff = Math.max(Date.now() - timestamp, 0)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function healthLabel(status: HealthStatus) {
  if (status === "warning") return "Warning"
  if (status === "banned") return "Banned"
  return "Healthy"
}

function previewTrendData() {
  return Array.from({ length: 7 }, (_, index) => ({
    period: `Day ${index + 1}`,
    karma: 0,
  }))
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

function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-36 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-[104px] rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-[344px] rounded-lg" />
      <Skeleton className="h-[360px] rounded-lg" />
    </div>
  )
}

function TimeframeSelector({
  value,
  onChange,
}: {
  value: Timeframe
  onChange: (value: Timeframe) => void
}) {
  return (
    <div className="flex rounded-full border border-border bg-surface p-1">
      {timeframes.map((timeframe) => {
        const active = timeframe.value === value

        return (
          <button
            key={timeframe.value}
            type="button"
            onClick={() => onChange(timeframe.value)}
            className={cn(
              "h-7 rounded-full px-3 font-sans text-[13px] font-medium leading-none text-text-secondary transition-colors",
              active
                ? "bg-accent-subtle text-accent"
                : "hover:bg-muted hover:text-text-primary",
            )}
          >
            {timeframe.label}
          </button>
        )
      })}
    </div>
  )
}

function MetricCard({
  label,
  value,
  isShimmering,
  healthStatus,
  mutedValue,
}: {
  label: string
  value: string | number
  isShimmering?: boolean
  healthStatus?: HealthStatus
  mutedValue?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div
        className={cn(
          "flex min-h-9 items-center gap-2 font-mono text-[28px] font-semibold leading-none text-text-primary",
          mutedValue && "text-text-tertiary",
          isShimmering && "animate-pulse",
        )}
      >
        {healthStatus ? <HealthDot status={healthStatus} /> : null}
        <span>{value}</span>
      </div>
      <p className="mt-3 font-sans text-[12px] font-medium uppercase text-text-secondary">
        {label}
      </p>
    </div>
  )
}

function Section({
  title,
  children,
  action,
}: {
  title: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <div className="flex min-h-8 items-center justify-between border-b border-border pb-2">
        <h2 className="font-sans text-[16px] font-semibold text-text-primary">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function GatedSection({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-surface">
      <div className="pointer-events-none opacity-45 blur-[2px]">{children}</div>
      <div className="absolute inset-0 flex items-center justify-center bg-surface/70 px-4 backdrop-blur-[4px]">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="font-sans text-[14px] font-semibold text-text-primary">
            Available on Growth plan
          </p>
          <Link href="../settings" className={buttonVariants({ size: "sm" })}>
            Upgrade
          </Link>
        </div>
      </div>
    </div>
  )
}

function TrendChart({
  data,
  isShimmering,
}: {
  data: Array<{ period: string; karma: number }>
  isShimmering?: boolean
}) {
  const isEmpty = data.every((point) => point.karma === 0)

  return (
    <div
      className={cn(
        "relative h-[300px] rounded-lg border border-border bg-surface px-2 py-4",
        isShimmering && "animate-pulse",
      )}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 18, bottom: 4, left: -18 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="period"
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--text-tertiary)", fontSize: 12 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--text-tertiary)", fontSize: 12 }}
            width={42}
          />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text-primary)",
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--text-secondary)" }}
          />
          <Line
            type="monotone"
            dataKey="karma"
            stroke="#E16259"
            strokeWidth={2}
            dot={{ r: 3, strokeWidth: 2, fill: "var(--surface)", stroke: "#E16259" }}
            activeDot={{ r: 5, fill: "#E16259", stroke: "var(--surface)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
      {isEmpty ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4">
          <p className="rounded-full bg-surface/85 px-3 py-1 text-[13px] text-text-tertiary">
            Data appears after your first week
          </p>
        </div>
      ) : null}
    </div>
  )
}

function ActivityList({
  items,
  isShimmering,
}: {
  items: Array<{
    id: string
    subreddit: string
    title: string
    score: number
    postedAt: number
    permalink: string
  }>
  isShimmering?: boolean
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-[14px] text-text-secondary">
        No posted content yet. Approve your first cards to see activity here.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <a
          key={item.id}
          href={item.permalink}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 rounded-lg px-2 py-2 transition-colors hover:bg-muted"
        >
          <span className="shrink-0 text-[14px] font-medium text-text-secondary">
            r/{item.subreddit}
          </span>
          <span className="text-text-tertiary">·</span>
          <span className="min-w-0 flex-1 truncate font-serif text-[15px] text-text-primary">
            {truncate(item.title, 40)}
          </span>
          <span
            className={cn(
              "shrink-0 font-mono text-[13px] text-text-secondary",
              isShimmering && "animate-pulse",
            )}
          >
            +{item.score}
          </span>
          <span className="hidden shrink-0 text-[13px] text-text-tertiary sm:inline">
            {timeAgo(item.postedAt)}
          </span>
          <ArrowUpRight className="size-3.5 shrink-0 text-text-tertiary" strokeWidth={1.5} />
        </a>
      ))}
    </div>
  )
}

function BestPerformingList({
  items,
  isShimmering,
}: {
  items: Array<{
    id: string
    subreddit: string
    score: number
    snippet: string
  }>
  isShimmering?: boolean
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center text-[14px] text-text-secondary">
        Best-performing posts appear after your first posts are live.
      </div>
    )
  }

  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={item.id} className="grid grid-cols-[24px_1fr] gap-3 rounded-lg px-2 py-2">
          <span className="font-mono text-[13px] text-text-tertiary">{index + 1}.</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[13px]">
              <span className="font-medium text-text-secondary">r/{item.subreddit}</span>
              <span className="text-text-tertiary">·</span>
              <span
                className={cn(
                  "font-mono text-text-secondary",
                  isShimmering && "animate-pulse",
                )}
              >
                +{item.score} pts
              </span>
            </div>
            <p className="mt-1 truncate font-serif text-[15px] text-text-primary">
              {truncate(item.snippet, 74)}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

export default function DashboardPage() {
  const [timeframe, setTimeframe] = useState<Timeframe | null>(null)
  const params = useParams<{ projectRef: string }>()
  const router = useRouter()
  const projectRef = params.projectRef

  const context = useQuery(api.analytics.getDashboardContext, { projectRef })

  useEffect(() => {
    if (context && context.projectRef !== projectRef) {
      router.replace(`/projects/${context.projectRef}/dashboard`)
    }
  }, [context, projectRef, router])

  const queryArgs = context && timeframe
    ? { projectRef: context.projectRef, timeframe }
    : "skip"

  const hasGrowthAnalytics = context?.plan === "growth" || context?.plan === "scale"
  const gatedQueryArgs = hasGrowthAnalytics ? queryArgs : "skip"

  const metrics = useQuery(api.analytics.getDashboardMetrics, queryArgs)
  const recentActivity = useQuery(api.analytics.getRecentActivity, queryArgs)
  const trendData = useQuery(api.analytics.getTrendData, gatedQueryArgs)
  const bestPerforming = useQuery(api.analytics.getBestPerforming, gatedQueryArgs)

  useEffect(() => {
    const stored = window.localStorage.getItem("astreex-dashboard-timeframe")
    const loadedTimeframe =
      stored === "7d" || stored === "30d" || stored === "all" ? stored : "30d"
    queueMicrotask(() => setTimeframe(loadedTimeframe))
  }, [])

  useEffect(() => {
    if (timeframe === null) return
    window.localStorage.setItem("astreex-dashboard-timeframe", timeframe)
  }, [timeframe])

  const showRefreshShimmer = false

  if (context === undefined || timeframe === null) {
    return <DashboardSkeleton />
  }

  if (context === null) {
    return (
      <div className="py-20 text-center">
        <h1 className="font-sans text-[24px] font-semibold text-text-primary">
          Dashboard
        </h1>
        <p className="mt-2 text-[14px] text-text-secondary">
          Complete onboarding to create your first project.
        </p>
      </div>
    )
  }

  if (
    metrics === undefined ||
    recentActivity === undefined ||
    (hasGrowthAnalytics && (trendData === undefined || bestPerforming === undefined))
  ) {
    return <DashboardSkeleton />
  }

  const plan = context.plan as Plan
  const displayedTrendData = trendData ?? previewTrendData()
  const displayedBestPerforming = bestPerforming ?? []

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-sans text-[24px] font-semibold text-text-primary">
          Dashboard
        </h1>
        <div className="flex items-center gap-2">
          {plan === "scale" ? (
            <Button variant="outline" size="sm" className="gap-1.5" disabled>
              <Download className="size-3.5" />
              Export CSV
            </Button>
          ) : null}
          <TimeframeSelector value={timeframe} onChange={setTimeframe} />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Posts"
          value={metrics.postsCount}
          mutedValue={metrics.postsCount === 0}
        />
        <MetricCard
          label="Approval rate"
          value={`${metrics.approvalRate}%`}
          mutedValue={metrics.approvalRate === 0}
        />
        <MetricCard
          label="Karma earned"
          value={`+${metrics.karmaEarned}`}
          isShimmering={showRefreshShimmer}
          mutedValue={metrics.karmaEarned === 0}
        />
        <MetricCard
          label="Account health"
          value={healthLabel(metrics.healthStatus)}
          healthStatus={metrics.healthStatus}
        />
      </div>

      <Section title="Engagement Trend">
        {hasGrowthAnalytics ? (
          <TrendChart data={displayedTrendData} isShimmering={showRefreshShimmer} />
        ) : (
          <GatedSection>
            <TrendChart data={displayedTrendData} isShimmering={showRefreshShimmer} />
          </GatedSection>
        )}
      </Section>

      <Section title="Recent Activity">
        <ActivityList items={recentActivity} isShimmering={showRefreshShimmer} />
      </Section>

      <Section title="Best Performing">
        {hasGrowthAnalytics ? (
          <BestPerformingList items={displayedBestPerforming} isShimmering={showRefreshShimmer} />
        ) : (
          <GatedSection>
            <div className="p-4">
              <BestPerformingList
                items={displayedBestPerforming}
                isShimmering={showRefreshShimmer}
              />
            </div>
          </GatedSection>
        )}
      </Section>
    </div>
  )
}
