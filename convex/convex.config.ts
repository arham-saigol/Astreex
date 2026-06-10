import { defineApp } from "convex/server"
import { v } from "convex/values"

const app = defineApp({
  env: {
    CLERK_JWT_ISSUER_DOMAIN: v.optional(v.string()),
    REDDIT_CLIENT_ID: v.string(),
    REDDIT_CLIENT_SECRET: v.string(),
    REDDIT_TOKEN_ENCRYPTION_KEY: v.string(),
    DEEPSEEK_API_KEY: v.string(),
  },
})

export default app
