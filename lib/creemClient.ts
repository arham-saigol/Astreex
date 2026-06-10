import { Creem } from "creem"

export function createCreemClient() {
  const apiKey = process.env.CREEM_API_KEY

  if (!apiKey) {
    throw new Error("CREEM_API_KEY is not configured")
  }

  return new Creem({
    apiKey,
    serverIdx: apiKey.startsWith("creem_test_") ? 1 : 0,
  })
}
