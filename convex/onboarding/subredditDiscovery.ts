"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { deepseekV4Pro, fireworksKimiK26, judgeSettings } from "../lib/ai"
import {
  communityDetails,
  communityFromDetails,
  communityPosts,
  searchCommunities,
  searchPosts,
  type FetchLayerCommunity,
  type FetchLayerPost,
} from "../lib/fetchLayer"
import { getSubredditDiscoveryLimits } from "../lib/planLimits"
import { stringifyRulesJson } from "../lib/rules"

type Rail = "A" | "B"

type CandidateSubreddit = {
  name: string
  rail: Rail
  reason: string
  memberCount?: number
  description?: string
}

type ScoredSubreddit = CandidateSubreddit & {
  relevanceScore: number
  audienceFit: string
  topicFit: string
  promotionRisk: string
  contentOpportunities: string[]
  reasoning: string
  redFlags: string[]
  rulesJson?: string
}

type DiscoveryResult = {
  created: number
  needsManualSubreddits: boolean
}

const shortlistSchema = z.object({
  subreddits: z.array(z.object({
    name: z.string(),
    rail: z.enum(["A", "B"]),
    reason: z.string(),
  })),
})

const scoringSchema = z.object({
  name: z.string(),
  relevanceScore: z.number().min(0).max(100),
  audienceFit: z.string(),
  topicFit: z.string(),
  promotionRisk: z.string(),
  contentOpportunities: z.array(z.string()),
  reasoning: z.string(),
  redFlags: z.array(z.string()),
})

export function normalizeSubredditName(name: string) {
  const normalized = name.replace(/^r\//i, "").trim().toLowerCase()
  if (!/^[a-z0-9_]{3,21}$/.test(normalized)) return null
  return normalized
}

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function collectStrings(value: unknown, output: string[] = []) {
  if (typeof value === "string") {
    output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectStrings(item, output))
    return output
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStrings(item, output))
  }
  return output
}

function keyword(value: string) {
  return value
    .replace(/[^\w\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
}

function discoveryKeywords(intelligence: Record<string, unknown>) {
  const terms = collectStrings({
    icps: intelligence.icps,
    personas: intelligence.personas,
    painPoints: intelligence.painPoints,
    capabilities: intelligence.capabilities,
    redditUsefulAngles: intelligence.redditUsefulAngles,
    positioning: intelligence.positioning,
  })

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

  return keywords.length > 0
    ? keywords
    : ["saas", "startups", "entrepreneur", "smallbusiness", "marketing", "sales"]
}

function candidateFromCommunity(
  community: FetchLayerCommunity,
  rail: Rail,
  reason: string,
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

  const memberCount =
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
    undefined

  return { name, rail, reason, memberCount, description }
}

function subredditFromPost(post: FetchLayerPost) {
  const record = post as Record<string, unknown>
  return normalizeSubredditName(
    asString(record.subreddit) ||
    asString(record.subredditName) ||
    asString(record.community) ||
    asString(record.subreddit_name),
  )
}

function mergeCandidate(
  candidates: Map<string, CandidateSubreddit>,
  candidate: CandidateSubreddit | null,
) {
  if (!candidate) return
  const existing = candidates.get(candidate.name)
  if (!existing || (existing.rail === "B" && candidate.rail === "A")) {
    candidates.set(candidate.name, candidate)
  }
}

async function collectCandidateSubreddits(
  ctx: Parameters<typeof searchCommunities>[0],
  intelligence: Record<string, unknown>,
  maxRailBCandidates: number,
) {
  const keywords = discoveryKeywords(intelligence)
  const candidates = new Map<string, CandidateSubreddit>()
  const railBNames = new Set<string>()

  for (const term of keywords) {
    const communities = await searchCommunities(ctx, term, 10)
    for (const community of communities) {
      mergeCandidate(
        candidates,
        candidateFromCommunity(community, "A", `Direct community search for "${term}".`),
      )
    }
    if (candidates.size >= 80) break
  }

  for (const term of keywords) {
    if (railBNames.size >= maxRailBCandidates) break
    const posts = await searchPosts(ctx, {
      query: term,
      sort: "relevance",
      time: "month",
      limit: 15,
    })
    for (const post of posts) {
      const name = subredditFromPost(post)
      if (!name || railBNames.has(name)) continue
      railBNames.add(name)
      mergeCandidate(candidates, {
        name,
        rail: "B",
        reason: `Relevant post search result for "${term}".`,
      })
      if (railBNames.size >= maxRailBCandidates) break
    }
  }

  return [...candidates.values()].slice(0, 100)
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

function sanitizeShortlist(
  raw: Array<{ name: string; rail: Rail; reason: string }>,
  candidates: CandidateSubreddit[],
  shortlistCount: number,
) {
  const candidateByName = new Map(candidates.map((candidate) => [candidate.name, candidate]))
  const seen = new Set<string>()
  const selected: CandidateSubreddit[] = []

  for (const item of raw) {
    const name = normalizeSubredditName(item.name)
    if (!name || seen.has(name)) continue
    const candidate = candidateByName.get(name)
    if (!candidate) continue
    seen.add(name)
    selected.push({
      ...candidate,
      rail: item.rail,
      reason: item.reason.trim() || candidate.reason,
    })
    if (selected.length >= shortlistCount) return selected
  }

  for (const candidate of candidates) {
    if (seen.has(candidate.name)) continue
    seen.add(candidate.name)
    selected.push(candidate)
    if (selected.length >= shortlistCount) break
  }

  return selected
}

async function shortlistWithKimi(
  candidates: CandidateSubreddit[],
  intelligenceJson: string,
  shortlistCount: number,
) {
  const result = await generateObject({
    model: fireworksKimiK26(),
    ...judgeSettings,
    schema: shortlistSchema,
    prompt: [
      "Shortlist subreddits for Reddit distribution using only the supplied candidates.",
      "Return no scores. Return name without r/, rail A or B, and a concise reason.",
      `Return at most ${shortlistCount} subreddits.`,
      `Project intelligence JSON:\n${intelligenceJson}`,
      `Candidates JSON:\n${JSON.stringify(candidates)}`,
    ].join("\n\n"),
  })

  return sanitizeShortlist(result.object.subreddits, candidates, shortlistCount)
}

async function enrichAndScoreSubreddit(
  ctx: Parameters<typeof communityDetails>[0],
  candidate: CandidateSubreddit,
  intelligenceJson: string,
): Promise<ScoredSubreddit | null> {
  const name = normalizeSubredditName(candidate.name)
  if (!name) return null

  let details: FetchLayerCommunity = {}
  let rulesJson = ""
  try {
    details = communityFromDetails(await communityDetails(ctx, name))
    rulesJson = details.rules === undefined ? "" : stringifyRulesJson(details.rules)
  } catch {
    details = {}
  }

  const [hotPosts, topPosts] = await Promise.all([
    communityPosts(ctx, name, { sort: "hot", limit: 15 }).catch(() => []),
    communityPosts(ctx, name, { sort: "top", time: "month", limit: 15 }).catch(() => []),
  ])
  const memberCount =
    typeof details.subscribers === "number"
      ? details.subscribers
      : typeof details.memberCount === "number"
        ? details.memberCount
        : typeof details.members === "number"
          ? details.members
          : candidate.memberCount
  const description =
    details.publicDescription ??
    details.public_description ??
    details.description ??
    candidate.description ??
    ""

  const result = await generateObject({
    model: deepseekV4Pro(),
    ...judgeSettings,
    schema: scoringSchema,
    prompt: [
      "Score one subreddit for a B2B founder's Reddit distribution workflow.",
      "Return only the strict schema fields. Score 0-100.",
      `Project intelligence JSON:\n${intelligenceJson}`,
      `Subreddit JSON:\n${JSON.stringify({
        name,
        rail: candidate.rail,
        memberCount,
        description,
        rulesJson,
        hotPosts: hotPosts.slice(0, 10).map((post) => ({
          title: post.title ?? "",
          selftext: post.selftext ?? post.text ?? post.body ?? "",
          score: post.score,
          commentCount: post.commentCount ?? post.numComments ?? post.num_comments,
        })),
        topPosts: topPosts.slice(0, 10).map((post) => ({
          title: post.title ?? "",
          selftext: post.selftext ?? post.text ?? post.body ?? "",
          score: post.score,
          commentCount: post.commentCount ?? post.numComments ?? post.num_comments,
        })),
      })}`,
    ].join("\n\n"),
  })

  const scoredName = normalizeSubredditName(result.object.name)
  if (scoredName !== name) return null

  return {
    ...candidate,
    name,
    memberCount,
    description: description.slice(0, 1000),
    rulesJson,
    relevanceScore: Math.round(result.object.relevanceScore),
    audienceFit: result.object.audienceFit,
    topicFit: result.object.topicFit,
    promotionRisk: result.object.promotionRisk,
    contentOpportunities: result.object.contentOpportunities,
    reasoning: result.object.reasoning,
    redFlags: result.object.redFlags,
  }
}

function sweetSpotRank(memberCount?: number) {
  if (memberCount === undefined) return 2
  if (memberCount >= 20_000 && memberCount <= 500_000) return 0
  if (memberCount >= 5_000 && memberCount <= 1_000_000) return 1
  return 2
}

export function selectSubredditsDeterministically(
  scored: ScoredSubreddit[],
  limits: {
    activeSubredditLimit: number
    inactiveBackupLimit: number
    activeScoreThreshold: number
    backupScoreThreshold: number
  },
) {
  const sorted = [...scored].sort((a, b) => {
    if (a.relevanceScore !== b.relevanceScore) return b.relevanceScore - a.relevanceScore
    const sweetSpotDiff = sweetSpotRank(a.memberCount) - sweetSpotRank(b.memberCount)
    if (sweetSpotDiff !== 0) return sweetSpotDiff
    return a.name.localeCompare(b.name)
  })

  const active: ScoredSubreddit[] = []
  const inactive: ScoredSubreddit[] = []
  const activeOverflow: ScoredSubreddit[] = []

  for (const subreddit of sorted) {
    if (subreddit.relevanceScore >= limits.activeScoreThreshold) {
      if (active.length < limits.activeSubredditLimit) {
        active.push(subreddit)
      } else {
        activeOverflow.push(subreddit)
      }
    } else if (subreddit.relevanceScore >= limits.backupScoreThreshold) {
      inactive.push(subreddit)
    }
  }

  return [
    ...active.map((subreddit) => ({ ...subreddit, active: true })),
    ...[...activeOverflow, ...inactive]
      .slice(0, limits.inactiveBackupLimit)
      .map((subreddit) => ({ ...subreddit, active: false })),
  ]
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

    const profile = await ctx.runQuery(
      internal.onboarding.data.loadProjectIntelligenceProfile,
      { projectId: args.projectId },
    )
    if (!profile || profile.intelligenceJson.trim() === "{}") {
      throw new Error("Project intelligence profile is missing")
    }

    const intelligence = JSON.parse(profile.intelligenceJson) as Record<string, unknown>
    const limits = getSubredditDiscoveryLimits(project.plan)
    const candidates = await collectCandidateSubreddits(
      ctx,
      intelligence,
      limits.maxRailBCandidates,
    )

    if (candidates.length === 0) {
      await ctx.runMutation(internal.onboarding.data.setSubredditDiscoveryStatus, {
        projectId: args.projectId,
        status: "needs_manual_subreddits",
      })
      return { created: 0, needsManualSubreddits: true }
    }

    const shortlist = await shortlistWithKimi(
      candidates,
      profile.intelligenceJson,
      limits.shortlistCount,
    )
    const scored = (await mapWithConcurrency(shortlist, 5, (candidate) =>
      enrichAndScoreSubreddit(ctx, candidate, profile.intelligenceJson),
    )).filter((subreddit): subreddit is ScoredSubreddit => subreddit !== null)
    const selected = selectSubredditsDeterministically(scored, limits)

    const seeded: { created: number } = await ctx.runMutation(
      internal.onboarding.data.seedDiscoveredSubreddits,
      {
        projectId: args.projectId,
        subreddits: selected.map((subreddit) => ({
          name: subreddit.name,
          memberCount: subreddit.memberCount,
          description: subreddit.description,
          rulesJson: subreddit.rulesJson,
          relevanceScore: subreddit.relevanceScore,
          reasoning: subreddit.reasoning,
          active: subreddit.active,
        })),
      },
    )

    if (seeded.created === 0) {
      await ctx.runMutation(internal.onboarding.data.setSubredditDiscoveryStatus, {
        projectId: args.projectId,
        status: "needs_manual_subreddits",
      })
      return { ...seeded, needsManualSubreddits: true }
    }

    return { ...seeded, needsManualSubreddits: false }
  },
})
