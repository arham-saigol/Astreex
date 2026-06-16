import { v } from "convex/values"
import { internal } from "../_generated/api"
import {
  internalAction,
  internalMutation,
} from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import type { Plan } from "../lib/planLimits"
import type {
  FetchedPost,
  ReplyDraft,
  ReplyOpportunity,
  ScoutedPost,
  SurfacedPostCandidate,
} from "./validators"

const countsValidator = v.object({
  fetchedPosts: v.optional(v.number()),
  newPosts: v.optional(v.number()),
  storedPosts: v.optional(v.number()),
  scoutedPosts: v.optional(v.number()),
  opportunityShards: v.optional(v.number()),
  replyOpportunities: v.optional(v.number()),
  replyDrafts: v.optional(v.number()),
  selectedReplies: v.optional(v.number()),
  filteredPosts: v.optional(v.number()),
  drafts: v.optional(v.number()),
  selectedCards: v.optional(v.number()),
  createdCards: v.optional(v.number()),
})

type PipelineCounts = {
  fetchedPosts?: number
  newPosts?: number
  storedPosts?: number
  scoutedPosts?: number
  opportunityShards?: number
  replyOpportunities?: number
  replyDrafts?: number
  selectedReplies?: number
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

      for (let index = 0; index < fetchedPosts.length; index += 100) {
        const stored: { storedPosts: number; newPosts: number } = await ctx.runMutation(
          internal.pipeline.storePosts.storeFetchedPosts,
          {
            projectId: args.projectId,
            posts: fetchedPosts.slice(index, index + 100),
          },
        )
        counts.storedPosts = (counts.storedPosts ?? 0) + stored.storedPosts
        counts.newPosts = (counts.newPosts ?? 0) + stored.newPosts
      }

      const candidateGroups: Array<{
        subreddit: string
        candidates: SurfacedPostCandidate[]
      }> = await ctx.runQuery(
        internal.pipeline.data.loadRecentUncardedCandidates,
        { projectId: args.projectId },
      )
      const candidateCount = candidateGroups.reduce(
        (total, group) => total + group.candidates.length,
        0,
      )

      if (candidateCount === 0) {
        await ctx.runMutation(
          internal.pipeline.orchestrator.markPipelineRunSkipped,
          {
            runId,
            reason: "no_recent_posts",
            counts,
          },
        )
        return { status: "skipped", reason: "no_recent_posts", counts }
      }

      const scoutSettlements = await Promise.allSettled(candidateGroups.map((group) =>
        ctx.runAction(internal.pipeline.subredditScout.runSubredditScout, {
          projectId: args.projectId,
          subreddit: group.subreddit,
          candidates: group.candidates,
        }),
      ))
      const scoutResults = scoutSettlements
        .filter((result): result is PromiseFulfilledResult<ScoutedPost[]> =>
          result.status === "fulfilled",
        )
        .map((result) => result.value)
      if (scoutResults.length === 0) {
        throw new Error("All subreddit scout actions failed")
      }
      const scoutedPosts: ScoutedPost[] = scoutResults.flat()
      counts.scoutedPosts = scoutedPosts.length

      if (scoutedPosts.length === 0) {
        await ctx.runMutation(
          internal.pipeline.orchestrator.markPipelineRunSkipped,
          {
            runId,
            reason: "no_scouted_posts",
            counts,
          },
        )
        return { status: "skipped", reason: "no_scouted_posts", counts }
      }

      const opportunityResult: {
        opportunities: ReplyOpportunity[]
        shardCount: number
      } = await ctx.runAction(
        internal.pipeline.opportunityJudges.selectReplyOpportunities,
        {
          projectId: args.projectId,
          scoutedPosts,
        },
      )
      counts.opportunityShards = opportunityResult.shardCount
      counts.replyOpportunities = opportunityResult.opportunities.length

      if (opportunityResult.opportunities.length === 0) {
        await ctx.runMutation(
          internal.pipeline.orchestrator.markPipelineRunSkipped,
          {
            runId,
            reason: "no_reply_opportunities",
            counts,
          },
        )
        return { status: "skipped", reason: "no_reply_opportunities", counts }
      }

      const replyDrafts: ReplyDraft[] = await ctx.runAction(
        internal.pipeline.draftOrchestrator.generateReplyDrafts,
        {
          projectId: args.projectId,
          opportunities: opportunityResult.opportunities,
        },
      )
      counts.replyDrafts = replyDrafts.length
      counts.drafts = replyDrafts.length

      if (replyDrafts.length === 0) {
        await ctx.runMutation(
          internal.pipeline.orchestrator.markPipelineRunSkipped,
          {
            runId,
            reason: "no_reply_drafts",
            counts,
          },
        )
        return { status: "skipped", reason: "no_reply_drafts", counts }
      }

      const selectedReplies: ReplyDraft[] = await ctx.runAction(
        internal.pipeline.replySelectionAgent.selectFinalReplies,
        {
          projectId: args.projectId,
          drafts: replyDrafts,
        },
      )
      counts.selectedReplies = selectedReplies.length
      counts.selectedCards = selectedReplies.length

      if (selectedReplies.length === 0) {
        await ctx.runMutation(
          internal.pipeline.orchestrator.markPipelineRunSkipped,
          {
            runId,
            reason: "no_selected_replies",
            counts,
          },
        )
        return { status: "skipped", reason: "no_selected_replies", counts }
      }

      const created: { created: number; skipped: boolean } = await ctx.runMutation(
        internal.pipeline.createCards.createDailyReplyCards,
        {
          projectId: args.projectId,
          runId,
          selectedDrafts: selectedReplies,
        },
      )
      counts.createdCards = created.created

      if (created.skipped) {
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
