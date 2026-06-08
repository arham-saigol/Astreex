import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Privacy Policy",
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-[1080px] px-6 py-20 md:py-28">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight text-text-primary">
        Privacy Policy
      </h1>
      <p className="text-text-secondary">
        This page will contain the Astreex privacy policy. Coming soon.
      </p>
    </div>
  )
}
