import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { findServer, ServerError, signIn, SignInCancelled, type FoundServer } from "@/auth/auth";
import { haptic } from "@/lib/haptics";
import { kv } from "@/lib/storage";
import { useSession } from "@/state/session";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { Logo } from "@/ui/Logo";
import { Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { colors, radius } from "@/ui/theme";

/** Server address, then the server's own sign-in in a Custom Tab. */
export default function Welcome() {
  const insets = useSafeAreaInsets();
  const last = kv.get<{ origin: string; name: string } | null>("server.last", null);
  const [address, setAddress] = useState(last ? last.origin.replace(/^https:\/\//, "") : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState<FoundServer | null>(null);
  const didSignIn = useSession((s) => s.didSignIn);

  const find = async () => {
    setBusy(true);
    setError(null);
    try {
      const s = await findServer(address);
      haptic.confirm();
      setServer(s);
    } catch (e) {
      haptic.reject();
      setError(e instanceof ServerError ? e.message : "Couldn't reach that server.");
    } finally {
      setBusy(false);
    }
  };

  const go = async () => {
    if (!server) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(server);
      haptic.confirm();
      didSignIn();
    } catch (e) {
      if (!(e instanceof SignInCancelled)) {
        haptic.reject();
        setError(e instanceof Error ? e.message : "Couldn't sign in.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1, paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}
      >
        <Animated.View entering={FadeIn.duration(500)} style={{ alignItems: "flex-start", gap: 18 }}>
          <Logo size={64} />
          <View style={{ gap: 6 }}>
            <Text size={40} weight={700} style={{ letterSpacing: -1.2, lineHeight: 44 }}>
              Harmoni
            </Text>
            <Text size={17} color={colors.text2} style={{ lineHeight: 24 }}>
              Your music, from your own server.
            </Text>
          </View>
        </Animated.View>

        <View style={{ flex: 1, minHeight: 40 }} />

        {!server ? (
          <Animated.View entering={FadeInDown.duration(420)} style={{ gap: 14 }}>
            <Text size={13} color={colors.text2}>
              Server address
            </Text>
            <Input
              icon="server"
              value={address}
              onChangeText={(t) => {
                setAddress(t);
                setError(null);
              }}
              placeholder="music.example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              onSubmitEditing={() => address.trim() && find()}
              autoFocus={!last}
            />
            {error ? (
              <Text size={14} color={colors.danger} style={{ lineHeight: 20 }}>
                {error}
              </Text>
            ) : (
              <Text size={13} color={colors.text3} style={{ lineHeight: 19 }}>
                The address you use for Harmoni in a browser.
              </Text>
            )}
            <Button label="Continue" size="lg" onPress={find} loading={busy} disabled={!address.trim()} />
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.duration(420)} style={{ gap: 16 }}>
            <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, padding: 20, gap: 6, borderWidth: 1, borderColor: colors.border }}>
              <Text size={13} color={colors.text3}>
                {server.origin.replace(/^https?:\/\//, "")}
              </Text>
              <Text size={24} weight={700} style={{ letterSpacing: -0.4 }}>
                {server.setup.name || "Harmoni"}
              </Text>
              {server.setup.welcome ? (
                <Text color={colors.text2} style={{ lineHeight: 21 }}>
                  {server.setup.welcome}
                </Text>
              ) : null}
            </View>
            {error ? (
              <Text size={14} color={colors.danger} style={{ lineHeight: 20 }}>
                {error}
              </Text>
            ) : (
              <Text size={13} color={colors.text3} style={{ lineHeight: 19 }}>
                You'll sign in on {server.setup.name || "the server"}'s own page, then come right back.
                {server.setup.signups === "invite" ? " New here? You can sign up there with an invite." : ""}
                {server.setup.signups === "open" ? " New here? You can make an account there." : ""}
              </Text>
            )}
            <Button label={`Sign in to ${server.setup.name || "Harmoni"}`} size="lg" onPress={go} loading={busy} />
            <Press
              feedback="tap"
              onPress={() => {
                setServer(null);
                setError(null);
              }}
              style={{ alignSelf: "center", padding: 10 }}
            >
              <Text weight={500} color={colors.text2}>
                Use a different server
              </Text>
            </Press>
          </Animated.View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
