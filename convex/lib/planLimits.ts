export type Plan = "starter" | "growth" | "scale"

export type PipelineLimits = {
  cardsPerDay: number
  replyCardsPerDay: number
  replyDraftTarget: number
  originalCardsPerDay: number
  maxScoutPostsPerSubreddit: number
  opportunityShardMaxPosts: number
  replyDrafts: number
  originalDrafts: number
  minOriginals: number
  filterTop: number
  monitoredSubreddits: number
  trackedCompetitors: number
  redditAccounts: number
  maxRailBCandidates: number
  shortlistCount: number
  activeSubredditLimit: number
  inactiveBackupLimit: number
  activeScoreThreshold: number
  backupScoreThreshold: number
}

const LIMITS: Record<Plan, PipelineLimits> = {
  starter: {
    cardsPerDay: 5,
    replyCardsPerDay: 4,
    replyDraftTarget: 6,
    originalCardsPerDay: 1,
    maxScoutPostsPerSubreddit: 15,
    opportunityShardMaxPosts: 35,
    replyDrafts: 6,
    originalDrafts: 1,
    minOriginals: 1,
    filterTop: 20,
    monitoredSubreddits: 5,
    trackedCompetitors: 3,
    redditAccounts: 1,
    maxRailBCandidates: 5,
    shortlistCount: 10,
    activeSubredditLimit: 5,
    inactiveBackupLimit: 5,
    activeScoreThreshold: 70,
    backupScoreThreshold: 50,
  },
  growth: {
    cardsPerDay: 15,
    replyCardsPerDay: 12,
    replyDraftTarget: 18,
    originalCardsPerDay: 3,
    maxScoutPostsPerSubreddit: 15,
    opportunityShardMaxPosts: 35,
    replyDrafts: 18,
    originalDrafts: 3,
    minOriginals: 3,
    filterTop: 60,
    monitoredSubreddits: 15,
    trackedCompetitors: 5,
    redditAccounts: 2,
    maxRailBCandidates: 10,
    shortlistCount: 20,
    activeSubredditLimit: 15,
    inactiveBackupLimit: 5,
    activeScoreThreshold: 70,
    backupScoreThreshold: 50,
  },
  scale: {
    cardsPerDay: 40,
    replyCardsPerDay: 32,
    replyDraftTarget: 40,
    originalCardsPerDay: 8,
    maxScoutPostsPerSubreddit: 15,
    opportunityShardMaxPosts: 35,
    replyDrafts: 40,
    originalDrafts: 8,
    minOriginals: 8,
    filterTop: 120,
    monitoredSubreddits: 25,
    trackedCompetitors: 10,
    redditAccounts: 5,
    maxRailBCandidates: 15,
    shortlistCount: 30,
    activeSubredditLimit: 25,
    inactiveBackupLimit: 5,
    activeScoreThreshold: 70,
    backupScoreThreshold: 50,
  },
}

export function getPipelineLimits(plan: Plan) {
  return LIMITS[plan]
}

export function getPlanLimits(plan: string) {
  const normalizedPlan: Plan =
    plan === "growth" || plan === "scale" ? plan : "starter"
  const limits = LIMITS[normalizedPlan]

  return {
    cardsPerDay: limits.cardsPerDay,
    maxSubreddits: limits.monitoredSubreddits,
    maxCompetitors: limits.trackedCompetitors,
    maxRedditAccounts: limits.redditAccounts,
    maxRailBCandidates: limits.maxRailBCandidates,
    shortlistCount: limits.shortlistCount,
    activeSubredditLimit: limits.activeSubredditLimit,
    inactiveBackupLimit: limits.inactiveBackupLimit,
    activeScoreThreshold: limits.activeScoreThreshold,
    backupScoreThreshold: limits.backupScoreThreshold,
  }
}

export function getSubredditDiscoveryLimits(plan: string) {
  const limits = getPipelineLimits(
    plan === "growth" || plan === "scale" ? plan : "starter",
  )

  return {
    discoverCount: limits.shortlistCount,
    activeCount: limits.activeSubredditLimit,
    maxRailBCandidates: limits.maxRailBCandidates,
    shortlistCount: limits.shortlistCount,
    activeSubredditLimit: limits.activeSubredditLimit,
    inactiveBackupLimit: limits.inactiveBackupLimit,
    activeScoreThreshold: limits.activeScoreThreshold,
    backupScoreThreshold: limits.backupScoreThreshold,
  }
}
