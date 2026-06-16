import { v } from "convex/values"
import { internalMutation } from "../_generated/server"
import { fetchedPostValidator } from "./validators"

const MAX_POST_AGE_MS = 48 * 60 * 60 * 1000

export const storeNewPosts = internalMutation({
  args: {
    projectId: v.id("projects"),
    posts: v.array(fetchedPostValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const cutoff = now - MAX_POST_AGE_MS
    const insertedIds = []

    for (const post of args.posts) {
      if (post.createdUtc < cutoff) continue

      const existing = await ctx.db
        .query("surfacedPosts")
        .withIndex("by_projectId_redditPostId", (q) =>
          q.eq("projectId", args.projectId).eq("redditPostId", post.redditPostId),
        )
        .unique()
      if (existing) {
        await ctx.db.patch(existing._id, {
          redditThingId: post.redditThingId,
          title: post.title,
          selftext: post.selftext,
          url: post.permalink ?? post.url,
          score: post.score,
          commentCount: post.commentCount,
          postedAt: post.createdUtc,
          surfacedAt: now,
        })
        continue
      }

      const surfacedPostId = await ctx.db.insert("surfacedPosts", {
        projectId: args.projectId,
        redditPostId: post.redditPostId,
        redditThingId: post.redditThingId,
        subreddit: post.subreddit,
        title: post.title,
        selftext: post.selftext,
        url: post.permalink ?? post.url,
        score: post.score,
        commentCount: post.commentCount,
        postedAt: post.createdUtc,
        surfacedAt: now,
      })
      insertedIds.push(surfacedPostId)
    }

    return insertedIds
  },
})

export const storeFetchedPosts = internalMutation({
  args: {
    projectId: v.id("projects"),
    posts: v.array(fetchedPostValidator),
  },
  handler: async (ctx, args) => {
    const now = Date.now()
    const cutoff = now - MAX_POST_AGE_MS
    let storedPosts = 0
    let newPosts = 0

    for (const post of args.posts) {
      if (post.createdUtc < cutoff) continue

      const existing = await ctx.db
        .query("surfacedPosts")
        .withIndex("by_projectId_redditPostId", (q) =>
          q.eq("projectId", args.projectId).eq("redditPostId", post.redditPostId),
        )
        .unique()

      if (existing) {
        await ctx.db.patch(existing._id, {
          redditThingId: post.redditThingId,
          title: post.title,
          selftext: post.selftext,
          url: post.permalink ?? post.url,
          score: post.score,
          commentCount: post.commentCount,
          postedAt: post.createdUtc,
          surfacedAt: now,
        })
      } else {
        await ctx.db.insert("surfacedPosts", {
          projectId: args.projectId,
          redditPostId: post.redditPostId,
          redditThingId: post.redditThingId,
          subreddit: post.subreddit,
          title: post.title,
          selftext: post.selftext,
          url: post.permalink ?? post.url,
          score: post.score,
          commentCount: post.commentCount,
          postedAt: post.createdUtc,
          surfacedAt: now,
        })
        newPosts++
      }

      storedPosts++
    }

    return { storedPosts, newPosts }
  },
})
