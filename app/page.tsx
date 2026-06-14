import type { Metadata } from "next"
import Link from "next/link"
import {
  Eye,
  Layers,
  MessageSquareText,
  Radar,
  ShieldCheck,
  Zap,
} from "lucide-react"

import { HeroMockup } from "@/components/hero-mockup"
import { MarketingShell } from "@/components/marketing-shell"
import { PricingCards } from "@/components/pricing-cards"

export const metadata: Metadata = {
  title: "Astreex — Reddit Growth on Autopilot",
  description:
    "Daily AI-curated Reddit replies and posts for B2B founders. Approve in 5 minutes, post automatically.",
  openGraph: {
    title: "Astreex — Reddit Growth on Autopilot",
    description:
      "Daily AI-curated Reddit replies and posts for B2B founders. Approve in 5 minutes, post automatically.",
    siteName: "Astreex",
    type: "website",
  },
}

const steps = [
  {
    number: "01",
    title: "Connect your product",
    description:
      "Add your website. Our AI reads it and builds your Project Intelligence Profile automatically.",
  },
  {
    number: "02",
    title: "Review your daily cards",
    description:
      "Each morning, approve the replies and posts that feel right. Skip the rest.",
  },
  {
    number: "03",
    title: "Posted automatically",
    description:
      "Approved content goes live at natural-looking intervals throughout the day.",
  },
]

const features = [
  {
    icon: Zap,
    title: "Daily AI cards",
    description:
      "Wake up to replies and posts tailored to your brand. No prompting required.",
  },
  {
    icon: Eye,
    title: "One-tap scheduling",
    description:
      "Approve with a swipe. Posts spread across the day automatically.",
  },
  {
    icon: ShieldCheck,
    title: "Shadow ban protection",
    description:
      "We monitor your posts daily and alert you the moment something's hidden.",
  },
  {
    icon: MessageSquareText,
    title: "Context-aware replies",
    description:
      "Every reply matches your tone and links your product naturally — never spammy.",
  },
  {
    icon: Radar,
    title: "Subreddit radar",
    description:
      "AI finds and scores the best communities for your product. Always up to date.",
  },
  {
    icon: Layers,
    title: "Multi-account posting",
    description:
      "Spread activity across Reddit accounts to protect your presence.",
  },
]

export default function HomePage() {
  return (
    <MarketingShell>
      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-[1080px] gap-12 px-6 pb-20 pt-20 md:pt-28 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:gap-16 lg:pb-28">
          <div className="space-y-7">
            <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent-subtle px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">
              Reddit growth on autopilot
            </span>

            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-text-primary sm:text-5xl lg:text-[3.25rem]">
              Turn Reddit into your best acquisition channel.
            </h1>

            <p className="max-w-[520px] text-lg leading-relaxed text-text-secondary">
              Daily AI-curated reply suggestions and original posts — approve in
              5 minutes, posted automatically.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Link
                href="/sign-up"
                className="inline-flex h-11 items-center rounded-lg bg-accent px-5 text-sm font-medium text-accent-foreground shadow-sm transition-colors hover:bg-accent-hover"
              >
                Start free trial
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex h-11 items-center rounded-lg border border-border px-5 text-sm font-medium text-text-primary transition-colors hover:bg-muted"
              >
                See how it works
              </a>
            </div>

            <p className="text-xs text-text-tertiary">
              7-day free trial · No credit card required
            </p>
          </div>

          <div className="hidden lg:block">
            <HeroMockup />
          </div>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section
        id="how-it-works"
        className="border-t border-border/40 bg-surface/50"
      >
        <div className="mx-auto max-w-[1080px] px-6 py-20 md:py-24">
          <div className="mb-14 max-w-lg">
            <h2 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-[2rem]">
              From noise to results, in minutes a day.
            </h2>
          </div>

          <div className="grid gap-10 md:grid-cols-3 md:gap-8">
            {steps.map((step) => (
              <div key={step.number} className="space-y-4">
                <span className="font-mono text-3xl font-bold text-accent/80">
                  {step.number}
                </span>
                <h3 className="text-lg font-semibold text-text-primary">
                  {step.title}
                </h3>
                <p className="text-sm leading-relaxed text-text-secondary">
                  {step.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── FEATURES ─── */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-[1080px] px-6 py-20 md:py-24">
          <div className="mb-14 max-w-lg">
            <h2 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-[2rem]">
              Everything a founder needs to grow on Reddit.
            </h2>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-xl border border-border/70 bg-surface p-6 transition-shadow hover:shadow-md"
              >
                <div className="mb-4 flex size-10 items-center justify-center rounded-lg bg-accent/10 text-accent transition-colors group-hover:bg-accent/15">
                  <feature.icon className="size-5" />
                </div>
                <h3 className="mb-2 font-semibold text-text-primary">
                  {feature.title}
                </h3>
                <p className="text-sm leading-relaxed text-text-secondary">
                  {feature.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── PRICING ─── */}
      <section className="border-t border-border/40 bg-surface/50">
        <div className="mx-auto max-w-[1080px] px-6 py-20 md:py-24">
          <div className="mb-4 text-center">
            <h2 className="text-3xl font-semibold tracking-tight text-text-primary sm:text-[2rem]">
              Simple pricing. No surprises.
            </h2>
          </div>
          <p className="mb-12 text-center text-sm text-text-secondary">
            7-day free trial on all plans. No credit card required.
          </p>

          <PricingCards />
        </div>
      </section>

      {/* ─── SOCIAL PROOF ─── */}
      {/* TODO: replace with real testimonial once case study is ready */}
      <section className="border-t border-border/40">
        <div className="mx-auto max-w-[1080px] px-6 py-20 md:py-24">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="mb-10 text-3xl font-semibold tracking-tight text-text-primary sm:text-[2rem]">
              Built for founders who actually ship.
            </h2>

            <blockquote className="space-y-5">
              <p className="font-serif text-xl italic leading-relaxed text-text-primary md:text-2xl">
                &ldquo;We went from zero Reddit presence to 400+ karma in our
                first month. The replies don&apos;t read like AI.&rdquo;
              </p>
              <footer className="text-sm text-text-secondary">
                — Alex M., founder of [product]
              </footer>
            </blockquote>
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="bg-accent">
        <div className="mx-auto max-w-[1080px] px-6 py-20 text-center md:py-24">
          <h2 className="mb-4 text-3xl font-semibold tracking-tight text-white sm:text-[2rem]">
            Start growing on Reddit today.
          </h2>
          <p className="mb-8 text-white/80">
            7-day free trial. No credit card. Cancel anytime.
          </p>
          <Link
            href="/sign-up"
            className="inline-flex h-11 items-center rounded-lg bg-white px-6 text-sm font-semibold text-accent shadow-sm transition-colors hover:bg-white/90"
          >
            Start free trial
          </Link>
        </div>
      </section>
    </MarketingShell>
  )
}
