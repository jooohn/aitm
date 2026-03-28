# Use CSS Modules with @apply for Component Styles

**Date:** 2026-03-28
**Status:** accepted

## Context

Components written with inline Tailwind class strings mix visual styling with logical behavior, making the TSX harder to read. We wanted to separate styling concerns so component files focus on logic and structure.

## Decision

Co-locate a `ComponentName.module.css` file alongside each component. Use Tailwind's `@apply` directive to define semantic class names. Import and reference via the `styles` object in TSX.

Example:
```css
/* RepositoryRow.module.css */
.validateButton {
  composes: button;
  @apply border-zinc-300 text-zinc-700 hover:bg-zinc-50;
}
```
```tsx
<button className={styles.validateButton}>Validate</button>
```

CSS Modules' `composes` is used for shared base styles within the same file.

## Consequences

- TSX files contain only semantic class references (`styles.form`, `styles.input`), keeping logic readable
- Styling lives in `.module.css` files next to the component
- `@apply` with dark mode and pseudo-class variants (`disabled:`, `hover:`) works correctly in Tailwind v4
- CSS Modules scopes class names locally, avoiding collisions
- Tailwind's JIT purging still works since classes appear in `.module.css` files that are processed by PostCSS

## Alternatives considered

- **Style constants file** (`Component.styles.ts` exporting class name strings): No new file format, purely TypeScript. Rejected because CSS Modules provide actual CSS scoping and are a first-class Next.js feature.
- **`cva` (class-variance-authority)**: Excellent for variant-based components. Deferred until components have meaningful variants that warrant the dependency.
- **Inline Tailwind classes**: Simple but mixes styling with logic; not sustainable as components grow.
