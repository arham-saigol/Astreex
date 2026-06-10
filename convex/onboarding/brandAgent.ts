"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { deepseekV4Pro, judgeSettings } from "../lib/ai"

const scrapeStatusValidator = v.union(
  v.literal("complete"),
  v.literal("degraded"),
)

const brandProfileSchema = z.object({
  name: z.string().describe("The product/brand name"),
  tagline: z.string().nullable().describe("One-line description, max 10 words. Return null if not found on the page."),
  description: z.string().describe("What the product does in 2-3 sentences"),
  targetAudience: z.array(z.string()).describe(
    "3-5 specific Reddit-style audience segments, e.g. 'indie hackers', 'B2B SaaS founders', 'devops engineers'",
  ),
  painPointsSolved: z.array(z.string()).describe(
    "3-5 specific pain points the product addresses",
  ),
  keyFeatures: z.array(z.string()).describe(
    "3-5 main product features or capabilities",
  ),
  tone: z.string().describe(
    "How the brand communicates, e.g. 'technical but approachable, direct, slightly casual'",
  ),
  avoidTopics: z.array(z.string()).describe(
    "Topics to never mention in Reddit posts, e.g. 'direct pricing comparisons with competitors'",
  ),
  competitors: z.array(z.string()).describe(
    "Names of direct competitor products or services mentioned or strongly implied on the page",
  ),
  industry: z.string().describe(
    "One-line industry categorization, e.g. 'B2B SaaS / developer tools'",
  ),
})

export const generateBrandProfile = internalAction({
  args: {
    projectId: v.id("projects"),
    websiteContent: v.string(),
    competitorContent: v.union(v.string(), v.null()),
    scrapeStatus: scrapeStatusValidator,
  },
  handler: async (ctx, args) => {
    const result = await generateObject({
      model: deepseekV4Pro(),
      ...judgeSettings,
      schema: brandProfileSchema,
      prompt: [
        "Analyze this website content and generate a comprehensive brand profile for Reddit marketing purposes.",
        args.scrapeStatus === "degraded"
          ? "The scrape was degraded. Use the available text and URL/domain clues, but avoid inventing unsupported specifics."
          : "Use concrete details from the website content.",
        `Website content:\n${args.websiteContent}`,
        `Competitor's content (for context on market positioning):\n${args.competitorContent ?? "Not provided"}`,
        [
          "Generate a JSON brand profile with these fields:",
          "- name: The product/brand name",
          "- tagline: One-line description (max 10 words)",
          "- description: What the product does (2-3 sentences)",
          "- targetAudience: Array of 3-5 audience segments",
          "- painPointsSolved: Array of 3-5 problems the product solves",
          "- keyFeatures: Array of 3-5 main features",
          "- tone: How the brand communicates",
          "- avoidTopics: Array of topics to avoid in Reddit posts",
          "- competitors: Array of competitor names",
          "- industry: One-line industry categorization",
          "Be specific and actionable. The target audience should be specific Reddit-style communities, not generic marketing segments.",
        ].join("\n"),
      ].join("\n\n"),
    })

    await ctx.runMutation(internal.onboarding.data.saveBrandProfile, {
      projectId: args.projectId,
      profileJson: JSON.stringify(result.object),
      scrapeStatus: args.scrapeStatus,
    })

    return result.object
  },
})
