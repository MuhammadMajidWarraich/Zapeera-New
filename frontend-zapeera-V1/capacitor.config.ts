import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.seikho.zapeera',
  appName: 'Zapeera',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // Current deployment hosts (2026-10-15): the single-host test deployment
    // lives under seikho.online. The old zapeera.com / Railway / Render hosts
    // are retired. Add Zapeera's own domain here once it is registered.
    allowNavigation: ['*.seikho.online'],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#060d1f',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#060d1f',
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#1a52c5',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
  android: {
    buildOptions: {
      keystorePath: undefined,
      keystoreAlias: undefined,
    },
  },
  ios: {
    contentInset: 'always',
  },
};

export default config;
