# Design Principles

The platform is a surface for making things. Its design should never compete with what is being made.

---

## Principles

**Unobtrusive.** The platform recedes. Chrome, controls, and UI furniture are as quiet as possible so that the elements — visuals, code, instruments — read as the foreground. When Hydra is running, the canvas is what you see.

**Honest.** Controls look like what they do. A button looks like a button. A slider looks like a slider. No gradients, no shadows, no decoration that does not carry information. If something is interactive, that should be legible without needing to hover over it.

**Functional colour.** Colour is not decoration. It is used only when it carries meaning — an active state, an error, a distinct voice or channel. When used, it is primary and direct: red, blue, yellow, orange. Never muted, never pastel.

**Modular and spatial.** Elements are discrete units on a shared canvas. Each has its own space and responsibility. The layout is not a dashboard — it is a 2D space where position is meaningful, like instruments arranged on a stage.

**Light ground.** The canvas background is light, not dark. Elements and their content — code, waveforms, visuals — create their own contrast. Light backgrounds allow colours to read cleanly and give the work room to breathe.

**Legible at a glance.** Controls are labelled directly and tersely. No tooltips required. The function of a control should be readable from across a room.

---

## References

**Dieter Rams — Braun HiFi wall unit**
Modular components composed into a unified whole. Pure white, no ornament, every control in its right place. The system is honest about what it is and what each part does. "Less but better."

**John Cage — Aria (1958)**
A score as spatial canvas. Vocal lines are drawn as abstract shapes, positioned freely in space, coloured by voice type. Instructions and text float where they belong. Content and notation share the same field without hierarchy. This is what the JAM canvas aspires to: a spatial notation where position is meaning.

**Piet Mondriaan — Composition II in Red, Blue and Yellow (1930)**
Primary colours against white, divided by structure. Colour is load-bearing, not decorative. The grid is the form. Nothing added that does not belong.

**Roland TR-909**
Cream body, dark labels, sparse red and orange accents only where state must be visible. Knobs in rows, step buttons in a line. The layout communicates the instrument's logic without explanation. Industrial but warm.

**Buchla Electric Music Box**
Dense but organised. Sections are distinct. Patch points are colour-coded so signal flow is legible. Everything connects to everything — the physical layout makes the system's logic visible. Complexity made navigable by honest structure.

---

## What this means in practice

- Background: dark grey with a subtle cool-blue tint (`#1a1c20` or similar) — intentional but unobtrusive, designed to be covered by Hydra or other visuals
- Text and borders: light grey, near-white, no softening
- Accent colours: use primary colours (red, blue, yellow, orange) only for active states, selections, or errors
- No drop shadows, no rounded corners beyond what is functionally necessary
- Typography: monospace for code and values; clean sans-serif for labels
- Controls are always visible — not hidden behind hover or collapsed panels unless screen space demands it
- Element windows should be as transparent as possible when not in focus, so visuals show through
