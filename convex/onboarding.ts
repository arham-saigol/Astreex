import { v } from "convex/values"
import { internal } from "./_generated/api"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { getOrCreateCurrentUser, getCurrentUserOrNull } from "./lib/auth"
import { getPlanLimits } from "./lib/planLimits"
import { ensureOwnerMembership, newProjectPublicId, projectRefFor, slugifyProjectName } from "./lib/projectRefs"
import { assertValidTimezone } from "./lib/timezones"
import { normalizeHttpUrl, normalizeOptionalHttpUrls } from "./lib/urls"

type Plan = "starter" | "growth" | "scale"

const planValidator = v.union(
  v.literal("starter"),
  v.literal("growth"),
  v.literal("scale"),
)

async function getOrCreateUser(ctx: MutationCtx) {
  return await getOrCreateCurrentUser(ctx)
}

async function getCurrentUser(ctx: QueryCtx) {
  return await getCurrentUserOrNull(ctx)
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
  newProject?: boolean
}

async function prepareProject(ctx: MutationCtx, args: PrepareProjectArgs) {
  const user = await getOrCreateUser(ctx)
  const projectName = args.projectName.trim()
  const timezone = assertValidTimezone(args.timezone)
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
  if (competitorUrls.some((url) => url === websiteUrl)) {
    throw new Error("Competitor URLs cannot include your website URL")
  }

  const now = Date.now()

  const projects = await getUserProjects(ctx, user._id)
  const completeProject = projects.find(isCompleteProject)
  if (completeProject && !args.newProject) {
    throw new Error("Onboarding already completed")
  }

  const project = args.newProject ? undefined : projects.find((item) => !isCompleteProject(item))

  if (!project) {
    const publicId = newProjectPublicId()
    const trialEligible = !user.firstCreatedProjectId
    const projectId = await ctx.db.insert("projects", {
      userId: user._id,
      publicId,
      slug: slugifyProjectName(projectName),
      name: projectName,
      plan: args.plan,
      planStatus: trialEligible ? "trialing" : "requires_subscription",
      onboardingStatus: "in_progress",
      timezone,
      lastActiveAt: now,
      createdAt: now,
    })

    await ensureOwnerMembership(ctx, projectId, user._id)
    if (trialEligible) {
      await ctx.db.patch(user._id, { firstCreatedProjectId: projectId })
    }

    await ctx.db.insert("projectIntelligenceProfiles", {
      projectId,
      websiteUrl,
      competitorUrls,
      intelligenceJson: "{}",
      createdAt: now,
      updatedAt: now,
    })

    const created = await ctx.db.get(projectId)
    return { projectId, projectRef: created ? projectRefFor(created) : `${slugifyProjectName(projectName)}-${publicId}` }
  }

  await ctx.db.patch(project._id, {
    name: projectName,
    plan: args.plan,
    timezone,
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

  const updated = await ctx.db.get(project._id)
  return { projectId: project._id, projectRef: updated ? projectRefFor(updated) : projectRefFor(project) }
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
    const memberships = await ctx.db
      .query("projectMemberships")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .take(100)
    const completeProject = projects.find(isCompleteProject)
    const draftProject = projects.find((project) => !isCompleteProject(project))
    const hasAccessibleProject = memberships.length > 0 || projects.length > 0

    return {
      isAuthenticated: true,
      hasCompletedOnboarding: hasAccessibleProject || !!user.initialProjectOnboardingSkippedAt,
      hasProjects: hasAccessibleProject,
      hasCreatedProjects: projects.length > 0,
      skippedInitialOnboarding: !!user.initialProjectOnboardingSkippedAt,
      projectId: (completeProject?._id ?? draftProject?._id) ?? null,
      projectRef: completeProject ? projectRefFor(completeProject) : draftProject ? projectRefFor(draftProject) : null,
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
      projectRef: projectRefFor(draftProject),
      projectName: draftProject.name,
      websiteUrl: brand?.websiteUrl ?? "",
      competitorUrls: brand?.competitorUrls ?? [],
      plan: draftProject.plan,
      timezone: draftProject.timezone,
      redditAccounts: redditAccounts.map((account) => ({
        username: account.redditUsername,
        isActive: account.isActive,
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
    newProject: v.optional(v.boolean()),
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
    newProject: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const prepared = await prepareProject(ctx, args)
    const projectId = prepared.projectId
    const project = await ctx.db.get(projectId)
    if (!project) throw new Error("Project not found")
    if (project.planStatus === "requires_subscription") {
      throw new Error("Subscribe before completing setup for this project")
    }
    const accountLimit = planAccountLimit(project.plan)
    const activeRedditAccounts: Doc<"redditAccounts">[] = []
    for await (const account of ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", projectId))) {
      if (!account.isActive) continue
      activeRedditAccounts.push(account)
      if (activeRedditAccounts.length > accountLimit) break
    }

    if (activeRedditAccounts.length === 0) {
      throw new Error("Connect at least one Reddit account to continue")
    }
    if (activeRedditAccounts.length > accountLimit) {
      throw new Error("Too many Reddit accounts for the selected plan")
    }

    const now = Date.now()
    const sevenDays = 7 * 24 * 60 * 60 * 1000

    await ctx.db.patch(projectId, {
      onboardingStatus: "running",
      onboardingError: undefined,
      trialEndsAt: project.planStatus === "trialing" ? now + sevenDays : project.trialEndsAt,
      lastActiveAt: now,
    })

    await ctx.scheduler.runAfter(0, internal.onboarding.pipeline.runOnboardingPipeline, {
      projectId,
    })

    const latest = await ctx.db.get(projectId)
    return { projectId, projectRef: latest ? projectRefFor(latest) : projectRefFor(project) }
  },
})
