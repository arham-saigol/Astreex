"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { OnboardingData } from "./page"

interface Props {
  data: OnboardingData
  updateData: (partial: Partial<OnboardingData>) => void
  onNext: () => void
  showSkip?: boolean
  onSkip?: () => void
}

export function StepWelcome({ data, updateData, onNext, showSkip, onSkip }: Props) {
  const [error, setError] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!data.projectName.trim()) {
      setError("Project name is required")
      return
    }
    setError("")
    onNext()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold text-text-primary">
          Let&apos;s set up your first project
        </h1>
        <p className="text-sm text-text-secondary">
          We&apos;ll analyze your product and find the best Reddit communities for you.
        </p>
      </div>

      <div className="space-y-2 pt-4">
        <Label htmlFor="projectName">Project name</Label>
        <Input
          id="projectName"
          type="text"
          placeholder="My SaaS"
          value={data.projectName}
          onChange={(e) => {
            updateData({ projectName: e.target.value })
            if (error) setError("")
          }}
          aria-invalid={!!error}
          autoFocus
        />
        {error && <p className="text-xs text-error">{error}</p>}
      </div>

      <div className="space-y-2">
        <Button type="submit" className="w-full" size="lg">
          Continue
        </Button>
        {showSkip ? (
          <Button type="button" variant="ghost" className="w-full" onClick={onSkip}>
            Skip for now
          </Button>
        ) : null}
      </div>
    </form>
  )
}
