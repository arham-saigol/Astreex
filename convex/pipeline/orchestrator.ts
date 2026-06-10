import { v } from "convex/values"
import { internal } from "../_generated/api"
import {
  internalAction,
  internalMutation,
} from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import type { Plan } from "../lib/planLimits"
import type { Draft, FetchedPost } from "./validators"

const countsValidator = v.object({
  fetchedPosts: v.optional(v.number()),
  newPosts: v.optional(v.number()),
  filteredPosts: v.optional(v.number()),
  drafts: v.optional(v.number()),
  selectedCards: v.optional(v.number()),
  createdCards: v.optional(v.number()),
})

type PipelineCounts = {
  fetchedPosts?: number
  newPosts?: number
  filteredPosts?: number
  drafts?: number
  selectedCards?: number
  createdCards?: number
}

type RunStart =
  | { shouldRun: false; status: string }
  | { shouldRun: true; runId: Id<"pipelineRuns"> }

type Readiness =
  | { ready: false; reason: string }
  | {
      ready: true
      project: { _id: Id<"projects">; plan: Plan; timezone: string }
      brand: { profileJson: string }
    }

type PipelineResult = {
  status: string
  skipped?: boolean
  reason?: string
  counts?: PipelineCounts
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export const startPipelineRun = internalMutation({
  args: {
    projectId: v.id("projects"),
    localDate: v.string(),
  },
  handler: async (ctx, args): Promise<RunStart> => {
    const now = Date.now()
    const existing = await ctx.db
      .query("pipelineRuns")
      .withIndex("by_projectId_and_localDate", (q) =>
        q.eq("projectId", args.projectId).eq("localDate", args.localDate),
      )
      .first()

    if (existing?.status === "running" || existing?.status === "completed") {
      return { shouldRun: false, status: existing.status }
    }

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: "running",
        startedAt: now,
      })
      return { shouldRun: true, runId: existing._id }
    }

    const runId = await ctx.db.insert("pipelineRuns", {
      projectId: args.projectId,
      localDate: args.localDate,
      status: "running",
      startedAt: now,
    })
    return { shouldRun: true, runId }
  },
})

export const markPipelineRunSkipped = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    reason: v.string(),
    counts: v.optional(countsValidator),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: "skipped",
      finishedAt: Date.now(),
      error: args.reason,
      counts: args.counts,
    })
  },
})

export const markPipelineRunCompleted = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    counts: countsValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: "completed",
      finishedAt: Date.now(),
      counts: args.counts,
    })
  },
})

export const markPipelineRunFailed = internalMutation({
  args: {
    runId: v.id("pipelineRuns"),
    error: v.string(),
    counts: v.optional(countsValidator),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: "failed",
      finishedAt: Date.now(),
      error: args.error,
      counts: args.counts,
    })
  },
})

export const runDailyPipeline = internalAction({
  args: {
    projectId: v.id("projects"),
    localDate: v.string(),
  },
  handler: async (ctx, args): Promise<PipelineResult> => {
    const trial = await ctx.runMutation(internal.billing.expireTrialIfNeeded, {
      projectId: args.projectId,
    })
    if (trial.expired) {
      return { status: "skipped", skipped: true, reason: "trial_expired" }
    }

    const started: RunStart = await ctx.runMutation(
      internal.pipeline.orchestrator.startPipelineRun,
      args,
    )

    if (!started.shouldRun) {
      return { status: started.status, skipped: true }
    }

    const runId = started.runId as Id<"pipelineRuns">
    const counts: PipelineCounts = {}

    try {
      const readiness: Readiness = await ctx.runQuery(
        internal.pipeline.data.getProjectReadiness,
        { projectId: args.projectId },
      )

      if (!readiness.ready) {
        await ctx.runMutation(
          internal.pipeline.orchestrator.markPipelineRunSkipped,
          {
            runId,
            reason: readiness.reason,
            counts,
          },
        )
        return { status: "skipped", reason: readiness.reason, counts }
      }

      const fetchedPosts: FetchedPost[] = await ctx.runAction(
        internal.pipeline.fetchPosts.fetchRedditPosts,
        { projectId: args.projectId },
      )
      counts.fetchedPosts = fetchedPosts.length

      const newPostIds: Array<Id<"surfacedPosts">> = []
      for (let index = 0; index < fetchedPosts.length; index += 100) {
        const insertedIds: Array<Id<"surfacedPosts">> = await ctx.runMutation(
          internal.pipeline.storePosts.storeNewPosts,
          {
            projectId: args.projectId,
            posts: fetchedPosts.slice(index, index + 100),
          },
        )
        newPostIds.push(...insertedIds)
      }
      counts.newPosts = newPostIds.length

      if (newPostIds.length === 0) {
        await ctx.runMutation(
          internal.pipeline.orchestrator.markPipelineRunSkipped,
          {
            runId,
            reason: "no_new_posts",
            counts,
          },
        )
        return { status: "skipped", reason: "no_new_posts", counts }
      }

      const filteredPostIds: Array<Id<"surfacedPosts">> = await ctx.runAction(
        internal.pipeline.filterAgent.filterPosts,
        {
          projectId: args.projectId,
          surfacedPostIds: newPostIds,
        },
      )
      counts.filteredPosts = filteredPostIds.length

      const drafts: Draft[] = await ctx.runAction(
        internal.pipeline.draftOrchestrator.generateAllDrafts,
        {
          projectId: args.projectId,
          filteredPostIds,
        },
      )
      counts.drafts = drafts.length

      const selectedDrafts: Draft[] = await ctx.runAction(
        internal.pipeline.judgeAgent.selectCards,
        {
          projectId: args.projectId,
          drafts,
        },
      )
      counts.selectedCards = selectedDrafts.length

      if (selectedDrafts.length === 0) {
        await ctx.runMutation(
          internal.pipeline.orchestrator.markPipelineRunSkipped,
          {
            runId,
            reason: "no_selected_drafts",
            counts,
          },
        )
        return { status: "skipped", reason: "no_selected_drafts", counts }
      }

      const created: { created: number; skipped: boolean } = await ctx.runMutation(
        internal.pipeline.createCards.createDailyCards,
        {
          projectId: args.projectId,
          selectedDrafts,
        },
      )
      counts.createdCards = created.created

      if (created.created === 0) {
        await ctx.runMutation(
          internal.pipeline.orchestrator.markPipelineRunSkipped,
          {
            runId,
            reason: "no_active_reddit_accounts",
            counts,
          },
        )
        return { status: "skipped", reason: "no_active_reddit_accounts", counts }
      }

      await ctx.runMutation(
        internal.pipeline.orchestrator.markPipelineRunCompleted,
        { runId, counts },
      )
      return { status: "completed", counts }
    } catch (error) {
      await ctx.runMutation(
        internal.pipeline.orchestrator.markPipelineRunFailed,
        {
          runId,
          error: errorMessage(error),
          counts,
        },
      )
      throw error
    }
  },
})
