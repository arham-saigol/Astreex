const MAX_RULES_JSON_LENGTH = 20_000

function sanitizeRuleValue(
  value: unknown,
  depth: number,
  maxStringLength: number,
  maxArrayItems: number,
  maxObjectKeys: number,
): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (typeof value === "string") return value.slice(0, maxStringLength)
  if (depth <= 0) return undefined
  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayItems)
      .map((item) =>
        sanitizeRuleValue(
          item,
          depth - 1,
          maxStringLength,
          maxArrayItems,
          maxObjectKeys,
        ),
      )
  }
  if (typeof value !== "object") return undefined

  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value).slice(0, maxObjectKeys)) {
    const sanitized = sanitizeRuleValue(
      item,
      depth - 1,
      maxStringLength,
      maxArrayItems,
      maxObjectKeys,
    )
    if (sanitized !== undefined) result[key] = sanitized
  }
  return result
}

function stringifySanitizedRules(
  rules: unknown,
  maxStringLength: number,
  maxArrayItems: number,
  maxObjectKeys: number,
) {
  return JSON.stringify(
    sanitizeRuleValue(rules, 4, maxStringLength, maxArrayItems, maxObjectKeys),
  )
}

export function stringifyRulesJson(rules: unknown) {
  const json = stringifySanitizedRules(rules, 300, 20, 20)
  if (json.length <= MAX_RULES_JSON_LENGTH) return json

  const compactJson = stringifySanitizedRules(rules, 100, 10, 10)
  if (compactJson.length <= MAX_RULES_JSON_LENGTH) return compactJson

  return JSON.stringify({ truncated: true })
}
