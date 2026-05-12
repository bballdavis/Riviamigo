# Riviamigo — Brand & Design System Reference

> Source of truth for visual decisions. All token values live in
> `packages/ui/src/tokens/globals.css`. This doc explains how and why to use them.

---

## Identity

| | |
|---|---|
| **Name** | Riviamigo |
| **Tagline** | *Your Rivian's data companion* |
| **Personality** | Precise, premium, technical — like a high-end automotive instrument cluster |
| **Logo mark** | Bold **R** in `font-display` (Space Grotesk) at `text-accent` on a `bg-accent/10` rounded tile |

---

## Color Palette

### Dark mode (default)

| Token | Hex | Use |
|---|---|---|
| `bg-page` | `#0A0A0F` | Page background — deepest layer |
| `bg-surface` | `#12121A` | Cards, sidebars |
| `bg-elevated` | `#1A1A24` | Inputs, dropdowns, hover states |
| `bg-glass` | `rgba(26,26,36,0.6)` | Backdrop-blur overlays (login card, modals) |
| `fg` | `#FAFAFA` | Primary text |
| `fg-secondary` | `#A1A1A1` | Labels, secondary copy |
| `fg-tertiary` | `#71717A` | Hints, placeholders, metadata |
| `border` | `rgba(255,255,255,0.08)` | Default borders |
| `border-strong` | `rgba(255,255,255,0.15)` | Hover borders, dividers |
| `accent` | `#F59E0B` | CTAs, active states, highlights |
| `accent-hover` | `#FBBF24` | Button hover |
| `accent-muted` | `rgba(245,158,11,0.15)` | Active nav background, subtle chips |
| `glow-button` | `0 0 20px rgba(245,158,11,0.40)` | Primary button shadow |

Charging indicators use the same branded accent via the shared `charging.active` token, so connected-state plug icons stay visually aligned with the rest of the app instead of introducing a separate orange.

### Light mode

Same tokens, lighter values. The accent shifts to `#D97706` (darker amber) for contrast on white.

---

## Typography

| Role | Font | Weight | Class |
|---|---|---|---|
| Brand / headings | Space Grotesk | 600–700 | `font-display font-semibold` |
| Body / UI | Inter | 400–500 | (default body) |
| Monospace | JetBrains Mono | 400 | `font-mono` |

### Scale conventions
- Page title: `text-2xl font-bold font-display`
- Section title: `text-base font-semibold`
- Card label: `text-[11px] font-semibold uppercase tracking-widest text-fg-tertiary`
- Body: `text-sm`
- Hint / meta: `text-xs text-fg-tertiary`

---

## Spacing & Layout

- Content max-width: `max-w-sm` (auth), `max-w-7xl` (dashboard pages)
- Card padding: `p-5` (default), `p-6` (prominent cards)
- Sidebar width: `w-64` expanded, `w-[72px]` collapsed
- Sidebar height reservation: `lg:pl-64` on main content

---

## Component Patterns

### Cards
```tsx
// Standard
<div className="bg-bg-surface border border-border rounded-2xl p-5" />

// Glass (auth screens, modals)
<div className="bg-bg-glass backdrop-blur-md border border-border rounded-2xl p-6 shadow-[0_8px_32px_rgba(0,0,0,0.4)]" />
```

### Accent glow (background decorations)
```tsx
// Center radial glow behind auth/hero content
<div className="pointer-events-none fixed inset-0 flex items-center justify-center">
  <div className="w-[700px] h-[700px] rounded-full bg-accent/[0.07] blur-[140px]" />
</div>
```

### Logo tile
```tsx
<div className="w-16 h-16 rounded-2xl bg-accent/10 border border-accent/25 flex items-center justify-center shadow-[0_0_40px_rgba(245,158,11,0.2)]">
  <span className="font-display font-bold text-3xl text-accent">R</span>
</div>
```

### Error state (inline)
```tsx
<p className="text-xs text-[#F87171] bg-[#7F1D1D]/20 border border-[#F87171]/20 rounded-lg px-3 py-2">
  {message}
</p>
```

### Empty / loading states
- Use `<EmptyState>` and `<Skeleton>` from `@riviamigo/ui/primitives`

---

## Page Checklist

When building a new page, tick these off:

- [ ] Wrapped in `<PageLayout>` (provides sidebar + main area)
- [ ] Page-level title uses `font-display font-semibold`
- [ ] Cards use `bg-bg-surface border border-border rounded-2xl`
- [ ] Error messages use the red inline pattern (not bare text)
- [ ] Loading states use `<Skeleton>` or `loading` prop on `<Button>`
- [ ] Any ambient decoration (`AmbientOrbs` or custom glow) is `aria-hidden` and `pointer-events-none`
- [ ] Accent color used only for interactive / highlight elements — never purely decorative

---

## Voice & Copy

- **Precise, not clinical.** "12 trips this week, 1,847 Wh/mi avg" not "Data loaded successfully."
- **No marketing fluff** inside the app. The tagline is for the landing/login page only.
- **Units** follow user preferences (miles/km, °F/°C) — never hard-code imperial.
