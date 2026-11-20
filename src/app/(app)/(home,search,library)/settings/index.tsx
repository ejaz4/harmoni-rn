import { router } from "expo-router";
import { Platform, View } from "react-native";

import { Avatar } from "@/profile/Avatar";
import { Group, Row } from "@/settings/parts";
import { useSession } from "@/state/session";
import { Icon, type IconName } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { colors } from "@/ui/theme";

interface Category {
  label: string;
  icon: IconName;
  href: string;
}

// Settings' categories, as the web groups them (settings/nav.tsx there), plus
// a group for what only the phone has. Each opens a page of its own. The
// server's own settings (for admins) stay on the web.
function useCategories(): { heading?: string; categories: Category[] }[] {
  const me = useSession((s) => s.me);
  const f = me?.server.features;
  return [
    { categories: [{ label: "Privacy & security", icon: "shield", href: "/settings/privacy" }] },
    {
      heading: "Listening",
      categories: [
        { label: "Playback", icon: "headphone", href: "/settings/playback" },
        { label: "Recommendations", icon: "sparkle", href: "/settings/recommendations" },
        ...(f?.link !== false ? [{ label: "Harmoni Link", icon: "link", href: "/settings/link" }] : []),
        { label: "Import music", icon: "arrow-down", href: "/settings/import" },
      ],
    },
    {
      heading: "This phone",
      categories: [
        { label: "Downloads & data", icon: "download", href: "/settings/downloads" },
        { label: "Look & feel", icon: "palette", href: "/settings/feel" },
        { label: Platform.OS === "android" ? "Controls & widget" : "Controls", icon: "phone", href: "/settings/controls" },
        { label: "Updates", icon: "refresh", href: "/settings/updates" },
      ],
    },
    {
      heading: "More",
      categories: [
        ...(me?.server.canInvite ? [{ label: "Invite people", icon: "user-plus", href: "/settings/invites" }] : []),
        { label: "Developer", icon: "info", href: "/settings/developer" },
      ],
    },
  ] as { heading?: string; categories: Category[] }[];
}

export default function Settings() {
  const me = useSession((s) => s.me);
  const groups = useCategories();
  return (
    <Screen back title="Settings" large>
      <Press
        onPress={() => router.push("/settings/account" as never)}
        feedback="tap"
        scaleTo={0.98}
        highlight={colors.hover}
        accessibilityLabel="Account"
        style={{ marginTop: 8, flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: 18, backgroundColor: colors.surface }}
      >
        <Avatar name={me?.name ?? ""} url={me?.avatarUrl} accent={me?.accent} size={52} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="headline" numberOfLines={1}>
            {me?.name ?? " "}
          </Text>
          <Text variant="footnote" color={colors.text2} numberOfLines={1}>
            {me ? `@${me.username} · Account` : "Account"}
          </Text>
        </View>
        <Icon name="chevron-right" size={17} color={colors.text3} />
      </Press>

      {groups.map((g) => (
        <Group key={g.heading ?? "you"} title={g.heading}>
          {g.categories.map((c, i) => (
            <Row
              key={c.label}
              first={i === 0}
              title={c.label}
              icon={c.icon}
              onPress={() => router.push(c.href as never)}
            />
          ))}
        </Group>
      ))}
    </Screen>
  );
}

