import { v } from "convex/values"
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { getCurrentUserOrNull, getOrCreateCurrentUser } from "./lib/auth"
import {
  ensureOwnerMembership,
  getProjectByPublicId,
  newProjectPublicId,
  parseProjectPublicId,
  projectRefFor,
  requireProjectAccessByRef,
  slugifyProjectName,
} from "./lib/projectRefs"

async function accessibleProjects(ctx: QueryCtx | MutationCtx, userId: Id<"users">) {
  const memberships = await ctx.db
    .query("projectMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(100)

  const byId = new Map<Id<"projects">, "owner" | "member">()
  for (const membership of memberships) byId.set(membership.projectId, membership.role)

  const owned = await ctx.db
    .query("projects")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .take(100)
  for (const project of owned) byId.set(project._id, "owner")

  const projects = []
  for (const [projectId, role] of byId) {
    const project = await ctx.db.get(projectId)
    if (!project) continue
    projects.push({ project, role })
  }

  projects.sort((a, b) => b.project.lastActiveAt - a.project.lastActiveAt)
  return projects
}

export const listAccessibleProjects = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx)
    if (!user) return null

    const projects = await accessibleProjects(ctx, user._id)
    return {
      projects: projects.map(({ project, role }) => ({
        projectRef: projectRefFor(project),
        publicId: project.publicId ?? null,
        name: project.name,
        plan: project.plan,
        planStatus: project.planStatus,
        onboardingStatus: project.onboardingStatus ?? null,
        role,
        createdAt: project.createdAt,
        lastActiveAt: project.lastActiveAt,
      })),
    }
  },
})

export const resolveProjectRef = query({
  args: { projectRef: v.string() },
  handler: async (ctx, args) => {
    const { project, membership } = await requireProjectAccessByRef(ctx, args.projectRef)
    return {
      projectRef: projectRefFor(project),
      publicId: project.publicId ?? parseProjectPublicId(args.projectRef),
      name: project.name,
      plan: project.plan,
      planStatus: project.planStatus,
      onboardingStatus: project.onboardingStatus ?? null,
      role: membership.role,
    }
  },
})

export const skipInitialProjectOnboarding = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await getOrCreateCurrentUser(ctx)
    const projects = await accessibleProjects(ctx, user._id)
    if (projects.length > 0) throw new Error("You already have a project")
    await ctx.db.patch(user._id, { initialProjectOnboardingSkippedAt: Date.now() })
    return { skipped: true }
  },
})

export const backfillPublicProjectIdentity = internalMutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100
    const projects = await ctx.db.query("projects").take(limit)
    let patchedProjects = 0
    let insertedMemberships = 0

    for (const project of projects) {
      const patch: { publicId?: string; slug?: string } = {}
      if (!project.publicId) patch.publicId = newProjectPublicId()
      if (!project.slug) patch.slug = slugifyProjectName(project.name)
      if (patch.publicId || patch.slug) {
        await ctx.db.patch(project._id, patch)
        patchedProjects++
      }

      const membership = await ctx.db
        .query("projectMemberships")
        .withIndex("by_projectId_and_userId", (q) =>
          q.eq("projectId", project._id).eq("userId", project.userId),
        )
        .unique()
      if (!membership) {
        await ctx.db.insert("projectMemberships", {
          projectId: project._id,
          userId: project.userId,
          role: "owner",
          createdAt: project.createdAt,
        })
        insertedMemberships++
      }
    }

    const users = await ctx.db.query("users").take(limit)
    let patchedUsers = 0
    for (const user of users) {
      if (user.firstCreatedProjectId) continue
      const first = await ctx.db
        .query("projects")
        .withIndex("by_userId", (q) => q.eq("userId", user._id))
        .first()
      if (first) {
        await ctx.db.patch(user._id, { firstCreatedProjectId: first._id })
        patchedUsers++
      }
    }

    return { patchedProjects, insertedMemberships, patchedUsers }
  },
})

export const ensureProjectIdentityForTests = internalMutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId)
    if (!project) return null
    await ensureOwnerMembership(ctx, project._id, project.userId)
    if (!project.publicId || !project.slug) {
      await ctx.db.patch(project._id, {
        publicId: project.publicId ?? newProjectPublicId(),
        slug: project.slug ?? slugifyProjectName(project.name),
      })
    }
    const next = await ctx.db.get(project._id)
    return next ? { projectRef: projectRefFor(next), publicId: next.publicId ?? null } : null
  },
})

export const getProjectByRefForServer = query({
  args: { projectRef: v.string() },
  handler: async (ctx, args) => {
    const publicId = parseProjectPublicId(args.projectRef)
    const project = await getProjectByPublicId(ctx, publicId)
    if (!project) throw new Error("Project not found")
    return { projectId: project._id, projectRef: projectRefFor(project) }
  },
})
