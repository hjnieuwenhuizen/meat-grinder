import type { CapacitorConfig } from '@capacitor/cli'

// Thin native shell: the app itself is loaded live from Firebase Hosting, so
// normal web deploys reach the Android app instantly. The shell only adds
// native bridges (Health Connect). webDir is a committed stub — unused at
// runtime because server.url wins.
const config: CapacitorConfig = {
  appId: 'com.meatgrinder.app',
  appName: 'Meat Grinder',
  webDir: 'www',
  server: {
    url: 'https://meat-grinder-88722.web.app',
    androidScheme: 'https',
  },
  backgroundColor: '#0b0f0d',
}

export default config
