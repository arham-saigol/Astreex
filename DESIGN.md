# Astreex — Design System

## 1. Design Philosophy

**"Calm Productivity"** — The app should feel like a breath of fresh air for overwhelmed founders. Every screen has one primary action. Information is revealed progressively, not dumped.

### Principles

- **One job per screen.** Feed = review. Dashboard = metrics. Radar = manage. Don't blend.
- **Progressive disclosure.** Show the minimum, let users drill in.
- **Feel fast.** Optimistic updates. Cards animate out on swipe before the server confirms.
- **Celebrate completion.** "You're done for today" should feel satisfying, not empty.
- **Quiet until relevant.** Actions appear on hover. Chrome stays invisible until needed.

### Inspiration

- Notion: minimal chrome, block-based layouts, inline editing, hover-to-reveal, generous whitespace
- Linear: speed, keyboard shortcuts, opinionated UX
- Tinder: card-based decisioning as core interaction

---

## 2. Visual Identity

**Brand:** Astreex
**Domain:** astreex.com
**Personality:** Intelligent, composed, warm, premium. Not playful, not corporate.
**Voice:** Confident and concise. No fluff. Speaks like a smart colleague, not a marketing bot.

---

## 3. Color Palette

### Light Mode

| Role            | Value     | Usage                                      |
|-----------------|-----------|--------------------------------------------|
| Background      | `#FAF9F7` | Page background                            |
| Surface         | `#FFFFFF` | Cards, panels, modals                      |
| Surface Raised  | `#FFFFFF` | Elevated cards (with shadow)               |
| Border          | `#E8E5E1` | Subtle dividers, card edges                |
| Text Primary    | `#1C1C1C` | Headings, body text                        |
| Text Secondary  | `#6B6560` | Labels, captions, muted text               |
| Text Tertiary   | `#9C9590` | Placeholders, disabled text                |
| Accent          | `#E16259` | CTAs, active states, highlights, links     |
| Accent Hover    | `#C9524A` | Hover state for accent elements            |
| Accent Subtle   | `#FDF2F1` | Accent backgrounds (badges, chips)         |

### Dark Mode

| Role            | Value     | Usage                                      |
|-----------------|-----------|--------------------------------------------|
| Background      | `#1C1C1C` | Page background (warm charcoal, not navy)  |
| Surface         | `#262626` | Cards, panels, modals                      |
| Surface Raised  | `#2F2F2F` | Elevated cards                             |
| Border          | `#3A3A3A` | Subtle dividers                            |
| Text Primary    | `#F5F3F0` | Headings, body text                        |
| Text Secondary  | `#A8A29E` | Labels, captions                           |
| Text Tertiary   | `#787270` | Placeholders, disabled                     |
| Accent          | `#E16259` | Same accent across both modes              |
| Accent Hover    | `#EF7A72` | Slightly lighter on dark backgrounds       |
| Accent Subtle   | `#2D2020` | Accent backgrounds in dark mode            |

### Semantic Colors

| Role    | Light       | Dark        | Usage                          |
|---------|-------------|-------------|--------------------------------|
| Success | `#3D9A5F`  | `#4AAF6E`  | Approved cards, posted status  |
| Warning | `#D4932A`  | `#E5A83A`  | Low relevance, caution states  |
| Error   | `#D44030`  | `#E55545`  | Failures, shadow ban alerts    |
| Info    | `#5B8BD4`  | `#6E9CE5`  | Neutral informational          |

### Relevance Score Dots

| Score   | Color       | Label            |
|---------|-------------|------------------|
| 80-100  | `#3D9A5F`  | High relevance   |
| 50-79   | `#D4932A`  | Medium relevance |
| 20-49   | `#C9524A`  | Low relevance    |
| 0-19    | `#9C9590`  | Not monitored    |

---

## 4. Typography

### Font Stack

| Role     | Family                | Fallback              | Usage                                        |
|----------|-----------------------|-----------------------|----------------------------------------------|
| UI       | Inter                 | system-ui, sans-serif | Nav, buttons, labels, table headers, metrics |
| Content  | Newsreader            | Georgia, serif        | Card reply text, post titles, agent reasoning, long-form content |
| Mono     | Commit Mono           | Geist Mono, monospace | Scores, stats, timestamps, code snippets     |

### Type Scale

| Name       | Size   | Weight | Line Height | Font    | Usage                    |
|------------|--------|--------|-------------|---------|--------------------------|
| Display    | 32px   | 600    | 1.2         | Inter   | Page titles (rare)       |
| Heading 1  | 24px   | 600    | 1.3         | Inter   | Section headers          |
| Heading 2  | 20px   | 600    | 1.3         | Inter   | Card headers, sub-sections |
| Heading 3  | 16px   | 600    | 1.4         | Inter   | List titles, sidebar     |
| Body       | 15px   | 400    | 1.6         | Plantin | Reply drafts, post content |
| Body UI    | 14px   | 400    | 1.5         | Inter   | General UI text          |
| Caption    | 13px   | 400    | 1.4         | Inter   | Metadata, timestamps     |
| Small      | 12px   | 500    | 1.4         | Inter   | Badges, labels, overlines |
| Mono       | 13px   | 400    | 1.4         | Commit Mono | Scores, data          |

### Font licensing note

Newsreader is available on Google Fonts under the SIL Open Font License. Free for all uses, no pageview limits, self-hostable.

---

## 5. Spacing & Layout

### Base Unit

4px base. All spacing uses multiples of 4.

| Token  | Value | Usage                              |
|--------|-------|------------------------------------|
| xs     | 4px   | Tight gaps (icon to label)         |
| sm     | 8px   | Inside compact components          |
| md     | 16px  | Default padding, gaps between items|
| lg     | 24px  | Section spacing                    |
| xl     | 32px  | Between major blocks               |
| 2xl    | 48px  | Page-level vertical rhythm         |
| 3xl    | 64px  | Hero/landing spacing               |

### Layout

- Max content width: `720px` (reading-optimized, Notion-like)
- Sidebar width: `240px` (collapsible)
- Card max width: `560px` (centered on cards page)
- Page padding: `24px` on desktop, `16px` on mobile

### Breakpoints

| Name   | Width    | Behavior                      |
|--------|----------|-------------------------------|
| sm     | 640px   | Stack sidebar, full-width cards |
| md     | 768px   | Sidebar overlay               |
| lg     | 1024px  | Sidebar visible, centered content |
| xl     | 1280px  | Comfortable max-width         |

---

## 6. Iconography

**Library:** Lucide Icons (consistent stroke width, clean geometry)
**Default size:** 20px
**Stroke width:** 1.5px
**Color:** Inherits text color (primary or secondary depending on context)

No filled icons. Outline only for consistency.

---

## 7. Component Styles

### Buttons

| Variant   | Background    | Text          | Border       | Usage               |
|-----------|---------------|---------------|--------------|---------------------|
| Primary   | `#E16259`     | `#FFFFFF`     | none         | Main CTAs           |
| Secondary | transparent   | Text Primary  | `Border`     | Secondary actions   |
| Ghost     | transparent   | Text Secondary| none         | Tertiary, nav items |
| Danger    | transparent   | Error         | Error        | Destructive actions |

- Border radius: `8px`
- Padding: `8px 16px` (default), `6px 12px` (small)
- Font: Inter, 14px, weight 500
- Hover: slight darkening (primary) or background tint (ghost/secondary)
- Transition: `150ms ease`

### Cards

- Background: Surface
- Border: `1px solid Border`
- Border radius: `12px`
- Padding: `24px`
- Shadow (raised): `0 1px 3px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.04)`
- Hover (interactive cards): shadow increases, translate -1px Y

### Inputs

- Background: Surface
- Border: `1px solid Border`
- Border radius: `8px`
- Padding: `10px 12px`
- Font: Inter, 14px
- Focus: border transitions to Accent, subtle accent glow (`0 0 0 2px Accent Subtle`)
- Placeholder: Text Tertiary

### Toggles (subreddit enable/disable)

- Inactive: `Border` track, white thumb
- Active: `Accent` track, white thumb
- Transition: `200ms ease`

### Toasts

- Position: bottom-center
- Background: Surface (dark mode) or `#1C1C1C` (light mode — inverted)
- Border radius: `8px`
- Duration: 3s default, 5s for important
- No close button (auto-dismiss)

---

## 8. UI Patterns & Interactions

### Navigation

- **Sidebar** (left): Logo at top, nav items below. Collapsible on mobile.
- Pages: Dashboard, Feed, Radar
- Active state: Accent text + subtle accent background
- Keyboard: `Cmd+K` opens command palette for quick navigation
- **Profile** (bottom of sidebar): Avatar + user name. Click opens a popover menu with: Sign out, Settings, Theme toggle (dark/light)

### Card Review (Core Interaction)

- Single card centered on screen
- Swipe right = approve (card slides right, green tint)
- Swipe left = decline (card slides left, red tint)
- Desktop: arrow keys or drag
- After last card: "All done" state with summary (posts scheduled, next batch time)
- Edit mode: click reply text → inline edit (Notion-style, no modal)

### Hover-to-Reveal

- Action buttons on list items appear only on hover (or always visible on mobile)
- Examples: disable toggle on subreddit row, expand details

### Empty States

- Friendly, not broken-looking
- Clear next step: "Connect your Reddit account to get started"
- Use the content font (Newsreader) for empty state messages to feel warm

### Loading

- Skeleton screens (Notion-style shimmer blocks), never spinners
- Content streams in progressively where possible

### Motion

- Duration: `150ms` for micro-interactions, `300ms` for cards/panels
- Easing: `cubic-bezier(0.16, 1, 0.3, 1)` (fast start, gentle settle — like Linear)
- Card swipe: spring physics (Framer Motion `spring` with damping ~20, stiffness ~300)
- Page transitions: subtle fade, no slide

---

## 9. Page Layouts

### Dashboard

```
┌──────────────────────────────────────────────┐
│ [Sidebar]  │  Heading: "Dashboard"           │
│            │                                  │
│  Dashboard │  ┌─────┐ ┌─────┐ ┌─────┐       │
│  Feed      │  │ 24  │ │ 89% │ │ +47 │       │
│  Radar     │  │posts│ │appr.│ │karma│       │
│            │  └─────┘ └─────┘ └─────┘       │
│            │                                  │
│  ──────── │  Recent Activity                 │
│  [Avatar]  │  ─────────────────────────       │
│  John D.   │  r/SaaS · 12 upvotes · 2h ago   │
│            │  r/startups · 3 replies · 5h ago │
│            │                                  │
│            │  Engagement Trend                │
│            │  ─────────────────────────       │
│            │  [Simple line chart]             │
└──────────────────────────────────────────────┘
```

### Feed Page

```
┌──────────────────────────────────────────────┐
│ [Sidebar]  │                                  │
│            │     2 of 5                       │
│  Dashboard │                                  │
│  Feed      │  ┌────────────────────────────┐  │
│  Radar     │  │ r/SaaS · 142 pts · 2h ago  │  │
│            │  │                            │  │
│  ──────── │  │ "How do you handle         │  │
│  [Avatar]  │  │  onboarding for a          │  │
│  John D.   │  │  technical product?"       │  │
│            │  │                            │  │
│            │  │ ────────────────────────── │  │
│            │  │                            │  │
│            │  │ Your reply:                │  │
│            │  │                            │  │
│            │  │ "We struggled with this    │  │
│            │  │  too. What worked was..."  │  │
│            │  │                            │  │
│            │  │ [Edit inline]              │  │
│            │  │                            │  │
│            │  │   ← Decline    Approve →   │  │
│            │  └────────────────────────────┘  │
│            │                                  │
└──────────────────────────────────────────────┘
```

### Radar Page

```
┌──────────────────────────────────────────────┐
│ [Sidebar]  │  Radar (18 active)              │
│            │  [+ Add subreddit]               │
│  Dashboard │                                  │
│  Feed      │  ● r/SaaS           124K  [on]   │
│  Radar     │  ● r/startups        3.2M [on]   │
│            │  ● r/EntrepreNeur   890K  [on]   │
│  ──────── │  ○ r/webdev         2.1M  [off]  │
│  [Avatar]  │                                  │
│  John D.   │  ┌─── Side panel ──────────────┐ │
│            │  │ r/SaaS                      │ │
│            │  │ Relevance: 92/100           │ │
│            │  │ Members: 124,000            │ │
│            │  │                             │ │
│            │  │ "High concentration of      │ │
│            │  │  founders discussing tools  │ │
│            │  │  and workflows. Posts about  │ │
│            │  │  growth and onboarding      │ │
│            │  │  align directly with your   │ │
│            │  │  product's positioning."    │ │
│            │  └─────────────────────────────┘ │
└──────────────────────────────────────────────┘
```

---

## 10. Do's and Don'ts

### Do

- Use whitespace generously — when in doubt, add more
- Keep text short. If a label needs explanation, use a tooltip
- Use the serif font (Newsreader) for any AI-generated or editorial content
- Maintain consistent border-radius (8px components, 12px cards)
- Provide keyboard shortcuts for power users

### Don't

- Don't use navy/blue tones in backgrounds — keep everything warm
- Don't show more than one card at a time on the review page
- Don't use modals for editing — inline editing always
- Don't add borders AND shadows — pick one per component
- Don't use filled/solid icons — outline only (Lucide)
- Don't use gradients on surfaces — flat with depth from shadows only
- Don't sacrifice whitespace to "fit more content" — scroll is fine
