import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const plan = v.union(v.literal("starter"), v.literal("growth"), v.literal("scale"))
const planStatus = v.union(
  v.literal("trialing"),
  v.literal("active"),
  v.literal("canceled"),
  v.literal("past_due"),
  v.literal("trial_expired"),
)
const redditHealthStatus = v.union(
  v.literal("healthy"),
  v.literal("warning"),
  v.literal("banned"),
)
const subredditAddedBy = v.union(v.literal("agent"), v.literal("user"))
const cardType = v.union(v.literal("reply"), v.literal("original"))
const cardStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("scheduled"),
  v.literal("posted"),
  v.literal("failed"),
  v.literal("expired"),
)
const contentVisibility = v.union(
  v.literal("visible"),
  v.literal("removed"),
  v.literal("shadow_hidden"),
)

export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_clerkId", ["clerkId"]),

  projects: defineTable({
    userId: v.id("users"),
    name: v.string(),
    plan,
    planStatus,
    trialEndsAt: v.optional(v.number()),
    creemCustomerId: v.optional(v.string()),
    creemSubscriptionId: v.optional(v.string()),
    timezone: v.string(),
    lastAnalyticsRefresh: v.optional(v.number()),
    lastActiveAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_lastActiveAt", ["lastActiveAt"]),

  brands: defineTable({
    projectId: v.id("projects"),
    websiteUrl: v.string(),
    competitorUrl: v.optional(v.string()),
    profileJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId", ["projectId"]),

  redditAccounts: defineTable({
    projectId: v.id("projects"),
    redditUsername: v.string(),
    accessToken: v.string(),
    refreshToken: v.string(),
    tokenExpiresAt: v.number(),
    isActive: v.boolean(),
    healthStatus: redditHealthStatus,
    lastCheckedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_projectId", ["projectId"]),

  subreddits: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    memberCount: v.optional(v.number()),
    relevanceScore: v.number(),
    reasoning: v.string(),
    active: v.boolean(),
    addedBy: subredditAddedBy,
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_active", ["projectId", "active"]),

  subredditCache: defineTable({
    subredditName: v.string(),
    posts: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        url: v.string(),
        score: v.number(),
        commentCount: v.number(),
        postedAt: v.number(),
      }),
    ),
    fetchedAt: v.number(),
    expiresAt: v.number(),
  }).index("by_subredditName", ["subredditName"]),

  surfacedPosts: defineTable({
    projectId: v.id("projects"),
    redditPostId: v.string(),
    subreddit: v.string(),
    title: v.string(),
    url: v.string(),
    score: v.number(),
    commentCount: v.number(),
    postedAt: v.number(),
    surfacedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_redditPostId", ["projectId", "redditPostId"]),

  cards: defineTable({
    projectId: v.id("projects"),
    surfacedPostId: v.optional(v.union(v.id("surfacedPosts"), v.null())),
    redditAccountId: v.id("redditAccounts"),
    type: cardType,
    targetSubreddit: v.optional(v.union(v.string(), v.null())),
    draftContent: v.string(),
    editedContent: v.optional(v.string()),
    status: cardStatus,
    scheduledFor: v.optional(v.number()),
    postedAt: v.optional(v.number()),
    redditCommentId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_status", ["projectId", "status"]),

  postedContent: defineTable({
    projectId: v.id("projects"),
    cardId: v.id("cards"),
    redditId: v.string(),
    subreddit: v.string(),
    score: v.number(),
    replyCount: v.number(),
    visibility: contentVisibility,
    lastCheckedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_cardId", ["cardId"]),
})
