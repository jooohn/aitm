# Shared Icon Components

**Date:** 2026-04-06
**Status:** accepted

## Context

Inline SVG icons were scattered across multiple components, duplicating the same paths in several places. This made icons hard to find, inconsistent in sizing/props, and tedious to update.

## Decision

All icons must be defined as shared React components under `src/app/components/icons/`. Each icon is a standalone file (e.g. `GitHubIcon.tsx`, `TrashIcon.tsx`) that accepts a `size` prop and optional `className`/`style` as needed.

Rules:

- **Never inline SVG icons** directly in component JSX.
- **Always create a shared icon component** in `src/app/components/icons/` and import it.
- Each icon component owns its SVG markup and exposes a minimal props interface (`size`, `className`, `style`).
- The `WorkflowStepDiagram` SVG and similar non-icon illustrations are excluded from this rule — this applies only to reusable icon-sized graphics.

## Consequences

- Single source of truth for each icon — updating a path or default size is a one-line change.
- Consistent API across all icons (`size` prop with a sensible default).
- Easy to discover available icons by browsing `src/app/components/icons/`.

## Alternatives considered

- **Icon library (lucide-react, react-icons):** Adds a dependency and limits customisation. The project currently uses few icons, so a library is unnecessary overhead.
- **Single sprite sheet / symbol map:** More complex setup for marginal benefit at the current icon count.
