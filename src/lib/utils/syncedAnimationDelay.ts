/**
 * Returns a negative animation-delay (in ms) that aligns a CSS animation
 * to a global clock so all elements using the same duration blink in unison,
 * regardless of when they mount.
 */
export function syncedAnimationDelay(durationMs: number): string {
  return `${-(Date.now() % durationMs)}ms`;
}
