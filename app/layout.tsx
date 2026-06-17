import type { Metadata } from "next"
import { EB_Garamond, Figtree, Geist_Mono } from "next/font/google"

import { AppProviders } from "@/components/providers"

import "./globals.css"

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  display: "swap",
})

const ebGaramond = EB_Garamond({
  variable: "--font-eb-garamond",
  subsets: ["latin"],
  display: "swap",
})

const commitMono = Geist_Mono({
  variable: "--font-commit-mono",
  subsets: ["latin"],
  display: "swap",
})

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  title: {
    default: "Astreex - Reddit Growth on Autopilot",
    template: "%s | Astreex",
  },
  description:
    "Daily AI-curated Reddit posts and replies for founders. Approve in 5 minutes, post automatically.",
  openGraph: {
    title: "Astreex - Reddit Growth on Autopilot",
    description:
      "Daily AI-curated Reddit posts and replies for founders. Approve in 5 minutes, post automatically.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "Astreex",
      },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${figtree.variable} ${ebGaramond.variable} ${commitMono.variable}`}
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
