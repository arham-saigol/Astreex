"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import { motion, AnimatePresence } from "framer-motion"
import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"
import { StepWelcome } from "./step-welcome"
import { StepProduct } from "./step-product"
import { StepPlan } from "./step-plan"
import { StepReddit } from "./step-reddit"

export type Plan = "starter" | "growth" | "scale"

export interface OnboardingData {
  projectName: string
  websiteUrl: string
  competitorUrl: string
  plan: Plan
  redditAccounts: { username: string }[]
  timezone: string
  projectId: Id<"projects"> | null
}

const TOTAL_STEPS = 4

export default function OnboardingPage() {
  const router = useRouter()
  const status = useQuery(api.onboarding.getOnboardingStatus)
  const draft = useQuery(api.onboarding.getOnboardingDraft)
  const prepareOnboardingProject = useMutation(api.onboarding.prepareOnboardingProject)
  const completeOnboarding = useMutation(api.onboarding.completeOnboarding)

  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPreparingProject, setIsPreparingProject] = useState(false)

  const [data, setData] = useState<OnboardingData>({
    projectName: "",
    websiteUrl: "",
    competitorUrl: "",
    plan: "growth",
    redditAccounts: [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    projectId: null,
  })

  // Redirect if already onboarded
  useEffect(() => {
    if (status?.hasCompletedOnboarding) {
      router.replace("/dashboard")
    }
  }, [status, router])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get("step") === "4") {
      setStep(4)
    }
  }, [])

  useEffect(() => {
    if (!draft) return

    setData((prev) => ({
      ...prev,
      projectId: draft.projectId,
      projectName: draft.projectName,
      websiteUrl: draft.websiteUrl,
      competitorUrl: draft.competitorUrl,
      plan: draft.plan,
      timezone: draft.timezone,
      redditAccounts: draft.redditAccounts,
    }))
  }, [draft])

  const goNext = useCallback(() => {
    setDirection(1)
    setStep((s) => Math.min(s + 1, TOTAL_STEPS))
  }, [])

  const goBack = useCallback(() => {
    setDirection(-1)
    setStep((s) => Math.max(s - 1, 1))
  }, [])

  const updateData = useCallback((partial: Partial<OnboardingData>) => {
    setData((prev) => ({ ...prev, ...partial }))
  }, [])

  const ensureDraftProject = useCallback(async () => {
    const result = await prepareOnboardingProject({
      projectName: data.projectName,
      websiteUrl: data.websiteUrl,
      competitorUrl: data.competitorUrl || undefined,
      plan: data.plan,
      timezone: data.timezone,
    })
    updateData({ projectId: result.projectId })
    return result.projectId
  }, [data, prepareOnboardingProject, updateData])

  const handlePlanNext = useCallback(async () => {
    setIsPreparingProject(true)
    try {
      await ensureDraftProject()
      goNext()
    } catch (error) {
      console.error("Project setup failed:", error)
    } finally {
      setIsPreparingProject(false)
    }
  }, [ensureDraftProject, goNext])

  const handleConnectReddit = useCallback(async () => {
    const projectId = data.projectId ?? (await ensureDraftProject())
    window.location.assign(
      `/api/reddit/authorize?projectId=${encodeURIComponent(projectId)}&returnTo=onboarding`,
    )
  }, [data.projectId, ensureDraftProject])

  const handleComplete = useCallback(async () => {
    setIsSubmitting(true)
    try {
      await completeOnboarding({
        projectName: data.projectName,
        websiteUrl: data.websiteUrl,
        competitorUrl: data.competitorUrl || undefined,
        plan: data.plan,
        timezone: data.timezone,
        projectId: data.projectId ?? undefined,
      })
      router.replace("/dashboard")
    } catch (error) {
      console.error("Onboarding failed:", error)
      setIsSubmitting(false)
    }
  }, [completeOnboarding, data, router])

  // Show nothing while checking status
  if (status === undefined || status?.hasCompletedOnboarding) {
    return null
  }

  const variants = {
    enter: (dir: number) => ({ x: dir > 0 ? 80 : -80, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir: number) => ({ x: dir > 0 ? -80 : 80, opacity: 0 }),
  }

  return (
    <div className={`w-full ${step === 3 ? "max-w-[800px]" : "max-w-[560px]"} transition-[max-width] duration-300`}>
      {/* Progress dots */}
      <div className="mb-8 flex items-center justify-center gap-2">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div
            key={i}
            className={`h-2 w-2 rounded-full transition-colors duration-200 ${
              i + 1 === step
                ? "bg-accent"
                : i + 1 < step
                  ? "bg-accent/40"
                  : "bg-border"
            }`}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {step === 1 && (
              <StepWelcome
                data={data}
                updateData={updateData}
                onNext={goNext}
              />
            )}
            {step === 2 && (
              <StepProduct
                data={data}
                updateData={updateData}
                onNext={goNext}
                onBack={goBack}
              />
            )}
            {step === 3 && (
              <StepPlan
                data={data}
                updateData={updateData}
                onNext={handlePlanNext}
                onBack={goBack}
                isPreparing={isPreparingProject}
              />
            )}
            {step === 4 && (
              <StepReddit
                data={data}
                onBack={goBack}
                onComplete={handleComplete}
                onConnectReddit={handleConnectReddit}
                isSubmitting={isSubmitting}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
