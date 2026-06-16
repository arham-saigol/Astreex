import { v } from "convex/values"
import type { Id } from "../_generated/dataModel"

export const fetchedPostValidator = v.object({
  redditPostId: v.string(),
  redditThingId: v.optional(v.string()),
  subreddit: v.string(),
  title: v.string(),
  selftext: v.optional(v.string()),
  permalink: v.optional(v.string()),
  url: v.string(),
  score: v.number(),
  commentCount: v.number(),
  createdUtc: v.number(),
})

export type FetchedPost = {
  redditPostId: string
  redditThingId?: string
  subreddit: string
  title: string
  selftext?: string
  permalink?: string
  url: string
  score: number
  commentCount: number
  createdUtc: number
}

export const surfacedPostCandidateValidator = v.object({
  surfacedPostId: v.id("surfacedPosts"),
  redditPostId: v.string(),
  subreddit: v.string(),
  title: v.string(),
  selftext: v.optional(v.string()),
  url: v.string(),
  score: v.number(),
  commentCount: v.number(),
  postedAt: v.number(),
})

export type SurfacedPostCandidate = {
  surfacedPostId: Id<"surfacedPosts">
  redditPostId: string
  subreddit: string
  title: string
  selftext?: string
  url: string
  score: number
  commentCount: number
  postedAt: number
}

export const scoutedPostValidator = v.object({
  surfacedPostId: v.id("surfacedPosts"),
  subreddit: v.string(),
  scoutRationale: v.optional(v.string()),
})

export type ScoutedPost = {
  surfacedPostId: Id<"surfacedPosts">
  subreddit: string
  scoutRationale?: string
}

export const replyOpportunityValidator = v.object({
  surfacedPostId: v.id("surfacedPosts"),
  targetSubreddit: v.string(),
  scoutRationale: v.optional(v.string()),
  opportunityRationale: v.optional(v.string()),
})

export type ReplyOpportunity = {
  surfacedPostId: Id<"surfacedPosts">
  targetSubreddit: string
  scoutRationale?: string
  opportunityRationale?: string
}

export const replyDraftValidator = v.object({
  type: v.literal("reply"),
  surfacedPostId: v.id("surfacedPosts"),
  targetSubreddit: v.string(),
  draftContent: v.string(),
  scoutRationale: v.optional(v.string()),
  opportunityRationale: v.optional(v.string()),
})

export const originalSignalValidator = v.object({
  signalId: v.string(),
  subreddit: v.string(),
  sourceId: v.string(),
  sourceType: v.union(v.literal("post"), v.literal("comment")),
  sourceTitle: v.optional(v.string()),
  sourceExcerpt: v.optional(v.string()),
  painPoint: v.string(),
  whyItMatters: v.string(),
  possiblePostDirection: v.string(),
})

export const originalThemeValidator = v.object({
  themeId: v.string(),
  title: v.string(),
  summary: v.string(),
  signalIds: v.array(v.string()),
  targetSubreddits: v.array(v.string()),
})

export const originalPostBriefValidator = v.object({
  briefId: v.string(),
  targetSubreddit: v.string(),
  titleAngle: v.string(),
  bodyDirection: v.string(),
  rationale: v.optional(v.string()),
  signalIds: v.optional(v.array(v.string())),
  themeId: v.optional(v.string()),
})

export const originalDraftValidator = v.object({
  type: v.literal("original"),
  targetSubreddit: v.string(),
  title: v.string(),
  body: v.string(),
  draftContent: v.string(),
  briefId: v.optional(v.string()),
  rationale: v.optional(v.string()),
})

export const originalDraftJudgeDecisionValidator = v.object({
  draftId: v.string(),
  approved: v.boolean(),
  reason: v.optional(v.string()),
  rewriteInstructions: v.optional(v.string()),
  score: v.optional(v.number()),
})

export const draftValidator = v.union(
  replyDraftValidator,
  originalDraftValidator,
)

export type ReplyDraft = {
  type: "reply"
  surfacedPostId: Id<"surfacedPosts">
  targetSubreddit: string
  draftContent: string
  scoutRationale?: string
  opportunityRationale?: string
}

export type OriginalSignal = {
  signalId: string
  subreddit: string
  sourceId: string
  sourceType: "post" | "comment"
  sourceTitle?: string
  sourceExcerpt?: string
  painPoint: string
  whyItMatters: string
  possiblePostDirection: string
}

export type OriginalTheme = {
  themeId: string
  title: string
  summary: string
  signalIds: string[]
  targetSubreddits: string[]
}

export type OriginalPostBrief = {
  briefId: string
  targetSubreddit: string
  titleAngle: string
  bodyDirection: string
  rationale?: string
  signalIds?: string[]
  themeId?: string
}

export type OriginalDraft = {
  type: "original"
  targetSubreddit: string
  title: string
  body: string
  draftContent: string
  briefId?: string
  rationale?: string
}

export type OriginalDraftJudgeDecision = {
  draftId: string
  approved: boolean
  reason?: string
  rewriteInstructions?: string
  score?: number
}

export type Draft = ReplyDraft | OriginalDraft
