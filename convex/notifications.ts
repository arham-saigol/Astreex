import { v } from "convex/values"
import { query } from "./_generated/server"
import { requireProjectAccessByRef } from "./lib/projectRefs"

const severity = v.union(
  v.literal("info"),
  v.literal("warning"),
  v.literal("critical"),
)

type BannerNotification = {
  id: string
  severity: "info" | "warning" | "critical"
  message: string
}

export const getActiveBanners = query({
  args: { projectRef: v.string() },
  returns: v.array(
    v.object({
      id: v.string(),
      severity,
      message: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<BannerNotification[]> => {
    const { project } = await requireProjectAccessByRef(ctx, args.projectRef)
    const billing = {
      planStatus: project.planStatus,
    }

    const notifications: BannerNotification[] = []

    if (billing.planStatus === "past_due") {
      notifications.push({
        id: "payment-past-due",
        severity: "critical",
        message: "Payment failed. Update your payment method to avoid interruption.",
      })
    }

    const accounts = await ctx.db
      .query("redditAccounts")
      .withIndex("by_projectId", (q) => q.eq("projectId", project._id))
      .take(50)

    const hasBannedAccount = accounts.some(
      (account) => account.healthStatus === "banned",
    )
    const hasWarningAccount = accounts.some(
      (account) => account.healthStatus === "warning",
    )

    if (hasBannedAccount || hasWarningAccount) {
      notifications.push({
        id: hasBannedAccount ? "reddit-health-banned" : "reddit-health-warning",
        severity: hasBannedAccount ? "critical" : "warning",
        message: "Your Reddit account may be shadow banned. Check your posted content.",
      })
    }

    return notifications
  },
})
