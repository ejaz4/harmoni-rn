import { Stack } from "expo-router/js-stack";
import { Platform, useWindowDimensions, type Animated } from "react-native";

import { colors } from "@/ui/theme";

export const unstable_settings = {
  anchor: "index",
  search: { anchor: "search" },
  library: { anchor: "library" },
};

/**
 * A push, as on iOS: the page slides in from the right on a spring (a flick
 * carries its speed), the one behind drifts a third of the way left and dims,
 * and you can drag a page back from anywhere on its left half. Android's own
 * "iOS" animation is a fixed 200 ms slide with none of that.
 */
const push = {
  animation: "spring" as const,
  config: { stiffness: 420, damping: 41, mass: 1, overshootClamping: true, restDisplacementThreshold: 0.5, restSpeedThreshold: 0.5 },
};

type Progress = Animated.AnimatedInterpolation<number>;

function card({
  current,
  next,
  layouts: { screen },
}: {
  current: { progress: Progress };
  next?: { progress: Progress };
  layouts: { screen: { width: number } };
}) {
  const w = screen.width;
  const enter = current.progress.interpolate({ inputRange: [0, 1], outputRange: [w, 0], extrapolate: "clamp" });
  const leave = next ? next.progress.interpolate({ inputRange: [0, 1], outputRange: [0, -w * 0.3], extrapolate: "clamp" }) : 0;
  return {
    cardStyle: {
      transform: [{ translateX: enter }, { translateX: leave }],
      // A soft shadow down the moving page's edge (Android draws it from elevation).
      elevation: 14,
      shadowColor: "#000",
      // iOS needs the rest spelled out (and the shadow cast left, onto the page behind).
      ...(Platform.OS === "ios" ? { shadowOffset: { width: -2, height: 0 }, shadowRadius: 10, shadowOpacity: 0.35 } : null),
    },
    overlayStyle: {
      opacity: current.progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.38], extrapolate: "clamp" }),
    },
  };
}

export default function TabStack({ segment }: { segment: string }) {
  const root = segment === "(search)" ? "search" : segment === "(library)" ? "library" : "index";
  const { width } = useWindowDimensions();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        cardStyle: { backgroundColor: colors.bg },
        cardOverlayEnabled: true,
        gestureEnabled: true,
        gestureDirection: "horizontal",
        gestureResponseDistance: Math.round(width * 0.5),
        gestureVelocityImpact: 0.4,
        transitionSpec: { open: push, close: push },
        cardStyleInterpolator: card,
      }}
    >
      <Stack.Screen name={root} />
    </Stack>
  );
}
