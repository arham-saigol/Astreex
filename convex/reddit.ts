import { v } from "convex/values"
import { api, internal } from "./_generated/api"
import {
  action,
  internalMutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import type { Id } from "./_generated/dataModel"
import { getPlanLimits } from "./lib/planLimits"
import {
  createZernioProfile,
  deleteZernioProfile,
  getAccountDetails,
  getAccountHealth,
  normalizeAccountHealth,
  zernioAccountId,
  zernioAccountProfileId,
  zernioAccountUsername,
} from "./lib/zernio"

const healthStatusValidator = v.union(
  v.literal("healthy"),
  v.literal("warning"),
  v.literal("banned"),
)

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

async function getOwnedProject(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
) {
  const user = await getCurrentUser(ctx)
  const project = await ctx.db.get(projectId)

  if (!project || project.userId !== user._id) {
    throw new Error("Not authorized")
  }

  return project
}

function validateRedditUsername(username: string) {
  const trimmed = username.trim()
  if (!/^[A-Za-z0-9_-]{3,20}$/.test(trimmed)) {
    throw new Error("Invalid Reddit username")
  }
  return trimmed
}

async function loadActiveProjectAccounts(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
  limit: number,
) {
  const activeAccounts = []
  for await (const account of ctx.db
    .query("redditAccounts")
    .withIndex("by_projectId", (q) => q.eq("projectId", projectId))) {
    if (!account.isActive) continue
    activeAccounts.push(account)
    if (activeAccounts.length >= limit) break
  }

  return activeAccounts
}

export const getConnectContext = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args): Promise<{
    projectId: Id<"projects">
    projectName: string
    zernioProfileId: string | null
    canAddAccount: boolean
    accountLimit: number
    usedAccounts: number
    message?: string
  }> => {
    const project = await getOwnedProject(ctx, args.projectId)
    const accountLimit = getPlanLimits(project.plan).maxRedditAccounts
    const accounts = await loadActiveProjectAccounts(
      ctx,
      args.projectId,
      accountLimit + 1,
    )
    const canAddAccount = accounts.length < accountLimit

    return {
      projectId: project._id,
      projectName: project.name,
      zernioProfileId: project.zernioProfileId ?? null,
      canAddAccount,
      accountLimit,
      usedAccounts: accounts.length,
      ...(canAddAccount
        ? {}
        : { message: "Reddit account limit reached for this plan" }),
    }
  },
})

export const ensureZernioProfileForConnect = action({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args): Promise<{
    projectId: Id<"projects">
    projectName: string
    zernioProfileId: string | null
    canAddAccount: boolean
    accountLimit: number
    usedAccounts: number
    message?: string
  }> => {
    const context: {
      projectId: Id<"projects">
      projectName: string
      zernioProfileId: string | null
      canAddAccount: boolean
      accountLimit: number
      usedAccounts: number
      message?: string
    } = await ctx.runQuery(api.reddit.getConnectContext, {
      projectId: args.projectId,
    })
    if (!context.canAddAccount) return context

    let zernioProfileId = context.zernioProfileId ?? undefined
    if (!zernioProfileId) {
      const createdZernioProfileId = await createZernioProfile(ctx, context.projectName)
      const canonicalZernioProfileId: string = await ctx.runMutation(
        internal.reddit.saveZernioProfileId,
        {
          projectId: args.projectId,
          zernioProfileId: createdZernioProfileId,
        },
      )
      if (canonicalZernioProfileId !== createdZernioProfileId) {
        await deleteZernioProfile(ctx, createdZernioProfileId)
      }
      zernioProfileId = canonicalZernioProfileId
    }

    return { ...context, zernioProfileId }
  },
})

export const completeZernioAccountConnect = action({
  args: {
    projectId: v.id("projects"),
    zernioAccountId: v.string(),
    zernioProfileId: v.string(),
  },
  handler: async (ctx, args): Promise<{ redditAccountId: Id<"redditAccounts"> }> => {
    const context: {
      zernioProfileId: string | null
      canAddAccount: boolean
      message?: string
    } = await ctx.runQuery(api.reddit.getConnectContext, {
      projectId: args.projectId,
    })
    if (!context.canAddAccount) {
      throw new Error(context.message ?? "Reddit account limit reached for this plan")
    }
    if (context.zernioProfileId !== args.zernioProfileId) {
      throw new Error("Invalid Zernio profile")
    }

    const accountPromise = getAccountDetails(ctx, args.zernioAccountId)
    const healthPromise = getAccountHealth(ctx, args.zernioAccountId)
    const account = await accountPromise
    const authoritativeAccountId = zernioAccountId(account)
    const authoritativeProfileId = zernioAccountProfileId(account)
    const redditUsername = zernioAccountUsername(account)
    if (
      (authoritativeAccountId && authoritativeAccountId !== args.zernioAccountId) ||
      authoritativeProfileId !== args.zernioProfileId ||
      !redditUsername
    ) {
      void healthPromise.catch(() => null)
      throw new Error("Unauthorized Zernio account")
    }

    const providerHealth = normalizeAccountHealth(await healthPromise)
    return await ctx.runMutation(internal.reddit.upsertZernioAccount, {
      projectId: args.projectId,
      redditUsername,
      zernioAccountId: args.zernioAccountId,
      providerHealthStatus: providerHealth.status,
      providerCanPost: providerHealth.canPost,
      providerNeedsReconnect: providerHealth.needsReconnect,
      providerIssues: providerHealth.issues,
    })
  },
})

export const saveZernioProfileId = internalMutation({
  args: {
    projectId: v.id("projects"),
    zernioProfileId: v.string(),
  },
  handler: async (ctx, args): Promise<string> => {
    await getOwnedProject(ctx, args.projectId)

    const project = await ctx.db.get(args.projectId)
    if (project?.zernioProfileId) {
      return project.zernioProfileId
    }

    await ctx.db.patch(args.projectId, {
      zernioProfileId: args.zernioProfileId,
      lastActiveAt: Date.now(),
    })
    return args.zernioProfileId
  },
})

export const upsertZernioAccount = internalMutation({
  args: {
    projectId: v.id("projects"),
    redditUsername: v.string(),
    zernioAccountId: v.string(),
    providerHealthStatus: v.optional(v.string()),
    providerCanPost: v.optional(v.boolean()),
    providerNeedsReconnect: v.optional(v.boolean()),
    providerIssues: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const project = await getOwnedProject(ctx, args.projectId)
    const redditUsername = validateRedditUsername(args.redditUsername)
    const accountLimit = getPlanLimits(project.plan).maxRedditAccounts
    const now = Date.now()

    const existingByAccountId = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId_and_zernioAccountId", (q) =>
        q.eq("projectId", args.projectId).eq("zernioAccountId", args.zernioAccountId),
      )
      .unique()
    const existingByUsername = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId_and_redditUsername", (q) =>
        q.eq("projectId", args.projectId).eq("redditUsername", redditUsername),
      )
      .unique()
    const existing = existingByAccountId ?? existingByUsername

    if (existing) {
      if (!existing.isActive) {
        const accounts = await loadActiveProjectAccounts(
          ctx,
          args.projectId,
          accountLimit,
        )
        if (accounts.length >= accountLimit) {
          throw new Error("Reddit account limit reached for this plan")
        }
      }

      await ctx.db.patch(existing._id, {
        redditUsername,
        zernioAccountId: args.zernioAccountId,
        isActive: true,
        healthStatus: "healthy",
        lastCheckedAt: now,
        providerHealthStatus: args.providerHealthStatus,
        providerCanPost: args.providerCanPost,
        providerNeedsReconnect: args.providerNeedsReconnect,
        providerIssues: args.providerIssues,
        providerLastCheckedAt: now,
      })
      return { redditAccountId: existing._id }
    }

    const accounts = await loadActiveProjectAccounts(
      ctx,
      args.projectId,
      accountLimit,
    )
    if (accounts.length >= accountLimit) {
      throw new Error("Reddit account limit reached for this plan")
    }

    const redditAccountId = await ctx.db.insert("redditAccounts", {
      projectId: args.projectId,
      redditUsername,
      zernioAccountId: args.zernioAccountId,
      isActive: true,
      healthStatus: "healthy",
      lastCheckedAt: now,
      providerHealthStatus: args.providerHealthStatus,
      providerCanPost: args.providerCanPost,
      providerNeedsReconnect: args.providerNeedsReconnect,
      providerIssues: args.providerIssues,
      providerLastCheckedAt: now,
      createdAt: now,
    })

    return { redditAccountId }
  },
})

export const setAccountHealthStatus = internalMutation({
  args: {
    redditAccountId: v.id("redditAccounts"),
    healthStatus: healthStatusValidator,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.redditAccountId, {
      healthStatus: args.healthStatus,
      lastCheckedAt: Date.now(),
    })
  },
})

export const updateProviderHealth = internalMutation({
  args: {
    redditAccountId: v.id("redditAccounts"),
    providerHealthStatus: v.string(),
    providerCanPost: v.boolean(),
    providerNeedsReconnect: v.boolean(),
    providerIssues: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.redditAccountId, {
      providerHealthStatus: args.providerHealthStatus,
      providerCanPost: args.providerCanPost,
      providerNeedsReconnect: args.providerNeedsReconnect,
      providerIssues: args.providerIssues,
      providerLastCheckedAt: Date.now(),
    })
  },
})
