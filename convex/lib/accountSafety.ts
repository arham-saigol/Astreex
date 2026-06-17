export const REDDIT_WARMUP_TOTAL_KARMA = 100
export const REDDIT_WARMUP_ACCOUNT_AGE_DAYS = 14

export const WARMUP_PROMPT_NOTE = [
  "Warm-up mode safety note: prioritize helpful community participation over promotion.",
  "Do not include links, CTAs, sales language, product announcements, or unsolicited product mentions.",
  "Mention the product only if the Reddit post directly asks for a tool/vendor and the answer can stay neutral.",
  "Favor low-moderation-risk discussions where a practical, experience-based reply or post will fit naturally.",
].join(" ")

export type RedditActivityStatus = "ready" | "warmup"

export type NormalizedRedditProfile = {
  totalKarma?: number
  postKarma?: number
  commentKarma?: number
  accountCreatedAt?: number
}

export type RedditActivityDecision = NormalizedRedditProfile & {
  activityStatus: RedditActivityStatus
  activityIssues: string[]
}

function numberFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function timestampFrom(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value)
    if (Number.isFinite(numeric)) return timestampFrom(numeric)
    const parsed = Date.parse(value)
    if (!Number.isNaN(parsed)) return parsed
  }
  return undefined
}

function objectFromPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {}
  const record = payload as Record<string, unknown>
  const nested = record.user ?? record.profile ?? record.data ?? record.account
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...(nested as Record<string, unknown>), ...record }
  }
  return record
}

export function normalizeRedditUserProfile(payload: unknown): NormalizedRedditProfile {
  const record = objectFromPayload(payload)
  const postKarma = numberFrom(
    record.postKarma ?? record.post_karma ?? record.linkKarma ?? record.link_karma,
  )
  const commentKarma = numberFrom(record.commentKarma ?? record.comment_karma)
  const totalKarma = numberFrom(
    record.totalKarma ?? record.total_karma ?? record.karma ?? record.combinedKarma,
  ) ?? (postKarma !== undefined || commentKarma !== undefined
    ? (postKarma ?? 0) + (commentKarma ?? 0)
    : undefined)
  const accountCreatedAt = timestampFrom(
    record.accountCreatedAt ??
      record.createdAt ??
      record.created_at ??
      record.createdUtc ??
      record.created_utc ??
      record.created,
  )

  return {
    totalKarma,
    postKarma,
    commentKarma,
    accountCreatedAt,
  }
}

export function decideRedditActivityStatus(
  profile: NormalizedRedditProfile,
  now = Date.now(),
): RedditActivityDecision {
  const activityIssues: string[] = []

  if (profile.totalKarma === undefined) {
    activityIssues.push("karma_unknown")
  } else if (profile.totalKarma < REDDIT_WARMUP_TOTAL_KARMA) {
    activityIssues.push("low_karma")
  }

  if (profile.accountCreatedAt === undefined) {
    activityIssues.push("account_age_unknown")
  } else {
    const ageDays = (now - profile.accountCreatedAt) / (24 * 60 * 60 * 1000)
    if (ageDays < REDDIT_WARMUP_ACCOUNT_AGE_DAYS) {
      activityIssues.push("new_account")
    }
  }

  return {
    ...profile,
    activityStatus: activityIssues.length === 0 ? "ready" : "warmup",
    activityIssues,
  }
}

export function normalizeSubredditName(name: string) {
  return name.replace(/^r\//i, "").trim().toLowerCase()
}

export function isUsableRedditAccount(account: {
  isActive: boolean
  healthStatus: "healthy" | "warning" | "banned"
  providerCanPost?: boolean
  providerNeedsReconnect?: boolean
}) {
  return (
    account.isActive &&
    account.healthStatus === "healthy" &&
    account.providerCanPost !== false &&
    account.providerNeedsReconnect !== true
  )
}

export function isReadyRedditAccount(account: Parameters<typeof isUsableRedditAccount>[0] & {
  activityStatus?: RedditActivityStatus
}) {
  return isUsableRedditAccount(account) && account.activityStatus === "ready"
}
