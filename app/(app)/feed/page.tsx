import { PlaceholderPage } from "@/components/placeholder-page"

export default function FeedPage() {
  return (
    <PlaceholderPage
      eyebrow="Feed"
      title="Review outbound ideas before they hit Reddit."
      description="This surface is ready for drafts, moderation checks, and the operational status of every content slice you generate."
      bullets={[
        "Draft variations tied to founder ICPs",
        "Approval workflows for tone, claim strength, and subreddit fit",
        "Future AI SDK actions for rewrite and summarization passes",
      ]}
    />
  )
}
