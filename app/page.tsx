import type { Metadata } from "next"
import Link from "next/link"
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  Eye,
  MessageSquareText,
  Radar,
  ShieldCheck,
  Shuffle,
  Sparkles,
  ThumbsUp,
} from "lucide-react"

import { MarketingShell } from "@/components/marketing-shell"
import { PricingCards } from "@/components/pricing-cards"

export const metadata: Metadata = {
  title: "Astreex — Reddit Distribution, Run by Agents",
  description:
    "Astreex scans full subreddit feeds with 100+ daily agent runs, turns the best opportunities into swipeable cards, and schedules approved Reddit posts automatically.",
  openGraph: {
    title: "Astreex — Reddit Distribution, Run by Agents",
    description:
      "Scan every relevant Reddit conversation. Approve the best replies and posts in minutes. Let Astreex schedule the rest.",
    siteName: "Astreex",
    type: "website",
  },
}

const proof = [
  ["100+", "agent runs every day"],
  ["Full feed", "subreddits scanned beyond keywords"],
  ["5 min", "daily approval workflow"],
]

const pipeline = [
  {
    icon: Radar,
    title: "Scan the whole community",
    description:
      "Astreex watches new posts, active threads, competitor mentions, buyer pain, and subreddit norms — not just a keyword list.",
  },
  {
    icon: Bot,
    title: "Let agents argue over quality",
    description:
      "Specialized agents score fit, timing, intent, tone, and promotion risk before anything reaches your approval queue.",
  },
  {
    icon: MessageSquareText,
    title: "Draft replies and posts",
    description:
      "Cards arrive with context-aware writing that sounds like a useful founder entering the conversation, not an ad bot.",
  },
  {
    icon: Shuffle,
    title: "Approve once, schedule naturally",
    description:
      "Swipe to approve and Astreex spaces approved content across the following day at natural randomized intervals.",
  },
]

const features = [
  "Subreddit discovery and scoring",
  "Competitor and category monitoring",
  "Original post generation",
  "Reply opportunity ranking",
  "Shadow-ban and health checks",
  "Multi-account pacing",
  "Daily analytics",
  "Brand voice memory",
]

const approvals = [
  {
    subreddit: "r/SaaS",
    signal: "High intent",
    title: "Founder asks where to find first 20 qualified users",
    reply:
      "I would start where the pain is already explicit. Search for problem threads first, then answer like a practitioner — not a vendor.",
  },
  {
    subreddit: "r/startups",
    signal: "Post idea",
    title: "What 1,400 failed launch posts reveal about distribution",
    reply:
      "The pattern is usually not bad copy. It is founders launching into rooms where nobody has the problem yet.",
  },
]

export default function HomePage() {
  return (
    <MarketingShell>
      <div className="bg-[#FFFFEB] text-[#1A1A1A]">
        <section className="px-5 pb-20 pt-16 sm:px-6 lg:pb-28 lg:pt-24">
          <div className="mx-auto grid max-w-[1160px] gap-12 lg:grid-cols-[0.92fr_1.08fr] lg:items-center">
            <div>
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-[#D7D2B7] bg-white px-4 py-2 text-sm font-extrabold text-[#034F46]">
                <Sparkles className="size-4" />
                Built for founders who use Reddit seriously
              </div>

              <h1 className="max-w-3xl font-heading text-6xl font-medium leading-[0.95] tracking-[-0.055em] text-[#1A1A1A] sm:text-7xl lg:text-[5.8rem]">
                Your daily Reddit operating system.
              </h1>

              <p className="mt-7 max-w-2xl text-xl font-semibold leading-relaxed text-[#4F4D42]">
                Astreex scans entire subreddit feeds with 100+ agent runs a day,
                finds the conversations worth entering, writes the posts and
                replies, then asks you for one simple decision: approve or skip.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/sign-up"
                  className="inline-flex h-13 items-center justify-center gap-2 rounded-2xl border-2 border-[#1A1A1A] bg-[#F0D7FF] px-6 text-base font-black text-[#1A1A1A] shadow-[4px_4px_0_#1A1A1A] transition-transform hover:-translate-y-0.5"
                >
                  Start free trial
                  <ArrowRight className="size-4" />
                </Link>
                <a
                  href="#product"
                  className="inline-flex h-13 items-center justify-center rounded-2xl border-2 border-[#1A1A1A] bg-white px-6 text-base font-black text-[#1A1A1A] transition-colors hover:bg-[#F8F6DD]"
                >
                  See how it works
                </a>
              </div>

              <p className="mt-4 text-sm font-bold text-[#777465]">
                7-day trial · No credit card · Approve everything before it posts
              </p>
            </div>

            <ProductConsole />
          </div>

          <div className="mx-auto mt-14 grid max-w-[1160px] gap-3 md:grid-cols-3">
            {proof.map(([value, label]) => (
              <div
                key={label}
                className="rounded-3xl border border-[#D7D2B7] bg-white p-5"
              >
                <div className="font-heading text-5xl font-medium leading-none tracking-[-0.04em] text-[#034F46]">
                  {value}
                </div>
                <p className="mt-2 text-sm font-extrabold uppercase tracking-[0.12em] text-[#777465]">
                  {label}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-6 lg:py-8">
          <div className="w-full rounded-[3.75rem] bg-[#1A1A1A] px-5 py-16 text-[#FFFFEB] sm:px-8 lg:py-20">
            <div className="mx-auto grid max-w-[1160px] gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:items-start">
              <div>
                <p className="text-sm font-black uppercase tracking-[0.22em] text-[#F0D7FF]">
                  Why it wins
                </p>
                <h2 className="mt-4 font-heading text-5xl font-medium leading-[0.98] tracking-[-0.045em] sm:text-6xl">
                  Reddit rewards presence, not campaigns.
                </h2>
                <p className="mt-5 text-lg font-semibold leading-relaxed text-[#DCD8BF]">
                  The opportunity is not “make one viral post.” It is being useful
                  in the right rooms every day without spending your day browsing.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {pipeline.map((item) => (
                  <div
                    key={item.title}
                    className="rounded-3xl border border-[#3A3A32] bg-[#232323] p-6"
                  >
                    <div className="mb-8 flex size-12 items-center justify-center rounded-2xl bg-[#F0D7FF] text-[#1A1A1A]">
                      <item.icon className="size-6" />
                    </div>
                    <h3 className="text-xl font-black tracking-[-0.02em]">
                      {item.title}
                    </h3>
                    <p className="mt-3 text-sm font-semibold leading-relaxed text-[#DCD8BF]">
                      {item.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="product" className="px-5 py-20 sm:px-6 lg:py-28">
          <div className="mx-auto max-w-[1160px]">
            <div className="max-w-3xl">
              <p className="text-sm font-black uppercase tracking-[0.22em] text-[#034F46]">
                The daily ritual
              </p>
              <h2 className="mt-4 font-heading text-5xl font-medium leading-[0.96] tracking-[-0.045em] sm:text-7xl">
                Review the best opportunities before coffee is cold.
              </h2>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-[0.86fr_1.14fr]">
              <div className="rounded-[2rem] border-2 border-[#1A1A1A] bg-[#034F46] p-7 text-[#FFFFEB]">
                <div className="flex items-center justify-between border-b border-[#FFFFEB]/20 pb-5">
                  <div className="text-sm font-black uppercase tracking-[0.2em] text-[#CFE6DA]">
                    Today&apos;s deck
                  </div>
                  <div className="font-heading text-5xl leading-none">12</div>
                </div>
                <h3 className="mt-8 font-heading text-5xl font-medium leading-[0.98] tracking-[-0.04em]">
                  Swipe right only when it feels true.
                </h3>
                <p className="mt-5 text-lg font-semibold leading-relaxed text-[#E7EFE7]">
                  You stay in control. Astreex prepares the work, explains the
                  signal, and learns from every approve, skip, and edit.
                </p>
                <div className="mt-8 grid gap-3">
                  {[
                    "Approve good-fit replies",
                    "Skip weak opportunities",
                    "Edit tone before scheduling",
                  ].map((item) => (
                    <div key={item} className="flex items-center gap-3">
                      <CheckCircle2 className="size-5 text-[#F0D7FF]" />
                      <span className="font-bold">{item}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[2rem] border-2 border-[#1A1A1A] bg-white p-5 shadow-[6px_6px_0_#1A1A1A] sm:p-7">
                <div className="mb-5 flex items-center justify-between border-b border-[#E4DFCA] pb-4">
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.18em] text-[#777465]">
                      Approval queue
                    </div>
                    <div className="mt-1 text-xl font-black">Prepared by agents</div>
                  </div>
                  <div className="rounded-full bg-[#E8F3E8] px-3 py-1 text-xs font-black text-[#034F46]">
                    Ready
                  </div>
                </div>

                <div className="grid gap-4">
                  {approvals.map((card) => (
                    <article
                      key={card.title}
                      className="rounded-3xl border border-[#D7D2B7] bg-[#FFFFEB] p-5"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.14em] text-[#777465]">
                        <span>{card.subreddit}</span>
                        <span className="rounded-full bg-[#F0D7FF] px-2 py-1 text-[#1A1A1A]">
                          {card.signal}
                        </span>
                      </div>
                      <h3 className="mt-4 text-2xl font-black leading-tight tracking-[-0.03em]">
                        {card.title}
                      </h3>
                      <p className="mt-4 rounded-2xl bg-white p-4 text-base font-semibold leading-relaxed text-[#56564B]">
                        “{card.reply}”
                      </p>
                      <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                        <button className="h-11 flex-1 rounded-2xl border-2 border-[#1A1A1A] bg-white text-sm font-black">
                          Skip
                        </button>
                        <button className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-[#1A1A1A] bg-[#F0D7FF] text-sm font-black">
                          Approve
                          <ThumbsUp className="size-4" />
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="py-6 lg:py-8">
          <div className="w-full rounded-[3.75rem] bg-[#1A1A1A] px-5 py-16 text-[#FFFFEB] sm:px-8 lg:py-20">
            <div className="mx-auto max-w-[1160px]">
              <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-end">
                <div>
                  <p className="text-sm font-black uppercase tracking-[0.22em] text-[#F0D7FF]">
                    Product depth
                  </p>
                  <h2 className="mt-4 font-heading text-5xl font-medium leading-[0.96] tracking-[-0.045em] sm:text-6xl">
                    A complete Reddit distribution loop.
                  </h2>
                </div>
                <p className="text-lg font-semibold leading-relaxed text-[#DCD8BF]">
                  Astreex is not another “AI content generator.” It combines feed
                  monitoring, agentic reasoning, approval UX, scheduling, account
                  health, and analytics into one operating system.
                </p>
              </div>

              <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {features.map((feature) => (
                  <div
                    key={feature}
                    className="rounded-2xl border border-[#3A3A32] bg-[#232323] p-5"
                  >
                    <CheckCircle2 className="mb-6 size-5 text-[#F0D7FF]" />
                    <p className="font-black leading-snug tracking-[-0.02em]">
                      {feature}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="px-5 py-20 sm:px-6 lg:py-28">
          <div className="mx-auto grid max-w-[1160px] gap-8 lg:grid-cols-[1fr_0.95fr] lg:items-center">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.22em] text-[#034F46]">
                Safety layer
              </p>
              <h2 className="mt-4 font-heading text-5xl font-medium leading-[0.96] tracking-[-0.045em] sm:text-7xl">
                Grow without looking like you automated it.
              </h2>
              <p className="mt-5 max-w-2xl text-lg font-semibold leading-relaxed text-[#56564B]">
                Reddit punishes lazy promotion. Astreex is designed around
                restraint: relevance scoring, human approval, randomized timing,
                and account health monitoring.
              </p>
            </div>

            <div className="rounded-[2rem] border-2 border-[#1A1A1A] bg-white p-6 shadow-[6px_6px_0_#034F46]">
              <div className="mb-6 flex items-center gap-3 border-b border-[#E4DFCA] pb-5">
                <div className="flex size-12 items-center justify-center rounded-2xl bg-[#F0D7FF] text-[#1A1A1A]">
                  <ShieldCheck className="size-6" />
                </div>
                <div>
                  <h3 className="text-xl font-black">Pre-post checks</h3>
                  <p className="text-sm font-semibold text-[#777465]">
                    Applied before cards reach your queue
                  </p>
                </div>
              </div>
              <div className="grid gap-3">
                {[
                  "Promotion-risk scan",
                  "Subreddit tone matching",
                  "Natural schedule spacing",
                  "Shadow-ban monitoring",
                ].map((item) => (
                  <div
                    key={item}
                    className="flex items-center gap-3 rounded-2xl bg-[#FFFFEB] p-4"
                  >
                    <CheckCircle2 className="size-5 text-[#034F46]" />
                    <span className="font-bold">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-[#D7D2B7] bg-[#FFFFEB] px-5 py-20 sm:px-6 lg:py-24">
          <div className="mx-auto max-w-[1160px]">
            <div className="mx-auto mb-12 max-w-3xl text-center">
              <p className="text-sm font-black uppercase tracking-[0.22em] text-[#034F46]">
                Pricing
              </p>
              <h2 className="mt-4 font-heading text-5xl font-medium leading-[0.96] tracking-[-0.045em] sm:text-6xl">
                Start with one focused Reddit motion.
              </h2>
              <p className="mt-4 text-lg font-semibold text-[#56564B]">
                7-day free trial on every plan. No credit card required.
              </p>
            </div>
            <PricingCards />
          </div>
        </section>

        <section className="px-5 py-20 sm:px-6 lg:py-28">
          <div className="mx-auto max-w-[960px] rounded-[2rem] border-2 border-[#1A1A1A] bg-[#034F46] p-8 text-center text-[#FFFFEB] shadow-[6px_6px_0_#1A1A1A] sm:p-12">
            <Clock3 className="mx-auto mb-6 size-10 text-[#F0D7FF]" />
            <h2 className="font-heading text-5xl font-medium leading-[0.96] tracking-[-0.045em] sm:text-6xl">
              Tomorrow&apos;s Reddit work can be ready before you log in.
            </h2>
            <p className="mx-auto mt-5 max-w-2xl text-lg font-semibold leading-relaxed text-[#E7EFE7]">
              Connect your product, review the suggested subreddits, and let
              Astreex prepare your first approval deck.
            </p>
            <div className="mt-8">
              <Link
                href="/sign-up"
                className="inline-flex h-13 items-center justify-center gap-2 rounded-2xl border-2 border-[#FFFFEB] bg-[#F0D7FF] px-6 text-base font-black text-[#1A1A1A] transition-transform hover:-translate-y-0.5"
              >
                Start free trial
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </section>
      </div>
    </MarketingShell>
  )
}

function ProductConsole() {
  return (
    <div className="rounded-[2rem] border-2 border-[#1A1A1A] bg-white p-4 shadow-[8px_8px_0_#1A1A1A] sm:p-5">
      <div className="rounded-[1.5rem] border border-[#D7D2B7] bg-[#FFFFEB] p-5">
        <div className="mb-5 flex items-center justify-between border-b border-[#E4DFCA] pb-4">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] text-[#777465]">
              Astreex Command
            </div>
            <div className="mt-1 text-xl font-black tracking-[-0.03em]">
              Today&apos;s Reddit pipeline
            </div>
          </div>
          <span className="rounded-full bg-[#034F46] px-3 py-1 text-xs font-black text-[#FFFFEB]">
            Live scan
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          {[
            [Eye, "Scan", "438 posts"],
            [Bot, "Reason", "117 agents"],
            [ThumbsUp, "Review", "12 cards"],
            [Clock3, "Schedule", "Tomorrow"],
          ].map(([Icon, label, value]) => (
            <div key={label as string} className="rounded-2xl bg-white p-4">
              <Icon className="mb-6 size-5 text-[#034F46]" />
              <div className="text-sm font-black">{label as string}</div>
              <div className="mt-1 text-xs font-bold text-[#777465]">
                {value as string}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3">
          {[
            ["r/SaaS", "Founder asks about acquiring first users", "94% fit"],
            ["r/Entrepreneur", "Thread about cold-start distribution", "87% fit"],
            ["r/startups", "Post idea from competitor pattern", "Strong"],
          ].map(([subreddit, title, fit]) => (
            <div
              key={title}
              className="grid gap-3 rounded-2xl border border-[#E4DFCA] bg-white p-4 sm:grid-cols-[120px_1fr_auto] sm:items-center"
            >
              <div className="text-sm font-black text-[#034F46]">
                {subreddit}
              </div>
              <div className="font-bold leading-snug">{title}</div>
              <div className="w-fit rounded-full bg-[#F0D7FF] px-3 py-1 text-xs font-black">
                {fit}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
