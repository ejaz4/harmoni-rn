import { useRef } from "react";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { haptic } from "@/lib/haptics";
import { iosShadow } from "./shadow";
import { colors } from "./theme";

/** A stepped slider (like an <input type="range" step>): a tick under the finger at each step. */
export function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string }) {
  const width = useSharedValue(0);
  const x = useSharedValue((value - min) / (max - min));
  const last = useRef(value);
  const set = (v: number) => {
    if (v === last.current) return;
    last.current = v;
    haptic.select();
    onChange(v);
  };
  const toValue = (px: number) => {
    "worklet";
    const f = Math.max(0, Math.min(1, px / Math.max(1, width.value)));
    return Math.round(min + f * (max - min));
  };
  const pan = Gesture.Pan()
    .minDistance(0)
    .hitSlop({ top: 14, bottom: 14 })
    .onBegin((e) => {
      const v = toValue(e.x);
      x.value = withSpring((v - min) / (max - min), { damping: 20, stiffness: 300 });
      runOnJS(set)(v);
    })
    .onUpdate((e) => {
      const v = toValue(e.x);
      x.value = (v - min) / (max - min);
      runOnJS(set)(v);
    });
  const fill = useAnimatedStyle(() => ({ width: x.value * width.value }));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.value * width.value - 11 }] }));
  return (
    <GestureDetector gesture={pan}>
      <View accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ min, max, now: value }} style={{ height: 32, justifyContent: "center" }} onLayout={(e) => (width.value = e.nativeEvent.layout.width)}>
        <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: "hidden" }}>
          <Animated.View style={[{ height: 6, backgroundColor: colors.accent }, fill]} />
        </View>
        <Animated.View style={[{ position: "absolute", left: 0, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, elevation: 3, ...iosShadow(3) }, knob]} />
      </View>
    </GestureDetector>
  );
}
