import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chiefclarity.app',
  appName: 'Chief Clarity',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
