import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type AuthDbCtx = QueryCtx | MutationCtx

async function findUserByIdentity(ctx: AuthDbCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) return { identity: null, user: null }

  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique()

  return { identity, user }
}

export async function getCurrentUserOrNull(ctx: AuthDbCtx) {
  const { user } = await findUserByIdentity(ctx)
  return user
}

export async function getOrCreateCurrentUser(ctx: MutationCtx) {
  const { identity, user } = await findUserByIdentity(ctx)
  if (!identity) throw new Error("Not authenticated")

  if (user) return user

  const userId = await ctx.db.insert("users", {
    tokenIdentifier: identity.tokenIdentifier,
    email: identity.email ?? "",
    name: identity.name,
    avatarUrl: identity.pictureUrl,
    createdAt: Date.now(),
  })

  return (await ctx.db.get(userId))!
}

export async function requireAuthenticatedUser(ctx: AuthDbCtx) {
  const { identity, user } = await findUserByIdentity(ctx)
  if (!identity) throw new Error("Not authenticated")
  if (!user) throw new Error("User not found")

  return user
}

export async function getCurrentProjectOrNull(ctx: AuthDbCtx) {
  const user = await getCurrentUserOrNull(ctx)
  if (!user) return null

  const memberships: Doc<"projectMemberships">[] = []
  for await (const membership of ctx.db
    .query("projectMemberships")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))) {
    memberships.push(membership)
  }
  const membershipProjects = await Promise.all(
    memberships.map((membership) => ctx.db.get(membership.projectId)),
  )
  const membershipProject = membershipProjects
    .filter((project): project is Doc<"projects"> => Boolean(project))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
  if (membershipProject) return { user, project: membershipProject }

  const project = await ctx.db
    .query("projects")
    .withIndex("by_userId", (q) => q.eq("userId", user._id))
    .first()

  return project ? { user, project } : null
}

export async function requireProjectAccess(
  ctx: AuthDbCtx,
  projectId: Id<"projects">,
): Promise<Doc<"projects">> {
  const user = await requireAuthenticatedUser(ctx)
  const project = await ctx.db.get(projectId)
  if (!project) throw new Error("Not authorized")

  const membership = await ctx.db
    .query("projectMemberships")
    .withIndex("by_projectId_and_userId", (q) =>
      q.eq("projectId", projectId).eq("userId", user._id),
    )
    .unique()

  if (!membership && project.userId !== user._id) {
    throw new Error("Not authorized")
  }

  return project
}

export async function requireOwnedProject(
  ctx: AuthDbCtx,
  projectId: Id<"projects">,
): Promise<Doc<"projects">> {
  const user = await requireAuthenticatedUser(ctx)
  const project = await ctx.db.get(projectId)

  if (!project) throw new Error("Not authorized")

  const membership = await ctx.db
    .query("projectMemberships")
    .withIndex("by_projectId_and_userId", (q) =>
      q.eq("projectId", projectId).eq("userId", user._id),
    )
    .unique()

  if (membership?.role !== "owner" && project.userId !== user._id) {
    throw new Error("Not authorized")
  }

  return project
}
