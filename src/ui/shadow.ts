import { Platform, type ViewStyle } from "react-native";

/**
 * iOS's stand-in for an Android `elevation`: iOS ignores elevation, and a bare
 * shadowColor draws nothing (shadowOpacity defaults to 0). Spread it next to the
 * existing `elevation` so Android stays as it was. Roughly Material's key light:
 * the higher the surface, the further down, softer and darker its shadow.
 */
export function iosShadow(elevation: number): ViewStyle {
  if (Platform.OS !== "ios" || elevation <= 0) return {};
  return {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: Math.round(elevation / 2) },
    shadowRadius: Math.round(elevation * 0.7 * 10) / 10,
    shadowOpacity: Math.min(0.6, 0.2 + elevation * 0.015),
  };
}
