"use client"

import { useEffect, useRef, useState } from "react"
import { useMutation, useQuery } from "convex/react"
import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion"
import { Check, X } from "lucide-react"

import { api } from "@/convex/_generated/api"
import type { Id } from "@/convex/_generated/dataModel"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EnrichedCard = {
  _id: Id<"cards">
  type: "reply" | "original"
  draftContent: string
  editedContent?: string
  targetSubreddit?: string | null
  createdAt: number
  surfacedPost: {
    subreddit: string
    title: string
    score: number
    postedAt: number
  } | null
  redditUsername: string | null
  showUsername: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

// ---------------------------------------------------------------------------
// Skeleton Card
// ---------------------------------------------------------------------------

function CardSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[560px]">
      <div className="mb-3 flex justify-center">
        <Skeleton className="h-5 w-16" />
      </div>
      <div className="rounded-xl border border-border p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)]">
        <div className="flex items-center gap-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-14" />
        </div>
        <Skeleton className="mt-4 h-5 w-full" />
        <Skeleton className="mt-2 h-5 w-3/4" />
        <div className="my-5 h-px bg-border" />
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-2/3" />
      </div>
      <div className="mt-5 flex items-center justify-between px-4">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-20" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty State
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <p className="font-serif text-xl text-text-primary">No cards yet.</p>
      <p className="mt-2 max-w-sm font-serif text-base text-text-secondary">
        Your first batch will be ready tomorrow morning after we analyze your subreddits.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Completion State
// ---------------------------------------------------------------------------

function CompletionState({
  approved,
  declined,
}: {
  approved: number
  declined: number
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col items-center justify-center py-24 text-center"
    >
      <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
        <Check className="h-6 w-6 text-success" />
      </div>
      <p className="font-serif text-2xl font-medium text-text-primary">
        All done for today.
      </p>
      <p className="mt-3 text-sm text-text-secondary">
        {approved} post{approved !== 1 ? "s" : ""} scheduled · {declined} declined
      </p>
      <p className="mt-6 font-serif text-base text-text-tertiary">
        Next batch arrives tomorrow morning.
      </p>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Editable Text
// ---------------------------------------------------------------------------

function EditableText({
  value,
  onChange,
  isEditing,
  onStartEdit,
  onEndEdit,
  className,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  isEditing: boolean
  onStartEdit: () => void
  onEndEdit: () => void
  className?: string
  placeholder?: string
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.selectionStart = textareaRef.current.value.length
      resizeTextarea()
    }
  }, [isEditing])

  function resizeTextarea() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }

  if (!isEditing) {
    return (
      <p
        className={`cursor-text whitespace-pre-wrap ${className ?? ""}`}
        onClick={onStartEdit}
      >
        {value || placeholder}
      </p>
    )
  }

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => {
        onChange(e.target.value)
        resizeTextarea()
      }}
      onBlur={onEndEdit}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          onEndEdit()
        }
      }}
      className={`w-full resize-none border-none bg-transparent outline-none ring-0 focus:ring-0 ${className ?? ""}`}
      placeholder={placeholder}
    />
  )
}

// ---------------------------------------------------------------------------
// Swipeable Card
// ---------------------------------------------------------------------------

function SwipeCard({
  card,
  onApprove,
  onDecline,
  isExiting,
  exitDirection,
}: {
  card: EnrichedCard
  onApprove: (editedContent?: string) => void
  onDecline: () => void
  isExiting: boolean
  exitDirection: "left" | "right" | null
}) {
  const [editMode, setEditMode] = useState(false)
  const [editedContent, setEditedContent] = useState(card.draftContent)
  const [editedTitle, setEditedTitle] = useState(
    card.type === "original" ? card.draftContent.split("\n")[0] ?? "" : ""
  )
  const [editedBody, setEditedBody] = useState(
    card.type === "original" ? card.draftContent.split("\n").slice(1).join("\n") : ""
  )

  // Reset edit state when card changes
  useEffect(() => {
    setEditMode(false)
    if (card.type === "reply") {
      setEditedContent(card.draftContent)
    } else {
      const lines = card.draftContent.split("\n")
      setEditedTitle(lines[0] ?? "")
      setEditedBody(lines.slice(1).join("\n"))
    }
  }, [card._id, card.draftContent, card.type])

  // Keyboard shortcut for E key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "e" || e.key === "E") {
        const target = e.target as HTMLElement
        if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return
        e.preventDefault()
        setEditMode(true)
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])

  const x = useMotionValue(0)
  const rotate = useTransform(x, [-200, 200], [-10, 10])
  const greenOpacity = useTransform(x, [0, 100], [0, 0.15])
  const redOpacity = useTransform(x, [-100, 0], [0.15, 0])

  function getEditedText(): string | undefined {
    if (card.type === "reply") {
      return editedContent !== card.draftContent ? editedContent : undefined
    }
    const combined = `${editedTitle}\n${editedBody}`
    return combined !== card.draftContent ? combined : undefined
  }

  function handleDragEnd(_: unknown, info: { offset: { x: number } }) {
    if (info.offset.x > 100) {
      onApprove(getEditedText())
    } else if (info.offset.x < -100) {
      onDecline()
    }
  }

  return (
    <motion.div
      key={card._id}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={
        isExiting
          ? {
              x: exitDirection === "right" ? "150vw" : "-150vw",
              rotate: exitDirection === "right" ? 10 : -10,
              opacity: 0,
              transition: { duration: 0.3, ease: [0.4, 0, 0.2, 1] as const },
            }
          : { opacity: 0 }
      }
      transition={{ duration: 0.2 }}
      style={{ x, rotate }}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.8}
      onDragEnd={handleDragEnd}
      className="relative mx-auto w-full max-w-[560px] cursor-grab touch-pan-y active:cursor-grabbing"
    >
      {/* Tint overlays */}
      <motion.div
        className="pointer-events-none absolute inset-0 rounded-xl bg-success"
        style={{ opacity: greenOpacity }}
      />
      <motion.div
        className="pointer-events-none absolute inset-0 rounded-xl bg-error"
        style={{ opacity: redOpacity }}
      />

      {/* Card content */}
      <div className="relative rounded-xl border border-border bg-card p-6 shadow-[0_1px_3px_rgba(0,0,0,0.04),0_4px_12px_rgba(0,0,0,0.04)]">
        {card.type === "reply" ? (
          <ReplyCardContent
            card={card}
            editedContent={editedContent}
            setEditedContent={setEditedContent}
            editMode={editMode}
            setEditMode={setEditMode}
          />
        ) : (
          <OriginalCardContent
            card={card}
            editedTitle={editedTitle}
            setEditedTitle={setEditedTitle}
            editedBody={editedBody}
            setEditedBody={setEditedBody}
            editMode={editMode}
            setEditMode={setEditMode}
          />
        )}
      </div>
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Reply Card Content
// ---------------------------------------------------------------------------

function ReplyCardContent({
  card,
  editedContent,
  setEditedContent,
  editMode,
  setEditMode,
}: {
  card: EnrichedCard
  editedContent: string
  setEditedContent: (v: string) => void
  editMode: boolean
  setEditMode: (v: boolean) => void
}) {
  const post = card.surfacedPost

  return (
    <>
      {/* Metadata */}
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-secondary">
        {post && (
          <>
            <span className="font-medium">r/{post.subreddit}</span>
            <span>·</span>
            <span>{timeAgo(post.postedAt)}</span>
            <span>·</span>
            <span>{post.score} pts</span>
          </>
        )}
      </div>

      {/* Posting as */}
      {card.showUsername && card.redditUsername && (
        <p className="mt-1.5 text-xs text-text-secondary">
          Posting as: u/{card.redditUsername}
        </p>
      )}

      {/* Original post title */}
      {post && (
        <p className="mt-3 font-serif text-base font-medium leading-snug text-text-primary">
          &ldquo;{post.title}&rdquo;
        </p>
      )}

      {/* Divider */}
      <div className="my-4 h-px bg-border" />

      {/* Reply label */}
      <p className="text-xs font-medium uppercase tracking-wide text-text-tertiary">
        Your reply:
      </p>

      {/* Editable reply */}
      <div className="mt-2">
        <EditableText
          value={editedContent}
          onChange={setEditedContent}
          isEditing={editMode}
          onStartEdit={() => setEditMode(true)}
          onEndEdit={() => setEditMode(false)}
          className="font-serif text-[15px] font-normal leading-relaxed text-text-primary"
          placeholder="Write your reply..."
        />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Original Card Content
// ---------------------------------------------------------------------------

function OriginalCardContent({
  card,
  editedTitle,
  setEditedTitle,
  editedBody,
  setEditedBody,
  editMode,
  setEditMode,
}: {
  card: EnrichedCard
  editedTitle: string
  setEditedTitle: (v: string) => void
  editedBody: string
  setEditedBody: (v: string) => void
  editMode: boolean
  setEditMode: (v: boolean) => void
}) {
  const subreddit = card.targetSubreddit ?? card.surfacedPost?.subreddit ?? "unknown"

  return (
    <>
      {/* Metadata */}
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-secondary">
        <span className="font-medium">r/{subreddit}</span>
        <span>·</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium">
          Original Post
        </span>
      </div>

      {/* Posting as */}
      {card.showUsername && card.redditUsername && (
        <p className="mt-1.5 text-xs text-text-secondary">
          Posting as: u/{card.redditUsername}
        </p>
      )}

      {/* Editable title */}
      <div className="mt-3">
        <EditableText
          value={editedTitle}
          onChange={setEditedTitle}
          isEditing={editMode}
          onStartEdit={() => setEditMode(true)}
          onEndEdit={() => setEditMode(false)}
          className="font-serif text-base font-medium leading-snug text-text-primary"
          placeholder="Post title..."
        />
      </div>

      {/* Divider */}
      <div className="my-4 h-px bg-border" />

      {/* Editable body */}
      <div>
        <EditableText
          value={editedBody}
          onChange={setEditedBody}
          isEditing={editMode}
          onStartEdit={() => setEditMode(true)}
          onEndEdit={() => setEditMode(false)}
          className="font-serif text-[15px] font-normal leading-relaxed text-text-primary"
          placeholder="Post body..."
        />
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// Feed Page
// ---------------------------------------------------------------------------

export default function FeedPage() {
  const cards = useQuery(api.cards.getActiveCards)
  const approveCard = useMutation(api.cards.approveCard)
  const declineCard = useMutation(api.cards.declineCard)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [exitDirection, setExitDirection] = useState<"left" | "right" | null>(null)
  const [isExiting, setIsExiting] = useState(false)
  const [decisions, setDecisions] = useState<Array<"approved" | "declined">>([])

  // Loading state
  if (cards === undefined) {
    return <CardSkeleton />
  }

  // Empty state
  if (cards.length === 0) {
    return <EmptyState />
  }

  const totalCards = cards.length
  const isComplete = currentIndex >= totalCards
  const currentCard = isComplete ? null : (cards[currentIndex] as EnrichedCard)

  const approvedCount = decisions.filter((d) => d === "approved").length
  const declinedCount = decisions.filter((d) => d === "declined").length

  // Completion state
  if (isComplete || !currentCard) {
    return <CompletionState approved={approvedCount} declined={declinedCount} />
  }

  function handleApprove(editedContent?: string) {
    if (!currentCard || isExiting) return
    setExitDirection("right")
    setIsExiting(true)
    setDecisions((prev) => [...prev, "approved"])

    // Optimistic — fire mutation in background
    approveCard({
      cardId: currentCard._id,
      editedContent: editedContent,
    })

    // Advance after animation
    setTimeout(() => {
      setCurrentIndex((i) => i + 1)
      setIsExiting(false)
      setExitDirection(null)
    }, 300)
  }

  function handleDecline() {
    if (!currentCard || isExiting) return
    setExitDirection("left")
    setIsExiting(true)
    setDecisions((prev) => [...prev, "declined"])

    // Optimistic — fire mutation in background
    declineCard({ cardId: currentCard._id })

    // Advance after animation
    setTimeout(() => {
      setCurrentIndex((i) => i + 1)
      setIsExiting(false)
      setExitDirection(null)
    }, 300)
  }

  return (
    <FeedContent
      card={currentCard}
      currentIndex={currentIndex}
      totalCards={totalCards}
      isExiting={isExiting}
      exitDirection={exitDirection}
      onApprove={handleApprove}
      onDecline={handleDecline}
    />
  )
}

// ---------------------------------------------------------------------------
// Feed Content (separated to use hooks properly)
// ---------------------------------------------------------------------------

function FeedContent({
  card,
  currentIndex,
  totalCards,
  isExiting,
  exitDirection,
  onApprove,
  onDecline,
}: {
  card: EnrichedCard
  currentIndex: number
  totalCards: number
  isExiting: boolean
  exitDirection: "left" | "right" | null
  onApprove: (editedContent?: string) => void
  onDecline: () => void
}) {
  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return

      if (e.key === "ArrowRight") {
        e.preventDefault()
        onApprove()
      } else if (e.key === "ArrowLeft") {
        e.preventDefault()
        onDecline()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onApprove, onDecline])

  return (
    <div className="flex flex-col items-center pt-4">
      {/* Card counter */}
      <p className="mb-4 text-sm text-text-secondary">
        {currentIndex + 1} of {totalCards}
      </p>

      {/* Swipeable card area */}
      <div className="relative w-full">
        <AnimatePresence mode="wait">
          <SwipeCard
            key={card._id}
            card={card}
            onApprove={onApprove}
            onDecline={onDecline}
            isExiting={isExiting}
            exitDirection={exitDirection}
          />
        </AnimatePresence>
      </div>

      {/* Action buttons */}
      <div className="mt-6 flex w-full max-w-[560px] items-center justify-between px-4">
        <Button
          variant="ghost"
          size="lg"
          onClick={onDecline}
          disabled={isExiting}
          className="gap-1.5 text-text-secondary"
        >
          <X className="h-4 w-4" />
          Decline
        </Button>
        <Button
          size="lg"
          onClick={() => onApprove()}
          disabled={isExiting}
          className="gap-1.5"
        >
          <Check className="h-4 w-4" />
          Approve
        </Button>
      </div>

      {/* Keyboard hint */}
      <p className="mt-6 text-xs text-text-tertiary">
        ← → to swipe · E to edit
      </p>
    </div>
  )
}
