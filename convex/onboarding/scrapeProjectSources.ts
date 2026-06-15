"use node"

import Exa from "exa-js"
import { lookup } from "node:dns/promises"
import { v } from "convex/values"
import { internal } from "../_generated/api"
import { internalAction } from "../_generated/server"
import { assertPublicHostname, isPrivateOrInternalIp } from "../lib/publicHosts"

const SUBPAGE_TARGET = [
  "pricing",
  "features",
  "product",
  "solutions",
  "comparison",
  "changelog",
  "releases",
  "about",
  "how-it-works",
]

export type ProjectSourcePage = {
  sourceType: "own" | "competitor"
  competitorIndex?: number
  url: string
  normalizedUrl: string
  title?: string
  text: string
  exaId?: string
}

type ScrapeResult = {
  pages: ProjectSourcePage[]
  scrapeStatus: "complete" | "degraded"
}

function normalizeUrl(value: string) {
  const trimmed = value.trim()
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  const url = new URL(withProtocol)
  assertPublicHostname(url.hostname, "URL")
  url.hash = ""
  if (url.pathname === "/") url.pathname = ""
  return url.toString()
}

async function assertPublicResolvedHost(normalizedUrl: string) {
  const hostname = new URL(normalizedUrl).hostname
  assertPublicHostname(hostname, "URL")
  const addresses = await lookup(hostname, { all: true })
  if (addresses.some((address) => isPrivateOrInternalIp(address.address))) {
    throw new Error("URL must resolve to a public IP address")
  }
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

async function fetchFallback(
  url: string,
  sourceType: "own" | "competitor",
  competitorIndex?: number,
): Promise<ProjectSourcePage> {
  const normalizedUrl = normalizeUrl(url)
  await assertPublicResolvedHost(normalizedUrl)
  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        "User-Agent": "astreex/0.1",
      },
    })
    if (!response.ok) {
      console.log(`Website scrape fallback failed for ${url}: ${response.status}`)
      return {
        sourceType,
        competitorIndex,
        url: normalizedUrl,
        normalizedUrl,
        text: domainText(url),
      }
    }

    const text = stripHtml(await response.text())
    return {
      sourceType,
      competitorIndex,
      url: normalizedUrl,
      normalizedUrl,
      text: text || domainText(url),
    }
  } catch (error) {
    console.log(`Website scrape fallback error for ${url}`, error)
    return {
      sourceType,
      competitorIndex,
      url: normalizedUrl,
      normalizedUrl,
      text: domainText(url),
    }
  }
}

function pageFromExa(
  page: {
    id?: string
    url?: string
    title?: string | null
    text?: string
  },
  sourceType: "own" | "competitor",
  competitorIndex?: number,
): ProjectSourcePage | null {
  const text = page.text?.trim()
  if (!page.url || !text) return null
  const normalizedUrl = normalizeUrl(page.url)

  return {
    sourceType,
    competitorIndex,
    url: page.url,
    normalizedUrl,
    title: page.title ?? undefined,
    text,
    exaId: page.id,
  }
}

async function scrapeWithExa(
  url: string,
  subpages: number,
  sourceType: "own" | "competitor",
  competitorIndex?: number,
) {
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
  const pages = [
    pageFromExa(homepage, sourceType, competitorIndex),
    ...((homepage?.subpages ?? []) as Array<{
      id?: string
      url?: string
      title?: string | null
      text?: string
    }>)
      .slice(0, subpages)
      .map((page) => pageFromExa(page, sourceType, competitorIndex)),
  ].filter((page): page is ProjectSourcePage => page !== null)

  if (pages.length === 0) throw new Error("Exa returned no usable page text")
  return pages.slice(0, subpages + 1)
}

async function scrapeUrl(
  url: string,
  subpages: number,
  sourceType: "own" | "competitor",
  competitorIndex?: number,
) {
  try {
    return {
      pages: await scrapeWithExa(url, subpages, sourceType, competitorIndex),
      degraded: false,
    }
  } catch (error) {
    console.log(`Exa scrape failed for ${url}; falling back to plain fetch`, error)
    return {
      pages: [await fetchFallback(url, sourceType, competitorIndex)],
      degraded: true,
    }
  }
}

export const scrapeProjectSources = internalAction({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args): Promise<ScrapeResult> => {
    const profile = await ctx.runQuery(
      internal.onboarding.data.loadProjectIntelligenceProfile,
      { projectId: args.projectId },
    )
    if (!profile) throw new Error("Project intelligence profile not found")

    const [own, ...competitorResults] = await Promise.all([
      scrapeUrl(profile.websiteUrl, 5, "own"),
      ...profile.competitorUrls.map((url, index) =>
        scrapeUrl(url, 3, "competitor", index),
      ),
    ])
    const pages = [
      ...own.pages,
      ...competitorResults.flatMap((result) => result.pages),
    ]

    return {
      pages,
      scrapeStatus:
        own.degraded || competitorResults.some((result) => result.degraded)
          ? "degraded"
          : "complete",
    }
  },
})
