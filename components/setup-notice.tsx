import { AlertTriangle, Cloud, ShieldCheck } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

type SetupNoticeProps = {
  compact?: boolean
}

const nextEnvEntries = [
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_SECRET_KEY",
  "CONVEX_DEPLOYMENT",
] as const

export function SetupNotice({ compact = false }: SetupNoticeProps) {
  const missing = nextEnvEntries.filter((key) => !process.env[key])

  if (missing.length === 0 && compact) {
    return null
  }

  return (
    <Card className="border-border/80 bg-surface-raised/90">
      <CardContent className={compact ? "flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between" : "space-y-4 p-5"}>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            {missing.length === 0 ? (
              <ShieldCheck className="size-4 text-success" />
            ) : (
              <AlertTriangle className="size-4 text-warning" />
            )}
            <span className="font-medium text-text-primary">
              {missing.length === 0 ? "Next.js env placeholders are filled." : "Local env setup is still incomplete."}
            </span>
          </div>
          <p className="max-w-3xl text-sm leading-7 text-text-secondary">
            {missing.length === 0
              ? "Your frontend keys are present. Set `CLERK_JWT_ISSUER_DOMAIN` on the Convex Cloud deployment, then run `npx convex dev` to sync auth."
              : "The app still renders without crashing, but route protection and Convex client auth will activate after you add the missing values and restart."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {missing.length === 0 ? (
            <Badge className="gap-1 rounded-full bg-success/15 px-3 py-1 text-success hover:bg-success/15">
              <Cloud className="size-3.5" />
              Ready for Convex sync
            </Badge>
          ) : (
            missing.map((key) => (
              <Badge
                key={key}
                variant="secondary"
                className="rounded-full border border-border bg-accent-subtle px-3 py-1 font-mono text-[11px] text-text-secondary hover:bg-accent-subtle"
              >
                {key}
              </Badge>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  )
}
