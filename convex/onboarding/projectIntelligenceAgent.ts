"use node"

import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { fireworksKimiK26, judgeSettings } from "../lib/ai"

const scrapeStatusValidator = v.union(
  v.literal("complete"),
  v.literal("degraded"),
)

const usefulPageValidator = v.object({
  sourceType: v.union(v.literal("own"), v.literal("competitor")),
  competitorIndex: v.optional(v.number()),
  title: v.optional(v.string()),
  pageKind: v.optional(v.string()),
  normalizedText: v.string(),
})

const projectIntelligenceSchema = z.object({
  overview: z.string(),
  capabilities: z.array(z.string()),
  icps: z.array(z.string()),
  personas: z.array(z.string()),
  painPoints: z.array(z.string()),
  pricingAndCompetitorComparisons: z.array(z.string()),
  whereProjectLeads: z.array(z.string()),
  whereCompetitorsLead: z.array(z.string()),
  weaknesses: z.array(z.string()),
  futureAdvantages: z.array(z.string()),
  positioning: z.string(),
  redditUsefulAngles: z.array(z.string()),
  avoidTopics: z.array(z.string()),
  agentNotes: z.array(z.string()),
})

const forbiddenKeyPattern = /(^|[_-])(source|sources|citation|citations|evidence|url|urls|link|links)([_-]|$)/i
const urlPattern = /\bhttps?:\/\/|\bwww\./i

function assertNoEvidenceOrUrls(value: unknown, path = "intelligence") {
  if (typeof value === "string") {
    if (urlPattern.test(value)) {
      throw new Error(`Project intelligence contains URL-like text at ${path}`)
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoEvidenceOrUrls(item, `${path}[${index}]`))
    return
  }

  if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKeyPattern.test(key)) {
        throw new Error(`Project intelligence contains forbidden evidence key ${path}.${key}`)
      }
      assertNoEvidenceOrUrls(nested, `${path}.${key}`)
    }
  }
}

export const generateProjectIntelligenceProfile = internalAction({
  args: {
    projectId: v.id("projects"),
    usefulPages: v.array(usefulPageValidator),
    scrapeStatus: scrapeStatusValidator,
  },
  handler: async (ctx, args) => {
    if (args.usefulPages.length === 0) {
      throw new Error("No useful pages available for project intelligence")
    }

    const pageContext = args.usefulPages.slice(0, 40).map((page, index) => ({
      label:
        page.sourceType === "own"
          ? `Own page ${index + 1}`
          : `Competitor ${Number(page.competitorIndex ?? 0) + 1} page ${index + 1}`,
      title: page.title ?? "",
      pageKind: page.pageKind ?? "",
      text: page.normalizedText.slice(0, 8000),
    }))

    const result = await generateObject({
      model: fireworksKimiK26(),
      ...judgeSettings,
      schema: projectIntelligenceSchema,
      prompt: [
        "Build a compact agent-facing Project intelligence JSON for Reddit distribution automation.",
        "Use selected page text and competitor labels only. Do not include source URLs, links, citations, or evidence fields.",
        args.scrapeStatus === "degraded"
          ? "The crawl was degraded. Use available text conservatively and avoid inventing specifics."
          : "Use concrete details from the selected pages.",
        [
          "The profile must be operational and compact, with these fields:",
          "overview, capabilities, icps, personas, painPoints, pricingAndCompetitorComparisons, whereProjectLeads, whereCompetitorsLead, weaknesses, futureAdvantages, positioning, redditUsefulAngles, avoidTopics, agentNotes.",
          "Avoid generic marketing language. Write notes downstream agents can use to filter posts, draft replies, judge content, and discover subreddits.",
        ].join("\n"),
        `Selected page text:\n${JSON.stringify(pageContext)}`,
      ].join("\n\n"),
    })

    assertNoEvidenceOrUrls(result.object)
    const intelligenceJson = JSON.stringify(result.object)

    await ctx.runMutation(internal.onboarding.data.saveProjectIntelligenceProfile, {
      projectId: args.projectId,
      intelligenceJson,
      scrapeStatus: args.scrapeStatus,
    })

    return result.object
  },
})
