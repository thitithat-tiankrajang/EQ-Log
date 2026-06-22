# Material AI Design System

## 1. Style Definition

- **Name:** Material AI Style
- **Type:** Clean, vibrant, user-friendly
- **Keywords:** AI, generative AI, cloud, developer, intuitive, vibrant, clean, modern
- **Era:** 2026+ AI-first
- **Light/Dark:** Full light mode, no dark mode by default, with optional theme variants

## 2. Color Palette

- **Primary colors:** Vibrant Blue `#4285F4`, Bold Red `#EA4335`, Energetic Yellow `#FBBC05`, Vivid Green `#34A853`
- **Secondary colors:** White `#FFFFFF`, Light Grey `#F8F9FA`, Dark Grey `#3C4043`, Cyan `#00BCD4`

## 3. Visual Effects

Use subtle Material Design shadows, dynamic gradients, responsive micro-interactions, legible sans-serif typography, floating elements, AI loading animations, and abstract data illustrations.

## 4. AI Prompt Keywords

Design a clean and vibrant landing page for a generative AI platform. Use multi-color brand accents, subtle material shadows, dynamic gradients, responsive micro-interactions, legible typography, AI loading animations, abstract data illustrations, and a user-friendly modern feel.

## 5. CSS Technical Direction

```css
background: #FFFFFF;
color: #3C4043;
box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
border-radius: 8px;
font-family: "Roboto", Arial, sans-serif;
transition: all 0.3s ease-in-out;
background-image: linear-gradient(to right, #4285F4, #34A853);
.ai-loading-animation;
.material-ripple-effect;
```

## 6. Design System Variables

```css
--brand-blue: #4285F4;
--brand-red: #EA4335;
--brand-yellow: #FBBC05;
--brand-green: #34A853;
--white: #FFFFFF;
--light-grey: #F8F9FA;
--font-sans: "Roboto", Arial, sans-serif;
--shadow-material: 0 2px 4px rgba(0, 0, 0, 0.1);
```

## 7. Implementation Checklist

- [ ] Vibrant brand colors
- [ ] Material Design shadows
- [ ] Dynamic gradients
- [ ] Legible typography
- [ ] AI animations
- [ ] Developer focus

## 8. Visual Theme and Atmosphere

Material AI Style is a tech-inspired design direction for AI, generative AI, and cloud products. It is intended as a ready-to-use template and prompt style for modern UI/UX work.

- **Density:** 3/10 - Airy
- **Variance:** 3/10 - Restrained
- **Motion:** 4/10 - Subtle

## 9. Color Palette and Roles

- **Vibrant Blue** `#4285F4` - Accent highlights, links, and focus states
- **Bold Red** `#EA4335` - Error states and destructive actions
- **Energetic Yellow** `#FBBC05` - Warning states and attention indicators
- **Vivid Green** `#34A853` - Supporting palette color and positive states
- **White** `#FFFFFF` - Secondary surfaces
- **Light Grey** `#F8F9FA` - Muted surfaces, secondary text contexts, and borders
- **Dark Grey** `#3C4043` - Primary text and deep contrast surfaces
- **Cyan** `#00BCD4` - Extended palette and decorative use

## 10. Typography Rules

- **Display / Hero:** Roboto, weight 700, tight tracking, used for headline impact
- **Body:** Roboto, weight 400, `16px / 1.6`, maximum line length of `72ch`
- **UI Labels / Captions:** Roboto, `0.875rem`, weight 500, slight letter spacing
- **Monospace:** JetBrains Mono, used for code, metadata, and technical values

Scale:

- **Hero:** `clamp(2.5rem, 5vw, 4rem)`
- **H1:** `2.25rem`
- **H2:** `1.5rem`
- **Body:** `1rem / 1.6`
- **Small:** `0.875rem`

## 11. Component Styling

- **Primary Button:** 8px rounded shape, accent fill, 8% darker hover with subtle lifted shadow, active state translated down by 1px, font weight 600, no outer glows
- **Secondary / Ghost Button:** Outline variant, 1.5px muted border, primary-color text, subtle background fill on hover
- **Cards:** 8px rounded corners, surface background, subtle `0 2px 12px rgba(0, 0, 0, 0.06)` shadow, 1px border stroke
- **Inputs:** Label above input, 1px border stroke, 2px accent focus ring with 2px offset, error text below, no floating labels
- **Navigation:** Primary surface background, active item uses an accent indicator and font weight 500
- **Skeletons:** Shimmer animation that matches component dimensions, no circular spinners
- **Empty States:** Icon-based composition with descriptive text and an action button

### EQ Lab Flat Variant

The current EQ Lab implementation uses a flatter operational variant of Material AI:

- Use square corners (`border-radius: 0`) for app controls, cards, tabs, filters, and action strips.
- Avoid decorative shadows and glow effects; use borders, spacing, and filled states for hierarchy.
- Avoid nested control frames. If a button lives inside an action strip, the strip owns the outer frame and each button is a flat cell.
- Active tabs, segmented controls, and primary commands should fill the full cell/div with the brand blue.
- Every clickable control must have a pressed response, not just hover. Use a solid darker fill on `:active` for buttons, tabs, cells, tile controls, and action strips.
- Form focus must align to the real control boundary. Wrapped inputs such as search bars and member pickers should draw focus on the wrapper, while the inner input must not draw a second outline.
- Standalone inputs should use an inset 2px accent outline (`outline-offset: -2px`) so the focus frame stays flush with the input border.
- Game tiles are exempt from the bright Material palette. Keep all tile faces dark/black with light text and white point values so they read as game pieces.
- Rack surfaces should contrast with the dark tiles. Use a pale blue-grey base, side-tinted active racks, and darker empty slots so rack contents do not collapse into one tone.
- Board coordinate labels must be outside the board grid. Use `R1`-`R15` for rows and `C1`-`C15` for columns so the board can keep a complete border on all four sides.
- Tile typography should use a plain formal sans-serif with tabular numerals. Tile point values should be white, and assigned choice tiles may use a brighter cyan-white face for fast recognition.

## 12. Layout Principles

- **Grid:** CSS Grid first
- **Max width:** `1280px`, centered, with `1.5rem` side padding
- **Spacing rhythm:** Balanced, based on an 8px unit
- **Section vertical gaps:** `clamp(4rem, 8vw, 8rem)`
- **Hero layout:** Split screen, text on the left and visual on the right
- **Feature sections:** Zig-zag alternating text and image rows, no three equal-width feature columns
- **Mobile collapse:** Multi-column layouts collapse below `768px`; avoid horizontal overflow
- **z-index contract:** base `0`, sticky nav `100`, overlay `200`, modal `300`, toast `500`

## 13. Motion and Interaction

- **Physics:** Ease-out curves with 200-300ms durations; smooth and predictable
- **Entry animations:** Fade plus translateY from `16px` to `0` over 420ms ease-out
- **List cascades:** 80ms stagger between items
- **Hover states:** Subtle color shift plus shadow adjustment over 200ms
- **Page transitions:** Fade only over 200ms
- **Performance:** Animate only transform and opacity; avoid layout-triggering properties

## 14. Anti-Patterns

- No emojis in UI; use an icon system such as Lucide or Heroicons
- No pure black `#000000`; use off-black or charcoal variants when needed
- No oversaturated accent colors; keep saturation capped at 80%
- No three-column equal-width feature layouts; use zig-zag or asymmetric grids
- No `h-screen`; use `min-h-[100dvh]`
- No AI copywriting cliches such as "Elevate", "Seamless", "Unleash", or "Next-Gen"
- No broken external image links; use `picsum.photos` or inline SVG if external imagery is required
- No generic lorem ipsum in demos

## Historical Context

Material AI Style represents a modern UI/UX web trend with a tech-inspired focus.

## Use Cases

Landing pages and modern websites.

## 15. Edit Board and Branching Timeline

The future replacement for `Live | Last turn` is specified in
[`EDIT_BOARD_BRANCHING_DESIGN.md`](./EDIT_BOARD_BRANCHING_DESIGN.md). It defines
the flat Material AI interface, immutable log editing, checkpoints, parallel
game branches, restore behavior, and a storage-conscious Supabase model.
