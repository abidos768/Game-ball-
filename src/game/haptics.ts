/**
 * Haptic feedback.
 *
 * Uses the Vibration API directly rather than a Capacitor plugin: the app is
 * Android-only, navigator.vibrate is supported in the WebView, and it costs no
 * extra dependency. Requires android.permission.VIBRATE in the manifest -
 * without it every call silently no-ops.
 *
 * Patterns are deliberately short. Anything over ~60ms on a frequent event
 * reads as the phone malfunctioning rather than as feedback, so the common
 * events are 10-25ms and only rare ones get a pattern.
 */

const KEY = 'neon-cell-haptics';

let enabled = true;

try {
  enabled = localStorage.getItem(KEY) !== '0';
} catch {
  enabled = true;
}

const supported = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

function buzz(pattern: number | number[]) {
  if (!enabled || !supported()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some devices throw when vibration is disabled system-wide.
  }
}

export const haptics = {
  /** Menu taps and toggles. Barely perceptible by design. */
  tap: () => buzz(10),
  /** Power-up pickup - noticeable but not intrusive. */
  powerup: () => buzz(18),
  /** Eating an enemy cell. */
  kill: () => buzz(22),
  /** Boss down: two beats so it reads as an event, not a hit. */
  bossKill: () => buzz([30, 40, 60]),
  /** Taking damage - the one moment a firm buzz is warranted. */
  hurt: () => buzz(45),
  /** Level up. */
  levelUp: () => buzz([15, 50, 15]),
  /** Trophy unlocked. */
  trophy: () => buzz([12, 40, 12, 40, 25]),
  /** Death. The longest pattern in the game, and the rarest. */
  gameOver: () => buzz([70, 60, 120]),
  /** Final seconds of the revive countdown. */
  countdown: () => buzz(14),
};

export function hapticsSupported() {
  return supported();
}

export function isHapticsEnabled() {
  return enabled;
}

export function setHapticsEnabled(next: boolean) {
  enabled = next;
  try {
    localStorage.setItem(KEY, next ? '1' : '0');
  } catch {
    // Storage unavailable - the setting just won't survive a restart.
  }
  if (!next && supported()) {
    try {
      navigator.vibrate(0); // cancel anything mid-pattern
    } catch { /* ignore */ }
  }
}

export function toggleHaptics() {
  setHapticsEnabled(!enabled);
  return enabled;
}
