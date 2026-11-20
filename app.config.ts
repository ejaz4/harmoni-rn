import type { ConfigContext, ExpoConfig } from "expo/config";

// app.json holds the config; this adds what CI decides per build.
//   VERSION_CODE  Android versionCode (CI uses the run number, so each build upgrades the last)
//   APP_VERSION   the version people see (CI uses 1.0.<run number>, matching the release tag)
//   LINK_HOSTS    servers whose links (/u/…, /song/…, /playlist/…) open in the app; comma-separated
const LINK_HOSTS: string[] = String(process.env.LINK_HOSTS || "music.ceccun.com")
  .split(",")
  .map((h: string) => h.trim())
  .filter(Boolean);
const LINK_PATHS = ["/u/", "/song/", "/playlist/", "/spice/", "/album/", "/artist/"];

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  version: process.env.APP_VERSION || config.version,
  ios: {
    ...config.ios,
    buildNumber: String(process.env.VERSION_CODE || config.ios?.buildNumber || 1),
    // The same links on iOS (Universal Links): the server publishes
    // /.well-known/apple-app-site-association. Needs a signed build to take effect.
    associatedDomains: LINK_HOSTS.map((host: string) => `applinks:${host}`),
  },
  android: {
    ...config.android,
    versionCode: Number(process.env.VERSION_CODE || config.android?.versionCode || 1),
    // Links to the web app open the matching screen here. Android verifies them when the
    // server publishes /.well-known/assetlinks.json; until then people can turn them on
    // in Settings (Open Harmoni links).
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        category: ["BROWSABLE", "DEFAULT"],
        data: LINK_HOSTS.flatMap((host: string) => LINK_PATHS.map((pathPrefix) => ({ scheme: "https", host, pathPrefix }))),
      },
    ],
  },
  plugins: [...(config.plugins ?? []), "./plugins/withReleaseSigning"],
});
