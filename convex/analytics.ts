import { v } from "convex/values"
import {
  action,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"

const timeframeValidator = v.union(
  v.literal("7d"),
  v.literal("30d"),
  v.literal("all"),
)

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

type Timeframe = "7d" | "30d" | "all"

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

function cutoffForTimeframe(timeframe: Timeframe) {
  if (timeframe === "7d") return Date.now() - 7 * DAY
  if (timeframe === "30d") return Date.now() - 30 * DAY
  return 0
}

function mockTrendData(timeframe: Timeframe) {
  // MOCK DATA: Replace with postedContent aggregation once real analytics data exists.
  const values = timeframe === "7d"
    ? [12, 18, 31, 22, 45, 38, 52]
    : [12, 18, 31, 22, 45, 38, 52, 47]

  const bucketSize = timeframe === "7d" ? DAY : 7 * DAY
  const now = Date.now()

  return values.map((karma, index) => {
    const bucketsFromEnd = values.length - index - 1
    const date = new Date(now - bucketsFromEnd * bucketSize)

    return {
      period: date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
      karma,
    }
  })
}

export const getDashboardContext = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx)
    const project = await ctx.db
      .query("projects")
      .withIndex("by_userId", (q) => q.eq("userId", user._id))
      .first()

    if (!project) return null

    return {
      projectId: project._id,
      plan: project.plan,
      lastAnalyticsRefresh: project.lastAnalyticsRefresh ?? null,
    }
  },
})

export const getDashboardMetrics = query({
  args: {
    projectId: v.id("projects"),
    timeframe: timeframeValidator,
  },
  handler: async (ctx, args) => {
    await getOwnedProject(ctx, args.projectId)
    cutoffForTimeframe(args.timeframe)

    // MOCK DATA: Replace with cards and postedContent aggregation.
    return {
      postsCount: 24,
      approvalRate: 89,
      karmaEarned: 147,
      healthStatus: "healthy" as const,
    }
  },
})

export const getRecentActivity = query({
  args: {
    projectId: v.id("projects"),
    timeframe: timeframeValidator,
  },
  handler: async (ctx, args) => {
    await getOwnedProject(ctx, args.projectId)
    cutoffForTimeframe(args.timeframe)

    // MOCK DATA: Replace with postedContent joined to cards/surfacedPosts.
    return [
      {
        id: "activity-1",
        subreddit: "SaaS",
        title: "How to handle positioning when every competitor sounds the same",
        score: 47,
        postedAt: Date.now() - 2 * HOUR,
        permalink: "https://www.reddit.com/r/SaaS/",
      },
      {
        id: "activity-2",
        subreddit: "startups",
        title: "Best tools for founder-led distribution without a content team",
        score: 31,
        postedAt: Date.now() - 4 * HOUR,
        permalink: "https://www.reddit.com/r/startups/",
      },
      {
        id: "activity-3",
        subreddit: "indiehackers",
        title: "Original post",
        score: 28,
        postedAt: Date.now() - 1 * DAY,
        permalink: "https://www.reddit.com/r/indiehackers/",
      },
      {
        id: "activity-4",
        subreddit: "entrepreneur",
        title: "Here's what changed after we stopped posting launch threads",
        score: 22,
        postedAt: Date.now() - 2 * DAY,
        permalink: "https://www.reddit.com/r/entrepreneur/",
      },
      {
        id: "activity-5",
        subreddit: "B2BMarketing",
        title: "The quiet channel that beat our paid acquisition test",
        score: 18,
        postedAt: Date.now() - 3 * DAY,
        permalink: "https://www.reddit.com/r/B2BMarketing/",
      },
      {
        id: "activity-6",
        subreddit: "smallbusiness",
        title: "What should a solo founder automate first",
        score: 14,
        postedAt: Date.now() - 4 * DAY,
        permalink: "https://www.reddit.com/r/smallbusiness/",
      },
      {
        id: "activity-7",
        subreddit: "marketing",
        title: "We found better leads by answering niche threads",
        score: 12,
        postedAt: Date.now() - 5 * DAY,
        permalink: "https://www.reddit.com/r/marketing/",
      },
      {
        id: "activity-8",
        subreddit: "sales",
        title: "Cold outbound versus community replies for early B2B",
        score: 9,
        postedAt: Date.now() - 6 * DAY,
        permalink: "https://www.reddit.com/r/sales/",
      },
      {
        id: "activity-9",
        subreddit: "ProductManagement",
        title: "How do you validate pain before building",
        score: 6,
        postedAt: Date.now() - 8 * DAY,
        permalink: "https://www.reddit.com/r/ProductManagement/",
      },
      {
        id: "activity-10",
        subreddit: "founders",
        title: "The first channel that made our demo calendar predictable",
        score: 5,
        postedAt: Date.now() - 10 * DAY,
        permalink: "https://www.reddit.com/r/founders/",
      },
    ]
  },
})

export const getTrendData = query({
  args: {
    projectId: v.id("projects"),
    timeframe: timeframeValidator,
  },
  handler: async (ctx, args) => {
    await getOwnedProject(ctx, args.projectId)
    cutoffForTimeframe(args.timeframe)

    return mockTrendData(args.timeframe)
  },
})

export const getBestPerforming = query({
  args: {
    projectId: v.id("projects"),
    timeframe: timeframeValidator,
  },
  handler: async (ctx, args) => {
    await getOwnedProject(ctx, args.projectId)
    cutoffForTimeframe(args.timeframe)

    // MOCK DATA: Replace with postedContent sorted by score.
    return [
      {
        id: "best-1",
        subreddit: "SaaS",
        score: 47,
        snippet: "We struggled with the same positioning problem until we mapped each reply to one specific buyer objection.",
      },
      {
        id: "best-2",
        subreddit: "startups",
        score: 31,
        snippet: "The key insight for us was treating Reddit as support-led discovery, not a place to broadcast launches.",
      },
      {
        id: "best-3",
        subreddit: "entrepreneur",
        score: 28,
        snippet: "Here's what changed once we stopped chasing broad founder communities and focused on narrow workflows.",
      },
      {
        id: "best-4",
        subreddit: "indiehackers",
        score: 24,
        snippet: "Original post: A simple checklist for finding high-intent Reddit threads before competitors answer them.",
      },
      {
        id: "best-5",
        subreddit: "B2BMarketing",
        score: 19,
        snippet: "The durable channel was not more content; it was showing up in the exact threads prospects already trusted.",
      },
    ]
  },
})

export const getRefreshContext = internalQuery({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const project = await getOwnedProject(ctx, args.projectId)

    return {
      lastAnalyticsRefresh: project.lastAnalyticsRefresh ?? null,
    }
  },
})

export const markAnalyticsRefreshed = internalMutation({
  args: {
    projectId: v.id("projects"),
    refreshedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await getOwnedProject(ctx, args.projectId)
    await ctx.db.patch(args.projectId, {
      lastAnalyticsRefresh: args.refreshedAt,
    })
  },
})

export const refreshAnalytics = action({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const refreshContext = await ctx.runQuery(
      internal.analytics.getRefreshContext,
      { projectId: args.projectId },
    )
    const now = Date.now()

    if (
      refreshContext.lastAnalyticsRefresh !== null &&
      now - refreshContext.lastAnalyticsRefresh < HOUR
    ) {
      return { refreshed: false }
    }

    // TODO: wire up Reddit fetch once OAuth is complete

    await ctx.runMutation(internal.analytics.markAnalyticsRefreshed, {
      projectId: args.projectId,
      refreshedAt: now,
    })

    return { refreshed: true }
  },
})
