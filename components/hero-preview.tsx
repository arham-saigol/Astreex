"use client"

import { motion } from "framer-motion"
import { Bot, Clock3, Radar, Send } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

const cards = [
  {
    icon: Radar,
    title: "Radar",
    copy: "Score live subreddit opportunities and queue the strongest founder-angle openings.",
  },
  {
    icon: Bot,
    title: "AI pass",
    copy: "Draft channel-native replies, compress notes, and keep a consistent narrative.",
  },
  {
    icon: Send,
    title: "Distribution",
    copy: "Move approved content into scheduled execution without losing operator context.",
  },
]

export function HeroPreview() {
  return (
    <div className="relative">
      <div className="absolute inset-x-10 top-8 h-48 rounded-full bg-accent/15 blur-3xl" />
      <motion.div
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: "easeOut" }}
        className="relative space-y-4 rounded-[28px] border border-border/70 bg-surface/92 p-5 shadow-[0_28px_80px_rgba(27,27,27,0.12)] backdrop-blur"
      >
        <div className="flex items-center justify-between rounded-2xl border border-border/60 bg-accent-subtle px-4 py-3">
          <div>
            <div className="font-medium text-text-primary">Operator snapshot</div>
            <div className="text-sm text-text-secondary">Today&apos;s pipeline is staged for review.</div>
          </div>
          <Badge className="rounded-full bg-accent px-3 py-1 text-accent-foreground hover:bg-accent">
            <Clock3 className="mr-1 size-3.5" />
            Live draft
          </Badge>
        </div>
        <div className="grid gap-3">
          {cards.map((card, index) => (
            <motion.div
              key={card.title}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.08 * index, duration: 0.45, ease: "easeOut" }}
            >
              <Card className="border-border/70 bg-surface-raised/95">
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="mt-1 flex size-10 items-center justify-center rounded-xl bg-accent-subtle text-accent">
                    <card.icon className="size-4" />
                  </div>
                  <div className="space-y-1">
                    <div className="font-medium text-text-primary">{card.title}</div>
                    <p className="text-sm leading-7 text-text-secondary">{card.copy}</p>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  )
}
