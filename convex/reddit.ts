import { v } from "convex/values"
import { api, internal } from "./_generated/api"
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import type { Doc, Id } from "./_generated/dataModel"
import { getCurrentUserOrNull, requireOwnedProject } from "./lib/auth"
import { getPlanLimits } from "./lib/planLimits"
import {
  REDDIT_WARMUP_ACCOUNT_AGE_DAYS,
  REDDIT_WARMUP_TOTAL_KARMA,
  decideRedditActivityStatus,
  isReadyRedditAccount,
  isUsableRedditAccount,
  normalizeRedditUserProfile,
  normalizeSubredditName,
} from "./lib/accountSafety"
import { userProfile } from "./lib/fetchLayer"
import {
  createZernioProfile,
  deleteZernioProfile,
  getAccountDetails,
  getAccountHealth,
  getRedditSubreddits,
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

const OAUTH_RATE_LIMIT_WINDOW_MS = 60_000
const OAUTH_RATE_LIMIT_MAX_REQUESTS = 20

export const consumeZernioOAuthRateLimit = internalMutation({
  args: {
    key: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.key.length === 0 || args.key.length > 256) {
      throw new Error("Invalid rate limit key")
    }

    const now = Date.now()
    const existing = await ctx.db
      .query("oauthRateLimitBuckets")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique()

    if (!existing) {
      await ctx.db.insert("oauthRateLimitBuckets", {
        key: args.key,
        count: 1,
        resetAt: now + OAUTH_RATE_LIMIT_WINDOW_MS,
        updatedAt: now,
      })
      return { allowed: true, retryAfter: 0 }
    }

    if (existing.resetAt <= now) {
      await ctx.db.patch(existing._id, {
        count: 1,
        resetAt: now + OAUTH_RATE_LIMIT_WINDOW_MS,
        updatedAt: now,
      })
      return { allowed: true, retryAfter: 0 }
    }

    const count = existing.count + 1
    await ctx.db.patch(existing._id, {
      count,
      updatedAt: now,
    })

    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000))
    return { allowed: count <= OAUTH_RATE_LIMIT_MAX_REQUESTS, retryAfter }
  },
})

async function getOwnedProject(
  ctx: QueryCtx | MutationCtx,
  projectId: Id<"projects">,
) {
  return await requireOwnedProject(ctx, projectId)
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

function textFrom(value: unknown) {
  return typeof value === "string" ? value.trim() : undefined
}

function arrayFromSubredditPayload(payload: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter((item): item is Record<string, unknown> => (
    item !== null && typeof item === "object" && !Array.isArray(item)
  ))
  if (!payload || typeof payload !== "object") return []
  const record = payload as Record<string, unknown>
  for (const key of ["subreddits", "communities", "results", "data"]) {
    const value = record[key]
    if (Array.isArray(value)) return arrayFromSubredditPayload(value)
  }
  return []
}

function accessBySubreddit(payload: unknown) {
  const access = new Map<string, { canPost: boolean; reason?: string }>()
  for (const item of arrayFromSubredditPayload(payload)) {
    const name = textFrom(
      item.name ?? item.displayName ?? item.display_name ?? item.subreddit,
    )
    if (!name) continue
    const subreddit = normalizeSubredditName(name)
    const explicitCanPost = item.canPost ?? item.can_post ?? item.postable ?? item.allowed
    const canPost = typeof explicitCanPost === "boolean" ? explicitCanPost : false
    const reason = textFrom(item.reason ?? item.issue ?? item.status)
    access.set(subreddit, { canPost, reason })
  }
  return access
}

function sanitizedErrorSummary(error: unknown) {
  const type = error instanceof Error
    ? (error.name || "Error")
    : error === null
      ? "null"
      : Array.isArray(error)
        ? "array"
        : typeof error
  const status = statusFromError(error)
  return status === undefined ? { type } : { type, status }
}

function statusFromError(error: unknown) {
  if (!error || typeof error !== "object") return undefined
  const record = error as Record<string, unknown>
  const status = record.status ?? record.statusCode
  if (typeof status === "number") return status
  const response = record.response
  if (response && typeof response === "object") {
    const responseStatus = (response as Record<string, unknown>).status
    if (typeof responseStatus === "number") return responseStatus
  }
  return undefined
}

function summarizeWarmupMode(accounts: Doc<"redditAccounts">[]) {
  const usable = accounts.filter(isUsableRedditAccount)
  const ready = usable.filter(isReadyRedditAccount)
  const warmup = usable.filter((account) => !isReadyRedditAccount(account))
  const mode = usable.length === 0
    ? "none"
    : ready.length === 0
      ? "all_warmup"
      : warmup.length > 0
        ? "partial_warmup"
        : "ready"

  return { mode, usable, ready, warmup }
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
    const result: { redditAccountId: Id<"redditAccounts"> } = await ctx.runMutation(
      internal.reddit.upsertZernioAccount,
      {
        projectId: args.projectId,
        redditUsername,
        zernioAccountId: args.zernioAccountId,
        providerHealthStatus: providerHealth.status,
        providerCanPost: providerHealth.canPost,
        providerNeedsReconnect: providerHealth.needsReconnect,
        providerIssues: providerHealth.issues,
      },
    )
    await refreshAccountSafetyData(ctx, result.redditAccountId)
    return result
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

export const getWarmupStatus = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUserOrNull(ctx)
    if (!user) return null

    const project = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first()
    if (!project) return null

    const accounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(50)
    const activeAccounts = accounts.filter((account) => account.isActive)
    const summary = summarizeWarmupMode(accounts)

    return {
      projectId: project._id,
      mode: summary.mode,
      thresholds: {
        totalKarma: REDDIT_WARMUP_TOTAL_KARMA,
        accountAgeDays: REDDIT_WARMUP_ACCOUNT_AGE_DAYS,
      },
      affectedAccounts: activeAccounts
        .filter((account) => account.activityStatus !== "ready")
        .map((account) => ({
          _id: account._id,
          redditUsername: account.redditUsername,
          activityStatus: account.activityStatus ?? "warmup",
          totalKarma: account.totalKarma ?? null,
          postKarma: account.postKarma ?? null,
          commentKarma: account.commentKarma ?? null,
          accountCreatedAt: account.accountCreatedAt ?? null,
          activityCheckedAt: account.activityCheckedAt ?? null,
          warmupSince: account.warmupSince ?? null,
          activityIssues: account.activityIssues ?? ["activity_unknown"],
        })),
      accounts: activeAccounts.map((account) => ({
        _id: account._id,
        redditUsername: account.redditUsername,
        activityStatus: account.activityStatus ?? "warmup",
        totalKarma: account.totalKarma ?? null,
        accountCreatedAt: account.accountCreatedAt ?? null,
        activityCheckedAt: account.activityCheckedAt ?? null,
      })),
    }
  },
})

export const loadAccountSafetySyncTarget = internalQuery({
  args: {
    redditAccountId: v.id("redditAccounts"),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.redditAccountId)
    if (!account) return null
    const subreddits = await ctx.db
      .query("subreddits")
      .withIndex("by_projectId_active", (q) =>
        q.eq("projectId", account.projectId).eq("active", true),
      )
      .take(100)

    return {
      account: {
        _id: account._id,
        projectId: account.projectId,
        redditUsername: account.redditUsername,
        zernioAccountId: account.zernioAccountId,
        warmupSince: account.warmupSince ?? null,
      },
      subreddits: subreddits.map((subreddit) => normalizeSubredditName(subreddit.name)),
    }
  },
})

export const loadProjectSafetySyncTargets = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .take(50)
    return accounts
      .filter((account) => account.isActive)
      .map((account) => account._id)
  },
})

export const pageProjectsForSafetySync = internalQuery({
  args: {
    planStatus: v.union(v.literal("trialing"), v.literal("active")),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const page = await ctx.db
      .query("projects")
      .withIndex("by_planStatus", (q) => q.eq("planStatus", args.planStatus))
      .paginate({ numItems: 200, cursor: args.cursor })
    return {
      projectIds: page.page.map((project) => project._id),
      cursor: page.isDone ? null : page.continueCursor,
    }
  },
})

export const saveAccountActivity = internalMutation({
  args: {
    redditAccountId: v.id("redditAccounts"),
    activityStatus: v.union(v.literal("ready"), v.literal("warmup")),
    totalKarma: v.optional(v.number()),
    postKarma: v.optional(v.number()),
    commentKarma: v.optional(v.number()),
    accountCreatedAt: v.optional(v.number()),
    activityIssues: v.array(v.string()),
    checkedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.redditAccountId)
    if (!account) return null
    const wasWarmup = account.activityStatus !== "ready"
    await ctx.db.patch(args.redditAccountId, {
      activityStatus: args.activityStatus,
      totalKarma: args.totalKarma,
      postKarma: args.postKarma,
      commentKarma: args.commentKarma,
      accountCreatedAt: args.accountCreatedAt,
      activityCheckedAt: args.checkedAt,
      activityIssues: args.activityIssues,
      warmupSince: args.activityStatus === "warmup"
        ? (account.warmupSince ?? args.checkedAt)
        : wasWarmup ? undefined : account.warmupSince,
    })
    return null
  },
})

export const saveSubredditAccessRows = internalMutation({
  args: {
    redditAccountId: v.id("redditAccounts"),
    projectId: v.id("projects"),
    rows: v.array(v.object({
      subreddit: v.string(),
      canPost: v.boolean(),
      reason: v.optional(v.string()),
    })),
    checkedAt: v.number(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.redditAccountId)
    if (!account || account.projectId !== args.projectId) return null

    for (const row of args.rows) {
      const subreddit = normalizeSubredditName(row.subreddit)
      const existing = await ctx.db
        .query("redditSubredditAccess")
        .withIndex("by_projectId_and_redditAccountId_and_subreddit", (q) =>
          q
            .eq("projectId", args.projectId)
            .eq("redditAccountId", args.redditAccountId)
            .eq("subreddit", subreddit),
        )
        .unique()
      const patch = {
        projectId: args.projectId,
        redditAccountId: args.redditAccountId,
        subreddit,
        canPost: row.canPost,
        checkedAt: args.checkedAt,
        reason: row.reason,
      }
      if (existing) {
        await ctx.db.patch(existing._id, patch)
      } else {
        await ctx.db.insert("redditSubredditAccess", patch)
      }
    }

    return null
  },
})

async function refreshAccountSafetyData(
  ctx: ActionCtx,
  redditAccountId: Id<"redditAccounts">,
) {
  const target: {
    account: {
      _id: Id<"redditAccounts">
      projectId: Id<"projects">
      redditUsername: string
      zernioAccountId: string
      warmupSince: number | null
    }
    subreddits: string[]
  } | null = await ctx.runQuery(internal.reddit.loadAccountSafetySyncTarget, {
    redditAccountId,
  })
  if (!target) return null

  const checkedAt = Date.now()
  const [profileResult, subredditsResult] = await Promise.allSettled([
    userProfile(ctx, target.account.redditUsername),
    target.subreddits.length > 0
      ? getRedditSubreddits(ctx, target.account.zernioAccountId)
      : Promise.resolve(null),
  ])

  try {
    if (profileResult.status === "rejected") throw profileResult.reason
    const profile = normalizeRedditUserProfile(profileResult.value)
    const decision = decideRedditActivityStatus(profile, checkedAt)
    await ctx.runMutation(internal.reddit.saveAccountActivity, {
      redditAccountId,
      activityStatus: decision.activityStatus,
      totalKarma: decision.totalKarma,
      postKarma: decision.postKarma,
      commentKarma: decision.commentKarma,
      accountCreatedAt: decision.accountCreatedAt,
      activityIssues: decision.activityIssues,
      checkedAt,
    })
  } catch (error) {
    console.warn("Reddit activity sync failed", redditAccountId, sanitizedErrorSummary(error))
    await ctx.runMutation(internal.reddit.saveAccountActivity, {
      redditAccountId,
      activityStatus: "warmup",
      activityIssues: ["activity_sync_failed"],
      checkedAt,
    })
  }

  if (target.subreddits.length === 0) return null

  try {
    if (subredditsResult.status === "rejected") throw subredditsResult.reason
    const access = accessBySubreddit(subredditsResult.value)
    await ctx.runMutation(internal.reddit.saveSubredditAccessRows, {
      redditAccountId,
      projectId: target.account.projectId,
      checkedAt,
      rows: target.subreddits.map((subreddit) => {
        const row = access.get(subreddit)
        return {
          subreddit,
          canPost: row?.canPost === true,
          reason: row?.canPost === true
            ? row.reason
            : (row?.reason ?? "not_available_for_account"),
        }
      }),
    })
  } catch (error) {
    console.warn("Reddit subreddit access sync failed", redditAccountId, sanitizedErrorSummary(error))
    await ctx.runMutation(internal.reddit.saveSubredditAccessRows, {
      redditAccountId,
      projectId: target.account.projectId,
      checkedAt,
      rows: target.subreddits.map((subreddit) => ({
        subreddit,
        canPost: false,
        reason: "access_sync_failed",
      })),
    })
  }

  return null
}

export const refreshRedditAccountSafety = internalAction({
  args: {
    redditAccountId: v.id("redditAccounts"),
  },
  handler: async (ctx, args) => {
    return await refreshAccountSafetyData(ctx, args.redditAccountId)
  },
})

export const refreshProjectSubredditAccess = internalAction({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const accountIds: Id<"redditAccounts">[] = await ctx.runQuery(
      internal.reddit.loadProjectSafetySyncTargets,
      { projectId: args.projectId },
    )
    for (const accountId of accountIds) {
      await refreshAccountSafetyData(ctx, accountId)
    }
    return null
  },
})

export const refreshAllRedditSafety = internalAction({
  args: {},
  handler: async (ctx) => {
    const statuses: Array<"active" | "trialing"> = ["active", "trialing"]
    for (const planStatus of statuses) {
      let cursor: string | null = null
      do {
        const page: { projectIds: Id<"projects">[]; cursor: string | null } = await ctx.runQuery(
          internal.reddit.pageProjectsForSafetySync,
          { planStatus, cursor },
        )
        for (const projectId of page.projectIds) {
          const accountIds: Id<"redditAccounts">[] = await ctx.runQuery(
            internal.reddit.loadProjectSafetySyncTargets,
            { projectId },
          )
          await Promise.all(accountIds.map((accountId) =>
            refreshAccountSafetyData(ctx, accountId),
          ))
        }
        cursor = page.cursor
      } while (cursor !== null)
    }
    return null
  },
})
