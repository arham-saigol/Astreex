"use client"

import { useState } from "react"
import { ArrowLeft, Plus, X } from "lucide-react"
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

function normalizedUrlKey(value: string) {
  try {
    const url = new URL(value.trim())
    url.hash = ""
    if (url.pathname === "/") url.pathname = ""
    return url.toString().toLowerCase()
  } catch {
    return value.trim().toLowerCase()
  }
}

function filledCompetitorUrls(values: string[]) {
  return values.map((url) => url.trim()).filter(Boolean)
}

export function StepProduct({ data, updateData, onNext, onBack }: Props) {
  const [errors, setErrors] = useState<{ websiteUrl?: string; competitorUrls?: string }>({})
  const competitorUrls = data.competitorUrls.length > 0 ? data.competitorUrls : [""]

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const newErrors: typeof errors = {}
    const filledCompetitors = filledCompetitorUrls(data.competitorUrls)

    if (!data.websiteUrl.trim()) {
      newErrors.websiteUrl = "Website URL is required"
    } else if (!isValidUrl(data.websiteUrl)) {
      newErrors.websiteUrl = "Enter a valid URL (e.g. https://yourproduct.com)"
    }

    if (filledCompetitors.some((url) => !isValidUrl(url))) {
      newErrors.competitorUrls = "Enter valid competitor URLs"
    } else if (new Set(filledCompetitors.map(normalizedUrlKey)).size !== filledCompetitors.length) {
      newErrors.competitorUrls = "Remove duplicate competitor URLs"
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    setErrors({})
    updateData({ competitorUrls: filledCompetitors })
    onNext()
  }

  const updateCompetitor = (index: number, value: string) => {
    const next = [...competitorUrls]
    next[index] = value
    updateData({ competitorUrls: next })
    if (errors.competitorUrls) {
      setErrors((prev) => ({ ...prev, competitorUrls: undefined }))
    }
  }

  const removeCompetitor = (index: number) => {
    const next = competitorUrls.filter((_, itemIndex) => itemIndex !== index)
    updateData({ competitorUrls: next.length > 0 ? next : [] })
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
          <div className="flex items-center justify-between gap-3">
            <Label>Competitor URLs</Label>
            <span className="text-xs text-text-tertiary">
              {filledCompetitorUrls(data.competitorUrls).length}
            </span>
          </div>
          <div className="space-y-2">
            {competitorUrls.map((url, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  type="url"
                  placeholder="https://competitor.com"
                  value={url}
                  onChange={(e) => updateCompetitor(index, e.target.value)}
                  aria-invalid={!!errors.competitorUrls}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeCompetitor(index)}
                  aria-label="Remove competitor"
                >
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
          {errors.competitorUrls && <p className="text-xs text-error">{errors.competitorUrls}</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-text-tertiary">
              Optional, helps us understand your market positioning
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => updateData({ competitorUrls: [...competitorUrls, ""] })}
            >
              <Plus className="size-4" />
              Add
            </Button>
          </div>
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
