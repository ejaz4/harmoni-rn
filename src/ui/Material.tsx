import { BlurView } from "expo-blur";
import type { ComponentRef, RefObject } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors } from "./theme";

/**
 * An iOS-style material: what's behind shows through, blurred and darkened.
 * Android needs to know what to blur: pass the BlurTargetView behind it (iOS blurs whatever is behind).
 */
export function Material({ target, style, thick, intensity = 70 }: { target?: RefObject<ComponentRef<typeof View> | null>; style?: StyleProp<ViewStyle>; thick?: boolean; intensity?: number }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: "hidden" }, style]}>
      {target || Platform.OS === "ios" ? (
        <BlurView blurTarget={target} blurMethod="dimezisBlurViewSdk31Plus" intensity={intensity} blurReductionFactor={2.5} tint="dark" style={StyleSheet.absoluteFill} />
      ) : null}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: thick ? colors.materialThick : colors.material }]} />
    </View>
  );
}
