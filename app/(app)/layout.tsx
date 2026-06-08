import type { ReactNode } from "react"

import { Sidebar } from "@/components/sidebar"

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      <Sidebar />

      {/* Main content */}
      <div className="lg:pl-[240px]">
        {/* Spacer for mobile top bar */}
        <div className="h-12 lg:hidden" />

        <main className="mx-auto max-w-4xl px-6 py-6">
          {children}
        </main>
      </div>
    </div>
  )
}
