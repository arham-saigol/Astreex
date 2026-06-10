"use node"

import Exa from "exa-js"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"

const SUBPAGE_TARGET = [
  "features",
  "pricing",
  "about",
  "product",
  "how-it-works",
  "solutions",
]

type ScrapeResult = {
  websiteContent: string
  competitorContent: string | null
  scrapeStatus: "complete" | "degraded"
}

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return trimmed
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim()
}

function domainText(url: string) {
  try {
    const parsed = new URL(normalizeUrl(url))
    return parsed.hostname.replace(/^www\./, "").replace(/\./g, " ")
  } catch {
    return url
  }
}

async function fetchFallback(url: string) {
  try {
    const response = await fetch(normalizeUrl(url), {
      headers: {
        "User-Agent": "astreex/0.1",
      },
    })
    if (!response.ok) {
      console.log(`Website scrape fallback failed for ${url}: ${response.status}`)
      return domainText(url)
    }

    const text = stripHtml(await response.text())
    return text || domainText(url)
  } catch (error) {
    console.log(`Website scrape fallback error for ${url}`, error)
    return domainText(url)
  }
}

async function scrapeWithExa(url: string, subpages: number) {
  const apiKey = process.env.EXA_API_KEY
  if (!apiKey) throw new Error("EXA_API_KEY is not configured")

  const exa = new Exa(apiKey)
  const result = await exa.getContents([normalizeUrl(url)], {
    subpages,
    subpageTarget: SUBPAGE_TARGET,
    text: { maxCharacters: 15000 },
    maxAgeHours: 24,
  })

  const homepage = result.results[0]
  const homepageText = homepage?.text?.trim() ?? ""
  if (!homepageText) throw new Error("Exa returned empty homepage text")

  return [
    homepageText,
    ...(homepage.subpages ?? []).map((page, index) =>
      `\n\n--- Subpage ${index + 1} ---\n${page.text ?? ""}`,
    ),
  ].join("\n")
}

async function scrapeUrl(url: string, subpages: number) {
  try {
    return {
      content: await scrapeWithExa(url, subpages),
      degraded: false,
    }
  } catch (error) {
    console.log(`Exa scrape failed for ${url}; falling back to plain fetch`, error)
    return {
      content: await fetchFallback(url),
      degraded: true,
    }
  }
}

export const scrapeWebsites = internalAction({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args): Promise<ScrapeResult> => {
    const brand = await ctx.runQuery(
      internal.onboarding.data.loadBrandForProject,
      { projectId: args.projectId },
    )
    if (!brand) throw new Error("Brand not found")

    const website = await scrapeUrl(brand.websiteUrl, 7)
    let competitorContent: string | null = null
    let competitorDegraded = false

    if (brand.competitorUrl?.trim()) {
      const competitor = await scrapeUrl(brand.competitorUrl, 3)
      competitorContent = competitor.content
      competitorDegraded = competitor.degraded
    }

    return {
      websiteContent: website.content,
      competitorContent,
      scrapeStatus: website.degraded || competitorDegraded ? "degraded" : "complete",
    }
  },
})
