import { v } from "convex/values"
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { getPlanLimits } from "./lib/planLimits"

type TokenRow = {
  accessToken: string
  refreshToken: string
  tokenExpiresAt: number
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
  label: string,
) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`${label} timed out`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

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

function base64UrlToBytes(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/")
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=")
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ""
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function getAesKey(usage: KeyUsage[]) {
  const encodedKey = process.env.REDDIT_TOKEN_ENCRYPTION_KEY
  if (!encodedKey) {
    throw new Error("REDDIT_TOKEN_ENCRYPTION_KEY is not configured")
  }

  const keyBytes = base64UrlToBytes(encodedKey)
  if (keyBytes.byteLength !== 32) {
    throw new Error("REDDIT_TOKEN_ENCRYPTION_KEY must decode to 32 bytes")
  }

  return await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, usage)
}

async function encryptToken(token: string) {
  const key = await getAesKey(["encrypt"])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(token)
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  )

  return `v1:${bytesToBase64Url(iv)}:${bytesToBase64Url(new Uint8Array(ciphertext))}`
}

async function decryptToken(payload: string) {
  const parts = payload.split(":")
  if (parts.length !== 3 || parts[0] !== "v1") {
    throw new Error("Reddit token is not encrypted")
  }

  const key = await getAesKey(["decrypt"])
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(parts[1]) },
    key,
    base64UrlToBytes(parts[2]),
  )

  return new TextDecoder().decode(plaintext)
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

async function refreshTokenForAccount(
  ctx: ActionCtx,
  redditAccountId: Id<"redditAccounts">,
): Promise<string> {
  const account: TokenRow | null = await ctx.runQuery(
    internal.reddit.loadAccountTokenFields,
    { redditAccountId },
  )
  if (!account) throw new Error("Reddit account not found")

  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("Reddit OAuth is not configured")
  }

  const refreshToken = await decryptToken(account.refreshToken)
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })

  const response = await fetchWithTimeout(
    "https://www.reddit.com/api/v1/access_token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "astreex/0.1",
      },
      body,
    },
    10_000,
    "Reddit token refresh",
  )

  if (!response.ok) {
    throw new Error("Failed to refresh Reddit token")
  }

  const tokenResponse = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }

  if (!tokenResponse.access_token || !tokenResponse.expires_in) {
    throw new Error("Reddit token refresh response was incomplete")
  }

  const encryptedAccessToken = await encryptToken(tokenResponse.access_token)
  const encryptedRefreshToken = tokenResponse.refresh_token
    ? await encryptToken(tokenResponse.refresh_token)
    : undefined

  await ctx.runMutation(internal.reddit.updateRefreshedToken, {
    redditAccountId,
    encryptedAccessToken,
    encryptedRefreshToken,
    tokenExpiresAt: Date.now() + tokenResponse.expires_in * 1000,
  })

  return tokenResponse.access_token
}

export const getOAuthAuthorizationContext = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
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
      canAddAccount,
      accountLimit,
      usedAccounts: accounts.length,
      ...(canAddAccount
        ? {}
        : { message: "Reddit account limit reached for this plan" }),
    }
  },
})

export const upsertOAuthAccount = mutation({
  args: {
    projectId: v.id("projects"),
    redditUsername: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    tokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const project = await getOwnedProject(ctx, args.projectId)
    const redditUsername = validateRedditUsername(args.redditUsername)
    const accountLimit = getPlanLimits(project.plan).maxRedditAccounts

    const existing = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId_and_redditUsername", (q) =>
        q.eq("projectId", args.projectId).eq("redditUsername", redditUsername),
      )
      .unique()

    const encryptedAccessToken = await encryptToken(args.accessToken)
    const encryptedRefreshToken = await encryptToken(args.refreshToken)
    const now = Date.now()

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
        accessToken: encryptedAccessToken,
        refreshToken: encryptedRefreshToken,
        tokenExpiresAt: args.tokenExpiresAt,
        isActive: true,
        healthStatus: "healthy",
        lastCheckedAt: now,
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
      accessToken: encryptedAccessToken,
      refreshToken: encryptedRefreshToken,
      tokenExpiresAt: args.tokenExpiresAt,
      isActive: true,
      healthStatus: "healthy",
      lastCheckedAt: now,
      createdAt: now,
    })

    return { redditAccountId }
  },
})

export const loadAccountTokenFields = internalQuery({
  args: {
    redditAccountId: v.id("redditAccounts"),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.redditAccountId)
    if (!account) return null

    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      tokenExpiresAt: account.tokenExpiresAt,
    }
  },
})

export const updateRefreshedToken = internalMutation({
  args: {
    redditAccountId: v.id("redditAccounts"),
    encryptedAccessToken: v.string(),
    encryptedRefreshToken: v.optional(v.string()),
    tokenExpiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const patch: {
      accessToken: string
      refreshToken?: string
      tokenExpiresAt: number
      lastCheckedAt: number
      healthStatus: "healthy"
    } = {
      accessToken: args.encryptedAccessToken,
      tokenExpiresAt: args.tokenExpiresAt,
      lastCheckedAt: Date.now(),
      healthStatus: "healthy",
    }

    if (args.encryptedRefreshToken) {
      patch.refreshToken = args.encryptedRefreshToken
    }

    await ctx.db.patch(args.redditAccountId, patch)
  },
})

export const markAccountWarning = internalMutation({
  args: {
    redditAccountId: v.id("redditAccounts"),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.redditAccountId, {
      healthStatus: "warning",
      lastCheckedAt: Date.now(),
    })
  },
})

export const setAccountHealthStatus = internalMutation({
  args: {
    redditAccountId: v.id("redditAccounts"),
    healthStatus: v.union(
      v.literal("healthy"),
      v.literal("warning"),
      v.literal("banned"),
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.redditAccountId, {
      healthStatus: args.healthStatus,
      lastCheckedAt: Date.now(),
    })
  },
})

export const refreshRedditToken = internalAction({
  args: {
    redditAccountId: v.id("redditAccounts"),
  },
  handler: async (ctx, args): Promise<string> => {
    try {
      return await refreshTokenForAccount(ctx, args.redditAccountId)
    } catch (error) {
      await ctx.runMutation(internal.reddit.markAccountWarning, {
        redditAccountId: args.redditAccountId,
      })
      throw error
    }
  },
})

export const getValidToken = internalAction({
  args: {
    redditAccountId: v.id("redditAccounts"),
  },
  handler: async (ctx, args): Promise<string> => {
    const account: TokenRow | null = await ctx.runQuery(
      internal.reddit.loadAccountTokenFields,
      { redditAccountId: args.redditAccountId },
    )
    if (!account) throw new Error("Reddit account not found")

    if (account.tokenExpiresAt > Date.now() + 60_000) {
      return await decryptToken(account.accessToken)
    }

    return await refreshTokenForAccount(ctx, args.redditAccountId)
  },
})
