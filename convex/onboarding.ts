import { v } from "convex/values"
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"

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
  if (plan === "starter") return 1
  if (plan === "growth") return 3
  return 5
}

type PrepareProjectArgs = {
  projectName: string
  websiteUrl: string
  competitorUrl?: string
  plan: Plan
  timezone: string
}

async function prepareProject(ctx: MutationCtx, args: PrepareProjectArgs) {
  const user = await getOrCreateUser(ctx)
  const projectName = args.projectName.trim()
  const websiteUrl = args.websiteUrl.trim()
  const competitorUrl = args.competitorUrl?.trim()

  if (!projectName) throw new Error("Project name is required")
  if (!websiteUrl) throw new Error("Website URL is required")

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

    await ctx.db.insert("brands", {
      projectId,
      websiteUrl,
      competitorUrl,
      profileJson: "{}",
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
    .query("brands")
    .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
    .first()

  if (brand) {
    await ctx.db.patch(brand._id, {
      websiteUrl,
      competitorUrl,
      updatedAt: now,
    })
  } else {
    await ctx.db.insert("brands", {
      projectId: project._id,
      websiteUrl,
      competitorUrl,
      profileJson: "{}",
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
      .query("brands")
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
      competitorUrl: brand?.competitorUrl ?? "",
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
    competitorUrl: v.optional(v.string()),
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
    competitorUrl: v.optional(v.string()),
    plan: planValidator,
    timezone: v.string(),
    projectId: v.optional(v.id("projects")),
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
      onboardingStatus: "complete",
      trialEndsAt: now + sevenDays,
      lastActiveAt: now,
    })

    return { projectId }
  },
})
