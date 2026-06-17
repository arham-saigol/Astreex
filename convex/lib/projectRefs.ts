import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { requireAuthenticatedUser } from "./auth"

type AuthDbCtx = QueryCtx | MutationCtx

const PUBLIC_ID_RE = /p_[a-z0-9]+$/i

export function slugifyProjectName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
  return slug || "project"
}

export function newProjectPublicId() {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return `p_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`
}

export function projectRefFor(project: Pick<Doc<"projects">, "name" | "publicId" | "slug">) {
  if (!project.publicId) throw new Error("Project publicId is missing")
  return `${project.slug ?? slugifyProjectName(project.name)}-${project.publicId}`
}

export function parseProjectPublicId(projectRef: string) {
  const match = projectRef.match(PUBLIC_ID_RE)
  if (!match) throw new Error("Invalid project reference")
  return match[0].toLowerCase()
}

export async function getProjectByPublicId(ctx: AuthDbCtx, publicId: string) {
  return await ctx.db
    .query("projects")
    .withIndex("by_publicId", (q) => q.eq("publicId", publicId))
    .unique()
}

async function getMembership(ctx: AuthDbCtx, projectId: Id<"projects">, userId: Id<"users">) {
  return await ctx.db
    .query("projectMemberships")
    .withIndex("by_projectId_and_userId", (q) =>
      q.eq("projectId", projectId).eq("userId", userId),
    )
    .unique()
}

export async function requireProjectAccess(ctx: AuthDbCtx, projectId: Id<"projects">) {
  const user = await requireAuthenticatedUser(ctx)
  const project = await ctx.db.get(projectId)
  if (!project) throw new Error("Project not found")

  const membership = await getMembership(ctx, projectId, user._id)
  if (!membership && project.userId !== user._id) throw new Error("Not authorized")

  return { user, project, membership: membership ?? { role: "owner" as const } }
}

export async function requireProjectOwner(ctx: AuthDbCtx, projectId: Id<"projects">) {
  const access = await requireProjectAccess(ctx, projectId)
  if (access.membership.role !== "owner" && access.project.userId !== access.user._id) {
    throw new Error("Owner access required")
  }
  return access
}

export async function requireProjectAccessByRef(ctx: AuthDbCtx, projectRef: string) {
  const publicId = parseProjectPublicId(projectRef)
  const project = await getProjectByPublicId(ctx, publicId)
  if (!project) throw new Error("Project not found")
  return await requireProjectAccess(ctx, project._id)
}

export async function requireProjectOwnerByRef(ctx: AuthDbCtx, projectRef: string) {
  const publicId = parseProjectPublicId(projectRef)
  const project = await getProjectByPublicId(ctx, publicId)
  if (!project) throw new Error("Project not found")
  return await requireProjectOwner(ctx, project._id)
}

export async function ensureOwnerMembership(ctx: MutationCtx, projectId: Id<"projects">, userId: Id<"users">) {
  const existing = await getMembership(ctx, projectId, userId)
  if (!existing) {
    await ctx.db.insert("projectMemberships", {
      projectId,
      userId,
      role: "owner",
      createdAt: Date.now(),
    })
  }
}
