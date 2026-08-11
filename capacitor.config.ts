import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // PERMANENT. Cannot be changed after your first Play Store upload,
  // and cannot be reused even if the app is deleted.
  appId: 'com.abidos.neoncellsurvival',
  appName: 'Neon Cell Survival',
  webDir: 'dist',

  android: {
    // Matches COLORS.bg in Game.tsx so there is no white flash on launch.
    backgroundColor: '#020617',
    allowMixedContent: false,
    captureInput: true,
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: '#020617',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersiveType: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#020617',
      overlaysWebView: false,
    },
  },
};

export default config;
