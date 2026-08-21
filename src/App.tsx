/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect } from 'react';

import Game from './components/Game';

export default function App() {
  useEffect(() => {
    // Native chrome setup. Both plugins are no-ops on the web, so the imports
    // are dynamic and failures are swallowed rather than crashing the game.
    void import('@capacitor/status-bar')
      .then(({ StatusBar, Style }) =>
        Promise.all([
          StatusBar.setStyle({ style: Style.Dark }),
          StatusBar.setBackgroundColor({ color: '#020617' }),
        ]),
      )
      .catch(() => {});

    // Hide the splash only once React has painted, otherwise there is a brief
    // flash of empty background between the splash and the first frame.
    void import('@capacitor/splash-screen')
      .then(({ SplashScreen }) => SplashScreen.hide())
      .catch(() => {});
  }, []);

  // h-dvh, not h-screen: on mobile browsers 100vh includes the space behind the
  // URL bar and nav bar, so the canvas grew taller than the visible area and
  // the camera centred the player below the middle of the screen.
  return (
    <div className="w-full h-dvh overflow-hidden bg-black">
      <Game />
    </div>
  );
}
