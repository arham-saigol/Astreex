export type Plan = "starter" | "growth" | "scale"

export type PipelineLimits = {
  cardsPerDay: number
  replyDrafts: number
  originalDrafts: number
  minOriginals: number
  filterTop: number
  monitoredSubreddits: number
  redditAccounts: number
}

const LIMITS: Record<Plan, PipelineLimits> = {
  starter: {
    cardsPerDay: 5,
    replyDrafts: 5,
    originalDrafts: 1,
    minOriginals: 1,
    filterTop: 20,
    monitoredSubreddits: 10,
    redditAccounts: 1,
  },
  growth: {
    cardsPerDay: 15,
    replyDrafts: 15,
    originalDrafts: 2,
    minOriginals: 2,
    filterTop: 60,
    monitoredSubreddits: 25,
    redditAccounts: 3,
  },
  scale: {
    cardsPerDay: 35,
    replyDrafts: 35,
    originalDrafts: 5,
    minOriginals: 3,
    filterTop: 120,
    monitoredSubreddits: 50,
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
    maxRedditAccounts: limits.redditAccounts,
  }
}

export function getSubredditDiscoveryLimits(plan: string) {
  switch (plan) {
    case "starter":
      return { discoverCount: 15, activeCount: 10 }
    case "growth":
      return { discoverCount: 30, activeCount: 25 }
    case "scale":
      return { discoverCount: 50, activeCount: 45 }
    default:
      return { discoverCount: 15, activeCount: 10 }
  }
}
