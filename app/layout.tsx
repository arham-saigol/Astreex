import type { Metadata } from "next"
import { Geist_Mono, Inter, Newsreader } from "next/font/google"

import { AppProviders } from "@/components/providers"

import "./globals.css"

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
})

const newsreader = Newsreader({
  variable: "--font-newsreader",
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
      className={`${inter.variable} ${newsreader.variable} ${commitMono.variable}`}
    >
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  )
}
