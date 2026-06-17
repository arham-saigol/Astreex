import { v } from "convex/values"
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { requireAuthenticatedUser, requireOwnedProject } from "./lib/auth"
import { getPlanLimits } from "./lib/planLimits"
import { reconcileProjectIntelligenceUrls } from "./lib/projectIntelligenceReconciliation"
import { normalizeHttpUrl, normalizeOptionalHttpUrls } from "./lib/urls"

const intelligenceJsonValidator = v.string()
const stringFields = ["overview", "positioning"] as const
const arrayFields = [
  "capabilities",
  "icps",
  "personas",
  "painPoints",
  "pricingAndCompetitorComparisons",
  "whereProjectLeads",
  "whereCompetitorsLead",
  "weaknesses",
  "futureAdvantages",
  "redditUsefulAngles",
  "avoidTopics",
  "agentNotes",
] as const

function validateProjectIntelligenceJson(value: string) {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error("Project intelligence must be valid JSON")
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Project intelligence must be an object")
  }

  const record = parsed as Record<string, unknown>
  for (const field of stringFields) {
    if (typeof record[field] !== "string") {
      throw new Error(`Project intelligence field ${field} must be a string`)
    }
  }
  for (const field of arrayFields) {
    if (!Array.isArray(record[field]) || !record[field].every((item) => typeof item === "string")) {
      throw new Error(`Project intelligence field ${field} must be a string array`)
    }
  }
}

async function getCurrentUser(ctx: QueryCtx | MutationCtx) {
  return await requireAuthenticatedUser(ctx)
}

async function getOwnedProject(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
) {
  return await requireOwnedProject(ctx, projectId)
}

async function getCurrentProject(ctx: QueryCtx) {
  const user = await getCurrentUser(ctx)
  const project = await ctx.db
    .query("projects")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .first()

  if (!project) return null

  return { user, project }
}

async function deleteProjectRows(
  ctx: MutationCtx,
  projectId: Id<"projects">,
) {
  const tables = [
    "projectIntelligenceChangeEvents",
    "monitoredPageSnapshots",
    "monitoredPages",
    "projectIntelligenceBuilds",
    "postedContent",
    "cards",
    "surfacedPosts",
    "redditSubredditAccess",
    "subreddits",
    "redditAccounts",
    "projectIntelligenceProfiles",
  ] as const

  let deletedRows = 0

  for (const table of tables) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .take(100)

    for (const row of rows) {
      await ctx.db.delete(row._id)
      deletedRows++
    }
  }

  return deletedRows
}

async function hasProjectRows(ctx: MutationCtx, projectId: Id<"projects">) {
  const tables = [
    "projectIntelligenceChangeEvents",
    "monitoredPageSnapshots",
    "monitoredPages",
    "projectIntelligenceBuilds",
    "postedContent",
    "cards",
    "surfacedPosts",
    "redditSubredditAccess",
    "subreddits",
    "redditAccounts",
    "projectIntelligenceProfiles",
  ] as const

  for (const table of tables) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .take(1)

    if (rows.length > 0) return true
  }

  return false
}

async function runDeleteProjectBatch(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  userId: Id<"users">,
) {
  const project = await ctx.db.get(projectId)
  if (!project) return { status: "deleted" as const }

  if (project.userId !== userId) {
    throw new Error("Not authorized")
  }

  if (project.planStatus !== "canceled" && project.creemCustomerId) {
    throw new Error("Cancel your plan before deleting this project")
  }

  await deleteProjectRows(ctx, projectId)

  if (await hasProjectRows(ctx, projectId)) {
    await ctx.scheduler.runAfter(0, internal.settings.deleteProjectBatch, {
      projectId,
      userId,
    })
    return { status: "queued" as const }
  }

  await ctx.db.delete(projectId)
  return { status: "deleted" as const }
}

export const getSettingsContext = query({
  args: {},
  handler: async (ctx) => {
    const current = await getCurrentProject(ctx)
    if (!current) return null

    const { user, project } = current
    const brand = await ctx.db
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .first()
    const runningBuild = await ctx.db
      .query("projectIntelligenceBuilds")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .order("desc")
      .take(10)
      .then((builds) => builds.find((build) => build.status === "running"))

    const redditAccounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(20)
    const limits = getPlanLimits(project.plan)

    return {
      user: {
        name: user.name ?? "",
        email: user.email,
        avatarUrl: user.avatarUrl ?? null,
      },
      project: {
        _id: project._id,
        name: project.name,
        plan: project.plan,
        planStatus: project.planStatus,
        onboardingStatus: project.onboardingStatus ?? null,
        onboardingError: project.onboardingError ?? null,
        onboardingAnalysisStartedAt: runningBuild?.startedAt ?? null,
        createdAt: project.createdAt,
        trialEndsAt: project.trialEndsAt ?? null,
        billingInterval: project.billingInterval ?? null,
        cancelAtPeriodEnd: project.cancelAtPeriodEnd ?? false,
        hasCreemCustomer: !!project.creemCustomerId,
        accountLimit: limits.maxRedditAccounts,
        limits,
      },
      brand: brand
        ? {
            _id: brand._id,
            websiteUrl: brand.websiteUrl,
            competitorUrls: brand.competitorUrls,
            intelligenceJson: brand.intelligenceJson,
            scrapeStatus: brand.scrapeStatus ?? null,
          }
        : null,
      redditAccounts: redditAccounts.map((account) => ({
        _id: account._id,
        redditUsername: account.redditUsername,
        healthStatus: account.healthStatus,
        isActive: account.isActive,
        activityStatus: account.activityStatus ?? "warmup",
        totalKarma: account.totalKarma ?? null,
        postKarma: account.postKarma ?? null,
        commentKarma: account.commentKarma ?? null,
        accountCreatedAt: account.accountCreatedAt ?? null,
        activityCheckedAt: account.activityCheckedAt ?? null,
        warmupSince: account.warmupSince ?? null,
        activityIssues: account.activityIssues ?? [],
        createdAt: account.createdAt,
      })),
    }
  },
})

export const updateUserName = mutation({
  args: {
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx)
    const name = args.name.trim()

    if (!name) throw new Error("Name is required")

    await ctx.db.patch(user._id, { name })
  },
})

export const updateProjectIntelligenceProfile = mutation({
  args: {
    projectId: v.id("projects"),
    intelligenceJson: intelligenceJsonValidator,
  },
  handler: async (ctx, args) => {
    await getOwnedProject(ctx, args.projectId)

    const brand = await ctx.db
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand) throw new Error("Project intelligence profile not found")

    validateProjectIntelligenceJson(args.intelligenceJson)
    await ctx.db.patch(brand._id, {
      intelligenceJson: args.intelligenceJson,
      updatedAt: Date.now(),
    })
  },
})

export const updateProjectIntelligenceUrls = mutation({
  args: {
    projectId: v.id("projects"),
    websiteUrl: v.string(),
    competitorUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const project = await getOwnedProject(ctx, args.projectId)

    const websiteUrl = normalizeHttpUrl(args.websiteUrl, "Website URL")
    const competitorUrls = normalizeOptionalHttpUrls(
      args.competitorUrls,
      "Competitor URL",
    )
    const competitorLimit = getPlanLimits(project.plan).maxCompetitors
    if (competitorUrls.length > competitorLimit) {
      throw new Error(`Your plan supports up to ${competitorLimit} tracked competitors`)
    }

    const brand = await ctx.db
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand) throw new Error("Project intelligence profile not found")

    await ctx.db.patch(brand._id, {
      websiteUrl,
      competitorUrls,
      updatedAt: Date.now(),
    })

    await reconcileProjectIntelligenceUrls(ctx, {
      projectId: args.projectId,
      profileId: brand._id,
      previousWebsiteUrl: brand.websiteUrl,
      nextWebsiteUrl: websiteUrl,
      previousCompetitorUrls: brand.competitorUrls,
      nextCompetitorUrls: competitorUrls,
    })
  },
})

export const retryOnboardingPipeline = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await getOwnedProject(ctx, args.projectId)

    await ctx.db.patch(args.projectId, {
      onboardingStatus: "running",
      onboardingError: undefined,
      lastActiveAt: Date.now(),
    })

    await ctx.scheduler.runAfter(0, internal.onboarding.pipeline.runOnboardingPipeline, {
      projectId: args.projectId,
    })

    return { queued: true }
  },
})

export const reanalyzeProjectIntelligenceProfile = mutation({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    await getOwnedProject(ctx, args.projectId)

    const brand = await ctx.db
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .first()
    if (!brand) throw new Error("Project intelligence profile not found")

    const now = Date.now()
    await ctx.db.patch(brand._id, {
      intelligenceJson: "{}",
      updatedAt: now,
    })
    await ctx.db.patch(args.projectId, {
      onboardingStatus: "running",
      onboardingError: undefined,
      lastActiveAt: now,
    })

    await ctx.scheduler.runAfter(0, internal.onboarding.pipeline.runOnboardingPipeline, {
      projectId: args.projectId,
    })

    return { queued: true }
  },
})

export const disconnectRedditAccount = mutation({
  args: {
    redditAccountId: v.id("redditAccounts"),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.redditAccountId)
    if (!account) throw new Error("Reddit account not found")

    await getOwnedProject(ctx, account.projectId)
    await ctx.db.delete(args.redditAccountId)
  },
})

export const deleteProject = mutation({
  args: {
    projectId: v.id("projects"),
    confirmation: v.string(),
  },
  handler: async (ctx, args) => {
    const project = await getOwnedProject(ctx, args.projectId)

    if (args.confirmation !== "DELETE PROJECT") {
      throw new Error("Confirmation does not match")
    }

    if (project.planStatus !== "canceled" && project.creemCustomerId) {
      throw new Error("Cancel your plan before deleting this project")
    }

    return await runDeleteProjectBatch(ctx, args.projectId, project.userId)
  },
})

export const deleteProjectBatch = internalMutation({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    await runDeleteProjectBatch(ctx, args.projectId, args.userId)
  },
})
