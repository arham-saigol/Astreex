import { PlaceholderPage } from "@/components/placeholder-page"

export default function SettingsPage() {
  return (
    <PlaceholderPage
      eyebrow="Settings"
      title="Configure the operating surface."
      description="This route is available for workspace settings, provider credentials, billing handoff, and team-level defaults."
      bullets={[
        "Clerk organization and seat policies",
        "Convex deployment and environment guidance",
        "Email, billing, and automation provider setup",
      ]}
    />
  )
}
