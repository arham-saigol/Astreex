import { v } from "convex/values"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { getPlanLimits } from "./lib/planLimits"

const planValidator = v.union(
  v.literal("starter"),
  v.literal("growth"),
  v.literal("scale"),
)
const intervalValidator = v.union(v.literal("monthly"), v.literal("annual"))
const billingStatusValidator = v.union(
  v.literal("active"),
  v.literal("canceled"),
  v.literal("past_due"),
)

type Plan = "starter" | "growth" | "scale"
type BillingInterval = "monthly" | "annual"

async function getCurrentUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new Error("Not authenticated")

  const user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique()
  if (!user) throw new Error("User not found")

  return user
}

async function getCurrentProject(ctx: QueryCtx) {
  const user = await getCurrentUser(ctx)
  return await ctx.db
    .query("projects")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .first()
}

async function getOwnedProject(
  ctx: QueryCtx,
  projectId: Id<"projects">,
) {
  const user = await getCurrentUser(ctx)
  const project = await ctx.db.get(projectId)

  if (!project || project.userId !== user._id) {
    throw new Error("Not authorized")
  }

  return project
}

async function projectUsage(ctx: QueryCtx | MutationCtx, projectId: Id<"projects">) {
  const subreddits = await ctx.db
    .query("subreddits")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(500)
  const redditAccounts = await ctx.db
    .query("redditAccounts")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(100)

  return {
    activeSubreddits: subreddits.filter((subreddit) => subreddit.active).length,
    disabledSubreddits: subreddits.filter((subreddit) => !subreddit.active).length,
    activeRedditAccounts: redditAccounts.filter((account) => account.isActive).length,
    disabledRedditAccounts: redditAccounts.filter((account) => !account.isActive).length,
  }
}

function accountHealthRank(account: Doc<"redditAccounts">) {
  if (account.healthStatus === "healthy") return 0
  if (account.healthStatus === "warning") return 1
  return 2
}

async function enforceDowngradeLimits(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  plan: Plan,
) {
  const limits = getPlanLimits(plan)
  const activeSubreddits = await ctx.db
    .query("subreddits")
    .withIndex("by_projectId_active", (q) =>
      q.eq("projectId", projectId).eq("active", true),
    )
    .take(500)
  activeSubreddits.sort((a, b) => {
    if (a.relevanceScore !== b.relevanceScore) {
      return b.relevanceScore - a.relevanceScore
    }
    return a._creationTime - b._creationTime
  })

  for (const subreddit of activeSubreddits.slice(limits.maxSubreddits)) {
    await ctx.db.patch(subreddit._id, { active: false })
  }

  const activeAccounts = await ctx.db
    .query("redditAccounts")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .take(100)
  const excessAccounts = activeAccounts
    .filter((account) => account.isActive)
    .sort((a, b) => {
      const health = accountHealthRank(a) - accountHealthRank(b)
      if (health !== 0) return health
      return a.createdAt - b.createdAt
    })
    .slice(limits.maxRedditAccounts)

  for (const account of excessAccounts) {
    await ctx.db.patch(account._id, { isActive: false })
  }

  const profile = await ctx.db
    .query("projectIntelligenceProfiles")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
    .first()
  if (profile && profile.competitorUrls.length > limits.maxCompetitors) {
    await ctx.db.patch(profile._id, {
      competitorUrls: profile.competitorUrls.slice(0, limits.maxCompetitors),
      updatedAt: Date.now(),
    })
  }
}

function billingPatch(args: {
  customerId?: string
  subscriptionId?: string
  plan?: Plan
  interval?: BillingInterval
  planStatus?: "active" | "canceled" | "past_due"
  cancelAtPeriodEnd?: boolean
}) {
  const patch: Partial<Doc<"projects">> = {}

  if (args.customerId) patch.creemCustomerId = args.customerId
  if (args.subscriptionId) patch.creemSubscriptionId = args.subscriptionId
  if (args.plan) patch.plan = args.plan
  if (args.interval) patch.billingInterval = args.interval
  if (args.planStatus) patch.planStatus = args.planStatus
  if (args.cancelAtPeriodEnd !== undefined) {
    patch.cancelAtPeriodEnd = args.cancelAtPeriodEnd
  }

  return patch
}

async function findWebhookProject(
  ctx: MutationCtx,
  args: {
    projectId?: string
    customerId?: string
    subscriptionId?: string
  },
) {
  if (args.subscriptionId) {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_creemSubscriptionId", (q) =>
        q.eq("creemSubscriptionId", args.subscriptionId),
      )
      .first()
    if (project) return project
  }

  if (args.customerId) {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_creemCustomerId", (q) =>
        q.eq("creemCustomerId", args.customerId),
      )
      .first()
    if (project) return project
  }

  if (args.projectId) {
    return await ctx.db.get(args.projectId as Id<"projects">)
  }

  return null
}

export const getProjectBillingStatus = query({
  args: {},
  handler: async (ctx) => {
    const project = await getCurrentProject(ctx)
    if (!project) return null

    const limits = getPlanLimits(project.plan)
    const usage = await projectUsage(ctx, project._id)

    return {
      projectId: project._id,
      plan: project.plan,
      planStatus: project.planStatus,
      billingInterval: project.billingInterval ?? null,
      cancelAtPeriodEnd: project.cancelAtPeriodEnd ?? false,
      trialEndsAt: project.trialEndsAt ?? null,
      hasCreemCustomer: !!project.creemCustomerId,
      creemCustomerId: project.creemCustomerId ?? null,
      limits,
      usage,
      disabledCounts: {
        subreddits: usage.disabledSubreddits,
        redditAccounts: usage.disabledRedditAccounts,
      },
      exceeded: {
        subreddits: usage.activeSubreddits > limits.maxSubreddits,
        redditAccounts: usage.activeRedditAccounts > limits.maxRedditAccounts,
      },
    }
  },
})

export const getCheckoutProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await getOwnedProject(ctx, args.projectId)

    return {
      projectId: project._id,
      name: project.name,
      plan: project.plan,
      planStatus: project.planStatus,
      creemCustomerId: project.creemCustomerId ?? null,
    }
  },
})

export const getPortalProject = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await getOwnedProject(ctx, args.projectId)
    if (!project.creemCustomerId) {
      throw new Error("No Creem customer exists for this project")
    }

    return {
      projectId: project._id,
      creemCustomerId: project.creemCustomerId,
    }
  },
})

export const handleCreemWebhook = mutation({
  args: {
    secret: v.string(),
    eventType: v.string(),
    projectId: v.optional(v.string()),
    customerId: v.optional(v.string()),
    subscriptionId: v.optional(v.string()),
    productId: v.optional(v.string()),
    plan: v.optional(planValidator),
    interval: v.optional(intervalValidator),
    status: v.optional(billingStatusValidator),
  },
  handler: async (ctx, args) => {
    const webhookSecret = process.env.CREEM_WEBHOOK_SECRET
    if (!webhookSecret || args.secret !== webhookSecret) {
      throw new Error("Invalid webhook secret")
    }

    const project = await findWebhookProject(ctx, args)
    if (!project) {
      return { handled: false, reason: "project_not_found" }
    }

    const activePatch = {
      customerId: args.customerId,
      subscriptionId: args.subscriptionId,
      plan: args.plan,
      interval: args.interval,
      planStatus: "active" as const,
      cancelAtPeriodEnd: false,
    }

    if (args.eventType === "checkout.completed") {
      await ctx.db.patch(project._id, billingPatch(activePatch))
      if (args.plan) await enforceDowngradeLimits(ctx, project._id, args.plan)
      return { handled: true }
    }

    if (
      args.eventType === "subscription.active" ||
      args.eventType === "subscription.paid"
    ) {
      await ctx.db.patch(project._id, billingPatch(activePatch))
      if (args.plan) await enforceDowngradeLimits(ctx, project._id, args.plan)
      return { handled: true }
    }

    if (args.eventType === "subscription.scheduled_cancel") {
      await ctx.db.patch(project._id, billingPatch({
        customerId: args.customerId,
        subscriptionId: args.subscriptionId,
        plan: args.plan,
        interval: args.interval,
        planStatus: "active",
        cancelAtPeriodEnd: true,
      }))
      if (args.plan) await enforceDowngradeLimits(ctx, project._id, args.plan)
      return { handled: true }
    }

    if (
      args.eventType === "subscription.canceled" ||
      args.eventType === "subscription.expired"
    ) {
      await ctx.db.patch(project._id, billingPatch({
        customerId: args.customerId,
        subscriptionId: args.subscriptionId,
        planStatus: "canceled",
        cancelAtPeriodEnd: false,
      }))
      return { handled: true }
    }

    if (args.eventType === "subscription.past_due") {
      await ctx.db.patch(project._id, billingPatch({
        customerId: args.customerId,
        subscriptionId: args.subscriptionId,
        planStatus: "past_due",
        cancelAtPeriodEnd: false,
      }))
      return { handled: true }
    }

    if (args.status) {
      await ctx.db.patch(project._id, billingPatch({
        customerId: args.customerId,
        subscriptionId: args.subscriptionId,
        plan: args.plan,
        interval: args.interval,
        planStatus: args.status,
        cancelAtPeriodEnd: args.status === "active" ? false : undefined,
      }))
      if (args.plan) await enforceDowngradeLimits(ctx, project._id, args.plan)
      return { handled: true }
    }

    return { handled: false, reason: "unsupported_event" }
  },
})

export const expireTrialIfNeeded = internalMutation({
  args: {
    projectId: v.id("projects"),
    now: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    const now = args.now ?? Date.now()

    if (
      project?.planStatus === "trialing" &&
      project.trialEndsAt !== undefined &&
      project.trialEndsAt < now
    ) {
      await ctx.db.patch(args.projectId, { planStatus: "trial_expired" })
      return { expired: true }
    }

    return { expired: false }
  },
})
