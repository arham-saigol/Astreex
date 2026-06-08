import { CheckCircle2, ChevronRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

type PlaceholderPageProps = {
  eyebrow: string
  title: string
  description: string
  bullets: string[]
}

export function PlaceholderPage({
  eyebrow,
  title,
  description,
  bullets,
}: PlaceholderPageProps) {
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <Badge variant="secondary" className="rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-[0.22em]">
          {eyebrow}
        </Badge>
        <div className="space-y-3">
          <h1 className="font-serif text-5xl leading-none tracking-tight text-text-primary">
            {title}
          </h1>
          <p className="max-w-3xl text-lg leading-8 text-text-secondary">{description}</p>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="border-border/80 bg-surface-raised/95">
          <CardHeader>
            <CardTitle>Planned surface</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {bullets.map((bullet, index) => (
              <div key={bullet}>
                {index > 0 ? <Separator className="mb-3" /> : null}
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-1 size-4 text-success" />
                  <p className="text-sm leading-7 text-text-secondary">{bullet}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="border-border/80 bg-surface-raised/95">
          <CardHeader>
            <CardTitle>Why this is here now</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-7 text-text-secondary">
            <p>This route exists so auth, navigation, and layout concerns are settled before feature implementation starts.</p>
            <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background px-3 py-3 text-text-primary">
              <ChevronRight className="size-4 text-accent" />
              Swap this placeholder for real product modules when the backend contracts are ready.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
