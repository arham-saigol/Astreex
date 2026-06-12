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

export const draftValidator = v.union(
  v.object({
    type: v.literal("reply"),
    surfacedPostId: v.id("surfacedPosts"),
    targetSubreddit: v.string(),
    draftContent: v.string(),
  }),
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
}

export type OriginalDraft = {
  type: "original"
  targetSubreddit: string
  title: string
  body: string
  draftContent: string
}

export type Draft = ReplyDraft | OriginalDraft
