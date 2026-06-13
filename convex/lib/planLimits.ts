export type Plan = "starter" | "growth" | "scale"

export type PipelineLimits = {
  cardsPerDay: number
  replyDrafts: number
  originalDrafts: number
  minOriginals: number
  filterTop: number
  monitoredSubreddits: number
  trackedCompetitors: number
  redditAccounts: number
}

const LIMITS: Record<Plan, PipelineLimits> = {
  starter: {
    cardsPerDay: 5,
    replyDrafts: 5,
    originalDrafts: 1,
    minOriginals: 1,
    filterTop: 20,
    monitoredSubreddits: 5,
    trackedCompetitors: 3,
    redditAccounts: 1,
  },
  growth: {
    cardsPerDay: 15,
    replyDrafts: 15,
    originalDrafts: 2,
    minOriginals: 2,
    filterTop: 60,
    monitoredSubreddits: 15,
    trackedCompetitors: 5,
    redditAccounts: 2,
  },
  scale: {
    cardsPerDay: 40,
    replyDrafts: 40,
    originalDrafts: 5,
    minOriginals: 3,
    filterTop: 120,
    monitoredSubreddits: 25,
    trackedCompetitors: 10,
    redditAccounts: 5,
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
  }
}

export function getSubredditDiscoveryLimits(plan: string) {
  switch (plan) {
    case "starter":
      return { discoverCount: 10, activeCount: 5 }
    case "growth":
      return { discoverCount: 20, activeCount: 15 }
    case "scale":
      return { discoverCount: 30, activeCount: 25 }
    default:
      return { discoverCount: 10, activeCount: 5 }
  }
}
