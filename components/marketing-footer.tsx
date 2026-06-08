import Link from "next/link"

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/50">
      <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-6 py-10 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-text-primary">Astreex</div>
          <p className="text-sm text-text-secondary">
            Reddit distribution, automated.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-sm text-text-secondary">
          <Link
            href="/privacy"
            className="transition-colors hover:text-text-primary"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="transition-colors hover:text-text-primary"
          >
            Terms of Service
          </Link>
        </div>
      </div>
      <div className="border-t border-border/30">
        <div className="mx-auto max-w-[1080px] px-6 py-5">
          <p className="text-xs text-text-tertiary">
            © 2026 Astreex. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
