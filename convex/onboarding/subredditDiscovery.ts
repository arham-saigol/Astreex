"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { deepseekV4Pro, judgeSettings } from "../lib/ai"
import { getSubredditDiscoveryLimits } from "../lib/planLimits"
import { withRateLimit } from "../lib/rateLimiter"

type CandidateSubreddit = {
  name: string
  subscribers?: number
  description: string
}

type DiscoveryResult = {
  created: number
  needsManualSubreddits: boolean
}

const rankedSubredditSchema = z.object({
  subreddits: z.array(z.object({
    name: z.string(),
    relevanceScore: z.number().min(0).max(100),
    reasoning: z.string(),
  })),
})

function normalizeSubredditName(name: string) {
  const normalized = name.replace(/^r\//i, "").trim().toLowerCase()
  if (!/^[a-z0-9_]{3,21}$/.test(normalized)) return null
  return normalized
}

function asStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : []
}

function keyword(value: string) {
  return value
    .replace(/[^\w\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
}

function discoveryKeywords(profile: Record<string, unknown>) {
  const terms = [
    ...asStringArray(profile.targetAudience),
    ...asStringArray(profile.painPointsSolved),
    ...asStringArray(profile.competitors),
    ...(typeof profile.industry === "string" ? profile.industry.split(/[\/,|]/) : []),
  ]

  const seen = new Set<string>()
  const keywords: string[] = []
  for (const term of terms) {
    const cleaned = keyword(term)
    const key = cleaned.toLowerCase()
    if (!cleaned || seen.has(key)) continue
    seen.add(key)
    keywords.push(cleaned)
    if (keywords.length >= 18) break
  }

  return keywords
}

async function getAppAccessToken() {
  const clientId = process.env.REDDIT_CLIENT_ID
  const clientSecret = process.env.REDDIT_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    throw new Error("Reddit OAuth is not configured")
  }

  const response = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "astreex/0.1",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  })

  if (!response.ok) {
    throw new Error("Failed to create Reddit app access token")
  }

  const body = (await response.json()) as { access_token?: string }
  if (!body.access_token) throw new Error("Reddit app token response was incomplete")
  return body.access_token
}

function parseSearchResults(payload: unknown) {
  const children =
    typeof payload === "object" && payload !== null &&
    "data" in payload &&
    typeof payload.data === "object" && payload.data !== null &&
    "children" in payload.data &&
    Array.isArray(payload.data.children)
      ? payload.data.children
      : []

  const candidates: CandidateSubreddit[] = []
  for (const child of children) {
    const data =
      typeof child === "object" && child !== null && "data" in child
        ? child.data
        : null
    if (typeof data !== "object" || data === null) continue

    const displayName =
      "display_name" in data && typeof data.display_name === "string"
        ? data.display_name
        : ""
    const name = normalizeSubredditName(displayName)
    if (!name) continue

    const over18 = "over18" in data && data.over18 === true
    const quarantined = "quarantine" in data && data.quarantine === true
    const type =
      "subreddit_type" in data && typeof data.subreddit_type === "string"
        ? data.subreddit_type
        : "public"
    if (over18 || quarantined || type === "private") continue

    const subscribers =
      "subscribers" in data && typeof data.subscribers === "number"
        ? data.subscribers
        : undefined
    const description =
      "public_description" in data && typeof data.public_description === "string"
        ? data.public_description
        : ""

    candidates.push({ name, subscribers, description })
  }

  return candidates
}

async function searchSubreddits(
  ctx: Parameters<typeof withRateLimit>[0],
  accessToken: string,
  term: string,
) {
  return await withRateLimit(ctx, 3, async () => {
    const url = new URL("https://oauth.reddit.com/subreddits/search.json")
    url.searchParams.set("q", term)
    url.searchParams.set("limit", "10")
    url.searchParams.set("include_over_18", "false")

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "User-Agent": "astreex/0.1",
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to search Reddit for "${term}"`)
    }

    return parseSearchResults(await response.json())
  })
}

function mergeCandidates(
  current: Map<string, CandidateSubreddit>,
  candidates: CandidateSubreddit[],
) {
  for (const candidate of candidates) {
    if (current.size >= 100) return
    if (!current.has(candidate.name)) current.set(candidate.name, candidate)
  }
}

function heuristicScore(candidate: CandidateSubreddit) {
  const subscribers = candidate.subscribers ?? 0
  if (subscribers >= 20_000 && subscribers <= 500_000) return 85
  if (subscribers >= 5_000 && subscribers <= 1_000_000) return 70
  if (subscribers > 1_000_000 && subscribers <= 5_000_000) return 55
  return 40
}

function sanitizeRanked(
  ranked: Array<{ name: string; relevanceScore: number; reasoning: string }>,
  candidates: CandidateSubreddit[],
  discoverCount: number,
  activeCount: number,
) {
  const candidateByName = new Map(candidates.map((candidate) => [candidate.name, candidate]))
  const seen = new Set<string>()
  const selected: Array<{
    name: string
    memberCount?: number
    relevanceScore: number
    reasoning: string
    active: boolean
  }> = []

  for (const item of ranked) {
    const name = normalizeSubredditName(item.name)
    if (!name || seen.has(name)) continue
    const candidate = candidateByName.get(name)
    if (!candidate) continue

    seen.add(name)
    selected.push({
      name,
      ...(candidate.subscribers === undefined ? {} : { memberCount: candidate.subscribers }),
      relevanceScore: Math.round(Math.max(0, Math.min(100, item.relevanceScore))),
      reasoning: item.reasoning.trim() || `r/${name} matches the brand audience.`,
      active: selected.length < activeCount,
    })
    if (selected.length >= discoverCount) return selected
  }

  const remaining = candidates
    .filter((candidate) => !seen.has(candidate.name))
    .sort((a, b) => heuristicScore(b) - heuristicScore(a))

  for (const candidate of remaining) {
    selected.push({
      name: candidate.name,
      ...(candidate.subscribers === undefined ? {} : { memberCount: candidate.subscribers }),
      relevanceScore: heuristicScore(candidate),
      reasoning: candidate.description
        ? `r/${candidate.name} discusses topics related to this brand: ${candidate.description.slice(0, 180)}`
        : `r/${candidate.name} appears relevant to the brand's audience and industry.`,
      active: selected.length < activeCount,
    })
    if (selected.length >= discoverCount) break
  }

  return selected
}

export const discoverSubreddits = internalAction({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args): Promise<DiscoveryResult> => {
    const project = await ctx.runQuery(
      internal.onboarding.data.loadPipelineProject,
      { projectId: args.projectId },
    )
    if (!project) throw new Error("Project not found")

    const brand = await ctx.runQuery(
      internal.onboarding.data.loadBrandForProject,
      { projectId: args.projectId },
    )
    if (!brand || brand.profileJson.trim() === "{}") {
      throw new Error("Brand profile is missing")
    }

    const profile = JSON.parse(brand.profileJson) as Record<string, unknown>
    const limits = getSubredditDiscoveryLimits(project.plan)
    const keywords = discoveryKeywords(profile)
    const fallbackKeywords = [
      "saas",
      "startups",
      "entrepreneur",
      "smallbusiness",
      "marketing",
      "sales",
      "ProductManagement",
      "B2BMarketing",
    ]
    const accessToken = await getAppAccessToken()
    const candidates = new Map<string, CandidateSubreddit>()

    for (const term of keywords) {
      mergeCandidates(candidates, await searchSubreddits(ctx, accessToken, term))
      if (candidates.size >= 100) break
    }

    if (candidates.size === 0) {
      for (const term of fallbackKeywords) {
        mergeCandidates(candidates, await searchSubreddits(ctx, accessToken, term))
        if (candidates.size >= 50) break
      }
    }

    const candidateList = [...candidates.values()].slice(0, 100)
    if (candidateList.length === 0) {
      await ctx.runMutation(internal.onboarding.data.setSubredditDiscoveryStatus, {
        projectId: args.projectId,
        status: "needs_manual_subreddits",
      })
      return { created: 0, needsManualSubreddits: true }
    }

    const result = await generateObject({
      model: deepseekV4Pro(),
      ...judgeSettings,
      schema: rankedSubredditSchema,
      prompt: [
        "You are selecting the best subreddits for a brand to engage with on Reddit.",
        `Brand Profile:\n${brand.profileJson}`,
        `Candidate subreddits (name, subscribers, description):\n${JSON.stringify(candidateList)}`,
        [
          `Select the top ${limits.discoverCount} subreddits where this brand can find its target audience and provide genuine value.`,
          "For each selected subreddit, provide name without r/, relevanceScore 0-100, and reasoning in 1-2 sentences.",
          "Criteria for high scores:",
          "- Active community with regular posts",
          "- Members match the brand's target audience",
          "- Post topics align with pain points or industry",
          "- Subreddit allows product-related discussions",
          "- Not too large (>5M) and not too small (<5K)",
          "- Sweet spot: 20K-500K members for B2B brands",
          `Return exactly ${limits.discoverCount} subreddits, sorted by relevanceScore descending.`,
        ].join("\n"),
      ].join("\n\n"),
    })

    const subreddits = sanitizeRanked(
      result.object.subreddits,
      candidateList,
      limits.discoverCount,
      limits.activeCount,
    )

    const seeded: { created: number } = await ctx.runMutation(
      internal.onboarding.data.seedDiscoveredSubreddits,
      {
        projectId: args.projectId,
        subreddits,
      },
    )

    return { ...seeded, needsManualSubreddits: false }
  },
})
