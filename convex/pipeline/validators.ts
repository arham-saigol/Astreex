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

export const draftValidator = v.union(
  replyDraftValidator,
  v.object({
    type: v.literal("original"),
    targetSubreddit: v.string(),
    title: v.string(),
    body: v.string(),
    draftContent: v.string(),
  }),
)

export type ReplyDraft = {
  type: "reply"
  surfacedPostId: Id<"surfacedPosts">
  targetSubreddit: string
  draftContent: string
  scoutRationale?: string
  opportunityRationale?: string
}

export type OriginalDraft = {
  type: "original"
  targetSubreddit: string
  title: string
  body: string
  draftContent: string
}

export type Draft = ReplyDraft | OriginalDraft
