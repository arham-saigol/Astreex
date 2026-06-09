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
