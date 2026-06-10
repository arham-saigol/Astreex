import type { ReactNode } from "react"

export default function OnboardingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-8">
      {children}
    </div>
  )
}
