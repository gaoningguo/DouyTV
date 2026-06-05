---
name: Immersive Aggregator System
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#3a3939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#201f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353534'
  on-surface: '#e5e2e1'
  on-surface-variant: '#b9cac8'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#849492'
  outline-variant: '#3a4a48'
  surface-tint: '#00ddd6'
  primary: '#cffffb'
  on-primary: '#003735'
  primary-container: '#00f2ea'
  on-primary-container: '#006a66'
  inverse-primary: '#006a66'
  secondary: '#ffb2b6'
  on-secondary: '#67001b'
  secondary-container: '#ff516a'
  on-secondary-container: '#5b0016'
  tertiary: '#f5f5f5'
  on-tertiary: '#2f3131'
  tertiary-container: '#d9d9d9'
  on-tertiary-container: '#5d5f5f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#29fcf3'
  primary-fixed-dim: '#00ddd6'
  on-primary-fixed: '#00201e'
  on-primary-fixed-variant: '#00504d'
  secondary-fixed: '#ffdadb'
  secondary-fixed-dim: '#ffb2b6'
  on-secondary-fixed: '#40000d'
  on-secondary-fixed-variant: '#920029'
  tertiary-fixed: '#e2e2e2'
  tertiary-fixed-dim: '#c6c6c7'
  on-tertiary-fixed: '#1a1c1c'
  on-tertiary-fixed-variant: '#454747'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353534'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '800'
    lineHeight: 52px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 32px
  title-md:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '700'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  base: 4px
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  safe-area-inset: max(16px, env(safe-area-inset-bottom))
---

## Brand & Style

The brand personality is high-energy, immersive, and unapologetically digital. Designed for a Gen-Z and Alpha audience, the design system prioritizes content consumption above all else, using a "dark-room" philosophy where the UI recedes to let vibrant media shine. 

The design style is a blend of **Glassmorphism** and **High-Contrast Modern**. It utilizes deep blacks to create infinite depth, allowing the neon primary accents to guide the eye toward interactive elements. Surfaces are treated as semi-transparent layers "floating" over content, ensuring that whether a user is reading manga or watching a 4K stream, the interface feels like a natural extension of the media itself.

## Colors

The palette is anchored by **True Black (#050505)** to maximize the contrast of OLED screens and ensure "borderless" video integration. 

- **Vibrant Cyan (#00f2ea):** Used for primary actions, progress bars, and active states in technical contexts (Video/Live).
- **Hot Pink (#ff004f):** Used for expressive actions, notifications, "Like" states, and accents in creative contexts (Music/Manga).
- **Text/Icons:** Pure white is used for maximum legibility against dark backgrounds, often with subtle drop shadows when appearing over media.
- **Glass Effects:** Overlays use a semi-transparent white with high background blur (20px+) to maintain readability without obscuring the content underneath.

## Typography

This design system utilizes **Inter** for its neutral, systematic clarity and excellent legibility at small sizes. 

- **Headlines:** Use heavy weights (Bold/ExtraBold) with tight letter spacing to create a high-impact, editorial feel similar to luxury streetwear branding.
- **Content Overlay:** Any text appearing directly over video must use a subtle `0px 2px 4px rgba(0,0,0,0.5)` drop shadow to ensure accessibility.
- **Reading Experience:** For Novels and Manga descriptions, `body-lg` is prioritized with increased line height (1.6) to reduce eye strain during long-form consumption.

## Layout & Spacing

The layout philosophy is **Borderless & Fluid**. 

- **Edge-to-Edge:** Content (Video, Manga panels) must touch the edges of the screen.
- **The 16px Rule:** All interactive UI elements (buttons, text margins) maintain a minimum 16px (`md`) distance from the screen edge.
- **Vertical Rhythm:** A strict 4px base unit is used. Elements are stacked with 8px or 16px gaps.
- **Aggregator Grid:** Music albums and Manga covers use a 2-column or 3-column fluid grid with minimal 4px gutters to emphasize the cover art over the background.
- **Safe Areas:** Critical controls (Play/Pause, Navigation) must stay clear of the device notch and "home indicator" areas using the `safe-area-inset` variable.

## Elevation & Depth

This design system avoids traditional drop shadows for depth, instead opting for **Tonal Stacking** and **Backdrop Blurs**.

1.  **Level 0 (Background):** Pure Black (#050505).
2.  **Level 1 (Cards/Sheets):** Dark Grey (#121212) or Glass (10% White + 20px Blur).
3.  **Level 2 (Floating Controls):** Cyan or Pink accents with a subtle outer glow (neon effect) rather than a shadow.
4.  **Z-Indexing:** Media stays at the bottom. Interaction layers (comments, shares) slide in from the bottom as 80% opacity glass sheets, allowing the video to remain partially visible behind the interface.

## Shapes

The shape language is **Modern and Friendly**, using significant rounding to offset the aggressive color palette.

- **Standard Elements:** Buttons and input fields use a 0.5rem (8px) radius.
- **Media Containers:** Manga thumbnails and Music cards use `rounded-lg` (1rem) to create a premium, "app-within-an-app" feel.
- **Avatars/Action Icons:** Circular (pill-shaped) icons are used for profile pictures and the "right-hand-side" action bar (Like, Comment, Share) to match the circular motion of thumb interactions.

## Components

- **Primary Action Bar:** Situated on the right side for short video/live streaming. Icons are minimalist 2px stroke weight lines. Icons glow slightly when active (Cyan for tech, Pink for social).
- **Glass Buttons:** Secondary actions use a "Frosted" background with a 1px white border at 20% opacity.
- **Progress Bars:** Ultra-thin (2px) Cyan lines. On hover/interaction, they expand to 6px for easier seeking.
- **Content Chips:** Used for Manga genres or Music tags. Semi-transparent dark backgrounds with white text; no borders.
- **Immersive Inputs:** Search bars use a 12% white fill with no border, becoming 20% white when focused.
- **Novel Reader:** High-contrast toggle. In "Deep Night" mode, text is mid-grey (#888) on black (#050505) to eliminate glare.
- **Live Indicators:** A pulsing Hot Pink dot next to "LIVE" labels using the `label-caps` typography style.