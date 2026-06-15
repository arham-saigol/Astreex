type ContextPurpose = "reply" | "original" | "filter" | "judge"

const fieldsByPurpose: Record<ContextPurpose, string[]> = {
  reply: [
    "overview",
    "capabilities",
    "icps",
    "personas",
    "painPoints",
    "positioning",
    "redditUsefulAngles",
    "avoidTopics",
    "agentNotes",
  ],
  original: [
    "overview",
    "capabilities",
    "icps",
    "personas",
    "painPoints",
    "positioning",
    "redditUsefulAngles",
    "avoidTopics",
  ],
  filter: [
    "overview",
    "icps",
    "personas",
    "painPoints",
    "positioning",
    "redditUsefulAngles",
    "avoidTopics",
  ],
  judge: [
    "overview",
    "capabilities",
    "positioning",
    "redditUsefulAngles",
    "avoidTopics",
    "agentNotes",
  ],
}

export function compactIntelligenceJson(intelligenceJson: string, purpose: ContextPurpose) {
  try {
    const parsed = JSON.parse(intelligenceJson) as Record<string, unknown>
    const compact: Record<string, unknown> = {}
    for (const field of fieldsByPurpose[purpose]) {
      if (parsed[field] !== undefined) compact[field] = parsed[field]
    }
    return JSON.stringify(compact)
  } catch {
    return intelligenceJson
  }
}
