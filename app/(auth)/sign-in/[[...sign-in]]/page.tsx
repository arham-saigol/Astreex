import { SignIn } from "@clerk/nextjs"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

const clerkConfigured = Boolean(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
)

export default function SignInPage() {
  if (!clerkConfigured) {
    return (
      <Card className="w-full max-w-md border-border/80 bg-surface/95">
        <CardHeader>
          <CardTitle>Clerk keys are not configured yet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-7 text-text-secondary">
          <p>Add `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` to `.env.local`, then restart the app.</p>
          <p>The route is already in place, so once the keys exist Clerk will render here immediately.</p>
        </CardContent>
      </Card>
    )
  }

  return <SignIn />
}
