# GasLamar Design System

> Source of truth for visual design. When adding UI, match this system. When changing the system, update this file.

**Product:** AI CV tailoring for Indonesian job seekers. Pay-per-use, no login, mobile-first.
**Aesthetic:** Modern-professional dark hero, clean white content sections, intentional decoration. Not minimal, not maximalist — confident and focused.
**Positioning:** Trustworthy tool with a sharp conversion mechanic (match score). Design must feel credible enough to trust with your job search, and urgent enough to act now.

---

## Color

### Tokens (CSS variables in `css/main.css`)

| Token | Hex | Use |
|-------|-----|-----|
| `--primary` | `#1B4FE8` | Primary action, brand anchor, CTAs, links |
| `--accent` | `#22C55E` | Success states, score high, per-CV rate pill, positive signal |
| `--warning` | `#F59E0B` | Score medium (50–74), star icons |
| `--danger` | `#EF4444` | Score low (< 50), destructive actions |
| `--navy` | `#0B1729` | Hero background, dark sections |
| `--navy-800` | `#0F2040` | Stats bar, secondary dark sections |

### Semantic Colors (Tailwind classes used inline)

| Role | Class | Hex |
|------|-------|-----|
| Page background | `bg-[#F8FAFF]` | #F8FAFF — warm off-white, not pure white |
| Body text | `text-[#1F2937]` | #1F2937 — near-black on light bg |
| Muted text (dark bg) | `text-[#94A3B8]` | #94A3B8 — slate-400 |
| Subtle text (dark bg) | `text-[#64748B]` | #64748B — slate-500 |
| Border (dark bg) | `border-white/5` to `border-white/10` | semi-transparent white |
| Surface (dark bg) | `bg-white/[0.06]` | glass card on navy |

### Rules

- Primary (#1B4FE8) is the single conversion color. Every CTA button uses it.
- Accent (#22C55E) signals good news only. Never use for CTAs.
- Never use purple/violet gradients. Never use generic gradient buttons.
- Dark sections use `--navy` or `--navy-800` — not generic gray-900 or black.
- Light sections use `#F8FAFF` background — not pure white.

---

## Typography

### Fonts

| Role | Family | Weight |
|------|--------|--------|
| Headings | Plus Jakarta Sans | 700 (bold), 800 (extrabold) |
| Body | Inter | 400 (regular), 500 (medium), 600 (semibold) |

Both loaded via Google Fonts. Applied via `font-heading` and `font-body` Tailwind classes (configured in `tailwind.config.js`).

### Type Scale

| Element | Class | Size |
|---------|-------|------|
| Hero H1 | `text-5xl sm:text-6xl lg:text-7xl` | 48–72px |
| Section H2 | `text-3xl sm:text-4xl` | 30–36px |
| Card heading | `text-xl` or `text-2xl` | 20–24px |
| Body | `text-base` | 16px |
| Body small | `text-sm` | 14px |
| Caption/label | `text-xs` | 12px |

### Rules

- Headings: `font-heading font-extrabold`, tight tracking (`tracking-tight`).
- Body: `font-body` (Inter), `leading-relaxed` for paragraphs.
- Never use Inter or Plus Jakarta Sans as fallback — they're the intentional choice.
- Eyebrow labels above section headings: `text-xs font-semibold uppercase tracking-widest text-primary`.

---

## Spacing

- Base unit: 4px (Tailwind default — `p-1 = 4px`).
- Section vertical padding: `py-20 sm:py-28` on light sections.
- Max content width: `max-w-6xl mx-auto` with `px-4 sm:px-6` horizontal padding.
- Card padding: `p-6` (light) or `p-5 sm:p-6` (pricing cards).
- Gap between grid items: `gap-6` or `gap-8`.

---

## Layout

- **Breakpoints:** Tailwind defaults (sm=640px, md=768px, lg=1024px).
- **Content max width:** `max-w-6xl` (1152px) centered. Marketing copy sections sometimes use `max-w-2xl` for readability.
- **Grid:** 1-column mobile → 2 or 3-column desktop via `grid-cols-1 sm:grid-cols-3`.
- **Hero:** Full-width dark section, center-aligned content.
- **Content sections:** Alternating decoration, white/off-white backgrounds.
- **Sticky nav:** `sticky top-0 z-50` with `nav-dark` glass effect.

---

## Decoration

Level: **Intentional** — texture and glow are used purposefully, not decoratively.

### Hero
- Background: `--navy` (#0B1729).
- Blue radial glow: `radial-gradient(ellipse 90% 55% at 50% -5%, rgba(27,79,232,0.40), transparent)`.
- Grid texture: 48×48px crosshatch at 2.5% opacity — visible but subtle.
- Both defined in `.hero-glow` and `.hero-grid` classes.

### Cards
- Light: `card-elevated` — subtle shadow, hover lift (`translateY(-2px)`).
- Dark / glass: `bg-white/[0.06] border border-white/10 backdrop-blur-sm`.

### Bottom CTA section
- Dark navy base with dot-grid texture (24×24px at 10% white).
- Radial gradient mesh overlay (blue + green at 6% opacity).
- Star badge accent.

### Border radius
- Buttons: `rounded-xl` (12px) to `rounded-2xl` (16px) for primary CTAs.
- Cards: `rounded-2xl` (16px).
- Pill badges: `rounded-full` or `rounded-[999px]`.
- Never uniform bubble-radius across all elements.

---

## Motion

Level: **Intentional** — animations aid comprehension and sequence content. Not decorative.

### Entrance animations (`.anim-fade-up`)
```css
fadeUp: translateY(24px) → (0) over 0.7s cubic-bezier(0.22, 1, 0.36, 1)
```
Staggered delays: `anim-delay-1` (0.1s) → `anim-delay-4` (0.54s). Hero content only.

### Score ring
```css
scoreReveal: stroke-dashoffset 534 → target over 1.4s cubic-bezier(0.22, 1, 0.36, 1)
```
Ring color transitions: 0.4s ease. Used on `hasil.html` only.

### Button shine
- `.btn-shine::after`: shine sweep on hover, left -100% → 160%, 0.55s ease.
- Applied to primary CTAs only.

### Transitions
Scoped to interactive elements only (not `*`) for Android perf:
```css
a, button, input, textarea, .btn-shine, .faq-icon, .dl-btn → 150ms, cubic-bezier(0.4, 0, 0.2, 1)
```

### Rules
- No decorative looping animations.
- No scroll-triggered animations beyond hero entrance.
- Score ring animation plays once on page load (js/scoring.js).
- FAQ icon rotates 180deg on open (functional, not decorative).

---

## Components

### Buttons

**Primary CTA:**
```html
<a class="btn-shine bg-primary text-white font-bold text-lg px-10 py-4 rounded-2xl hover:bg-blue-600 transition-all shadow-2xl shadow-blue-900/60 hover:-translate-y-0.5">
```

**Secondary / ghost:**
```html
<a class="border border-white/15 text-white font-semibold px-8 py-4 rounded-2xl hover:bg-white/8">
```

**Nav CTA:**
```html
<a class="btn-shine bg-primary text-white font-semibold px-5 py-2.5 rounded-xl text-sm shadow-lg shadow-blue-900/30">
```

### Cards (pricing / tier)

On dark background:
```html
<div class="bg-white/[0.06] border border-white/10 rounded-2xl p-5 sm:p-6 cursor-pointer hover:border-primary/40 transition-all">
```
Selected state (`.tier-card.selected`): `bg-white/30 border-white border-2 shadow-[0_0_0_4px_rgba(255,255,255,0.2)]`.

### Section eyebrow
```html
<span class="section-eyebrow">
  <svg .../>LABEL
</span>
```
Style: `inline-flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold uppercase tracking-widest px-4 py-1.5 rounded-full`.

### Score ring
SVG circle with `stroke-dasharray="534"`, colored by `.score-high/.score-medium/.score-low`. Animated via `.score-animate` class added by JS. Center number animated via `scoring.js` counter.

### FAQ accordion
`.faq-icon` rotates `.rotate-180` on open. Content reveals with CSS `max-height` transition.

### Mobile progress indicator
In-page, visible mobile only (`flex sm:hidden`):
```html
<div class="flex sm:hidden text-xs font-semibold text-primary">Langkah N / 3 — Label</div>
```

### Frosted glass card (app pages)
Used on `analyzing.html`, `download.html`, `access.html`, `exchange-token.html` — not on the marketing landing page.
```jsx
<div
  className="rounded-[24px] px-6 py-6"
  style={{
    background:     'rgba(255,255,255,0.88)',
    border:         '1px solid rgba(148,163,184,0.14)',
    boxShadow:      '0 18px 44px rgba(15, 23, 42, 0.08)',
    backdropFilter: 'blur(14px)',
  }}
>
```
Shadow constant reused across components: `'0 18px 44px rgba(15, 23, 42, 0.08)'`.

### App page shell
App pages (upload, analyzing, hasil, download, access, exchange-token) share a light shell — distinct from the dark marketing hero:
- **Background:** `radial-gradient(ellipse 80% 50% at 50% -20%, rgba(37,99,235,0.08), transparent)` on `min-h-screen`.
- **Sticky navbar:** `rgba(255,255,255,0.88)` bg, `backdropFilter: blur(14px)`, `borderColor: rgba(148,163,184,0.18)`.
- **Content max width:** `max-w-2xl` for focused single-column flows (analyzing, access); `max-w-screen-xl` for wider layouts (download).

### Serif display heading
Used for page headings and success states on app pages — creates a softer, document-like feel that contrasts with the marketing headings:
```js
const SERIF = {
  fontFamily: '"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,serif',
  letterSpacing: '-0.02em',
}
```
Applied to: download success heading, access page H1. Not used on `index.html`.

### Language tab pills
Toggle between ID/EN content inside a component:
```jsx
<button
  className={`min-h-[44px] px-5 rounded-full font-semibold text-sm transition-all ${
    active ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200 hover:border-blue-300'
  }`}
>
```

### CopyButton (dual-state)
Idle: `#EFF6FF` bg / `#BFDBFE` border / `#1D4ED8` text.
Copied (2s): `#F0FDF4` bg / `#86EFAC` border / `#15803D` text, label "✓ Disalin!".
Minimum touch target: `min-h-[44px] min-w-[44px]`.

### InterviewKit accordion
Frosted glass wrapper. Sections grouped by `GroupLabel` (metadata above item clusters):
```jsx
<p className="text-xs font-bold tracking-widest uppercase text-slate-400 mt-5 mb-2 px-1">
  LABEL GRUP
</p>
```
Items use shadcn `<Accordion type="single" collapsible>`. Each item: `border border-slate-100 rounded-[14px] mb-2 overflow-hidden`.
Accordion trigger: `min-h-[44px] px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50`.

### Download buttons
Primary (DOCX): gradient `linear-gradient(180deg,#3b82f6,#1d4ed8)`, `boxShadow: 0 4px 14px rgba(37,99,235,0.28)`, white text, `rounded-full`, `hover:translate-x-1`.
Secondary (PDF): white bg, `border: 1px solid rgba(37,99,235,0.2)`, `#1E3A8A` text.

### Post-download coaching card
Dismissible card shown after first download. Two variants:
- **Credits remaining:** `#EFF6FF` bg / `#BFDBFE` border — encourages using remaining credits.
- **No credits left:** `#F0FDF4` bg / `#86EFAC` border — upsell or interview tips.

Both use `rounded-[20px] p-5 mb-4 relative` with an `✕` dismiss button (`absolute top-3 right-3`).

### Expired / notice banner
Amber warning strip used above cards when a session link has expired:
```jsx
<div
  role="status"
  className="rounded-[16px] px-4 py-3 text-sm mb-4 text-amber-800"
  style={{ background: 'rgba(255,251,235,0.9)', border: '1px solid rgba(253,230,138,0.8)' }}
>
```

---

## Page Inventory

| Page | Purpose | Key components |
|------|---------|---------------|
| `index.html` | Marketing / landing | Hero, stats bar, cara kerja, pricing, FAQ, CTA, footer |
| `upload.html` | Step 1: upload CV + JD | Drop zone, file input, URL fetcher, progress indicator |
| `analyzing.html` | Analysis in progress | Progress ring, step list, trust rotator, cancel/back |
| `hasil.html` | Step 2: score + gaps | Score ring, verdict card, gap list, tier cards, email capture |
| `download.html` | Step 3: download | Download grid, score bars, interview kit, coaching card |
| `access.html` | Session recovery | Email form, expired banner, success confirmation |
| `exchange-token.html` | Email download-link handler | Auto-redirects after token exchange; minimal shell |
| `accessibility.html` | Accessibility statement | Static content page, light shell |
| `privacy.html` | Privacy policy | Static content page, light shell |
| `terms.html` | Terms of service | Static content page, light shell |
| `404.html` | Not found fallback | Static error page |

---

## Patterns to Avoid

- Purple/violet gradients (use `--navy` + `--primary` blue).
- 3-column icon grid with circles (OK for cara kerja steps, not for features).
- Generic gradient buttons (primary CTAs are solid `--primary`).
- Centered everything — hero is centered, content sections use left-align or grid.
- `* { transition }` global rule (scoped to interactive elements only — already fixed).
- Inter or Plus Jakarta Sans listed as "one of many fonts" — they're the intentional system choices.

---

## Anti-AI-Slop Checklist

Before shipping a new section:
- [ ] No purple/violet accent color
- [ ] No decorative gradient background blobs
- [ ] Score or achievement badge? Use `--accent` green, not gold/yellow.
- [ ] Hero has grid texture OR radial glow — not both at 100% opacity simultaneously
- [ ] Buttons have directional labels ("Cek Skor CV Saya →") not generic labels ("Get Started")
- [ ] Indonesian copy — not English placeholders

---

*Last updated: 2026-05-08 | gstack /design-consultation*
