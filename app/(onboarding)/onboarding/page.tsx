"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery } from "convex/react"
import { motion, AnimatePresence } from "framer-motion"
import { toast } from "sonner"
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
  competitorUrls: string[]
  plan: Plan
  redditAccounts: { username: string; isActive: boolean }[]
  timezone: string
  projectId: Id<"projects"> | null
  projectRef: string | null
}

const TOTAL_STEPS = 4

export default function OnboardingPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isNewProject = searchParams.get("new") === "1"
  const status = useQuery(api.onboarding.getOnboardingStatus)
  const draft = useQuery(api.onboarding.getOnboardingDraft)
  const prepareOnboardingProject = useMutation(api.onboarding.prepareOnboardingProject)
  const completeOnboarding = useMutation(api.onboarding.completeOnboarding)
  const skipInitialProjectOnboarding = useMutation(api.projects.skipInitialProjectOnboarding)

  const [step, setStep] = useState(1)
  const [direction, setDirection] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isPreparingProject, setIsPreparingProject] = useState(false)
  const [prepareError, setPrepareError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const [data, setData] = useState<OnboardingData>({
    projectName: "",
    websiteUrl: "",
    competitorUrls: [],
    plan: "growth",
    redditAccounts: [],
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    projectId: null,
    projectRef: null,
  })

  // Redirect only if normal onboarding is complete. /onboarding?new=1 always creates a project.
  useEffect(() => {
    const hasFinishedOnboarding =
      status?.hasCompletedOnboarding || status?.skippedInitialOnboarding
    if (!isNewProject && hasFinishedOnboarding) {
      router.replace("/dashboard")
    }
  }, [isNewProject, status, router])

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search)
    if (searchParams.get("step") === "4") {
      queueMicrotask(() => setStep(4))
    }
    if (searchParams.get("reddit_error")) {
      toast.error("Reddit connection failed. Please try again.")
      searchParams.delete("reddit_error")
      const query = searchParams.toString()
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}`,
      )
    }
  }, [])

  useEffect(() => {
    if (!draft) return

    queueMicrotask(() => {
      setData((prev) => ({
        ...prev,
        projectId: draft.projectId,
        projectRef: draft.projectRef,
        projectName: draft.projectName,
        websiteUrl: draft.websiteUrl,
        competitorUrls: draft.competitorUrls,
        plan: draft.plan,
        timezone: draft.timezone,
        redditAccounts: draft.redditAccounts,
      }))
    })
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
      competitorUrls: data.competitorUrls,
      plan: data.plan,
      timezone: data.timezone,
      newProject: isNewProject,
    })
    updateData({ projectId: result.projectId, projectRef: result.projectRef })
    return result
  }, [data, isNewProject, prepareOnboardingProject, updateData])

  const handlePlanNext = useCallback(async () => {
    setIsPreparingProject(true)
    setPrepareError(null)
    try {
      await ensureDraftProject()
      goNext()
    } catch (error) {
      console.error("Project setup failed:", error)
      setPrepareError(error instanceof Error ? error.message : "Project setup failed.")
    } finally {
      setIsPreparingProject(false)
    }
  }, [ensureDraftProject, goNext])

  const handleConnectReddit = useCallback(async () => {
    let projectRef = data.projectRef
    if (!data.projectId || !projectRef) {
      try {
        const result = await ensureDraftProject()
        projectRef = result.projectRef
      } catch (error) {
        console.error("Project setup failed:", error)
        const message = error instanceof Error ? error.message : "Project setup failed."
        setSubmitError(message)
        toast.error(message)
        return
      }
    }
    if (!projectRef) return
    window.location.assign(
      `/api/zernio/reddit/connect?projectRef=${encodeURIComponent(projectRef)}&returnTo=onboarding`,
    )
  }, [data.projectId, data.projectRef, ensureDraftProject])

  const handleComplete = useCallback(async () => {
    setIsSubmitting(true)
    setSubmitError(null)
    try {
      if (!data.projectRef) throw new Error("Project setup is incomplete.")
      await completeOnboarding({
        projectRef: data.projectRef,
      })
      router.replace("/dashboard")
    } catch (error) {
      console.error("Onboarding failed:", error)
      setSubmitError(error instanceof Error ? error.message : "Onboarding failed.")
    } finally {
      setIsSubmitting(false)
    }
  }, [completeOnboarding, data.projectRef, router])

  if (status === undefined) {
    return <div className="h-80 w-full animate-pulse rounded-xl bg-muted" />
  }

  const hasFinishedOnboarding =
    status.hasCompletedOnboarding || status.skippedInitialOnboarding
  if (!isNewProject && hasFinishedOnboarding) {
    return <div className="h-80 w-full animate-pulse rounded-xl bg-muted" />
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
                showSkip={!isNewProject && status?.hasCreatedProjects === false}
                onSkip={async () => {
                  await skipInitialProjectOnboarding()
                  router.replace("/dashboard")
                }}
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
                error={prepareError}
              />
            )}
            {step === 4 && (
              <StepReddit
                data={data}
                onBack={goBack}
                onComplete={handleComplete}
                onConnectReddit={handleConnectReddit}
                isSubmitting={isSubmitting}
                error={submitError}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
