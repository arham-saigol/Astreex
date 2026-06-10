import { createDeepSeek } from "@ai-sdk/deepseek"

export function deepseekV4Pro() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured")
  }

  const deepseek = createDeepSeek({ apiKey })
  return deepseek("deepseek-v4-pro")
}

export const filterSettings = {
  temperature: 0.3,
  maxOutputTokens: 4000,
}

export const judgeSettings = {
  temperature: 0.3,
  maxOutputTokens: 4000,
}

export const replySettings = {
  temperature: 0.7,
  maxOutputTokens: 1000,
}

export const originalSettings = {
  temperature: 0.7,
  maxOutputTokens: 2000,
}
