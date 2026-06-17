"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useQuery } from "convex/react"
import { useClerk, useUser } from "@clerk/nextjs"
import { AnimatePresence, motion } from "framer-motion"
import {
  Layers,
  LayoutDashboard,
  LogOut,
  Menu,
  MoonStar,
  Radio,
  Settings,
  SunMedium,
  X,
} from "lucide-react"
import { useTheme } from "next-themes"

import { api } from "@/convex/_generated/api"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TrialCard } from "@/components/trial-card"
import { cn } from "@/lib/utils"

const navItems = [
  { segment: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { segment: "feed", label: "Feed", icon: Layers },
  { segment: "radar", label: "Radar", icon: Radio },
]

function NavItem({
  href,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  href: string
  label: string
  icon: typeof LayoutDashboard
  active: boolean
  onClick?: () => void
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-medium transition-colors duration-150",
        active
          ? "bg-accent-subtle text-accent"
          : "text-text-secondary hover:bg-muted hover:text-text-primary"
      )}
    >
      <Icon className="size-[20px] shrink-0" strokeWidth={1.5} />
      {label}
    </Link>
  )
}

function ProfileMenu({ settingsHref }: { settingsHref: string }) {
  const { user } = useUser()
  const { signOut } = useClerk()
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  const displayName = user?.fullName || user?.firstName || "User"
  const initials = displayName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  return (
    <Popover>
      <PopoverTrigger
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-150 hover:bg-muted"
      >
        <Avatar size="lg">
          <AvatarImage src={user?.imageUrl} alt={displayName} />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <span className="truncate text-[14px] font-medium text-text-primary">
          {displayName}
        </span>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={8} align="start" className="w-56">
        <Link
          href={settingsHref}
          className="flex items-center gap-3 rounded-md px-3 py-2 text-[14px] text-text-secondary transition-colors duration-150 hover:bg-muted hover:text-text-primary"
        >
          <Settings className="size-4" strokeWidth={1.5} />
          Settings
        </Link>
        <button
          onClick={() => setTheme(isDark ? "light" : "dark")}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-[14px] text-text-secondary transition-colors duration-150 hover:bg-muted hover:text-text-primary"
        >
          {isDark ? (
            <SunMedium className="size-4" strokeWidth={1.5} />
          ) : (
            <MoonStar className="size-4" strokeWidth={1.5} />
          )}
          {isDark ? "Light mode" : "Dark mode"}
        </button>
        <div className="my-1 h-px bg-border" />
        <button
          onClick={() => signOut()}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-[14px] text-text-secondary transition-colors duration-150 hover:bg-muted hover:text-text-primary"
        >
          <LogOut className="size-4" strokeWidth={1.5} />
          Sign out
        </button>
      </PopoverContent>
    </Popover>
  )
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const data = useQuery(api.projects.listAccessibleProjects)
  const projectRef = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
  const currentProject = data?.projects.find((project) => project.projectRef === projectRef)
  const projectBase = projectRef ? `/projects/${projectRef}` : null

  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="px-3 py-4">
        <Link href="/dashboard" className="inline-block" onClick={onNavigate}>
          <span className="text-[20px] font-semibold tracking-tight text-text-primary">
            Astreex
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <div className="px-2">
        <Popover>
          <PopoverTrigger className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left text-[14px] font-medium text-text-primary">
            <span className="truncate">{currentProject?.name ?? "All projects"}</span>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56">
            <Link href="/dashboard" onClick={onNavigate} className="block rounded-md px-3 py-2 text-[14px] text-text-secondary hover:bg-muted hover:text-text-primary">
              All projects
            </Link>
            {(data?.projects ?? []).map((project) => (
              <Link key={project.projectRef} href={`/projects/${project.projectRef}/dashboard`} onClick={onNavigate} className="block truncate rounded-md px-3 py-2 text-[14px] text-text-secondary hover:bg-muted hover:text-text-primary">
                {project.name}
              </Link>
            ))}
            <div className="my-1 h-px bg-border" />
            <Link href="/onboarding?new=1" onClick={onNavigate} className="block rounded-md px-3 py-2 text-[14px] text-accent hover:bg-muted">
              Create new project
            </Link>
          </PopoverContent>
        </Popover>
      </div>

      <nav className="mt-4 flex-1 space-y-1 px-2">
        {projectBase ? navItems.map((item) => {
          const href = `${projectBase}/${item.segment}`
          return (
            <NavItem
              key={item.segment}
              href={href}
              label={item.label}
              icon={item.icon}
              active={pathname.startsWith(href)}
              onClick={onNavigate}
            />
          )
        }) : (
          <NavItem
            href="/dashboard"
            label="Projects"
            icon={LayoutDashboard}
            active={pathname === "/dashboard"}
            onClick={onNavigate}
          />
        )}
      </nav>

      {/* Profile */}
      <div className="space-y-3 border-t border-border px-2 py-3">
        <TrialCard />
        <ProfileMenu settingsHref={projectRef ? `/projects/${projectRef}/settings` : "/dashboard"} />
      </div>
    </div>
  )
}

/** Desktop sidebar — always visible at lg+ */
function DesktopSidebar() {
  return (
    <aside className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:flex lg:w-[240px] lg:flex-col border-r border-border bg-background">
      <SidebarContent />
    </aside>
  )
}

/** Mobile top bar + slide-out sidebar */
function MobileSidebar() {
  const [open, setOpen] = useState(false)

  return (
    <>
      {/* Top bar */}
      <div className="fixed inset-x-0 top-0 z-40 flex h-12 items-center border-b border-border bg-background px-4 lg:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-muted hover:text-text-primary"
        >
          <Menu className="size-5" strokeWidth={1.5} />
        </button>
        <span className="ml-3 text-[14px] font-semibold text-text-primary">
          Astreex
        </span>
      </div>

      {/* Overlay + drawer */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-50 bg-black/40 lg:hidden"
            />
            <motion.aside
              key="drawer"
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 w-[240px] border-r border-border bg-background lg:hidden"
            >
              <button
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="absolute right-3 top-4 rounded-md p-1.5 text-text-secondary transition-colors hover:bg-muted hover:text-text-primary"
              >
                <X className="size-4" strokeWidth={1.5} />
              </button>
              <SidebarContent onNavigate={() => setOpen(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}

export function Sidebar() {
  return (
    <>
      <DesktopSidebar />
      <MobileSidebar />
    </>
  )
}
