import { createDeepSeek } from "@ai-sdk/deepseek"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"

export function deepseekV4Pro() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim()
  if (!apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured")
  }

  const deepseek = createDeepSeek({ apiKey })
  return deepseek("deepseek-v4-pro")
}

export function fireworksKimiK26() {
  const apiKey = process.env.FIREWORKS_API_KEY?.trim()
  if (!apiKey) {
    throw new Error("FIREWORKS_API_KEY is not configured")
  }

  const fireworks = createOpenAICompatible({
    name: "fireworks",
    apiKey,
    baseURL: "https://api.fireworks.ai/inference/v1",
  })
  return fireworks("accounts/fireworks/models/kimi-k2p6")
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
