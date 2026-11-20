// Harmoni's design system, shared with the web app's (globals.css there):
// warm neutral surfaces stacked darkest to lightest, translucent hairlines
// that work on tinted backgrounds too, text in three greys that all read
// on the page, and a cream accent. The artwork brings the colour.
// Space comes from a 4px grid; sections sit 36-48 apart, items 12-20.

import { Platform } from "react-native";

export const colors = {
  chrome: "#0B0B0A", // the frame around everything (behind sheets, Now Playing)
  bg: "#131312", // the page
  surface: "#1A1A19", // cards, grouped backgrounds
  surface2: "#222221", // fills: inputs, placeholders, chips
  surface3: "#2D2C2B", // pressed fills, secondary buttons
  hover: "rgba(255,255,255,0.055)",
  press: "rgba(255,255,255,0.09)",
  border: "rgba(255,255,255,0.07)", // hairlines
  borderStrong: "rgba(255,255,255,0.12)",
  text: "#F4F3F1", // label
  text2: "rgba(244,243,241,0.72)", // supporting lines
  text3: "rgba(244,243,241,0.53)", // metadata only
  text4: "rgba(244,243,241,0.2)", // disabled, placeholders on art
  accent: "#EFE6D6",
  accentInk: "#1B1813",
  tint: "#F2DDBF", // interactive text: links, "Show all"
  danger: "#FF8A7A",
  scrim: "rgba(0,0,0,0.55)",
  material: "rgba(26,25,23,0.72)", // under a blur
  materialThick: "rgba(30,29,27,0.9)",
  glass: "rgba(255,255,255,0.14)", // a pill over artwork or colour
} as const;

/** The page colour at some opacity, for fades into the page. */
export const bgAlpha = (a: number) => `rgba(19,19,18,${a})`;

export const radius = { xl: 24, lg: 16, md: 12, sm: 8, xs: 6, pill: 999 } as const;

/** HIG text styles (sizes in dp; Outfit runs a touch small, so these match SF's optical sizes). */
export const textStyles = {
  largeTitle: { size: 34, line: 41, weight: 700, tracking: -0.7 },
  title1: { size: 28, line: 34, weight: 700, tracking: -0.55 },
  title2: { size: 22, line: 28, weight: 700, tracking: -0.4 },
  title3: { size: 20, line: 25, weight: 600, tracking: -0.3 },
  headline: { size: 17, line: 22, weight: 600, tracking: -0.25 },
  body: { size: 17, line: 22, weight: 400, tracking: -0.25 },
  callout: { size: 16, line: 21, weight: 400, tracking: -0.2 },
  subhead: { size: 15, line: 20, weight: 400, tracking: -0.15 },
  footnote: { size: 13, line: 18, weight: 400, tracking: -0.05 },
  caption: { size: 12, line: 16, weight: 400, tracking: 0 },
  caption2: { size: 11, line: 13, weight: 500, tracking: 0.1 },
  /** Small caps over a title: "PLAYLIST", "YOUR SPICE · MORNING". Uppercase it with `Kicker`. */
  kicker: { size: 11, line: 14, weight: 600, tracking: 1.7 },
  /** The greeting and collection names: big, tight. */
  display: { size: 32, line: 35, weight: 700, tracking: -1 },
} as const;
export type TextVariant = keyof typeof textStyles;

/** Legacy size names, kept so older screens still read sensibly. */
export const type = {
  m1: 13,
  b0: 15,
  s1: 18,
  s2: 22,
  s3: 34,
  s4: 48,
} as const;

export const space = { gutter: 20, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/**
 * A bundled font's name for `fontFamily`. Android finds embedded fonts by file name
 * ("Outfit_700Bold"); iOS by the PostScript name inside the file ("Outfit-Bold").
 */
const POSTSCRIPT: Record<string, string> = {
  Outfit_400Regular: "Outfit-Regular",
  Outfit_500Medium: "Outfit-Medium",
  Outfit_600SemiBold: "Outfit-SemiBold",
  Outfit_700Bold: "Outfit-Bold",
  Outfit_800ExtraBold: "Outfit-ExtraBold",
  Fraunces_700Bold: "Fraunces-Bold",
  PlayfairDisplay_700Bold: "PlayfairDisplay-Bold",
  SpaceGrotesk_700Bold: "SpaceGrotesk-Bold",
  BricolageGrotesque_700Bold: "BricolageGrotesque-Bold",
  Nunito_800ExtraBold: "Nunito-ExtraBold",
  JetBrainsMono_700Bold: "JetBrainsMono-Bold",
  BebasNeue_400Regular: "BebasNeue-Regular",
  Caveat_700Bold: "Caveat-Bold",
  Silkscreen_400Regular: "Silkscreen-Regular",
};

export function font(file: string): string {
  return Platform.OS === "ios" ? (POSTSCRIPT[file] ?? file) : file;
}

/** The system's monospaced font (Android calls it "monospace"; iOS has Menlo). */
export const monospace = Platform.OS === "ios" ? "Menlo" : "monospace";

export const fonts = {
  400: font("Outfit_400Regular"),
  500: font("Outfit_500Medium"),
  600: font("Outfit_600SemiBold"),
  700: font("Outfit_700Bold"),
  800: font("Outfit_800ExtraBold"),
} as const;

export type Weight = keyof typeof fonts;

/**
 * Motion, after iOS: springs, not curves. `duration` is how long it takes to
 * settle; `dampingRatio` below 1 overshoots a little.
 */
export const spring = {
  /** Buttons and small things: quick, barely any overshoot. */
  snappy: { duration: 380, dampingRatio: 0.86 },
  /** Sheets and big moves: no overshoot. */
  smooth: { duration: 520, dampingRatio: 1 },
  /** Things that land: a little bounce. */
  bouncy: { duration: 620, dampingRatio: 0.7 },
  /** Press feedback. */
  press: { duration: 260, dampingRatio: 0.92 },
} as const;

/** Arrive fast, settle slow (quint out); leave quicker than you came. Durations in ms. */
export const motion = {
  fast: 160,
  medium: 280,
  slow: 480,
  slower: 720,
  ease: [0.22, 1, 0.36, 1] as const,
  easeIn: [0.5, 0, 0.75, 0] as const,
};

export const layout = {
  tabBar: 64,
  miniPlayer: 64,
};
