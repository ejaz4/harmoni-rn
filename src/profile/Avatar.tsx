import { Image } from "expo-image";
import { memo } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { serverOrigin } from "@/api/client";
import { Text } from "@/ui/Text";
import { iosShadow } from "@/ui/shadow";
import { colors, fonts } from "@/ui/theme";
import { inkFor } from "./style";

/** A media path from the server ("/api/media/x.webp", public) as a full URL. */
export function mediaUrl(path: string | undefined): string | undefined {
  if (!path) return undefined;
  return /^https?:/.test(path) ? path : `${serverOrigin() ?? ""}${path}`;
}

/** Someone's picture, or their initial on their colour. */
export const Avatar = memo(function Avatar({
  name,
  url,
  accent,
  size,
  ring,
  style,
}: {
  name: string;
  url?: string;
  accent?: string;
  size: number;
  /** A ring in their colour, set off from the page (the big one on a profile). */
  ring?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const src = mediaUrl(url);
  const bg = src ? colors.surface2 : (accent ?? colors.surface3);
  const initial = [...name.trim()][0]?.toUpperCase() || "·";
  const face = (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        overflow: "hidden",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {src ? (
        <Image
          source={{ uri: src }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={160}
          cachePolicy="memory-disk"
          recyclingKey={src}
        />
      ) : (
        <Text
          size={size * 0.42}
          weight={600}
          color={accent ? inkFor(accent) : colors.text}
          style={{ lineHeight: size * 0.5, fontFamily: fonts[600] }}
        >
          {initial}
        </Text>
      )}
    </View>
  );
  if (!ring) return <View style={style}>{face}</View>;
  const gap = Math.max(3, size * 0.035);
  const line = Math.max(2, size * 0.014);
  const outer = size + (gap + line) * 2;
  return (
    <View
      style={[
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          borderWidth: line,
          borderColor: accent ?? colors.surface3,
          padding: gap,
          backgroundColor: colors.bg,
        },
        { elevation: 18, shadowColor: "#000", ...iosShadow(18) },
        style,
      ]}
    >
      {face}
    </View>
  );
});
