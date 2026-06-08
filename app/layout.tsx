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

export const metadata: Metadata = {
  title: {
    default: "Astreex",
    template: "%s | Astreex",
  },
  description: "Astreex is a Reddit distribution automation workspace for B2B founders.",
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
