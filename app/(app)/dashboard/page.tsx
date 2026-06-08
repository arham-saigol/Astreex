import { PlaceholderPage } from "@/components/placeholder-page"

export default function DashboardPage() {
  return (
    <PlaceholderPage
      eyebrow="Dashboard"
      title="Track distribution momentum."
      description="Use this area for weekly campaign summaries, operator alerts, and the pipeline of Reddit placements that need action."
      bullets={[
        "Active post queue and scheduling health",
        "Founder response rate and win annotations",
        "Signals from Convex scheduled jobs and AI actions",
      ]}
    />
  )
}
