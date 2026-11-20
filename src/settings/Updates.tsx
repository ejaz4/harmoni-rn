import Native from "harmoni-player";
import type { ReactNode } from "react";
import { Platform, View } from "react-native";

import { bytes, shortDate } from "@/lib/format";
import { SmallButton, Switch } from "@/ui/bits";
import { Spinner } from "@/ui/Spinner";
import { Text } from "@/ui/Text";
import { colors } from "@/ui/theme";
import { openUpdateSheet, ProgressBar } from "@/update/UpdateSheet";
import { checkForUpdate, currentBuild, currentVersion, downloadUpdate, retryUpdate, updatesHere, useUpdate } from "@/update/updater";
import { Group, Row, useKvSwitch } from "./parts";

function checkedAgo(at: number) {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} hr ago` : shortDate(new Date(at).toISOString());
}

/** This version, whether there's a newer one (and getting it), and whether updates download by themselves. */
export function Updates() {
  const s = useUpdate();
  const [auto, setAuto] = useKvSwitch("settings.autoUpdate", true);
  const version = `Harmoni for ${Platform.OS === "ios" ? "iOS" : "Android"} ${currentVersion}${currentBuild ? ` (${currentBuild})` : ""}`;
  if (!updatesHere()) {
    return (
      <Group>
        <Row first title="Version" note={version} />
      </Group>
    );
  }
  const r = s.release;
  const pct = s.total ? Math.round((s.received / s.total) * 100) : 0;
  let title = `Harmoni ${currentVersion}`;
  let note: ReactNode = s.checkedAt ? `Up to date · checked ${checkedAgo(s.checkedAt)}` : "Look for a newer version.";
  let action: ReactNode = <SmallButton label="Check" onPress={() => checkForUpdate({ manual: true })} />;
  if (s.phase === "checking") {
    note = "Checking…";
    action = <Spinner size={20} color={colors.text2} />;
  } else if (s.phase === "failed") {
    title = r ? `Harmoni ${r.version}` : "Couldn't check for updates";
    note = s.error;
    action = <SmallButton label="Try Again" onPress={retryUpdate} />;
  } else if (r && s.phase === "available") {
    title = `Harmoni ${r.version} is out`;
    note = `${bytes(r.size)} · you have ${currentVersion}`;
    action = <SmallButton label="Get" onPress={openUpdateSheet} />;
  } else if (r && (s.phase === "downloading" || s.phase === "verifying")) {
    title = `Downloading Harmoni ${r.version}`;
    note = (
      <View style={{ gap: 8, paddingTop: 4 }}>
        <ProgressBar value={s.total ? s.received / s.total : 0} />
        <Text variant="footnote" color={colors.text2}>
          {s.phase === "verifying" ? "Checking the download…" : `${bytes(s.received)} of ${bytes(s.total)} · ${pct}%`}
        </Text>
      </View>
    );
    action = null;
  } else if (r && s.phase === "ready") {
    title = `Harmoni ${r.version} is ready`;
    note = `Downloaded · you have ${currentVersion}`;
    action = <SmallButton label="Update" onPress={openUpdateSheet} />;
  } else if (r && s.phase === "installing") {
    title = `Updating to Harmoni ${r.version}`;
    note = "Android is installing it.";
    action = null; // the row opens the sheet, which can start again
  }
  return (
    <Group note={`${version}. New versions come from Harmoni's releases on GitHub.`}>
      <Row first title={title} note={note} onPress={r && !action ? openUpdateSheet : undefined}>
        {action}
      </Row>
      <Row title="Download updates automatically" note="On Wi‑Fi. Harmoni still asks before it installs one.">
        <Switch
          value={auto}
          onChange={(v) => {
            setAuto(v);
            if (v && s.phase === "available" && !Native.networkMetered()) downloadUpdate();
          }}
        />
      </Row>
    </Group>
  );
}

