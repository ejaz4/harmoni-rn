import Native from "harmoni-player";
import { useState } from "react";
import { Platform, View } from "react-native";

import { Api } from "@/api/endpoints";
import { kv } from "@/lib/storage";
import { dropAutoplaySongs } from "@/player/player";
import { Group, OffHere, Row, SettingsPage, useKvSwitch } from "@/settings/parts";
import { useNativePref } from "@/settings/prefs";
import { useSession } from "@/state/session";
import { Switch } from "@/ui/bits";
import { toast } from "@/ui/overlays";
import { Stepper } from "@/ui/Stepper";
import { Text } from "@/ui/Text";
import { colors } from "@/ui/theme";

/** iOS's player can't skip silence, and iOS always stops an app's music when it's swiped away. */
const ANDROID = Platform.OS === "android";

export default function PlaybackSettings() {
  const me = useSession((s) => s.me);
  const setMe = useSession((s) => s.setMe);
  const [fade, setFade] = useState(() => kv.get("settings.crossfade", 0));
  const [smooth, setSmooth] = useKvSwitch("settings.smoothPause", true);
  const [keepAwake, setKeepAwake] = useKvSwitch("settings.keepAwake", false);
  const [skipSilence, setSkipSilence] = useNativePref("skipSilence");
  const [alongside, setAlongside] = useNativePref("playAlongside");
  const [stopOnSwipe, setStopOnSwipe] = useNativePref("stopOnSwipe");

  const autoplay = async (v: boolean) => {
    if (!me) return;
    setMe({ ...me, autoplay: v });
    if (!v) dropAutoplaySongs();
    try {
      setMe(await Api.updateMe({ autoplay: v }));
    } catch {
      setMe({ ...me, autoplay: !v });
      toast("Couldn't change Autoplay.", "error");
    }
  };

  return (
    <SettingsPage title="Playback">
      <Group title="Transitions" here>
        <View style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="body">Crossfade</Text>
              <Text variant="footnote" color={colors.text2}>
                Blend the end of each song into the start of the next.
              </Text>
            </View>
            <Text variant="footnote" weight={600} color={colors.text2} tabular style={{ width: 44, textAlign: "right" }}>
              {fade ? `${fade} s` : "Off"}
            </Text>
          </View>
          <Stepper
            label="Crossfade"
            value={fade}
            min={0}
            max={12}
            onChange={(v) => {
              setFade(v);
              kv.set("settings.crossfade", v);
              Native.setCrossfade(v);
            }}
          />
        </View>
        <Row title="Smooth play and pause" note="Fade the volume in and out instead of cutting it.">
          <Switch
            value={smooth}
            onChange={(v) => {
              setSmooth(v);
              Native.setSmooth(v);
            }}
          />
        </Row>
      </Group>

      <Group title="Queue">
        <Row first title="Autoplay" note="When your queue ends, keep playing similar songs.">
          {me?.server.features.autoplay === false ? <OffHere /> : <Switch value={!!me?.autoplay} onChange={autoplay} />}
        </Row>
      </Group>

      <Group title="Sound" here>
        {ANDROID ? (
          <Row first title="Skip silence" note="Trim the quiet at the start and end of songs.">
            <Switch value={skipSilence} onChange={setSkipSilence} />
          </Row>
        ) : null}
        <Row first={!ANDROID} title="Play alongside other apps" note="Keep playing when another app makes a sound, instead of pausing.">
          <Switch value={alongside} onChange={setAlongside} />
        </Row>
        {Native.hasEqualizer() ? <Row title="Equalizer" note="Shape the sound with your phone's equalizer." onPress={() => Native.openEqualizer()} /> : null}
      </Group>

      {ANDROID ? (
        <Group title="When you leave" here>
          <Row first title="Stop when swiped away" note="Swiping Harmoni out of your recent apps stops the music too.">
            <Switch value={stopOnSwipe} onChange={setStopOnSwipe} />
          </Row>
        </Group>
      ) : null}

      <Group title="Lyrics" here>
        <Row first title="Keep screen on" note="Stop the screen dimming while lyrics are open.">
          <Switch value={keepAwake} onChange={setKeepAwake} />
        </Row>
      </Group>
    </SettingsPage>
  );
}
