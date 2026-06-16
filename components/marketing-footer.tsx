import Link from "next/link"

export function MarketingFooter() {
  return (
    <footer className="border-t-2 border-[#1A1A1A] bg-[#FFFFEB]">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-6 py-10 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="text-lg font-black tracking-[-0.04em] text-[#1A1A1A]">
            Astreex
          </div>
          <p className="mt-1 text-sm font-semibold text-[#56564B]">
            Reddit distribution, run by agents.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-6 text-sm font-bold text-[#56564B]">
          <Link href="/pricing" className="hover:text-[#1A1A1A]">
            Pricing
          </Link>
          <Link href="/privacy" className="hover:text-[#1A1A1A]">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-[#1A1A1A]">
            Terms of Service
          </Link>
        </div>
      </div>
      <div className="border-t border-[#DED9C0]">
        <div className="mx-auto max-w-[1180px] px-6 py-5">
          <p className="text-xs font-semibold text-[#8B8A7C]">
            © 2026 Astreex. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
