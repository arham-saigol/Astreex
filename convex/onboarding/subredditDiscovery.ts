"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { deepseekV4Pro, judgeSettings } from "../lib/ai"
import {
  communityDetails,
  communityFromDetails,
  searchCommunities,
  type FetchLayerCommunity,
} from "../lib/fetchLayer"
import { getSubredditDiscoveryLimits } from "../lib/planLimits"
import { stringifyRulesJson } from "../lib/rules"

type CandidateSubreddit = {
  name: string
  subscribers?: number
  description: string
  rulesJson?: string
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

function candidateFromCommunity(
  community: FetchLayerCommunity,
): CandidateSubreddit | null {
  const displayName =
    community.displayName ??
    community.display_name ??
    community.name ??
    community.subreddit ??
    ""
  const name = normalizeSubredditName(displayName)
  if (!name) return null

  const type = community.subredditType ?? community.type ?? "public"
  if (
    community.over18 ||
    community.nsfw ||
    community.quarantined ||
    community.quarantine ||
    type === "private"
  ) {
    return null
  }

  const subscribers =
    typeof community.subscribers === "number"
      ? community.subscribers
      : typeof community.memberCount === "number"
        ? community.memberCount
        : typeof community.members === "number"
          ? community.members
          : undefined
  const description =
    community.publicDescription ??
    community.public_description ??
    community.description ??
    ""

  return { name, subscribers, description }
}

async function searchSubreddits(
  ctx: Parameters<typeof searchCommunities>[0],
  term: string,
) {
  const communities = await searchCommunities(ctx, term, 10)
  return communities
    .map(candidateFromCommunity)
    .filter((candidate): candidate is CandidateSubreddit => candidate !== null)
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

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
) {
  const results: R[] = []
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  )
  return results
}

async function enrichSelectedSubreddits(
  ctx: Parameters<typeof communityDetails>[0],
  subreddits: ReturnType<typeof sanitizeRanked>,
) {
  return await mapWithConcurrency(subreddits, 5, async (subreddit) => {
    try {
      const payload = await communityDetails(ctx, subreddit.name)
      const details = communityFromDetails(payload)
      const memberCount =
        typeof details.subscribers === "number"
          ? details.subscribers
          : typeof details.memberCount === "number"
            ? details.memberCount
            : typeof details.members === "number"
              ? details.members
              : subreddit.memberCount
      const description =
        details.publicDescription ??
        details.public_description ??
        details.description ??
        undefined

      return {
        ...subreddit,
        memberCount,
        description: description?.slice(0, 1000),
        rulesJson: details.rules === undefined ? undefined : stringifyRulesJson(details.rules),
      }
    } catch {
      return subreddit
    }
  })
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
    const candidates = new Map<string, CandidateSubreddit>()

    for (const term of keywords) {
      mergeCandidates(candidates, await searchSubreddits(ctx, term))
      if (candidates.size >= 100) break
    }

    if (candidates.size === 0) {
      for (const term of fallbackKeywords) {
        mergeCandidates(candidates, await searchSubreddits(ctx, term))
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

    const enrichedSubreddits = await enrichSelectedSubreddits(ctx, subreddits)

    const seeded: { created: number } = await ctx.runMutation(
      internal.onboarding.data.seedDiscoveredSubreddits,
      {
        projectId: args.projectId,
        subreddits: enrichedSubreddits,
      },
    )

    return { ...seeded, needsManualSubreddits: false }
  },
})
