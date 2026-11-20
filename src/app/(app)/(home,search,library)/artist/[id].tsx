import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Api } from "@/api/endpoints";
import type { AlbumCard, Artist } from "@/api/types";
import { plural, shortDate } from "@/lib/format";
import { useArtworkColors, usePlayback } from "@/player/hooks";
import { player } from "@/player/player";
import { ArtistRow, CardLink, useGridWidth } from "@/song/cards";
import { openCollectionMenu } from "@/song/collections";
import { SongList } from "@/song/SongList";
import { Artwork, sized } from "@/ui/Artwork";
import { EmptyState, PlayButton, Section, Skeleton } from "@/ui/bits";
import { Icon } from "@/ui/Icon";
import { IconButton, Press } from "@/ui/Press";
import { Screen } from "@/ui/Screen";
import { Kicker, Text } from "@/ui/Text";
import { iosShadow } from "@/ui/shadow";
import { colors, bgAlpha } from "@/ui/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TOPBAR } from "@/shell/layout";

const KIND = { album: "Album", ep: "EP", single: "Single", compilation: "Compilation" } as const;

function compact(n: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ["artist", id], queryFn: () => Api.artist(id) });
  const a = q.data;
  return (
    <Screen back title={a?.name} titleAt={260} bleedTop padded={false} refreshing={q.isRefetching} onRefresh={() => q.refetch()}>
      {a ? (
        <Animated.View entering={FadeIn.duration(250)}>
          <Hero a={a} />
          <View style={{ paddingHorizontal: 20 }}>
            <Body a={a} />
          </View>
        </Animated.View>
      ) : q.isError ? (
        <View style={{ padding: 16, paddingTop: 120 }}>
          <EmptyState title="Artist not found" body="Try searching for them; Harmoni learns about artists as you search." />
        </View>
      ) : (
        <View>
          <Skeleton height={360} radius={0} />
          <View style={{ padding: 16, gap: 8 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={52} radius={12} />
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}

function Hero({ a }: { a: Artist }) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const theme = useArtworkColors(a.imageUrl);
  const pb = usePlayback();
  const releases = a.albums.length + a.singles.length + a.compilations.length;
  const meta = [a.fans ? `${compact(a.fans)} fans` : null, releases ? plural(releases, "release") : null].filter(Boolean).join(" · ");
  const current = !!pb.song && a.popular.some((s) => s.id === pb.song!.id);
  return (
    <View
      style={{
        minHeight: Math.max(300, Math.min(height * 0.46, 460)),
        justifyContent: "flex-end",
        paddingHorizontal: 20,
        paddingBottom: 24,
        paddingTop: insets.top + TOPBAR,
        overflow: "hidden",
      }}
    >
      {a.bannerUrl ? (
        <>
          <Image
            source={{ uri: sized(a.bannerUrl, 1024) }}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            contentPosition={{ top: "30%" }}
            transition={300}
          />
          <LinearGradient colors={[bgAlpha(0), bgAlpha(0.55), colors.bg]} locations={[0.35, 0.68, 1]} style={StyleSheet.absoluteFill} />
          <LinearGradient
            colors={[bgAlpha(0.45), bgAlpha(0)]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 0.3 }}
            style={StyleSheet.absoluteFill}
          />
        </>
      ) : (
        <LinearGradient colors={[theme?.deep ?? colors.surface2, colors.bg]} style={StyleSheet.absoluteFill} />
      )}
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 20 }}>
        {!a.bannerUrl && a.imageUrl ? (
          <View style={{ elevation: 16, shadowColor: "#000", ...iosShadow(16), borderRadius: 60 }}>
            <Artwork url={a.imageUrl} size={120} round />
          </View>
        ) : null}
        <View style={{ flex: 1, gap: 8 }}>
          <Kicker color="rgba(255,255,255,0.72)">Artist</Kicker>
          <Text
            size={a.name.length > 14 ? 38 : 46}
            weight={700}
            style={{
              letterSpacing: a.name.length > 14 ? -1.3 : -1.6,
              lineHeight: a.name.length > 14 ? 41 : 48,
              textShadowColor: "rgba(0,0,0,0.3)",
              textShadowRadius: 24,
            }}
          >
            {a.name}
          </Text>
          {meta ? (
            <Text variant="subhead" color="rgba(255,255,255,0.72)">
              {meta}
            </Text>
          ) : null}
          {a.popular.length ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 }}>
              <PlayButton
                size={56}
                label={`Play ${a.name}`}
                playing={current && pb.playing}
                onPress={() => (current ? player.toggle() : player.play(a.popular, 0))}
              />
              <IconButton
                label="Shuffle"
                onPress={() => player.play(a.popular, Math.floor(Math.random() * a.popular.length), { shuffle: true })}
              >
                <Icon name="shuffle" size={22} color="rgba(255,255,255,0.85)" />
              </IconButton>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function Pill({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press
      onPress={onPress}
      feedback="tap"
      scaleTo={1}
      dim
      hitSlop={8}
      style={{ alignSelf: "flex-start", paddingVertical: 8, marginTop: 8 }}
    >
      <Text variant="subhead" weight={600} color={colors.text2}>
        {label}
      </Text>
    </Press>
  );
}

function Grid({ title, items }: { title: string; items: AlbumCard[] }) {
  const w = useGridWidth();
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const shown = all ? items : items.slice(0, 12);
  return (
    <Section title={title}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 20 }}>
        {shown.map((al) => (
          <CardLink
            key={al.id}
            title={al.title}
            subtitle={[al.releaseDate?.slice(0, 4), al.kind ? KIND[al.kind] : null].filter(Boolean).join(" · ")}
            artwork={al.artworkUrl}
            width={w}
            collection={{ kind: "album", id: al.id, name: al.title }}
          />
        ))}
      </View>
      {items.length > 12 ? <Pill label={all ? "Show less" : `Show all ${items.length}`} onPress={() => setAll(!all)} /> : null}
    </Section>
  );
}

function Body({ a }: { a: Artist }) {
  const [more, setMore] = useState(false);
  const [bioOpen, setBioOpen] = useState(false);
  const long = (a.bio?.length ?? 0) > 420;
  return (
    <View>
      <Section title="Popular" style={{ marginTop: 8 }}>
        {a.popular.length ? (
          <>
            <SongList songs={more ? a.popular : a.popular.slice(0, 5)} numbered />
            {a.popular.length > 5 ? <Pill label={more ? "Show less" : "Show more"} onPress={() => setMore(!more)} /> : null}
          </>
        ) : (
          <Text variant="subhead" color={colors.text3}>
            No popular songs found yet.
          </Text>
        )}
      </Section>

      {a.latest ? (
        <Section title="Latest release" style={{ marginTop: 40 }}>
          <Press
            onPress={() => router.push(`/album/${a.latest!.id}`)}
            onLongPress={() =>
              openCollectionMenu(
                { kind: "album", id: a.latest!.id, name: a.latest!.title, artist: { id: a.id, name: a.name } },
                { artwork: a.latest!.artworkUrl },
              )
            }
            feedback="tap"
            scaleTo={0.98}
            style={{ flexDirection: "row", alignItems: "center", gap: 16 }}
          >
            <View style={{ elevation: 12, shadowColor: "#000", ...iosShadow(12), borderRadius: 10 }}>
              <Artwork url={a.latest.artworkUrl} size={120} radius={10} px={400} />
            </View>
            <View style={{ flex: 1, gap: 4 }}>
              <Kicker>
                {a.latest.kind ? KIND[a.latest.kind] : "Release"}
                {a.latest.releaseDate ? ` · ${shortDate(a.latest.releaseDate)}` : ""}
              </Kicker>
              <Text variant="headline" numberOfLines={2}>
                {a.latest.title}
              </Text>
              {a.latest.trackCount ? (
                <Text variant="subhead" color={colors.text2}>
                  {plural(a.latest.trackCount, "song")}
                </Text>
              ) : null}
            </View>
          </Press>
        </Section>
      ) : null}

      {a.yours.length ? (
        <Section title="Your favourites">
          <SongList songs={a.yours} />
        </Section>
      ) : null}

      <Grid title="Albums" items={a.albums} />
      <Grid title="Singles & EPs" items={a.singles} />
      <Grid title="Compilations" items={a.compilations} />

      {a.bio ? (
        <Section title="About">
          <View style={{ padding: 20, borderRadius: 20, backgroundColor: colors.surface, gap: 12 }}>
            {a.fans ? <Text variant="headline">{a.fans.toLocaleString()} fans</Text> : null}
            <Text variant="callout" color={colors.text2} style={{ lineHeight: 23 }} numberOfLines={long && !bioOpen ? 5 : undefined}>
              {a.bio}
            </Text>
            {long ? <Pill label={bioOpen ? "Show less" : "Read more"} onPress={() => setBioOpen(!bioOpen)} /> : null}
          </View>
        </Section>
      ) : null}

      {a.related.length ? (
        <Section title="Fans also like">
          <ArtistRow artists={a.related} />
        </Section>
      ) : null}
    </View>
  );
}
