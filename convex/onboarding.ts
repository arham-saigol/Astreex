import { v } from "convex/values"
import { internal } from "./_generated/api"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { getPlanLimits } from "./lib/planLimits"
import { normalizeHttpUrl, normalizeOptionalHttpUrls } from "./lib/urls"

type Plan = "starter" | "growth" | "scale"

const planValidator = v.union(
  v.literal("starter"),
  v.literal("growth"),
  v.literal("scale"),
)

async function getOrCreateUser(ctx: MutationCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) {
    throw new Error("Not authenticated")
  }

  let user = await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique()

  if (!user) {
    const userId = await ctx.db.insert("users", {
      clerkId: identity.subject,
      email: identity.email ?? "",
      name: identity.name,
      avatarUrl: identity.pictureUrl,
      createdAt: Date.now(),
    })
    user = (await ctx.db.get(userId))!
  }

  return user
}

async function getCurrentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return null

  return await ctx.db
    .query("users")
    .withIndex("by_clerkId", (q) => q.eq("clerkId", identity.subject))
    .unique()
}

async function getUserProjects(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  return await ctx.db
    .query("projects")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(20)
}

function isCompleteProject(project: Doc<"projects">) {
  return project.onboardingStatus !== "in_progress"
}

function planAccountLimit(plan: Plan) {
  return getPlanLimits(plan).maxRedditAccounts
}

type PrepareProjectArgs = {
  projectName: string
  websiteUrl: string
  competitorUrls?: string[]
  plan: Plan
  timezone: string
}

async function prepareProject(ctx: MutationCtx, args: PrepareProjectArgs) {
  const user = await getOrCreateUser(ctx)
  const projectName = args.projectName.trim()
  const websiteUrl = normalizeHttpUrl(args.websiteUrl, "Website URL")
  const competitorUrls = normalizeOptionalHttpUrls(
    args.competitorUrls,
    "Competitor URL",
  )
  const competitorLimit = getPlanLimits(args.plan).maxCompetitors

  if (!projectName) throw new Error("Project name is required")
  if (projectName.length > 100) throw new Error("Project name is too long")
  if (websiteUrl.length > 2048) throw new Error("Website URL is too long")
  if (competitorUrls.some((url) => url.length > 2048)) {
    throw new Error("Competitor URL is too long")
  }
  if (competitorUrls.length > competitorLimit) {
    throw new Error(`Your plan supports up to ${competitorLimit} tracked competitors`)
  }

  const now = Date.now()

  const projects = await getUserProjects(ctx, user._id)
  const completeProject = projects.find(isCompleteProject)
  if (completeProject) {
    throw new Error("Onboarding already completed")
  }

  const project = projects.find((item) => !isCompleteProject(item))

  if (!project) {
    const projectId = await ctx.db.insert("projects", {
      userId: user._id,
      name: projectName,
      plan: args.plan,
      planStatus: "trialing",
      onboardingStatus: "in_progress",
      timezone: args.timezone,
      lastActiveAt: now,
      createdAt: now,
    })

    await ctx.db.insert("projectIntelligenceProfiles", {
      projectId,
      websiteUrl,
      competitorUrls,
      intelligenceJson: "{}",
      createdAt: now,
      updatedAt: now,
    })

    return { projectId }
  }

  await ctx.db.patch(project._id, {
    name: projectName,
    plan: args.plan,
    timezone: args.timezone,
    lastActiveAt: now,
  })

  const brand = await ctx.db
    .query("projectIntelligenceProfiles")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .first()

  if (brand) {
    await ctx.db.patch(brand._id, {
      websiteUrl,
      competitorUrls,
      updatedAt: now,
    })
  } else {
    await ctx.db.insert("projectIntelligenceProfiles", {
      projectId: project._id,
      websiteUrl,
      competitorUrls,
      intelligenceJson: "{}",
      createdAt: now,
      updatedAt: now,
    })
  }

  return { projectId: project._id }
}

export const getOnboardingStatus = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity()
    if (!identity) {
      return { isAuthenticated: false, hasCompletedOnboarding: false }
    }

    const user = await getCurrentUser(ctx)

    if (!user) {
      return { isAuthenticated: true, hasCompletedOnboarding: false }
    }

    const projects = await getUserProjects(ctx, user._id)
    const completeProject = projects.find(isCompleteProject)
    const draftProject = projects.find((project) => !isCompleteProject(project))

    return {
      isAuthenticated: true,
      hasCompletedOnboarding: !!completeProject,
      projectId: (completeProject?._id ?? draftProject?._id) ?? null,
    }
  },
})

export const getOnboardingDraft = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    if (!user) return null

    const projects = await getUserProjects(ctx, user._id)
    const draftProject = projects.find((project) => !isCompleteProject(project))
    if (!draftProject) return null

    const brand = await ctx.db
      .query("projectIntelligenceProfiles")
      .withIndex("by_projectId", (q) => q.eq("projectId", draftProject._id))
      .first()

    const redditAccounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", draftProject._id))
      .take(planAccountLimit(draftProject.plan))

    return {
      projectId: draftProject._id,
      projectName: draftProject.name,
      websiteUrl: brand?.websiteUrl ?? "",
      competitorUrls: brand?.competitorUrls ?? [],
      plan: draftProject.plan,
      timezone: draftProject.timezone,
      redditAccounts: redditAccounts.map((account) => ({
        username: account.redditUsername,
      })),
    }
  },
})

export const prepareOnboardingProject = mutation({
  args: {
    projectName: v.string(),
    websiteUrl: v.string(),
    competitorUrls: v.optional(v.array(v.string())),
    plan: planValidator,
    timezone: v.string(),
  },
  handler: async (ctx, args) => {
    return await prepareProject(ctx, args)
  },
})

export const completeOnboarding = mutation({
  args: {
    projectName: v.string(),
    websiteUrl: v.string(),
    competitorUrls: v.optional(v.array(v.string())),
    plan: planValidator,
    timezone: v.string(),
  },
  handler: async (ctx, args) => {
    const prepared = await prepareProject(ctx, args)
    const projectId = prepared.projectId
    const project = await ctx.db.get(projectId)
    if (!project) throw new Error("Project not found")
    const accountLimit = planAccountLimit(project.plan)
    const redditAccounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))
      .take(accountLimit + 1)

    if (redditAccounts.length > accountLimit) {
      throw new Error("Too many Reddit accounts for the selected plan")
    }

    const now = Date.now()
    const sevenDays = 7 * 24 * 60 * 60 * 1000

    await ctx.db.patch(projectId, {
      onboardingStatus: "running",
      onboardingError: undefined,
      trialEndsAt: now + sevenDays,
      lastActiveAt: now,
    })

    await ctx.scheduler.runAfter(0, internal.onboarding.pipeline.runOnboardingPipeline, {
      projectId,
    })

    return { projectId }
  },
})
