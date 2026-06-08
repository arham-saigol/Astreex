# Astreex

Reddit distribution automation for B2B founders. Daily AI-curated cards with suggested replies and original posts, approved via swipe and scheduled automatically.

---

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Performance Above All Else

**When in doubt, do the thing that makes the app feel the fastest to use.**

This includes things like:
- Optimistic updates everywhere (card approvals, subreddit toggles, settings changes reflect instantly)
- Leverage Convex real-time subscriptions — never poll, never show stale data
- Avoid waterfalls: parallel data fetching, no sequential requests that could be concurrent
- Prefetch where possible (next card data, subreddit details on hover)
- Skeleton screens over loading spinners — the UI should never feel "stuck"

## 6. Good Defaults, Minimal Friction

**Users should get value with zero configuration. Less config is best.**

This means things like:
- Onboarding does the thinking: website URL in → brand profile + subreddits out. User just reviews.
- Cards appear ready to approve. Editing is optional, not required.
- Scheduling "just works" — random offsets are automatic, no user input needed.
- The daily workflow should take under 5 minutes. If it takes longer, something is wrong.
- Getting from login to reviewing today's cards should be one click (max two).

## 7. Security

**Convenient but never insecure.**

This includes things like:
- All Convex mutations/queries must verify the authenticated user owns the resource they're accessing.
- Reddit OAuth tokens are sensitive — never expose in client responses, never log.
- Validate that Reddit OAuth scopes are sufficient before attempting actions.
- Public-facing API routes (webhooks, callbacks) must be validated and rate-limited.
- Never trust client-submitted Reddit post IDs or subreddit names without sanitization.

<!-- nextjs-ai-start -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- nextjs-ai-start -->

<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.
<!-- convex-ai-end -->