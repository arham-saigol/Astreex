import { PlaceholderPage } from "@/components/placeholder-page"

export default function RadarPage() {
  return (
    <PlaceholderPage
      eyebrow="Radar"
      title="Watch the channels that matter."
      description="Radar is where subreddit discovery, trend scoring, and founder-specific opportunity streams can converge."
      bullets={[
        "Subreddit watchlists with freshness scoring",
        "Signal capture from comments, threads, and keyword movement",
        "Future Convex crons for recurring refresh and re-ranking",
      ]}
    />
  )
}
