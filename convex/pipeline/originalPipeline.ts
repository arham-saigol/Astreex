"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction, type ActionCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"
import {
  deepseekHighReasoningOptions,
  deepseekMaxReasoningOptions,
  deepseekV4Pro,
  judgeSettings,
} from "../lib/ai"
import { getPipelineLimits, type Plan } from "../lib/planLimits"
import { compactIntelligenceJson } from "./intelligenceContext"
import type {
  OriginalDraft,
  OriginalDraftJudgeDecision,
  OriginalPostBrief,
  OriginalSignal,
  OriginalTheme,
} from "./validators"

const SCOUT_CHUNK_SIZE = 5
const ANGLES_PER_THEME = 3
export const ORIGINAL_REWRITE_ROUNDS = 2

type OriginalPipelineContext = {
  project: { plan: Plan }
  brand: { intelligenceJson: string }
  subreddits: Array<{
    name: string
    memberCount: number | null
    description: string | null
    rulesJson: string | null
    relevanceScore: number
    reasoning: string
  }>
  recentPosts: Array<{
    _id: string
    redditPostId: string
    subreddit: string
    title: string
    selftext?: string
    url: string
    score: number
    commentCount: number
    postedAt: number
  }>
  performance: unknown
}

type OriginalPipelineCounts = {
  originalSignals?: number
  originalThemes?: number
  originalDrafts?: number
  selectedOriginals?: number
  originalRewrites?: number
}

type DraftCandidate = {
  draftId: string
  draft: OriginalDraft
  brief: OriginalPostBrief
}

const signalScoutSchema = z.object({
  signals: z.array(z.object({
    subreddit: z.string(),
    sourceId: z.string().optional(),
    sourceType: z.enum(["post", "comment"]).optional(),
    sourceTitle: z.string().optional(),
    sourceExcerpt: z.string().optional(),
    painPoint: z.string(),
    whyItMatters: z.string(),
    possiblePostDirection: z.string(),
  })),
})

const plannerSchema = z.object({
  briefs: z.array(z.object({
    targetSubreddit: z.string(),
    titleAngle: z.string(),
    bodyDirection: z.string(),
    rationale: z.string().optional(),
    signalIds: z.array(z.string()).optional(),
  })),
})

const themeClusterSchema = z.object({
  themes: z.array(z.object({
    themeId: z.string().optional(),
    title: z.string(),
    summary: z.string(),
    signalIds: z.array(z.string()).optional(),
    targetSubreddits: z.array(z.string()).optional(),
  })),
})

const themeJudgeSchema = z.object({
  selectedThemeIds: z.array(z.string()),
})

const angleGeneratorSchema = z.object({
  angles: z.array(z.object({
    themeId: z.string(),
    angleId: z.string().optional(),
    targetSubreddit: z.string(),
    titleAngle: z.string(),
    bodyDirection: z.string(),
    rationale: z.string().optional(),
  })),
})

const angleJudgeSchema = z.object({
  selectedAngleIds: z.array(z.string()),
})

const finalJudgeSchema = z.object({
  selectedDraftIds: z.array(z.string()),
  decisions: z.array(z.object({
    draftId: z.string(),
    approved: z.boolean(),
    reason: z.string().optional(),
    rewriteInstructions: z.string().optional(),
    score: z.number().optional(),
  })).optional(),
})

function normalizeSubredditName(name: string) {
  return name.replace(/^r\//i, "").trim().toLowerCase()
}

function truncate(value: string | undefined, length: number) {
  if (!value) return ""
  return value.length > length ? `${value.slice(0, length)}...` : value
}

function stableHash(value: string) {
  let hash = 5381
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 33) ^ value.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

export function originalScoutChunks(subreddits: string[], plan: Plan) {
  const limit = getPipelineLimits(plan).activeSubredditLimit
  const capped = subreddits.slice(0, limit)
  const chunks: string[][] = []

  for (let index = 0; index < capped.length; index += SCOUT_CHUNK_SIZE) {
    chunks.push(capped.slice(index, index + SCOUT_CHUNK_SIZE))
  }

  return chunks
}

export function desiredOriginalThemeCount(plan: Plan) {
  return getPipelineLimits(plan).originalCardsPerDay * 2
}

function postPrompt(post: OriginalPipelineContext["recentPosts"][number]) {
  return {
    sourceId: String(post._id),
    redditPostId: post.redditPostId,
    subreddit: post.subreddit,
    title: post.title,
    selftext: truncate(post.selftext, 600),
    url: post.url,
    score: post.score,
    commentCount: post.commentCount,
    postedAt: new Date(post.postedAt).toISOString(),
  }
}

function subredditPrompt(context: OriginalPipelineContext, names: string[]) {
  const allowed = new Set(names.map(normalizeSubredditName))
  return context.subreddits
    .filter((subreddit) => allowed.has(normalizeSubredditName(subreddit.name)))
    .map((subreddit) => ({
      name: normalizeSubredditName(subreddit.name),
      memberCount: subreddit.memberCount,
      description: truncate(subreddit.description ?? undefined, 800),
      rulesJson: truncate(subreddit.rulesJson ?? undefined, 1200),
      relevanceScore: subreddit.relevanceScore,
      reasoning: subreddit.reasoning,
    }))
}

function sourceIdsForSubreddits(context: OriginalPipelineContext, subreddits: string[]) {
  const allowed = new Set(subreddits.map(normalizeSubredditName))
  return new Set(context.recentPosts
    .filter((post) => allowed.has(normalizeSubredditName(post.subreddit)))
    .map((post) => String(post._id)))
}

function fallbackSignals(
  context: OriginalPipelineContext,
  subreddits: string[],
  limit: number,
) {
  const allowed = new Set(subreddits.map(normalizeSubredditName))
  return [...context.recentPosts]
    .filter((post) => allowed.has(normalizeSubredditName(post.subreddit)))
    .sort((a, b) => {
      const scoreA = Math.log1p(Math.max(0, a.commentCount)) * 8 + Math.log1p(Math.max(0, a.score))
      const scoreB = Math.log1p(Math.max(0, b.commentCount)) * 8 + Math.log1p(Math.max(0, b.score))
      return scoreB - scoreA
    })
    .slice(0, limit)
    .map((post, index): OriginalSignal => ({
      signalId: `signal_${stableHash(`${post._id}:${index}`)}`,
      subreddit: normalizeSubredditName(post.subreddit),
      sourceId: String(post._id),
      sourceType: "post",
      sourceTitle: post.title,
      sourceExcerpt: truncate(post.selftext, 300),
      painPoint: post.title,
      whyItMatters: "Deterministic fallback from recent subreddit activity.",
      possiblePostDirection: `Write a useful post responding to the discussion pattern behind: ${post.title}`,
    }))
}

export function sanitizeOriginalSignals(
  rawSignals: Array<{
    subreddit: string
    sourceId?: string
    sourceType?: "post" | "comment"
    sourceTitle?: string
    sourceExcerpt?: string
    painPoint: string
    whyItMatters: string
    possiblePostDirection: string
  }>,
  context: OriginalPipelineContext,
  subreddits: string[],
  limit: number,
) {
  const allowedSubreddits = new Set(subreddits.map(normalizeSubredditName))
  const sourceIds = sourceIdsForSubreddits(context, subreddits)
  const signals: OriginalSignal[] = []
  const seen = new Set<string>()

  for (const signal of rawSignals) {
    const subreddit = normalizeSubredditName(signal.subreddit)
    const sourceId = signal.sourceId ? String(signal.sourceId) : ""
    if (!allowedSubreddits.has(subreddit)) continue
    if (!sourceIds.has(sourceId)) continue

    const painPoint = signal.painPoint.trim()
    const possiblePostDirection = signal.possiblePostDirection.trim()
    const whyItMatters = signal.whyItMatters.trim()
    if (!painPoint || !possiblePostDirection || !whyItMatters) continue

    const dedupeKey = `${subreddit}:${painPoint.toLowerCase()}:${possiblePostDirection.toLowerCase()}`
    if (seen.has(dedupeKey)) continue

    signals.push({
      signalId: `signal_${stableHash(dedupeKey)}`,
      subreddit,
      sourceId,
      sourceType: signal.sourceType ?? "post",
      sourceTitle: signal.sourceTitle?.trim() || undefined,
      sourceExcerpt: signal.sourceExcerpt?.trim() || undefined,
      painPoint,
      whyItMatters,
      possiblePostDirection,
    })
    seen.add(dedupeKey)
    if (signals.length >= limit) return signals
  }

  for (const signal of fallbackSignals(context, subreddits, limit)) {
    const dedupeKey = `${signal.subreddit}:${signal.painPoint.toLowerCase()}:${signal.possiblePostDirection.toLowerCase()}`
    if (seen.has(dedupeKey)) continue
    signals.push(signal)
    seen.add(dedupeKey)
    if (signals.length >= limit) return signals
  }

  return signals
}

export function sanitizeOriginalThemes(
  rawThemes: Array<{
    themeId?: string
    title: string
    summary: string
    signalIds?: string[]
    targetSubreddits?: string[]
  }>,
  signals: OriginalSignal[],
  targetCount: number,
) {
  const signalById = new Map(signals.map((signal) => [signal.signalId, signal]))
  const allowedSubreddits = new Set(signals.map((signal) => signal.subreddit))
  const themes: OriginalTheme[] = []
  const seen = new Set<string>()

  for (const theme of rawThemes) {
    const title = theme.title.trim()
    const summary = theme.summary.trim()
    if (!title || !summary) continue

    const dedupeKey = title.toLowerCase()
    if (seen.has(dedupeKey)) continue

    const signalIds = (theme.signalIds ?? []).filter((id, index, ids) =>
      signalById.has(id) && ids.indexOf(id) === index,
    )
    const targetSubreddits = (theme.targetSubreddits ?? [])
      .map(normalizeSubredditName)
      .filter((subreddit, index, names) =>
        allowedSubreddits.has(subreddit) && names.indexOf(subreddit) === index,
      )
    const fallbackSignal = signalIds[0] ? signalById.get(signalIds[0]) : undefined

    themes.push({
      themeId: theme.themeId?.trim() || `theme_${stableHash(dedupeKey)}`,
      title,
      summary,
      signalIds,
      targetSubreddits: targetSubreddits.length > 0
        ? targetSubreddits
        : fallbackSignal ? [fallbackSignal.subreddit] : [],
    })
    seen.add(dedupeKey)
    if (themes.length >= targetCount) return themes
  }

  for (const signal of signals) {
    if (themes.length >= targetCount) break
    const title = signal.possiblePostDirection.slice(0, 80)
    const dedupeKey = title.toLowerCase()
    if (seen.has(dedupeKey)) continue

    themes.push({
      themeId: `theme_${stableHash(`${signal.signalId}:${title}`)}`,
      title,
      summary: signal.whyItMatters,
      signalIds: [signal.signalId],
      targetSubreddits: [signal.subreddit],
    })
    seen.add(dedupeKey)
  }

  return themes
}

export function sanitizeThemeSelection(
  themes: OriginalTheme[],
  selectedThemeIds: string[],
  targetCount: number,
) {
  const byId = new Map(themes.map((theme) => [theme.themeId, theme]))
  const selected: OriginalTheme[] = []
  const seen = new Set<string>()

  for (const themeId of selectedThemeIds) {
    const theme = byId.get(themeId)
    if (!theme || seen.has(themeId)) continue
    selected.push(theme)
    seen.add(themeId)
    if (selected.length >= targetCount) return selected
  }

  for (const theme of themes) {
    if (seen.has(theme.themeId)) continue
    selected.push(theme)
    seen.add(theme.themeId)
    if (selected.length >= targetCount) return selected
  }

  return selected
}

export function sanitizePostBriefs(
  rawBriefs: Array<{
    targetSubreddit: string
    titleAngle: string
    bodyDirection: string
    rationale?: string
    signalIds?: string[]
    themeId?: string
  }>,
  signals: OriginalSignal[],
  allowedSubreddits: string[],
  targetCount: number,
) {
  const signalById = new Map(signals.map((signal) => [signal.signalId, signal]))
  const allowed = new Set(allowedSubreddits.map(normalizeSubredditName))
  const briefs: OriginalPostBrief[] = []
  const seen = new Set<string>()

  for (const brief of rawBriefs) {
    const targetSubreddit = normalizeSubredditName(brief.targetSubreddit)
    const titleAngle = brief.titleAngle.trim()
    const bodyDirection = brief.bodyDirection.trim()
    if (!allowed.has(targetSubreddit) || !titleAngle || !bodyDirection) continue

    const dedupeKey = `${targetSubreddit}:${titleAngle.toLowerCase()}`
    if (seen.has(dedupeKey)) continue

    briefs.push({
      briefId: `brief_${stableHash(dedupeKey)}`,
      targetSubreddit,
      titleAngle,
      bodyDirection,
      rationale: brief.rationale?.trim() || undefined,
      signalIds: (brief.signalIds ?? []).filter((id, index, ids) =>
        signalById.has(id) && ids.indexOf(id) === index,
      ),
      themeId: brief.themeId,
    })
    seen.add(dedupeKey)
    if (briefs.length >= targetCount) return briefs
  }

  for (const signal of signals) {
    if (briefs.length >= targetCount) break
    if (!allowed.has(signal.subreddit)) continue

    const dedupeKey = `${signal.subreddit}:${signal.possiblePostDirection.toLowerCase()}`
    if (seen.has(dedupeKey)) continue

    briefs.push({
      briefId: `brief_${stableHash(dedupeKey)}`,
      targetSubreddit: signal.subreddit,
      titleAngle: signal.possiblePostDirection,
      bodyDirection: `Address this pain point without pitching: ${signal.painPoint}`,
      rationale: signal.whyItMatters,
      signalIds: [signal.signalId],
    })
    seen.add(dedupeKey)
  }

  return briefs
}

type AngleOption = OriginalPostBrief & { angleId: string }

export function sanitizeAngleOptions(
  rawAngles: Array<{
    themeId: string
    angleId?: string
    targetSubreddit: string
    titleAngle: string
    bodyDirection: string
    rationale?: string
  }>,
  themes: OriginalTheme[],
  allowedSubreddits: string[],
) {
  const themeById = new Map(themes.map((theme) => [theme.themeId, theme]))
  const allowed = new Set(allowedSubreddits.map(normalizeSubredditName))
  const byTheme = new Map<string, AngleOption[]>()

  for (const angle of rawAngles) {
    const theme = themeById.get(angle.themeId)
    const targetSubreddit = normalizeSubredditName(angle.targetSubreddit)
    const titleAngle = angle.titleAngle.trim()
    const bodyDirection = angle.bodyDirection.trim()
    if (!theme || !allowed.has(targetSubreddit) || !titleAngle || !bodyDirection) continue

    const existing = byTheme.get(theme.themeId) ?? []
    if (existing.length >= ANGLES_PER_THEME) continue
    if (existing.some((item) => item.titleAngle.toLowerCase() === titleAngle.toLowerCase())) {
      continue
    }

    const key = `${theme.themeId}:${targetSubreddit}:${titleAngle}`
    existing.push({
      angleId: angle.angleId?.trim() || `angle_${stableHash(key)}`,
      briefId: `brief_${stableHash(key)}`,
      themeId: theme.themeId,
      targetSubreddit,
      titleAngle,
      bodyDirection,
      rationale: angle.rationale?.trim() || theme.summary,
      signalIds: theme.signalIds,
    })
    byTheme.set(theme.themeId, existing)
  }

  for (const theme of themes) {
    const existing = byTheme.get(theme.themeId) ?? []
    const targetSubreddits = theme.targetSubreddits.length > 0
      ? theme.targetSubreddits
      : [...allowed].slice(0, 1)

    while (existing.length < ANGLES_PER_THEME && targetSubreddits.length > 0) {
      const targetSubreddit = targetSubreddits[existing.length % targetSubreddits.length]
      const key = `${theme.themeId}:${targetSubreddit}:fallback:${existing.length}`
      existing.push({
        angleId: `angle_${stableHash(key)}`,
        briefId: `brief_${stableHash(key)}`,
        themeId: theme.themeId,
        targetSubreddit,
        titleAngle: `${theme.title}${existing.length === 0 ? "" : ` (${existing.length + 1})`}`,
        bodyDirection: theme.summary,
        rationale: theme.summary,
        signalIds: theme.signalIds,
      })
    }

    byTheme.set(theme.themeId, existing)
  }

  return themes.flatMap((theme) => byTheme.get(theme.themeId) ?? [])
}

export function sanitizeAngleFitSelection(
  angles: AngleOption[],
  selectedAngleIds: string[],
  themes: OriginalTheme[],
) {
  const angleById = new Map(angles.map((angle) => [angle.angleId, angle]))
  const selectedByTheme = new Map<string, OriginalPostBrief>()

  for (const angleId of selectedAngleIds) {
    const angle = angleById.get(angleId)
    if (!angle || !angle.themeId || selectedByTheme.has(angle.themeId)) continue
    selectedByTheme.set(angle.themeId, angle)
  }

  for (const theme of themes) {
    if (selectedByTheme.has(theme.themeId)) continue
    const fallback = angles.find((angle) => angle.themeId === theme.themeId)
    if (fallback) selectedByTheme.set(theme.themeId, fallback)
  }

  return themes
    .map((theme) => selectedByTheme.get(theme.themeId))
    .filter((brief): brief is OriginalPostBrief => Boolean(brief))
}

export function draftPrompt(drafts: DraftCandidate[]) {
  return drafts.map((candidate) => ({
    draftId: candidate.draftId,
    subreddit: candidate.draft.targetSubreddit,
    title: candidate.draft.title,
    body: candidate.draft.body,
    brief: candidate.brief,
  }))
}

export function sanitizeFinalOriginalSelection(
  drafts: DraftCandidate[],
  selectedDraftIds: string[],
  targetCount: number,
  forceFill: boolean,
) {
  const byId = new Map(drafts.map((draft) => [draft.draftId, draft]))
  const selected: DraftCandidate[] = []
  const seen = new Set<string>()

  for (const draftId of selectedDraftIds) {
    const draft = byId.get(draftId)
    if (!draft || seen.has(draftId)) continue
    selected.push(draft)
    seen.add(draftId)
    if (selected.length >= targetCount) return selected
  }

  if (!forceFill) return selected

  for (const draft of drafts) {
    if (seen.has(draft.draftId)) continue
    selected.push(draft)
    seen.add(draft.draftId)
    if (selected.length >= targetCount) return selected
  }

  return selected
}

function reasoningForOriginal(plan: Plan, stage: "growth" | "scale" | "starter") {
  if (stage === "starter") return deepseekMaxReasoningOptions
  if (plan === "scale") return deepseekMaxReasoningOptions
  return deepseekHighReasoningOptions
}

async function runSignalScout(
  context: OriginalPipelineContext,
  subreddits: string[],
) {
  const plan = context.project.plan
  const posts = context.recentPosts
    .filter((post) => subreddits.includes(normalizeSubredditName(post.subreddit)))
    .map(postPrompt)
  const limit = plan === "starter" ? 20 : 20
  const result = await generateObject({
    model: deepseekV4Pro(),
    ...judgeSettings,
    ...deepseekHighReasoningOptions,
    schema: signalScoutSchema,
    prompt: [
      `Signal Scout: find ${plan === "starter" ? "5-20" : `up to ${limit}`} original-post signals for these subreddits.`,
      "Each signal must reference a provided sourceId, name the pain point, explain why it matters, and suggest a possible original post direction.",
      "Prefer recurring problems, nuanced founder lessons, tactical questions, and discussion patterns. Avoid inventing facts.",
      `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "original")}`,
      `Subreddit metadata JSON: ${JSON.stringify(subredditPrompt(context, subreddits))}`,
      `Recent source posts JSON: ${JSON.stringify(posts)}`,
      `Recent performance JSON: ${JSON.stringify(context.performance)}`,
    ].join("\n\n"),
  })

  return sanitizeOriginalSignals(result.object.signals, context, subreddits, limit)
}

async function runStarterPlanner(
  context: OriginalPipelineContext,
  signals: OriginalSignal[],
) {
  const targetCount = 2
  const allowedSubreddits = context.subreddits.map((subreddit) => subreddit.name)
  const result = await generateObject({
    model: deepseekV4Pro(),
    ...judgeSettings,
    ...deepseekMaxReasoningOptions,
    schema: plannerSchema,
    prompt: [
      "Post Opportunity Planner: group these signals into strong original-post opportunities.",
      `Return exactly ${targetCount} post briefs. Each brief needs targetSubreddit, titleAngle, bodyDirection, rationale, and relevant signalIds.`,
      "Pick only angles that are likely to fit the target subreddit and sound like a helpful founder, not a marketer.",
      `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "original")}`,
      `Subreddit metadata JSON: ${JSON.stringify(context.subreddits)}`,
      `Signals JSON: ${JSON.stringify(signals)}`,
    ].join("\n\n"),
  })

  return sanitizePostBriefs(result.object.briefs, signals, allowedSubreddits, targetCount)
}

async function runThemeClusterer(
  context: OriginalPipelineContext,
  signals: OriginalSignal[],
) {
  const targetCount = desiredOriginalThemeCount(context.project.plan)
  const result = await generateObject({
    model: deepseekV4Pro(),
    ...judgeSettings,
    ...deepseekMaxReasoningOptions,
    schema: themeClusterSchema,
    prompt: [
      "Theme Clusterer: cluster original-post signals into distinct themes.",
      `Return ${targetCount} themes: 2x today's original-card target before judging.`,
      "Each theme should include title, summary, relevant signalIds, and likely targetSubreddits.",
      `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "original")}`,
      `Signals JSON: ${JSON.stringify(signals)}`,
    ].join("\n\n"),
  })

  return sanitizeOriginalThemes(result.object.themes, signals, targetCount)
}

async function runThemeJudge(
  context: OriginalPipelineContext,
  themes: OriginalTheme[],
) {
  const targetCount = getPipelineLimits(context.project.plan).originalCardsPerDay
  const result = await generateObject({
    model: deepseekV4Pro(),
    ...judgeSettings,
    ...reasoningForOriginal(context.project.plan, context.project.plan === "scale" ? "scale" : "growth"),
    schema: themeJudgeSchema,
    prompt: [
      "Post Opportunity Judge: select the strongest original-post themes for today.",
      `Return exactly ${targetCount} themeIds.`,
      "Prioritize useful, low-risk, non-promotional themes with clear subreddit fit and variety.",
      `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "judge")}`,
      `Recent performance JSON: ${JSON.stringify(context.performance)}`,
      `Themes JSON: ${JSON.stringify(themes)}`,
    ].join("\n\n"),
  })

  return sanitizeThemeSelection(themes, result.object.selectedThemeIds, targetCount)
}

async function runAngleGenerator(
  context: OriginalPipelineContext,
  themes: OriginalTheme[],
) {
  const allowedSubreddits = context.subreddits.map((subreddit) => subreddit.name)
  const result = await generateObject({
    model: deepseekV4Pro(),
    ...judgeSettings,
    ...reasoningForOriginal(context.project.plan, context.project.plan === "scale" ? "scale" : "growth"),
    schema: angleGeneratorSchema,
    prompt: [
      "Angle Generator: generate subreddit-fit original post angles for each selected theme.",
      `Return ${ANGLES_PER_THEME} angle options per theme.`,
      "Each angle needs themeId, targetSubreddit, titleAngle, bodyDirection, and rationale.",
      `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "original")}`,
      `Subreddit metadata JSON: ${JSON.stringify(context.subreddits)}`,
      `Selected themes JSON: ${JSON.stringify(themes)}`,
    ].join("\n\n"),
  })

  return sanitizeAngleOptions(result.object.angles, themes, allowedSubreddits)
}

async function runAngleFitJudge(
  context: OriginalPipelineContext,
  angles: AngleOption[],
  themes: OriginalTheme[],
) {
  const result = await generateObject({
    model: deepseekV4Pro(),
    ...judgeSettings,
    ...reasoningForOriginal(context.project.plan, context.project.plan === "scale" ? "scale" : "growth"),
    schema: angleJudgeSchema,
    prompt: [
      "Angle Fit Judge: choose one angle per theme with the best subreddit fit.",
      "Return selectedAngleIds. Favor usefulness, specificity, and low moderation risk.",
      `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "judge")}`,
      `Angle options JSON: ${JSON.stringify(angles)}`,
    ].join("\n\n"),
  })

  return sanitizeAngleFitSelection(angles, result.object.selectedAngleIds, themes)
}

async function draftBriefs(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  briefs: OriginalPostBrief[],
) {
  const results = await Promise.allSettled(briefs.map((brief) =>
    ctx.runAction(internal.pipeline.draftAgent.generateOriginalPostFromBrief, {
      projectId,
      brief,
    }),
  ))
  const candidates: DraftCandidate[] = []

  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      const brief = briefs[index]
      candidates.push({
        draftId: `draft_${stableHash(`${brief.briefId}:${result.value.title}:${index}`)}`,
        draft: result.value as OriginalDraft,
        brief,
      })
    } else {
      console.error("Original draft generation failed", result.reason)
    }
  }

  return candidates
}

async function runFinalJudge(
  context: OriginalPipelineContext,
  candidates: DraftCandidate[],
  targetCount: number,
) {
  const result = await generateObject({
    model: deepseekV4Pro(),
    ...judgeSettings,
    ...reasoningForOriginal(context.project.plan, context.project.plan === "scale" ? "scale" : "growth"),
    schema: finalJudgeSchema,
    prompt: [
      "Final Post Judge: select original Reddit post cards for today's feed.",
      `Return up to ${targetCount} selectedDraftIds plus decisions for rejected drafts with rewriteInstructions when useful.`,
      "Approve only posts that are useful, subreddit-fit, non-promotional, specific, and low moderation risk.",
      `Project intelligence JSON: ${compactIntelligenceJson(context.brand.intelligenceJson, "judge")}`,
      `Recent performance JSON: ${JSON.stringify(context.performance)}`,
      `Drafts JSON: ${JSON.stringify(draftPrompt(candidates))}`,
    ].join("\n\n"),
  })

  return {
    selectedDraftIds: result.object.selectedDraftIds,
    decisions: result.object.decisions ?? [],
  }
}

async function rewriteRejected(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  candidates: DraftCandidate[],
  selected: DraftCandidate[],
  decisions: OriginalDraftJudgeDecision[],
) {
  const selectedIds = new Set(selected.map((candidate) => candidate.draftId))
  const decisionById = new Map(decisions.map((decision) => [decision.draftId, decision]))
  const rejected = candidates.filter((candidate) => !selectedIds.has(candidate.draftId))

  const results = await Promise.allSettled(rejected.map((candidate) => {
    const decision = decisionById.get(candidate.draftId)
    return ctx.runAction(internal.pipeline.draftAgent.rewriteOriginalPostFromBrief, {
      projectId,
      brief: candidate.brief,
      currentDraft: candidate.draft,
      rewriteInstructions: decision?.rewriteInstructions?.trim() ||
        decision?.reason?.trim() ||
        "Improve subreddit fit, usefulness, specificity, and reduce promotional risk.",
    })
  }))

  const rewrittenByOldId = new Map<string, DraftCandidate>()
  let rewriteCount = 0
  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") {
      const old = rejected[index]
      const draft = result.value as OriginalDraft
      rewrittenByOldId.set(old.draftId, {
        draftId: `draft_${stableHash(`${old.brief.briefId}:${draft.title}:${Date.now()}:${index}`)}`,
        draft,
        brief: old.brief,
      })
      rewriteCount++
    } else {
      console.error("Original rewrite failed", result.reason)
    }
  }

  return {
    candidates: candidates.map((candidate) =>
      rewrittenByOldId.get(candidate.draftId) ?? candidate,
    ),
    rewriteCount,
  }
}

async function selectWithRewrites(
  ctx: ActionCtx,
  projectId: Id<"projects">,
  context: OriginalPipelineContext,
  initialCandidates: DraftCandidate[],
  targetCount: number,
) {
  let candidates = initialCandidates
  let rewriteCount = 0
  let lastSelectedIds: string[] = []

  for (let round = 0; round <= ORIGINAL_REWRITE_ROUNDS; round++) {
    const judge = await runFinalJudge(context, candidates, targetCount)
    lastSelectedIds = judge.selectedDraftIds
    const selected = sanitizeFinalOriginalSelection(
      candidates,
      judge.selectedDraftIds,
      targetCount,
      false,
    )

    if (selected.length >= Math.min(targetCount, candidates.length)) {
      return { selected, rewriteCount }
    }
    if (round === ORIGINAL_REWRITE_ROUNDS) break

    const rewritten = await rewriteRejected(
      ctx,
      projectId,
      candidates,
      selected,
      judge.decisions,
    )
    candidates = rewritten.candidates
    rewriteCount += rewritten.rewriteCount
  }

  return {
    selected: sanitizeFinalOriginalSelection(
      candidates,
      lastSelectedIds,
      targetCount,
      true,
    ),
    rewriteCount,
  }
}

export const generateDailyOriginalDrafts = internalAction({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args): Promise<{
    drafts: OriginalDraft[]
    counts: OriginalPipelineCounts
  }> => {
    const context: OriginalPipelineContext = await ctx.runQuery(
      internal.pipeline.data.loadOriginalPipelineContext,
      { projectId: args.projectId },
    )
    const counts: OriginalPipelineCounts = {}
    if (context.subreddits.length === 0 || context.recentPosts.length === 0) {
      return { drafts: [], counts }
    }

    const limits = getPipelineLimits(context.project.plan)
    const chunks = originalScoutChunks(
      context.subreddits.map((subreddit) => subreddit.name),
      context.project.plan,
    )
    const scoutResults = await Promise.allSettled(
      chunks.map((chunk) => runSignalScout(context, chunk)),
    )
    const signals = scoutResults.flatMap((result) => {
      if (result.status === "fulfilled") return result.value
      console.error("Original signal scout failed", result.reason)
      return []
    })
    const dedupedSignals = sanitizeOriginalSignals(
      signals,
      context,
      context.subreddits.map((subreddit) => subreddit.name),
      Math.max(20, chunks.length * 20),
    )
    counts.originalSignals = dedupedSignals.length
    if (dedupedSignals.length === 0) return { drafts: [], counts }

    let briefs: OriginalPostBrief[]
    if (context.project.plan === "starter") {
      briefs = await runStarterPlanner(context, dedupedSignals)
    } else {
      const themes = await runThemeClusterer(context, dedupedSignals)
      counts.originalThemes = themes.length
      const selectedThemes = await runThemeJudge(context, themes)
      const angles = await runAngleGenerator(context, selectedThemes)
      briefs = await runAngleFitJudge(context, angles, selectedThemes)
    }

    if (briefs.length === 0) return { drafts: [], counts }

    const candidates = await draftBriefs(ctx, args.projectId, briefs)
    counts.originalDrafts = candidates.length
    if (candidates.length === 0) return { drafts: [], counts }

    const selected = await selectWithRewrites(
      ctx,
      args.projectId,
      context,
      candidates,
      limits.originalCardsPerDay,
    )
    counts.originalRewrites = selected.rewriteCount
    counts.selectedOriginals = selected.selected.length

    return {
      drafts: selected.selected.map((candidate) => candidate.draft),
      counts,
    }
  },
})
