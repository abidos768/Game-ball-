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
      launchShowDuration: 3000,
      // App.tsx hides it once React has painted the first frame.
      launchAutoHide: false,
      backgroundColor: '#020617',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#020617',
      overlaysWebView: false,
    },
  },
};

export default config;
