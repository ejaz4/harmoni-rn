import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from "react-native";
import Animated, { FadeIn, LinearTransition, ZoomIn, ZoomOut } from "react-native-reanimated";

import { Api } from "@/api/endpoints";
import type { Song, Spice } from "@/api/types";
import { haptic } from "@/lib/haptics";
import { streamSearch } from "@/search/stream";
import { useDockHeight } from "@/shell/layout";
import { libraryChanged } from "@/state/collections";
import { Artwork } from "@/ui/Artwork";
import { ExplicitBadge, SongRowsSkeleton } from "@/ui/bits";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/overlays";
import { Press } from "@/ui/Press";
import { Screen } from "@/ui/Screen";
import { Spinner } from "@/ui/Spinner";
import { Text } from "@/ui/Text";
import { iosShadow } from "@/ui/shadow";
import { colors, fonts } from "@/ui/theme";
import { autoName, useSpiceDraft } from "./draft";
import { SpiceArt } from "./SpiceArt";

/** New Spice (no `spice`) or Change seeds (with one). */
export function SeedPicker({ spice }: { spice?: Spice }) {
  const dock = useDockHeight();
  const [picked, setPicked] = useState<Song[]>(() => (spice ? spice.seeds : useSpiceDraft.getState().seeds));
  const [name, setName] = useState(spice && !spice.autoNamed ? spice.name : "");
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Song[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nameFocus, setNameFocus] = useState(false);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const suggestions = useQuery({ queryKey: ["spice-suggestions"], queryFn: Api.spiceSuggestions });

  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    if (!query) {
      setResults(null);
      return;
    }
    const abort = new AbortController();
    setSearching(true);
    streamSearch(
      query,
      (s) => {
        if (abort.signal.aborted) return;
        if (s.results.length || s.done) setResults(s.results);
        if (s.done) setSearching(false);
      },
      abort.signal,
    ).catch(() => !abort.signal.aborted && setSearching(false));
    return () => abort.abort();
  }, [query]);

  const isPicked = (s: Song) => picked.some((p) => p.id === s.id);
  const toggle = (s: Song) => {
    if (isPicked(s)) {
      haptic.toggleOff();
      setPicked((p) => p.filter((x) => x.id !== s.id));
    } else {
      if (picked.length >= 50) return toast("That's plenty: 50 songs at most.");
      haptic.toggleOn();
      setPicked((p) => [...p, s]);
    }
  };

  const auto = autoName(picked);
  const shownName = name.trim() || (picked.length ? auto : "Your Spice");
  const list = query ? results : (suggestions.data ?? null);

  const done = async () => {
    if (!picked.length || busy) return;
    setBusy(true);
    Keyboard.dismiss();
    try {
      if (!spice) {
        const s = await Api.createSpice(
          picked.map((p) => p.id),
          name.trim() || undefined,
        );
        useSpiceDraft.setState({ seeds: [] });
        libraryChanged();
        router.replace(`/spice/${s.id}`);
      } else {
        await Api.setSeeds(
          spice.id,
          picked.map((p) => p.id),
        );
        const wanted = name.trim() || null;
        const had = spice.autoNamed ? null : spice.name;
        if (wanted !== had) await Api.renameSpice(spice.id, wanted);
        libraryChanged();
        router.back();
      }
    } catch {
      toast(spice ? "Couldn't save that. Try again?" : "Couldn't create the Spice.", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
      <Screen back keyboardShouldPersistTaps="handled">
        <View style={{ paddingTop: 8, marginBottom: 24 }}>
          <Text variant="subhead" weight={600} color={colors.tint}>
            {spice ? spice.name : "New Spice"}
          </Text>
          <Text variant="title1" style={{ marginTop: 4, marginBottom: 8 }}>
            {spice ? "Change what it grows from" : "What should it taste like?"}
          </Text>
          <Text variant="callout" color={colors.text2}>
            {spice
              ? "Add songs or take some away. It remakes itself from them the next time you open it."
              : "Pick a few songs you love. Harmoni grows a mix from them, and makes it fresh every day."}
          </Text>
        </View>

        {picked.length ? (
          <Animated.View
            layout={LinearTransition.duration(200)}
            style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}
          >
            {picked.map((s) => (
              <Animated.View
                key={s.id}
                entering={ZoomIn.springify().damping(18)}
                exiting={ZoomOut.duration(160)}
                layout={LinearTransition.springify().damping(20)}
                style={{
                  height: 36,
                  borderRadius: 999,
                  backgroundColor: colors.surface2,
                  paddingLeft: 4,
                  paddingRight: 2,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  maxWidth: "100%",
                }}
              >
                <Artwork url={s.artworkUrl} size={28} round />
                <Text variant="subhead" weight={500} numberOfLines={1} style={{ maxWidth: 170 }}>
                  {s.title}
                </Text>
                <Press
                  onPress={() => toggle(s)}
                  feedback={false}
                  scaleTo={0.85}
                  accessibilityLabel={`Remove ${s.title}`}
                  style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" }}
                >
                  <Icon name="close" size={14} color={colors.text2} />
                </Press>
              </Animated.View>
            ))}
          </Animated.View>
        ) : null}

        <Animated.View layout={LinearTransition.duration(220)}>
          <View
            style={{
              height: 38,
              borderRadius: 12,
              backgroundColor: "rgba(255,255,255,0.1)",
              flexDirection: "row",
              alignItems: "center",
              paddingLeft: 10,
              paddingRight: 4,
              gap: 6,
              marginBottom: 28,
            }}
          >
            <Icon name="search" size={17} color={colors.text2} />
            <TextInput
              ref={input}
              value={text}
              onChangeText={setText}
              placeholder="Search for a song to add"
              placeholderTextColor={colors.text3}
              selectionColor={colors.tint}
              cursorColor={colors.tint}
              returnKeyType="search"
              autoCorrect={false}
              onSubmitEditing={() => Keyboard.dismiss()}
              style={{ flex: 1, color: colors.text, fontFamily: fonts[400], fontSize: 17, paddingVertical: 0 }}
            />
            {searching ? <Spinner size={18} color={colors.text2} /> : null}
            {text ? (
              <Press
                onPress={() => setText("")}
                accessibilityLabel="Clear"
                scaleTo={0.85}
                style={{ width: 36, height: 36, alignItems: "center", justifyContent: "center" }}
              >
                <Icon name="close" size={18} color={colors.text2} />
              </Press>
            ) : null}
          </View>

          <Text variant="title2" style={{ marginBottom: 8 }}>
            {query ? "Songs" : "From your listening"}
          </Text>
          {!list ? (
            <SongRowsSkeleton n={6} />
          ) : !list.length ? (
            <Text variant="callout" color={colors.text2} style={{ paddingVertical: 24 }}>
              {query
                ? `Nothing turned up for “${query}”. Try the artist's name on its own.`
                : "Start by searching for a song you love. Once you've been listening a while, your favourites show up here to pick from."}
            </Text>
          ) : (
            <Animated.View entering={FadeIn.duration(200)}>
              {list.map((s) => (
                <PickRow key={s.id} song={s} picked={isPicked(s)} onPress={() => toggle(s)} />
              ))}
            </Animated.View>
          )}
          <View style={{ height: 120 }} />
        </Animated.View>
      </Screen>

      <View
        style={{
          position: "absolute",
          left: 12,
          right: 12,
          bottom: dock + 10,
          borderRadius: 22,
          backgroundColor: "#242321",
          padding: 10,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          elevation: 16,
          ...iosShadow(16),
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: "rgba(255,255,255,0.08)",
        }}
      >
        <View style={{ width: 48, height: 48, borderRadius: 8, overflow: "hidden" }}>
          <SpiceArt name={shownName} covers={picked.map((p) => p.artworkUrl).filter(Boolean) as string[]} label={false} />
        </View>
        <View style={{ flex: 1 }}>
          <TextInput
            value={name}
            onChangeText={setName}
            maxLength={60}
            placeholder={picked.length ? auto : "Your Spice"}
            placeholderTextColor={nameFocus ? colors.text3 : colors.text}
            onFocus={() => setNameFocus(true)}
            onBlur={() => setNameFocus(false)}
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            accessibilityLabel="Name (optional)"
            style={{
              color: colors.text,
              fontFamily: fonts[600],
              fontSize: 16,
              paddingVertical: 0,
              borderBottomWidth: nameFocus ? 1 : 0,
              borderColor: colors.borderStrong,
            }}
          />
          <Text variant="footnote" color={colors.text2}>
            {!picked.length ? "Pick a song to start" : picked.length < 3 ? "Add a couple more" : "Ready when you are"}
          </Text>
        </View>
        <Press
          onPress={done}
          disabled={!picked.length || busy}
          feedback="confirm"
          scaleTo={0.95}
          style={{
            height: 44,
            paddingHorizontal: 20,
            borderRadius: 999,
            backgroundColor: colors.accent,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            opacity: !picked.length || busy ? 0.4 : 1,
          }}
        >
          {busy ? <Spinner size={18} color={colors.accentInk} /> : <Icon name="spice" size={18} color={colors.accentInk} />}
          <Text variant="callout" weight={600} color={colors.accentInk}>
            {spice ? "Save" : "Make it"}
          </Text>
        </Press>
      </View>
    </KeyboardAvoidingView>
  );
}

function PickRow({ song, picked, onPress }: { song: Song; picked: boolean; onPress: () => void }) {
  return (
    <Press
      onPress={onPress}
      feedback={false}
      scaleTo={1}
      highlight="rgba(255,255,255,0.06)"
      style={{ flexDirection: "row", alignItems: "center", gap: 14, minHeight: 64, paddingHorizontal: 20, marginHorizontal: -20 }}
    >
      <Artwork url={song.artworkUrl} size={48} radius={6} />
      <View style={{ flex: 1, alignSelf: "stretch", flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text variant="callout" weight={500} numberOfLines={1} style={{ flexShrink: 1 }}>
              {song.title}
            </Text>
            {song.explicit ? <ExplicitBadge /> : null}
          </View>
          <Text variant="subhead" color={colors.text2} numberOfLines={1}>
            {song.artists.map((a) => a.name).join(", ")}
          </Text>
        </View>
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: picked ? colors.tint : "transparent",
            borderWidth: picked ? 0 : 1.5,
            borderColor: colors.text3,
          }}
        >
          <Icon name={picked ? "check" : "plus"} size={15} color={picked ? colors.accentInk : colors.text2} />
        </View>
        <View
          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border }}
        />
      </View>
    </Press>
  );
}
