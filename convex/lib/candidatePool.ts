import type { Id } from "../_generated/dataModel"

export type CandidatePost = {
  _id: Id<"surfacedPosts">
  subreddit: string
  title?: string
  selftext?: string
  url?: string
  score: number
  commentCount: number
  postedAt: number
}

export function candidatePoolSize(filterTop: number) {
  return Math.min(Math.max(filterTop * 4, 40), 180)
}

export function selectFilterCandidates<T extends CandidatePost>(
  posts: T[],
  filterTop: number,
) {
  const maxCandidates = candidatePoolSize(filterTop)
  const subredditCounts = new Map<string, number>()

  return [...posts]
    .sort((a, b) => {
      const activityA = Math.log1p(Math.max(0, a.commentCount)) * 6 + Math.log1p(Math.max(0, a.score))
      const activityB = Math.log1p(Math.max(0, b.commentCount)) * 6 + Math.log1p(Math.max(0, b.score))
      const ageA = Math.max(0, Date.now() - a.postedAt)
      const ageB = Math.max(0, Date.now() - b.postedAt)
      return activityB - ageB / 3_600_000 - (activityA - ageA / 3_600_000)
    })
    .filter((post) => {
      const key = post.subreddit.toLowerCase()
      const count = subredditCounts.get(key) ?? 0
      if (count >= Math.max(2, Math.ceil(maxCandidates / 12))) return false
      subredditCounts.set(key, count + 1)
      return true
    })
    .slice(0, maxCandidates)
}
