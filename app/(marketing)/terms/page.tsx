import type { Metadata } from "next"

export const metadata: Metadata = {
  title: "Terms of Service",
}

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-[1080px] px-6 py-20 md:py-28">
      <h1 className="mb-6 text-3xl font-semibold tracking-tight text-text-primary">
        Terms of Service
      </h1>
      <p className="text-text-secondary">
        This page will contain the Astreex terms of service. Coming soon.
      </p>
    </div>
  )
}
