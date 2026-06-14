"use node"

import { createHash } from "node:crypto"
import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "../_generated/api"
import type { Id } from "../_generated/dataModel"
import { internalAction } from "../_generated/server"
import { deepseekV4Pro, judgeSettings } from "../lib/ai"

const sourcePageValidator = v.object({
  sourceType: v.union(v.literal("own"), v.literal("competitor")),
  competitorIndex: v.optional(v.number()),
  url: v.string(),
  normalizedUrl: v.string(),
  title: v.optional(v.string()),
  text: v.string(),
  exaId: v.optional(v.string()),
})

const pageUsefulnessSchema = z.object({
  pages: z.array(z.object({
    normalizedUrl: z.string(),
    useful: z.boolean(),
    pageKind: z.string(),
    reason: z.string(),
  })),
})

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 60_000)
}

function contentHash(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

export const filterUsefulProjectPages = internalAction({
  args: {
    projectId: v.id("projects"),
    pages: v.array(sourcePageValidator),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.runQuery(
      internal.onboarding.data.loadProjectIntelligenceProfile,
      { projectId: args.projectId },
    )
    if (!profile) throw new Error("Project intelligence profile not found")

      const buildId: Id<"projectIntelligenceBuilds"> = await ctx.runMutation(
      internal.onboarding.data.createProjectIntelligenceBuild,
      {
        projectId: args.projectId,
        profileId: profile._id,
        model: "deepseek-v4-pro",
        sourcePageCount: args.pages.length,
      },
    )

    try {
      const pageInputs = args.pages.map((page) => ({
        sourceType: page.sourceType,
        competitorIndex: page.competitorIndex,
        normalizedUrl: page.normalizedUrl,
        title: page.title ?? "",
        excerpt: normalizeText(page.text).slice(0, 2500),
      }))

      const result = await generateObject({
        model: deepseekV4Pro(),
        ...judgeSettings,
        schema: pageUsefulnessSchema,
        prompt: [
          "Classify which crawled pages are useful for building a compact operational project intelligence profile.",
          "Use only metadata and excerpts. Do not generate or edit the profile.",
          "Useful pages include product, pricing, features, solutions, comparisons, changelog, releases, about, and how-it-works pages.",
          "Return one row for each input normalizedUrl.",
          `Pages:\n${JSON.stringify(pageInputs)}`,
        ].join("\n\n"),
      })

      const classificationByUrl = new Map(
        result.object.pages.map((page) => [page.normalizedUrl, page]),
      )
      const usefulPages = args.pages.flatMap((page) => {
        const classification = classificationByUrl.get(page.normalizedUrl)
        if (!classification?.useful) return []
        const normalizedText = normalizeText(page.text)
        if (!normalizedText) return []

        return [{
          sourceType: page.sourceType,
          competitorIndex: page.competitorIndex,
          url: page.url,
          normalizedUrl: page.normalizedUrl,
          title: page.title,
          pageKind: classification.pageKind,
          normalizedText,
          contentHash: contentHash(normalizedText),
          exaId: page.exaId,
        }]
      })

      await ctx.runMutation(internal.onboarding.data.persistUsefulProjectPages, {
        projectId: args.projectId,
        profileId: profile._id,
        pages: usefulPages,
      })
      await ctx.runMutation(internal.onboarding.data.finishProjectIntelligenceBuild, {
        buildId,
        status: "complete",
        usefulPageCount: usefulPages.length,
      })

      return { usefulPages, buildId }
    } catch (error) {
      await ctx.runMutation(internal.onboarding.data.finishProjectIntelligenceBuild, {
        buildId,
        status: "failed",
        usefulPageCount: 0,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
})
