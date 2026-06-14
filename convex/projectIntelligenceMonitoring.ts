"use node"

import { createHash } from "node:crypto"
import Exa from "exa-js"
import { generateObject } from "ai"
import { v } from "convex/values"
import { z } from "zod"
import { internal } from "./_generated/api"
import type { Id } from "./_generated/dataModel"
import { internalAction } from "./_generated/server"
import { fireworksKimiK26, judgeSettings } from "./lib/ai"

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

const changeEvaluationSchema = z.object({
  meaningful: z.boolean(),
  reason: z.string(),
  updatedIntelligence: projectIntelligenceSchema.optional(),
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

function normalizeText(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 60_000)
}

function contentHash(text: string) {
  return createHash("sha256").update(text).digest("hex")
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

async function fetchPage(url: string) {
  const apiKey = process.env.EXA_API_KEY
  if (apiKey) {
    try {
      const exa = new Exa(apiKey)
      const result = await exa.getContents([url], {
        text: { maxCharacters: 60000 },
        maxAgeHours: 1,
      })
      const page = result.results[0]
      const text = normalizeText(page?.text ?? "")
      if (text) {
        return {
          normalizedText: text,
          title: page.title,
          exaId: page.id,
          contentHash: contentHash(text),
        }
      }
    } catch (error) {
      console.log(`Exa monitored page refresh failed for ${url}`, error)
    }
  }

  const response = await fetch(url, { headers: { "User-Agent": "astreex/0.1" } })
  if (!response.ok) throw new Error(`Page fetch failed with status ${response.status}`)
  const normalizedText = normalizeText(stripHtml(await response.text()))
  return { normalizedText, contentHash: contentHash(normalizedText) }
}

function nextWeeklyCheck(now: number) {
  return now + 7 * 24 * 60 * 60 * 1000
}

export const evaluatePageChangeAndMaybeUpdateProfile = internalAction({
  args: {
    eventId: v.id("projectIntelligenceChangeEvents"),
  },
  handler: async (ctx, args) => {
    try {
      const context = await ctx.runQuery(
        internal.projectIntelligenceData.loadChangeEvaluationContext,
        { eventId: args.eventId },
      )
      const result = await generateObject({
        model: fireworksKimiK26(),
        ...judgeSettings,
        schema: changeEvaluationSchema,
        prompt: [
          "Decide whether a monitored page change meaningfully updates this compact project intelligence profile.",
          "If meaningful, return the full updated profile in the same schema. Do not include sources, links, URLs, citations, or evidence keys.",
          `Current project intelligence JSON:\n${context.profile.intelligenceJson}`,
          `Page metadata JSON:\n${JSON.stringify({
            sourceType: context.page.sourceType,
            competitorIndex: context.page.competitorIndex,
            title: context.page.title,
            pageKind: context.page.pageKind,
          })}`,
          `Previous page text:\n${context.previousSnapshot?.normalizedText.slice(0, 12000) ?? ""}`,
          `New page text:\n${context.newSnapshot.normalizedText.slice(0, 12000)}`,
        ].join("\n\n"),
      })

      if (!result.object.meaningful) {
        await ctx.runMutation(
          internal.projectIntelligenceData.markChangeEventNotSignificant,
          {
            eventId: args.eventId,
            summary: result.object.reason,
          },
        )
        return { updated: false }
      }

      if (!result.object.updatedIntelligence) {
        throw new Error("Meaningful change did not include updated intelligence")
      }

      assertNoEvidenceOrUrls(result.object.updatedIntelligence)
      await ctx.runMutation(
        internal.projectIntelligenceData.markChangeEventProfileUpdated,
        {
          eventId: args.eventId,
          profileId: context.profile._id,
          intelligenceJson: JSON.stringify(result.object.updatedIntelligence),
          summary: result.object.reason,
        },
      )
      return { updated: true }
    } catch (error) {
      await ctx.runMutation(internal.projectIntelligenceData.markChangeEventFailed, {
        eventId: args.eventId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },
})

export const refreshDueMonitoredPages = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now()
    let cursor: string | null = null
    let isDone = false
    let checked = 0
    let changed = 0

    while (!isDone && checked < 200) {
      const page: {
        page: Array<{
          _id: Id<"monitoredPages">
          url: string
          lastContentHash?: string
        }>
        continueCursor: string
        isDone: boolean
      } = await ctx.runQuery(
        internal.projectIntelligenceData.listDueMonitoredPages,
        {
          now,
          paginationOpts: { numItems: 50, cursor },
        },
      )

      for (const monitoredPage of page.page) {
        checked++
        const fetched = await fetchPage(monitoredPage.url)
        if (fetched.contentHash === monitoredPage.lastContentHash) {
          await ctx.runMutation(
            internal.projectIntelligenceData.markMonitoredPageUnchanged,
            {
              monitoredPageId: monitoredPage._id,
              fetchedAt: now,
              nextCheckAt: nextWeeklyCheck(now),
            },
          )
          continue
        }

        const inserted: { eventId: Id<"projectIntelligenceChangeEvents"> } =
          await ctx.runMutation(
            internal.projectIntelligenceData.insertChangedSnapshotAndEvent,
            {
              monitoredPageId: monitoredPage._id,
              fetchedAt: now,
              nextCheckAt: nextWeeklyCheck(now),
              contentHash: fetched.contentHash,
              normalizedText: fetched.normalizedText,
              title: fetched.title ?? undefined,
              exaId: fetched.exaId,
            },
          )
        changed++
        await ctx.runAction(
          internal.projectIntelligenceMonitoring.evaluatePageChangeAndMaybeUpdateProfile,
          { eventId: inserted.eventId },
        )
      }

      cursor = page.continueCursor
      isDone = page.isDone
    }

    return { checked, changed }
  },
})
