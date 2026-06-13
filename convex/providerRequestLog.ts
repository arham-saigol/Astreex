import { v } from "convex/values"
import { internalMutation } from "./_generated/server"

export const log = internalMutation({
  args: {
    provider: v.union(v.literal("zernio"), v.literal("fetchlayer")),
    endpoint: v.string(),
    status: v.optional(v.number()),
    ok: v.boolean(),
    durationMs: v.number(),
    error: v.optional(v.string()),
    requestedAt: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("providerRequestLog", {
      ...args,
      createdAt: Date.now(),
    })
  },
})
