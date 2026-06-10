import { internal } from "../_generated/api"
import { internalMutation } from "../_generated/server"

const batchSize = 200
const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000

export const cleanupStaleData = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    const staleSurfacedPosts = await ctx.db
      .query("surfacedPosts")
      .withIndex("by_surfacedAt", (q) =>
        q.lt("surfacedAt", now - thirtyDaysMs),
      )
      .take(batchSize)
    const expiredSubredditCache = await ctx.db
      .query("subredditCache")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", now))
      .take(batchSize)

    for (const post of staleSurfacedPosts) {
      await ctx.db.delete(post._id)
    }
    for (const cacheEntry of expiredSubredditCache) {
      await ctx.db.delete(cacheEntry._id)
    }

    if (
      staleSurfacedPosts.length === batchSize ||
      expiredSubredditCache.length === batchSize
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.pipeline.cleanup.cleanupStaleData,
        {},
      )
    }

    return {
      surfacedPostsDeleted: staleSurfacedPosts.length,
      subredditCacheDeleted: expiredSubredditCache.length,
    }
  },
})
