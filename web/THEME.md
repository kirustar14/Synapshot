# UNNAMED theme

Carried over verbatim from `lovable-frontend/`. Every value below is copied, not paraphrased.
Source files: `lovable-frontend/src/styles.css`, `src/components/common.tsx`,
`src/routes/_clinic.tsx`, `src/routes/__root.tsx`, `src/components/ui/{button,card,badge,input,table}.tsx`,
`components.json`.

The live copy of all of this is `web/src/styles.css`. If the two ever disagree, the CSS file wins.

## Tailwind setup

Tailwind v4, CSS first. There is no `tailwind.config.js` colour palette. The whole design system
lives in `src/styles.css`:

```css
@import "tailwindcss" source(none);
@source "../src";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));
```

`source(none)` plus `@source "../src"` means Tailwind scans only `web/src`, not `node_modules`.
`tw-animate-css` is installed as a dependency, so the import stays.

Dark mode is a `.dark` class on `<html>`, toggled in `App.tsx` from the Zustand store and
persisted to `localStorage["unnamed-dark"]` as `"1"` or `"0"`.

shadcn config from `components.json`: style `new-york`, `rsc: false`, `tsx: true`, base colour
`slate`, `cssVariables: true`, no prefix, lucide icons, aliases `@/components`, `@/lib/utils`,
`@/components/ui`, `@/lib`, `@/hooks`.

## Fonts

Nunito at weights 400, 500, 600, 700, 800, 900 and JetBrains Mono at 400, 600, from Google Fonts.
Loaded with preconnect plus a stylesheet link. In `web/index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nunito:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;600&display=swap" />
```

Token mapping:

```
--font-sans: "Nunito", ui-sans-serif, system-ui, sans-serif;
--font-mono: "JetBrains Mono", ui-monospace, monospace;
```

Headings are `font-extrabold` (800) or `font-black` (900). The brand mark `unnamed.` is
`text-2xl font-black`. Page titles are `text-3xl font-extrabold`. Panel titles are
`text-base font-extrabold`. Nav items are `text-sm font-bold`. Body text carries
`font-feature-settings: "tnum"` so digits line up in tables.

## Radius scale

`--radius: 1.25rem` is the root. The scale in `@theme inline`:

```
--radius-sm: calc(var(--radius) - 4px);   /* 1.25rem - 4px */
--radius-md: calc(var(--radius) - 2px);
--radius-lg: var(--radius);
--radius-xl: calc(var(--radius) + 4px);
--radius-2xl: calc(var(--radius) + 8px);
```

Buttons are `rounded-full`. Cards are `rounded-xl`. Nav items are `rounded-2xl`. Badges and
chips are `rounded-full` or `rounded-md`.

## The two shadows

```
--shadow-soft: 0 3px 20px -8px oklch(0.28 0.015 250 / 0.06);
--shadow-lift: 0 8px 32px -10px oklch(0.28 0.015 250 / 0.12);
```

Used as `shadow-soft` and `shadow-lift`. The default button and the active nav item both use
`shadow-soft`.

## `@theme inline` colour bindings

Every colour utility is bound to a custom property, so swapping `:root` for `.dark` swaps the
whole palette with no class changes.

```
--color-background: var(--background);
--color-foreground: var(--foreground);
--color-card: var(--card);
--color-card-foreground: var(--card-foreground);
--color-popover: var(--popover);
--color-popover-foreground: var(--popover-foreground);
--color-primary: var(--primary);
--color-primary-foreground: var(--primary-foreground);
--color-primary-soft: var(--primary-soft);
--color-secondary: var(--secondary);
--color-secondary-foreground: var(--secondary-foreground);
--color-muted: var(--muted);
--color-muted-foreground: var(--muted-foreground);
--color-accent: var(--accent);
--color-accent-foreground: var(--accent-foreground);
--color-destructive: var(--destructive);
--color-destructive-foreground: var(--destructive-foreground);
--color-destructive-soft: var(--destructive-soft);
--color-synthetic: var(--synthetic);
--color-synthetic-foreground: var(--synthetic-foreground);
--color-synthetic-soft: var(--synthetic-soft);
--color-success: var(--success);
--color-success-soft: var(--success-soft);
--color-band: var(--band);
--color-bubble-out: var(--bubble-out);
--color-bubble-in: var(--bubble-in);
--color-bubble-in-foreground: var(--bubble-in-foreground);
--color-border: var(--border);
--color-input: var(--input);
--color-ring: var(--ring);
--color-ring-offset-background: var(--background);
--color-chart-1: var(--chart-1);
--color-chart-2: var(--chart-2);
--color-chart-3: var(--chart-3);
--color-chart-4: var(--chart-4);
--color-chart-5: var(--chart-5);
--color-sidebar: var(--sidebar);
--color-sidebar-foreground: var(--sidebar-foreground);
--color-sidebar-primary: var(--sidebar-primary);
--color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
--color-sidebar-accent: var(--sidebar-accent);
--color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
--color-sidebar-border: var(--sidebar-border);
--color-sidebar-ring: var(--sidebar-ring);
--color-lab-lilac: var(--lab-lilac);
--color-lab-peach: var(--lab-peach);
--color-lab-surface: var(--lab-surface);
```

## `:root` tokens, light mode

| Property | Value |
| --- | --- |
| `--radius` | `1.25rem` |
| `--background` | `oklch(0.985 0.002 260)` |
| `--foreground` | `oklch(0.29 0.017 255)` |
| `--lab-lilac` | `oklch(0.935 0.022 285)` |
| `--lab-peach` | `oklch(0.945 0.032 55)` |
| `--lab-surface` | `oklch(0.964 0.006 255)` |
| `--card` | `oklch(1 0 0)` |
| `--card-foreground` | `oklch(0.22 0.02 220)` |
| `--popover` | `oklch(1 0 0)` |
| `--popover-foreground` | `oklch(0.22 0.02 220)` |
| `--primary` | `oklch(0.43 0.065 172)` |
| `--primary-foreground` | `oklch(0.99 0.005 186)` |
| `--primary-soft` | `oklch(0.946 0.024 166)` |
| `--secondary` | `oklch(0.958 0.006 255)` |
| `--secondary-foreground` | `oklch(0.28 0.02 220)` |
| `--muted` | `oklch(0.958 0.006 255)` |
| `--muted-foreground` | `oklch(0.53 0.015 255)` |
| `--accent` | `oklch(0.946 0.024 166)` |
| `--accent-foreground` | `oklch(0.37 0.06 172)` |
| `--destructive` | `oklch(0.56 0.21 25)` |
| `--destructive-foreground` | `oklch(0.99 0 0)` |
| `--destructive-soft` | `oklch(0.96 0.03 25)` |
| `--synthetic` | `oklch(0.78 0.15 75)` |
| `--synthetic-foreground` | `oklch(0.38 0.09 60)` |
| `--synthetic-soft` | `oklch(0.96 0.05 85)` |
| `--success` | `oklch(0.58 0.13 155)` |
| `--success-soft` | `oklch(0.95 0.04 155)` |
| `--band` | `oklch(0.51 0.09 186 / 0.16)` |
| `--bubble-out` | `oklch(0.62 0.19 255)` |
| `--bubble-in` | `oklch(0.92 0.004 250)` |
| `--bubble-in-foreground` | `oklch(0.2 0 0)` |
| `--border` | `oklch(0.928 0.006 255)` |
| `--input` | `oklch(0.9 0.008 255)` |
| `--ring` | `oklch(0.43 0.065 172)` |
| `--chart-1` | `oklch(0.43 0.065 172)` |
| `--chart-2` | `oklch(0.6 0.12 240)` |
| `--chart-3` | `oklch(0.7 0.14 75)` |
| `--chart-4` | `oklch(0.55 0.15 300)` |
| `--chart-5` | `oklch(0.56 0.21 25)` |
| `--sidebar` | `oklch(0.976 0.004 255)` |
| `--sidebar-foreground` | `oklch(0.3 0.02 220)` |
| `--sidebar-primary` | `oklch(0.51 0.09 186)` |
| `--sidebar-primary-foreground` | `oklch(0.99 0 0)` |
| `--sidebar-accent` | `oklch(1 0 0)` |
| `--sidebar-accent-foreground` | `oklch(0.37 0.06 172)` |
| `--sidebar-border` | `oklch(0.928 0.006 255)` |
| `--sidebar-ring` | `oklch(0.51 0.09 186)` |

Primary is a deep teal. The synthetic marker is amber. Neither is reused for anything else.

## `.dark` tokens

Only the properties listed here are overridden. Everything else inherits from `:root`, so
`--radius`, `--bubble-out`, the five chart colours, `--sidebar-primary`,
`--sidebar-primary-foreground` and `--sidebar-ring` are the same in both modes.

| Property | Value |
| --- | --- |
| `--lab-lilac` | `oklch(0.29 0.035 285)` |
| `--lab-peach` | `oklch(0.29 0.04 55)` |
| `--lab-surface` | `oklch(0.235 0.012 255)` |
| `--background` | `oklch(0.17 0.012 220)` |
| `--foreground` | `oklch(0.95 0.005 200)` |
| `--card` | `oklch(0.21 0.014 220)` |
| `--card-foreground` | `oklch(0.95 0.005 200)` |
| `--popover` | `oklch(0.21 0.014 220)` |
| `--popover-foreground` | `oklch(0.95 0.005 200)` |
| `--primary` | `oklch(0.7 0.11 182)` |
| `--primary-foreground` | `oklch(0.17 0.02 200)` |
| `--primary-soft` | `oklch(0.3 0.05 186)` |
| `--secondary` | `oklch(0.26 0.014 220)` |
| `--secondary-foreground` | `oklch(0.95 0.005 200)` |
| `--muted` | `oklch(0.26 0.014 220)` |
| `--muted-foreground` | `oklch(0.7 0.015 220)` |
| `--accent` | `oklch(0.3 0.04 186)` |
| `--accent-foreground` | `oklch(0.9 0.05 186)` |
| `--destructive` | `oklch(0.66 0.19 25)` |
| `--destructive-foreground` | `oklch(0.99 0 0)` |
| `--destructive-soft` | `oklch(0.3 0.07 25)` |
| `--synthetic` | `oklch(0.78 0.15 75)` |
| `--synthetic-foreground` | `oklch(0.88 0.12 85)` |
| `--synthetic-soft` | `oklch(0.32 0.06 75)` |
| `--success` | `oklch(0.7 0.14 155)` |
| `--success-soft` | `oklch(0.3 0.05 155)` |
| `--band` | `oklch(0.7 0.11 182 / 0.2)` |
| `--bubble-in` | `oklch(0.32 0.01 250)` |
| `--bubble-in-foreground` | `oklch(0.96 0 0)` |
| `--border` | `oklch(1 0 0 / 10%)` |
| `--input` | `oklch(1 0 0 / 15%)` |
| `--ring` | `oklch(0.7 0.11 182)` |
| `--sidebar` | `oklch(0.2 0.013 220)` |
| `--sidebar-foreground` | `oklch(0.9 0.005 200)` |
| `--sidebar-accent` | `oklch(0.3 0.04 186)` |
| `--sidebar-accent-foreground` | `oklch(0.9 0.05 186)` |
| `--sidebar-border` | `oklch(1 0 0 / 8%)` |

`--synthetic` is deliberately identical in both modes, so the amber badge reads the same way in
either theme.

## Base layer

```css
@layer base {
  * { border-color: var(--color-border); }
  body {
    background-color: var(--color-background);
    color: var(--color-foreground);
    font-family: var(--font-sans);
    font-feature-settings: "tnum";
    -webkit-font-smoothing: antialiased;
  }
  h1, h2, h3, p, a, span, th, dt { letter-spacing: 0; }
  button, input, textarea, select { font: inherit; }
}
```

## The `panel` utility

The single most used surface. Everything that looks like a card on a screen uses
`class="panel p-5"`.

```css
@utility panel {
  background: var(--color-card);
  border-radius: var(--radius);
  border: 1px solid var(--color-border);
}
```

## `patient-table` rules

```css
.patient-table th { white-space: nowrap; font-weight: 700; text-transform: none; font-size: 12px; }
.patient-table td { padding-top: 20px; padding-bottom: 20px; }
.patient-table tbody tr { border-color: color-mix(in oklab, var(--border) 65%, transparent); }
```

Headers stay bold and sentence case, never uppercase. Rows are tall, 20px top and bottom.

## `science-grid` rule

The faint graph-paper background behind visualisation panels.

```css
.science-grid {
  background-image:
    linear-gradient(var(--border) 1px, transparent 1px),
    linear-gradient(90deg, var(--border) 1px, transparent 1px);
  background-size: 28px 28px;
}
```

## Canvas rule

```css
.workspace-visual canvas { touch-action: pan-y; }
```

Lets a touch user scroll the page past a 3D viewer instead of being trapped by OrbitControls.

## Motion

Reduced motion is honoured globally:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

### ring-pulse

For the incoming call pill and the ringing phone animation.

```css
@utility ring-pulse { animation: ring-pulse 1.2s ease-in-out infinite; }

@keyframes ring-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.12); opacity: 0.75; }
}
```

### ring-wave

The expanding halo behind it.

```css
@utility ring-wave { animation: ring-wave 1.6s ease-out infinite; }

@keyframes ring-wave {
  0% { transform: scale(0.6); opacity: 0.6; }
  100% { transform: scale(2.4); opacity: 0; }
}
```

## Print rules

C2 exports a one page report through `window.print()`. Anything in the chrome carries `no-print`.

```css
@media print {
  .no-print { display: none !important; }
  body { background: white; }
  .print-page { padding: 0 !important; margin: 0 !important; }
  .panel { box-shadow: none; break-inside: avoid; }
  @page { size: A4; margin: 12mm; }
}
```

## Component recipes

### Button (`ui/button.tsx`)

Base: `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0`

| Variant | Classes |
| --- | --- |
| `default` | `bg-primary text-primary-foreground shadow-soft hover:bg-primary/90` |
| `destructive` | `bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90` |
| `outline` | `border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground` |
| `secondary` | `bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80` |
| `ghost` | `hover:bg-accent hover:text-accent-foreground` |
| `link` | `text-primary underline-offset-4 hover:underline` |

| Size | Classes |
| --- | --- |
| `default` | `h-11 px-5 py-2` |
| `sm` | `h-9 px-4 text-xs` |
| `lg` | `h-12 px-8` |
| `icon` | `h-10 w-10 shrink-0` |

Buttons are pill shaped and bold. Default height 44px, which is already a comfortable touch
target. The call page needs 48px, so it passes `size="lg"` or its own height class.

### Card (`ui/card.tsx`)

`rounded-xl border bg-card text-card-foreground shadow`, header and content padded `p-6`.
Prefer the `panel` utility plus `Panel` from `components/common.tsx` for screen sections.

### Badge (`ui/badge.tsx`)

Base `inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2`,
variants `default`, `secondary`, `destructive`, `outline`.

### Input (`ui/input.tsx`)

`flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm`

`text-base` on small screens stops iOS Safari zooming on focus.

### Table (`ui/table.tsx`)

`Table` wraps in `relative w-full overflow-auto`, table is `w-full caption-bottom text-sm`.
`TableHead` is `h-10 px-2 text-left align-middle font-medium text-muted-foreground`,
`TableCell` is `p-2 align-middle`, `TableRow` is `border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted`.
Add `className="patient-table"` on the C1 table to pick up the taller, bolder variant.

## Shared chips, from `components/common.tsx`

| Component | Classes |
| --- | --- |
| `SyntheticBadge` | `rounded-full border border-synthetic/50 bg-synthetic-soft px-2 py-0.5 text-[11px] font-medium text-synthetic-foreground`, flask icon |
| `RealBadge` | `rounded-full border border-primary/30 bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-accent-foreground` |
| `ModelLabel` | `text-[11px] text-muted-foreground`, info icon, text "Model output, not a scan" |
| `FlagChip` red_flag | `border-destructive/40 bg-destructive-soft text-destructive` |
| `FlagChip` missed_call | `border-border bg-muted text-muted-foreground` |
| `FlagChip` low_quality | `border-synthetic/40 bg-synthetic-soft text-synthetic-foreground` |
| `FlagChip` drift | `border-chart-2/40 bg-accent text-accent-foreground` |
| `StatusChip` ok | `text-success bg-success-soft border-success/30` |
| `StatusChip` warn | `text-synthetic-foreground bg-synthetic-soft border-synthetic/40` |
| `StatusChip` error | `text-destructive bg-destructive-soft border-destructive/30` |
| `StatusChip` missing | `text-muted-foreground bg-muted border-border` |
| `TierChip` A | `border-primary/40 text-primary` |
| `TierChip` B | `border-chart-2/40 text-chart-2` |

Every chip pairs its colour with an icon or a word, so colour is never the only signal.

## Layout shell

From `lovable-frontend/src/routes/_clinic.tsx`, ported to `web/src/components/ClinicLayout.tsx`.

- Sidebar: `sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar lg:flex`, hidden under `lg` and replaced by a `Sheet`.
- Brand block: `flex h-[100px] items-center gap-3 px-7`, a `h-10 w-10` tile with
  `rounded-2xl border border-primary/15 bg-primary-soft text-primary` holding the lucide `Brain`
  icon at `strokeWidth={1.5}`, then `unnamed.` in `text-2xl font-black` over
  "The brain twin lab" in `text-[10px] font-semibold text-muted-foreground`.
- Nav item: `flex min-h-12 items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-sidebar-foreground hover:bg-sidebar-accent` and when active
  `bg-sidebar-accent text-sidebar-accent-foreground shadow-soft`.
- Footer block: a `border-t pt-5` row reading "Research environment" with the lucide
  `FlaskConical` icon in `text-primary`, the line "Synthetic patients. Model forecasts support,
  but never replace, clinical judgment.", and a `h-9 w-9 rounded-full bg-lab-lilac` avatar
  reading `CL` next to "Clinical lab" and "TBI recovery research".
- Top bar: `sticky top-0 z-20 flex h-[76px] items-center gap-3 border-b border-border/70 bg-background/95 px-4 backdrop-blur lg:px-10`.
- Synthetic pill, shown when `health.mode === "mock"`: `rounded-full bg-primary-soft px-3 py-1.5 text-[11px] font-bold text-accent-foreground` with a `h-1.5 w-1.5 rounded-full bg-primary` dot.
- Mock pill, shown when the client fell back to the local mock layer:
  `rounded-full border border-synthetic/50 bg-synthetic-soft px-3 py-1.5 text-[11px] font-bold text-synthetic-foreground`.
- Main: `print-page mx-auto min-w-0 w-full max-w-[1440px] flex-1 px-5 py-7 lg:px-10 lg:py-10`.
- Patient tab link: `rounded-full px-4 py-2 text-sm font-bold text-muted-foreground hover:bg-muted hover:text-foreground`, active `bg-primary-soft text-primary`.

The P routes (`/consent/:token`, `/phone/:id`, `/stretch/:token`) and `/call/:token` sit outside
this shell. They are mobile first, single column, no sidebar, and must work at 360px wide.
