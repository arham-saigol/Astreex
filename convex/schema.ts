import { defineSchema, defineTable } from "convex/server"
import { v } from "convex/values"

const plan = v.union(v.literal("starter"), v.literal("growth"), v.literal("scale"))
const planStatus = v.union(
  v.literal("trialing"),
  v.literal("active"),
  v.literal("canceled"),
  v.literal("past_due"),
  v.literal("trial_expired"),
  v.literal("requires_subscription"),
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
const monitoredSourceType = v.union(v.literal("own"), v.literal("competitor"))
const intelligenceBuildStatus = v.union(
  v.literal("running"),
  v.literal("complete"),
  v.literal("failed"),
)
const intelligenceChangeStatus = v.union(
  v.literal("pending"),
  v.literal("profile_updated"),
  v.literal("not_significant"),
  v.literal("failed"),
)
const redditHealthStatus = v.union(
  v.literal("healthy"),
  v.literal("warning"),
  v.literal("banned"),
)
const redditActivityStatus = v.union(
  v.literal("ready"),
  v.literal("warmup"),
)
const subredditAddedBy = v.union(v.literal("agent"), v.literal("user"))
const cardType = v.union(v.literal("reply"), v.literal("original"))
const timeframe = v.union(v.literal("7d"), v.literal("30d"), v.literal("all"))
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
    tokenIdentifier: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    firstCreatedProjectId: v.optional(v.id("projects")),
    initialProjectOnboardingSkippedAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_tokenIdentifier", ["tokenIdentifier"]),

  projects: defineTable({
    userId: v.id("users"),
    publicId: v.optional(v.string()),
    slug: v.optional(v.string()),
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
    zernioProfileId: v.optional(v.string()),
    lastActiveAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_publicId", ["publicId"])
    .index("by_lastActiveAt", ["lastActiveAt"])
    .index("by_planStatus", ["planStatus"])
    .index("by_creemCustomerId", ["creemCustomerId"])
    .index("by_creemSubscriptionId", ["creemSubscriptionId"]),

  projectMemberships: defineTable({
    projectId: v.id("projects"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("member")),
    createdAt: v.number(),
  })
    .index("by_userId", ["userId"])
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_userId", ["projectId", "userId"]),

  projectInvitations: defineTable({
    projectId: v.id("projects"),
    email: v.string(),
    invitedByUserId: v.id("users"),
    tokenHash: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    expiresAt: v.number(),
    acceptedByUserId: v.optional(v.id("users")),
    acceptedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_email", ["projectId", "email"])
    .index("by_tokenHash", ["tokenHash"]),

  projectIntelligenceProfiles: defineTable({
    projectId: v.id("projects"),
    websiteUrl: v.string(),
    competitorUrls: v.array(v.string()),
    intelligenceJson: v.string(),
    scrapeStatus: v.optional(scrapeStatus),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_projectId", ["projectId"]),

  monitoredPages: defineTable({
    projectId: v.id("projects"),
    profileId: v.id("projectIntelligenceProfiles"),
    sourceType: monitoredSourceType,
    competitorIndex: v.optional(v.number()),
    url: v.string(),
    normalizedUrl: v.string(),
    title: v.optional(v.string()),
    pageKind: v.optional(v.string()),
    active: v.boolean(),
    lastFetchedAt: v.optional(v.number()),
    nextCheckAt: v.number(),
    lastContentHash: v.optional(v.string()),
    lastSnapshotId: v.optional(v.id("monitoredPageSnapshots")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_normalizedUrl", ["projectId", "normalizedUrl"])
    .index("by_active_and_nextCheckAt", ["active", "nextCheckAt"]),

  monitoredPageSnapshots: defineTable({
    projectId: v.id("projects"),
    monitoredPageId: v.id("monitoredPages"),
    fetchedAt: v.number(),
    contentHash: v.string(),
    normalizedText: v.string(),
    title: v.optional(v.string()),
    exaId: v.optional(v.string()),
  })
    .index("by_monitoredPageId", ["monitoredPageId"])
    .index("by_projectId", ["projectId"]),

  projectIntelligenceBuilds: defineTable({
    projectId: v.id("projects"),
    profileId: v.id("projectIntelligenceProfiles"),
    status: intelligenceBuildStatus,
    model: v.string(),
    sourcePageCount: v.number(),
    usefulPageCount: v.number(),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_projectId", ["projectId"]),

  projectIntelligenceChangeEvents: defineTable({
    projectId: v.id("projects"),
    monitoredPageId: v.id("monitoredPages"),
    previousSnapshotId: v.optional(v.id("monitoredPageSnapshots")),
    newSnapshotId: v.id("monitoredPageSnapshots"),
    status: intelligenceChangeStatus,
    summary: v.optional(v.string()),
    createdAt: v.number(),
    processedAt: v.optional(v.number()),
  }).index("by_projectId", ["projectId"]),

  redditAccounts: defineTable({
    projectId: v.id("projects"),
    redditUsername: v.string(),
    zernioAccountId: v.string(),
    isActive: v.boolean(),
    healthStatus: redditHealthStatus,
    lastCheckedAt: v.optional(v.number()),
    providerHealthStatus: v.optional(v.string()),
    providerCanPost: v.optional(v.boolean()),
    providerNeedsReconnect: v.optional(v.boolean()),
    providerIssues: v.optional(v.array(v.string())),
    providerLastCheckedAt: v.optional(v.number()),
    activityStatus: v.optional(redditActivityStatus),
    totalKarma: v.optional(v.number()),
    postKarma: v.optional(v.number()),
    commentKarma: v.optional(v.number()),
    accountCreatedAt: v.optional(v.number()),
    activityCheckedAt: v.optional(v.number()),
    warmupSince: v.optional(v.number()),
    activityIssues: v.optional(v.array(v.string())),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_redditUsername", ["projectId", "redditUsername"])
    .index("by_projectId_and_zernioAccountId", ["projectId", "zernioAccountId"]),

  redditSubredditAccess: defineTable({
    projectId: v.id("projects"),
    redditAccountId: v.id("redditAccounts"),
    subreddit: v.string(),
    canPost: v.boolean(),
    checkedAt: v.number(),
    reason: v.optional(v.string()),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_and_subreddit", ["projectId", "subreddit"])
    .index("by_redditAccountId", ["redditAccountId"])
    .index("by_redditAccountId_and_subreddit", [
      "redditAccountId",
      "subreddit",
    ])
    .index("by_projectId_and_redditAccountId_and_subreddit", [
      "projectId",
      "redditAccountId",
      "subreddit",
    ]),

  subreddits: defineTable({
    projectId: v.id("projects"),
    name: v.string(),
    memberCount: v.optional(v.number()),
    description: v.optional(v.string()),
    rulesJson: v.optional(v.string()),
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
        redditThingId: v.optional(v.string()),
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
    redditThingId: v.optional(v.string()),
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
    .index("by_projectId_and_subreddit_and_postedAt", [
      "projectId",
      "subreddit",
      "postedAt",
    ])
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
    zernioSubmissionKey: v.optional(v.string()),
    zernioSubmissionAccountId: v.optional(v.id("redditAccounts")),
    pipelineRunId: v.optional(v.id("pipelineRuns")),
    draftKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_projectId_status", ["projectId", "status"])
    .index("by_status_and_createdAt", ["status", "createdAt"])
    .index("by_projectId_and_surfacedPostId", ["projectId", "surfacedPostId"])
    .index("by_projectId_and_createdAt", ["projectId", "createdAt"])
    .index("by_projectId_and_redditAccountId_and_createdAt", [
      "projectId",
      "redditAccountId",
      "createdAt",
    ])
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
    parentRedditThingId: v.optional(v.string()),
    parentPermalink: v.optional(v.string()),
    zernioPostId: v.optional(v.string()),
    subreddit: v.string(),
    type: v.optional(cardType),
    permalink: v.optional(v.string()),
    score: v.number(),
    replyCount: v.number(),
    visibility: contentVisibility,
    lastCheckedAt: v.number(),
    lastAnalyticsAttemptAt: v.optional(v.number()),
    lastAnalyticsError: v.optional(v.string()),
    analyticsFailureCount: v.optional(v.number()),
    lastAnalyticsSource: v.optional(v.union(v.literal("zernio"), v.literal("fetchlayer"))),
    nextAnalyticsRefreshAt: v.optional(v.number()),
    fetchLayerFallbackLastAttemptAt: v.optional(v.number()),
    fetchLayerFallbackCooldownUntil: v.optional(v.number()),
    dashboardRollupAppliedAt: v.optional(v.number()),
    dashboardRollupScore: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_projectId", ["projectId"])
    .index("by_cardId", ["cardId"])
    .index("by_projectId_and_createdAt", ["projectId", "createdAt"])
    .index("by_projectId_and_score", ["projectId", "score"])
    .index("by_projectId_and_redditAccountId_and_score", [
      "projectId",
      "redditAccountId",
      "score",
    ])
    .index("by_projectId_and_lastAnalyticsAttemptAt", [
      "projectId",
      "lastAnalyticsAttemptAt",
    ])
    .index("by_projectId_and_nextAnalyticsRefreshAt", [
      "projectId",
      "nextAnalyticsRefreshAt",
    ])
    .index("by_projectId_and_redditAccountId_and_nextAnalyticsRefreshAt", [
      "projectId",
      "redditAccountId",
      "nextAnalyticsRefreshAt",
    ])
    .index("by_createdAt", ["createdAt"])
    .index("by_redditAccountId_and_createdAt", ["redditAccountId", "createdAt"])
    .index("by_projectId_and_parentRedditThingId", ["projectId", "parentRedditThingId"]),

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

  providerRequestLog: defineTable({
    provider: v.union(v.literal("zernio"), v.literal("fetchlayer")),
    endpoint: v.string(),
    status: v.optional(v.number()),
    ok: v.boolean(),
    durationMs: v.number(),
    error: v.optional(v.string()),
    requestedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_provider_and_requestedAt", ["provider", "requestedAt"])
    .index("by_ok_and_requestedAt", ["ok", "requestedAt"]),

  dashboardAnalyticsSessions: defineTable({
    projectId: v.id("projects"),
    sessionId: v.string(),
    timeframe,
    redditAccountIds: v.array(v.id("redditAccounts")),
    openedAt: v.number(),
    lastHeartbeatAt: v.number(),
    expiresAt: v.number(),
    closedAt: v.optional(v.number()),
  })
    .index("by_projectId_and_sessionId", ["projectId", "sessionId"])
    .index("by_expiresAt", ["expiresAt"]),

  dashboardAnalyticsLocks: defineTable({
    key: v.string(),
    projectId: v.id("projects"),
    zernioAccountId: v.string(),
    parentRedditThingId: v.string(),
    acquiredAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expiresAt", ["expiresAt"]),

  dashboardAnalyticsRefreshJobs: defineTable({
    key: v.string(),
    projectId: v.id("projects"),
    sessionId: v.string(),
    timeframe,
    redditAccountIds: v.array(v.id("redditAccounts")),
    status: v.union(v.literal("queued"), v.literal("running"), v.literal("finished")),
    scheduledAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
    expiresAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_expiresAt", ["expiresAt"]),

  dashboardDailyRollups: defineTable({
    projectId: v.id("projects"),
    redditAccountId: v.optional(v.id("redditAccounts")),
    accountKey: v.string(),
    day: v.string(),
    postsCount: v.number(),
    karmaEarned: v.number(),
    lastActivityAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_projectId_and_day", ["projectId", "day"])
    .index("by_projectId_and_accountKey_and_day", ["projectId", "accountKey", "day"]),

  analyticsFallbackUsage: defineTable({
    key: v.string(),
    projectId: v.id("projects"),
    count: v.number(),
    resetAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_resetAt", ["resetAt"]),

  oauthRateLimitBuckets: defineTable({
    key: v.string(),
    count: v.number(),
    resetAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_resetAt", ["resetAt"]),

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
      storedPosts: v.optional(v.number()),
      scoutedPosts: v.optional(v.number()),
      opportunityShards: v.optional(v.number()),
      replyOpportunities: v.optional(v.number()),
      replyDrafts: v.optional(v.number()),
      selectedReplies: v.optional(v.number()),
      filteredPosts: v.optional(v.number()),
      drafts: v.optional(v.number()),
      selectedCards: v.optional(v.number()),
      createdCards: v.optional(v.number()),
      originalSignals: v.optional(v.number()),
      originalThemes: v.optional(v.number()),
      originalDrafts: v.optional(v.number()),
      selectedOriginals: v.optional(v.number()),
      originalRewrites: v.optional(v.number()),
      createdOriginalCards: v.optional(v.number()),
    })),
  }).index("by_projectId_and_localDate", ["projectId", "localDate"]),
})
