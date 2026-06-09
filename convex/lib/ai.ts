import { createDeepSeek } from "@ai-sdk/deepseek"

const deepseek = createDeepSeek({
  apiKey: process.env.DEEPSEEK_API_KEY ?? "",
})

export function deepseekV4Pro() {
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
