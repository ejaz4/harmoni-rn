import Native from "harmoni-player";
import { Platform } from "react-native";

import { LinksRow } from "@/settings/LinksRow";
import { Group, Row, SettingsPage } from "@/settings/parts";
import { useNativePref } from "@/settings/prefs";
import { SmallButton, Switch } from "@/ui/bits";

/** The widget and app links are Android's; on iOS only the media controls are here. */
const ANDROID = Platform.OS === "android";

export default function ControlSettings() {
  const [heart, setHeart] = useNativePref("mediaHeart");
  return (
    <SettingsPage title={ANDROID ? "Controls & widget" : "Controls"}>
      <Group title="Media controls" here>
        <Row first title="Like button" note={
            ANDROID
              ? "A heart beside play and skip in the notification, on the lock screen and in the car."
              : "Like songs from the lock screen and Control Center."
          }>
          <Switch value={heart} onChange={setHeart} />
        </Row>
      </Group>

      {ANDROID ? (
      <Group title="Home screen" here>
        {Native.canPinWidget() ? (
          <Row first title="Widget" note="What's playing, with play, skip and back, right on your home screen.">
            <SmallButton label="Add" icon="plus" onPress={() => Native.pinWidget()} />
          </Row>
        ) : null}
        <LinksRow first={!Native.canPinWidget()} />
      </Group>
      ) : null}
    </SettingsPage>
  );
}
