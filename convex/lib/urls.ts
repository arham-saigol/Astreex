import { assertPublicHostname } from "./publicHosts"

export function normalizeHttpUrl(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label} is required`)

  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error(`${label} must be a valid URL`)
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label} must start with http:// or https://`)
  }
  assertPublicHostname(url.hostname, label)

  url.hash = ""
  if (url.pathname === "/") url.pathname = ""
  return url.toString()
}

function dedupeKey(value: string) {
  const url = new URL(value)
  const port = url.port ? `:${url.port}` : ""
  return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${port}${url.pathname}${url.search}`
}

export function normalizeOptionalHttpUrls(
  values: string[] | undefined,
  label: string,
) {
  const normalized: string[] = []
  const seen = new Set<string>()

  for (const value of values ?? []) {
    if (!value.trim()) continue
    const url = normalizeHttpUrl(value, label)
    const key = dedupeKey(url)
    if (seen.has(key)) {
      throw new Error(`${label} contains duplicate URLs`)
    }
    seen.add(key)
    normalized.push(url)
  }

  return normalized
}
