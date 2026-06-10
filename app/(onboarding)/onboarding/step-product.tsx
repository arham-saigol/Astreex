"use client"

import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { OnboardingData } from "./page"

interface Props {
  data: OnboardingData
  updateData: (partial: Partial<OnboardingData>) => void
  onNext: () => void
  onBack: () => void
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

export function StepProduct({ data, updateData, onNext, onBack }: Props) {
  const [errors, setErrors] = useState<{ websiteUrl?: string; competitorUrl?: string }>({})

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const newErrors: typeof errors = {}

    if (!data.websiteUrl.trim()) {
      newErrors.websiteUrl = "Website URL is required"
    } else if (!isValidUrl(data.websiteUrl)) {
      newErrors.websiteUrl = "Enter a valid URL (e.g. https://yourproduct.com)"
    }

    if (data.competitorUrl.trim() && !isValidUrl(data.competitorUrl)) {
      newErrors.competitorUrl = "Enter a valid URL (e.g. https://competitor.com)"
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setErrors({})
    onNext()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="text-2xl font-semibold text-text-primary">
          Tell us about your product
        </h1>
      </div>

      <div className="space-y-4 pt-4">
        <div className="space-y-2">
          <Label htmlFor="websiteUrl">Website URL</Label>
          <Input
            id="websiteUrl"
            type="url"
            placeholder="https://yourproduct.com"
            value={data.websiteUrl}
            onChange={(e) => {
              updateData({ websiteUrl: e.target.value })
              if (errors.websiteUrl) setErrors((prev) => ({ ...prev, websiteUrl: undefined }))
            }}
            aria-invalid={!!errors.websiteUrl}
            autoFocus
          />
          {errors.websiteUrl && <p className="text-xs text-error">{errors.websiteUrl}</p>}
        </div>

        <div className="space-y-2">
          <Label htmlFor="competitorUrl">Competitor URL</Label>
          <Input
            id="competitorUrl"
            type="url"
            placeholder="https://competitor.com"
            value={data.competitorUrl}
            onChange={(e) => {
              updateData({ competitorUrl: e.target.value })
              if (errors.competitorUrl) setErrors((prev) => ({ ...prev, competitorUrl: undefined }))
            }}
            aria-invalid={!!errors.competitorUrl}
          />
          {errors.competitorUrl && <p className="text-xs text-error">{errors.competitorUrl}</p>}
          <p className="text-xs text-text-tertiary">
            Optional — helps us understand your market positioning
          </p>
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="ghost" size="lg" onClick={onBack} aria-label="Go back">
          <ArrowLeft className="size-4" />
        </Button>
        <Button type="submit" className="flex-1" size="lg">
          Continue
        </Button>
      </div>
    </form>
  )
}
