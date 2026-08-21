# Neon Cell Survival

A fast neon arcade survival game for Android. Grow your cell by eating orbs, avoid anything bigger than you, and see how long you last as the arena fills up.

Built with React + TypeScript on a `<canvas>`, wrapped for Android with Capacitor. Fully offline — the app requests no internet permission at all.

---

## Play

Drag anywhere to steer. Your cell shoots automatically at anything too big to eat. Eat green orbs to grow, gold orbs for a speed burst, and coloured power-ups for shield, magnet, freeze and radar.

You shrink slowly over time, and every hit costs size. Drop below the threshold and the run ends.

Bosses appear as you level up. Kill one and the arena expands.

---

## Features

- **Stage themes** — the arena shifts palette every three levels across six stages, easing between them rather than cutting
- **Adaptive difficulty** — enemy size, speed and power-up cadence respond to how well you're actually doing, inside a deliberately narrow band
- **Procedural audio** — all sound effects and the background music are synthesised at runtime with the Web Audio API. No audio files ship with the game
- **Haptics** — distinct vibration patterns per event, with an in-game toggle
- **Trophies and skins** — unlockables persisted to `localStorage`
- **Offline** — no network calls, no accounts, no tracking

---

## Running locally

```bash
npm install
npm run dev
```

To test on a phone on the same network:

```bash
npm run dev -- --host
```

Note that the dev server is significantly slower than a production build — unbundled modules, HMR and React StrictMode double-rendering. Judge performance from `npm run preview`, not `npm run dev`.

---

## Building for Android

Requires **JDK 21** (Gradle 8.14 / AGP 8.13 do not support newer JDKs) and the Android SDK.

```bash
npm run build
npx cap sync android
cd android
./gradlew assembleDebug      # APK for testing
./gradlew bundleRelease      # AAB for Play, needs android/keystore.properties
```

Signing reads `android/keystore.properties`, which is gitignored. Copy `android/keystore.properties.example` and fill it in.

---

## Project layout

```
src/
  components/Game.tsx    game loop, rendering, UI
  game/
    audio.ts             procedural sound effects
    music.ts             procedural background music
    haptics.ts           vibration patterns + persisted setting
    flow.ts              adaptive difficulty controller
    stages.ts            stage themes + palette interpolation
    meta.ts              skins, trophies, save data
android/                 Capacitor Android project
```

---

## Implementation notes

**Fixed timestep.** Every timer in the game is a frame count and movement is per-frame, so tying updates to `requestAnimationFrame` would make game speed equal the display refresh rate — double speed on a 120 Hz phone. `update()` runs at exactly 60 logical ticks per second; drawing happens as often as the screen allows.

**Device pixel ratio.** The canvas backing store is sized in device pixels and the context is scaled, so drawing code and touch handling both stay in CSS pixels. Resolution adapts down if measured frame times can't hold 50 fps.

**World maintenance.** The arena grows every level, so orb and enemy counts scale with its area, and entities that drift far from the player are recycled into a ring around them rather than spawned fresh — keeping totals stable without anything popping into view.

**No `shadowBlur`.** Canvas shadow blur is one of the most expensive 2D operations and its cost scales with rendered pixel area. Cells are flat fills.

---

## License

MIT — see [LICENSE](LICENSE).
