import { defineApp } from "convex/server"
import { v } from "convex/values"

const app = defineApp({
  env: {
    CLERK_JWT_ISSUER_DOMAIN: v.optional(v.string()),
    ZERNIO_API_KEY: v.string(),
    ZERNIO_BASE_URL: v.optional(v.string()),
    FETCHLAYER_API_KEY: v.string(),
    FETCHLAYER_BASE_URL: v.optional(v.string()),
    DEEPSEEK_API_KEY: v.string(),
  },
})

export default app
