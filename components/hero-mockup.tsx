"use client"

import { motion } from "framer-motion"
import { ArrowUpRight, Check, Clock, MessageSquare, Sparkles } from "lucide-react"

export function HeroMockup() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      {/* Glow */}
      <div className="absolute -inset-8 rounded-[40px] bg-accent/8 blur-3xl" />

      {/* Main card */}
      <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-surface shadow-[0_24px_64px_rgba(0,0,0,0.08)]">
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
          <div className="flex items-center gap-2">
            <Sparkles className="size-3.5 text-accent" />
            <span className="text-xs font-medium text-text-primary">
              Today&apos;s Feed
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="flex size-2.5 rounded-full bg-success" />
            <span className="text-[11px] text-text-tertiary">3 ready</span>
          </div>
        </div>

        {/* Cards stack */}
        <div className="space-y-3 p-4">
          {/* Card 1 — approved */}
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="rounded-xl border border-border/60 bg-background p-4"
          >
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-md bg-accent/10">
                  <MessageSquare className="size-3 text-accent" />
                </div>
                <span className="text-xs font-medium text-text-primary">
                  r/SaaS
                </span>
                <span className="text-[11px] text-text-tertiary">• reply</span>
              </div>
              <div className="flex size-5 items-center justify-center rounded-full bg-success/15">
                <Check className="size-3 text-success" />
              </div>
            </div>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              &quot;We built something similar — started with just Reddit and
              it&apos;s now our #2 acquisition channel...&quot;
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="inline-flex items-center gap-1 rounded-md bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
                <Check className="size-2.5" />
                Approved
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] text-text-tertiary">
                <Clock className="size-2.5" />
                Posts at 2:30 PM
              </span>
            </div>
          </motion.div>

          {/* Card 2 — pending */}
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.45, duration: 0.5 }}
            className="rounded-xl border border-border/60 bg-background p-4"
          >
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex size-6 items-center justify-center rounded-md bg-accent/10">
                  <ArrowUpRight className="size-3 text-accent" />
                </div>
                <span className="text-xs font-medium text-text-primary">
                  r/startups
                </span>
                <span className="text-[11px] text-text-tertiary">• post</span>
              </div>
              <div className="flex size-5 items-center justify-center rounded-full bg-warning/15">
                <Clock className="size-3 text-warning" />
              </div>
            </div>
            <p className="text-[13px] leading-relaxed text-text-secondary">
              &quot;How we automated our Reddit presence without getting shadow
              banned (a technical breakdown)&quot;
            </p>
            <div className="mt-3 flex items-center gap-3">
              <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                <Clock className="size-2.5" />
                Pending review
              </span>
            </div>
          </motion.div>

          {/* Card 3 — ghost */}
          <motion.div
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className="rounded-xl border border-border/40 bg-background/60 p-4 opacity-60"
          >
            <div className="mb-2 flex items-center gap-2">
              <div className="flex size-6 items-center justify-center rounded-md bg-muted">
                <MessageSquare className="size-3 text-text-tertiary" />
              </div>
              <span className="text-xs font-medium text-text-primary">
                r/Entrepreneur
              </span>
              <span className="text-[11px] text-text-tertiary">• reply</span>
            </div>
            <div className="space-y-1.5">
              <div className="h-2.5 w-4/5 rounded bg-muted" />
              <div className="h-2.5 w-3/5 rounded bg-muted" />
            </div>
          </motion.div>
        </div>
      </div>
    </motion.div>
  )
}
