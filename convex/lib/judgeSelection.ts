import type { Draft } from "../pipeline/validators"
import type { PipelineLimits } from "./planLimits"

function draftSubreddit(draft: Draft) {
  return draft.targetSubreddit.toLowerCase()
}

function countOriginals(drafts: Draft[]) {
  return drafts.filter((draft) => draft.type === "original").length
}

export function sanitizeJudgeSelection(
  drafts: Draft[],
  selectedIndices: number[],
  limits: PipelineLimits,
) {
  const finalCount = Math.min(limits.cardsPerDay, drafts.length)
  const validIndices = selectedIndices.filter((index) =>
    Number.isInteger(index) && index >= 0 && index < drafts.length,
  )
  const orderedIndices = [
    ...validIndices,
    ...drafts.map((_, index) => index),
  ]

  const selected: number[] = []
  const seen = new Set<number>()
  const subredditCounts = new Map<string, number>()
  const uniqueSubreddits = new Set(drafts.map(draftSubreddit))
  const maxPerSubreddit = Math.max(
    1,
    Math.ceil(finalCount / Math.min(uniqueSubreddits.size || 1, finalCount || 1)),
  )

  for (const index of orderedIndices) {
    if (selected.length >= finalCount) break
    if (seen.has(index)) continue

    const subreddit = draftSubreddit(drafts[index])
    const count = subredditCounts.get(subreddit) ?? 0
    if (count >= maxPerSubreddit) continue

    selected.push(index)
    seen.add(index)
    subredditCounts.set(subreddit, count + 1)
  }

  for (const index of orderedIndices) {
    if (selected.length >= finalCount) break
    if (seen.has(index)) continue

    selected.push(index)
    seen.add(index)
  }

  const availableOriginals = drafts
    .map((draft, index) => ({ draft, index }))
    .filter((item) => item.draft.type === "original")
  const minOriginals = Math.min(limits.minOriginals, availableOriginals.length, finalCount)

  while (countOriginals(selected.map((index) => drafts[index])) < minOriginals) {
    const original = availableOriginals.find((item) => !seen.has(item.index))
    if (!original) break

    const replaceAt = [...selected]
      .reverse()
      .find((index) => drafts[index].type === "reply")
    if (replaceAt === undefined) break

    const position = selected.indexOf(replaceAt)
    seen.delete(replaceAt)
    selected[position] = original.index
    seen.add(original.index)
  }

  return selected.slice(0, finalCount).map((index) => drafts[index])
}
