/**
 * AdMob rewarded-ad wrapper — STAGED FOR v1.1, NOT WIRED IN v1.0.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS FILE IS DELIBERATELY NOT IMPORTED ANYWHERE.
 *
 * Nothing imports it, so Rollup tree-shakes it out and it contributes zero
 * bytes to the v1.0 bundle. It is here so the v1.1 work is written and reviewed
 * while the closed-testing clock runs, without altering the app being submitted.
 *
 * Do NOT `npm install @capacitor-community/admob` until v1.0 is live. Adding
 * the dependency merges INTERNET and com.google.android.gms.permission.AD_ID
 * into the manifest even when no ad is ever requested — which would make the
 * app's central claim ("collects nothing, no internet permission, cannot
 * transmit") false in the build under review.
 *
 * Activation checklist lives in the Obsidian note "Neon Cell — v1.1 Ads Plan".
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Google's official test unit. Never ship a real unit ID while developing. */
export const TEST_REWARDED_UNIT_ID = 'ca-app-pub-3940256099942544/5224354917';

export type RewardResult =
  | { ok: true }
  | { ok: false; reason: 'dismissed' | 'failed' | 'unavailable' };

/**
 * Show a rewarded ad and resolve with whether the reward was actually earned.
 *
 * Contract, and the reason this returns a result rather than taking a callback:
 * a rewarded ad has three distinct endings — earned, dismissed early, and
 * failed to load — and the revive flow must treat them differently. The current
 * stub in Game.tsx grants the reward unconditionally after 2s, which is fine
 * for a stub and wrong for production.
 *
 * The caller must grant the reward ONLY on `{ ok: true }`.
 */
export async function showRewardedAd(
  unitId: string = TEST_REWARDED_UNIT_ID,
): Promise<RewardResult> {
  // Dynamic import so this module has no static dependency on the plugin.
  // Until the package is installed this throws, and we degrade to 'unavailable'
  // rather than crashing the game.
  let AdMob: typeof import('@capacitor-community/admob').AdMob;
  let RewardAdPluginEvents: typeof import('@capacitor-community/admob').RewardAdPluginEvents;
  try {
    const mod = await import('@capacitor-community/admob');
    AdMob = mod.AdMob;
    RewardAdPluginEvents = mod.RewardAdPluginEvents;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  let earned = false;
  const listeners: Array<{ remove: () => Promise<void> }> = [];

  try {
    // The Rewarded event is the ONLY trustworthy signal that the reward was
    // earned. Ad dismissal fires regardless of whether the user watched it.
    listeners.push(
      await AdMob.addListener(RewardAdPluginEvents.Rewarded, () => {
        earned = true;
      }),
    );

    await AdMob.prepareRewardVideoAd({ adId: unitId });
    await AdMob.showRewardVideoAd();

    return earned ? { ok: true } : { ok: false, reason: 'dismissed' };
  } catch {
    return { ok: false, reason: 'failed' };
  } finally {
    // Listeners are global to the plugin; leaving them attached would stack a
    // new one on every revive and fire the handler N times on the Nth ad.
    for (const l of listeners) {
      try {
        await l.remove();
      } catch {
        /* plugin already torn down */
      }
    }
  }
}

/**
 * Call once at startup, before any ad request.
 *
 * `initializeForTesting` and the device list must be removed before release —
 * shipping with test devices configured serves test ads to real users and earns
 * nothing.
 */
export async function initAds(): Promise<boolean> {
  try {
    const { AdMob } = await import('@capacitor-community/admob');
    await AdMob.initialize({
      testingDevices: [],
      initializeForTesting: false,
    });
    return true;
  } catch {
    return false;
  }
}
