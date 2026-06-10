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
const billingInterval = v.union(v.literal("monthly"), v.literal("annual"))
const onboardingStatus = v.union(
  v.literal("in_progress"),
  v.literal("running"),
  v.literal("complete"),
  v.literal("error"),
)
const subredditDiscoveryStatus = v.union(
  v.literal("complete"),
  v.literal("needs_manual_subreddits"),
)
const scrapeStatus = v.union(
  v.literal("complete"),
  v.literal("degraded"),
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
    billingInterval: v.optional(billingInterval),
    cancelAtPeriodEnd: v.optional(v.boolean()),
    onboardingStatus: v.optional(onboardingStatus),
    onboardingError: v.optional(v.string()),
    subredditDiscoveryStatus: v.optional(subredditDiscoveryStatus),
    timezone: v.string(),
    lastAnalyticsRefresh: v.optional(v.number()),
    lastActiveAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_lastActiveAt", ["lastActiveAt"])
    .index("by_planStatus", ["planStatus"])
    .index("by_creemCustomerId", ["creemCustomerId"])
    .index("by_creemSubscriptionId", ["creemSubscriptionId"]),

  brands: defineTable({
    projectId: v.id("projects"),
    websiteUrl: v.string(),
    competitorUrl: v.optional(v.string()),
    profileJson: v.string(),
    scrapeStatus: v.optional(scrapeStatus),
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
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_redditUsername", ["projectId", "redditUsername"]),

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
    .index("by_projectId_and_name", ["projectId", "name"])
    .index("by_projectId_active", ["projectId", "active"]),

  subredditCache: defineTable({
    subredditName: v.string(),
    posts: v.array(
      v.object({
        id: v.string(),
        title: v.string(),
        selftext: v.optional(v.string()),
        permalink: v.optional(v.string()),
        url: v.string(),
        score: v.number(),
        commentCount: v.number(),
        postedAt: v.number(),
      }),
    ),
    fetchedAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_subredditName", ["subredditName"])
    .index("by_expiresAt", ["expiresAt"]),

  surfacedPosts: defineTable({
    projectId: v.id("projects"),
    redditPostId: v.string(),
    subreddit: v.string(),
    title: v.string(),
    selftext: v.optional(v.string()),
    url: v.string(),
    score: v.number(),
    commentCount: v.number(),
    postedAt: v.number(),
    surfacedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_redditPostId", ["projectId", "redditPostId"])
    .index("by_surfacedAt", ["surfacedAt"]),

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
    failureReason: v.optional(v.string()),
    postRetryCount: v.optional(v.number()),
    lastPostAttemptAt: v.optional(v.number()),
    pipelineRunId: v.optional(v.id("pipelineRuns")),
    draftKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_status", ["projectId", "status"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_projectId_and_surfacedPostId", ["projectId", "surfacedPostId"])
    .index("by_projectId_and_createdAt", ["projectId", "createdAt"])
    .index("by_projectId_and_pipelineRunId_and_draftKey", [
      "projectId",
      "pipelineRunId",
      "draftKey",
    ])
    .index("by_redditAccountId_and_scheduledFor", ["redditAccountId", "scheduledFor"]),

  postedContent: defineTable({
    projectId: v.id("projects"),
    cardId: v.id("cards"),
    redditAccountId: v.optional(v.id("redditAccounts")),
    redditId: v.string(),
    redditThingId: v.optional(v.string()),
    subreddit: v.string(),
    type: v.optional(cardType),
    permalink: v.optional(v.string()),
    score: v.number(),
    replyCount: v.number(),
    visibility: contentVisibility,
    lastCheckedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_cardId", ["cardId"])
    .index("by_projectId_and_createdAt", ["projectId", "createdAt"])
    .index("by_createdAt", ["createdAt"])
    .index("by_redditAccountId_and_createdAt", ["redditAccountId", "createdAt"]),

  notifications: defineTable({
    projectId: v.id("projects"),
    redditAccountId: v.optional(v.id("redditAccounts")),
    type: v.union(
      v.literal("reddit_health_warning"),
      v.literal("reddit_health_banned"),
    ),
    status: v.union(v.literal("unread"), v.literal("resolved")),
    message: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId_and_status", ["projectId", "status"])
    .index("by_projectId_and_type_and_redditAccountId", [
      "projectId",
      "type",
      "redditAccountId",
    ])
    .index("by_projectId_and_type_and_redditAccountId_and_status", [
      "projectId",
      "type",
      "redditAccountId",
      "status",
    ]),

  rateLimitLog: defineTable({
    service: v.literal("reddit"),
    priority: v.union(v.literal(1), v.literal(2), v.literal(3)),
    requestedAt: v.number(),
    createdAt: v.number(),
  }).index("by_service_and_requestedAt", ["service", "requestedAt"]),

  pipelineRuns: defineTable({
    projectId: v.id("projects"),
    localDate: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("skipped"),
    ),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    counts: v.optional(v.object({
      fetchedPosts: v.optional(v.number()),
      newPosts: v.optional(v.number()),
      filteredPosts: v.optional(v.number()),
      drafts: v.optional(v.number()),
      selectedCards: v.optional(v.number()),
      createdCards: v.optional(v.number()),
    })),
  }).index("by_projectId_and_localDate", ["projectId", "localDate"]),
})
