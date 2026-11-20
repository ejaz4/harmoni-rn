import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, TextInput, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import type { ArtistCard, Song } from "@/api/types";
import { useArtistImage } from "@/api/token";
import { artistLine } from "@/lib/format";
import { inkFor, useArtworkColors, usePlayback } from "@/player/hooks";
import { player } from "@/player/player";
import { pickTopArtist } from "@/search/rank";
import { streamSearch, type SearchState } from "@/search/stream";
import { searchFocus } from "@/shell/state";
import { ArtistRow } from "@/song/cards";
import { openSongMenu } from "@/song/menu";
import { openCollectionMenu, runCollection, useIsLoading, type CollectionRef } from "@/song/collections";
import { SongList } from "@/song/SongList";
import { PeopleRow } from "@/profile/people";
import { SpiceArt } from "@/spice/SpiceArt";
import { Api } from "@/api/endpoints";
import { Artwork } from "@/ui/Artwork";
import { EmptyState, PlayButton, Section, Skeleton, SongRowsSkeleton } from "@/ui/bits";
import { Icon } from "@/ui/Icon";
import { Press } from "@/ui/Press";
import { PageTitle, Screen, TopBar } from "@/ui/Screen";
import { Kicker, Text } from "@/ui/Text";
import { iosShadow } from "@/ui/shadow";
import { colors, fonts, radius } from "@/ui/theme";
import { kv } from "@/lib/storage";

export default function Search() {
  const [text, setText] = useState(kv.get("search.last", ""));
  const [query, setQuery] = useState(text);
  const [state, setState] = useState<SearchState | null>(null);
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    searchFocus.current = () => input.current?.focus();
    return () => {
      searchFocus.current = null;
    };
  }, []);

  // 450 ms after the last keystroke, like the web.
  useEffect(() => {
    const t = setTimeout(() => setQuery(text.trim()), 450);
    return () => clearTimeout(t);
  }, [text]);

  useEffect(() => {
    kv.set("search.last", query);
    if (!query) {
      setState(null);
      return;
    }
    const abort = new AbortController();
    setState({ query, results: [], providers: [], spice: null, done: false, error: null });
    streamSearch(query, (s) => !abort.signal.aborted && setState(s), abort.signal).catch(() => {
      if (!abort.signal.aborted) setState((s) => (s ? { ...s, done: true, error: "failed" } : s));
    });
    return () => abort.abort();
  }, [query]);

  const field = (
    <View
      style={{
        height: 38,
        borderRadius: 12,
        backgroundColor: "rgba(255,255,255,0.1)",
        flexDirection: "row",
        alignItems: "center",
        paddingLeft: 10,
        paddingRight: 6,
        gap: 6,
      }}
    >
      <Icon name="search" size={17} color={colors.text2} />
      <TextInput
        ref={input}
        value={text}
        onChangeText={setText}
        placeholder="Songs, artists, lyrics and more"
        placeholderTextColor={colors.text3}
        selectionColor={colors.tint}
        cursorColor={colors.tint}
        returnKeyType="search"
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        onSubmitEditing={() => {
          setQuery(text.trim());
          Keyboard.dismiss();
        }}
        style={{ flex: 1, color: colors.text, fontFamily: fonts[400], fontSize: 17, paddingVertical: 0 }}
      />
      {text ? (
        <Press
          onPress={() => {
            setText("");
            input.current?.focus();
          }}
          feedback="tap"
          scaleTo={0.85}
          hitSlop={10}
          accessibilityLabel="Clear"
          style={{ width: 28, height: 28, alignItems: "center", justifyContent: "center" }}
        >
          <View
            style={{
              width: 18,
              height: 18,
              borderRadius: 9,
              backgroundColor: colors.text3,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon name="close" size={11} color={colors.bg} />
          </View>
        </Press>
      ) : null}
    </View>
  );

  return (
    <Screen
      tab="(search)"
      topBar={<TopBar fill={field} alwaysSolid />}
      keyboardShouldPersistTaps="handled"
      onScrollBeginDrag={() => Keyboard.dismiss()}
    >
      {!state ? (
        <View>
          <PageTitle subtitle="What are you in the mood for?">Search</PageTitle>
          <EmptyState
            title="Type in the search bar up top"
            body="Songs, artists, lyrics you half remember. Harmoni checks every source at once."
            icon="search"
          />
        </View>
      ) : (
        <Results state={state} />
      )}
    </Screen>
  );
}

function Results({ state }: { state: SearchState }) {
  const { results, spice } = state;
  // People on this server, alongside the music.
  const people = useQuery({
    queryKey: ["users", state.query],
    queryFn: () => Api.users(state.query).catch(() => []),
    enabled: !!state.query,
    staleTime: 60_000,
  }).data;
  // Searching someone's username or full name: they're who you're after.
  const q = state.query.toLowerCase().replace(/^@/, "");
  const exactPerson = !!people?.some((p) => p.username.toLowerCase() === q || p.name.toLowerCase() === q);
  const peopleSection = people?.length ? (
    <Section title="People" style={exactPerson ? { marginTop: 16 } : undefined}>
      <PeopleRow users={people} />
    </Section>
  ) : null;
  const artists = useMemo(() => {
    const map = new Map<string, ArtistCard & { songs: number; cover?: string }>();
    for (const s of results) {
      for (const a of s.artists) {
        if (!a.id) continue;
        const e = map.get(a.id);
        if (e) e.songs++;
        else map.set(a.id, { id: a.id, name: a.name, songs: 1, cover: s.artworkUrl });
      }
    }
    return [...map.values()];
  }, [results]);
  const topArtist = useMemo(
    () => (results.length ? pickTopArtist(state.query, artists, results[0]) : undefined),
    [state.query, artists, results],
  );

  if (!results.length && !state.done) return <SearchSkeleton />;
  if (state.error && !results.length)
    return (
      <View style={{ marginTop: 16 }}>
        <EmptyState
          title="Search hit a snag"
          body="Something went wrong talking to the server. Give it another go in a moment."
          icon="cloud-off"
        />
      </View>
    );
  if (!results.length && people?.length) return <Animated.View entering={FadeIn.duration(200)}>{peopleSection}</Animated.View>;
  if (!results.length)
    return (
      <View style={{ marginTop: 16 }}>
        <EmptyState
          title="Nothing turned up"
          body={`No sources had anything for “${state.query}”. Check the spelling, or try the artist's name on its own.`}
        />
      </View>
    );

  return (
    <Animated.View entering={FadeIn.duration(200)}>
      {exactPerson ? peopleSection : null}
      {spice ? <SpiceResult spice={spice} /> : null}
      <Section title="Top result" style={{ marginTop: spice || exactPerson ? 24 : 16 }}>
        {topArtist ? <TopArtist artist={topArtist} results={results} /> : <TopSong song={results[0]} />}
      </Section>
      <Section title="Songs">
        <SongList songs={results.slice(0, 5)} single />
      </Section>
      {exactPerson ? null : peopleSection}
      {artists.length ? (
        <Section title="Artists">
          <ArtistRow artists={artists.slice(0, 10)} fallbacks={Object.fromEntries(artists.map((a) => [a.id, a.cover]))} />
        </Section>
      ) : null}
      {results.length > 5 ? (
        <Section title="More songs">
          <SongList songs={results.slice(5)} single />
        </Section>
      ) : null}
    </Animated.View>
  );
}

function SearchSkeleton() {
  return (
    <View style={{ marginTop: 16 }}>
      <Skeleton width={120} height={26} />
      <Skeleton height={260} radius={24} style={{ marginTop: 16 }} />
      <Skeleton width={90} height={26} style={{ marginTop: 32, marginBottom: 16 }} />
      <SongRowsSkeleton />
      <Skeleton width={100} height={26} style={{ marginTop: 32, marginBottom: 16 }} />
      <View style={{ flexDirection: "row", gap: 14 }}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width={104} height={104} round />
        ))}
      </View>
    </View>
  );
}

function SpiceResult({ spice }: { spice: NonNullable<SearchState["spice"]> }) {
  const collection: CollectionRef = { kind: "spice", id: spice.id, name: spice.name };
  const loading = useIsLoading(collection);
  return (
    <Press
      onPress={() => router.push(`/spice/${spice.id}`)}
      onLongPress={() => openCollectionMenu(collection, { subtitle: "Spice", artwork: spice.covers[0] })}
      feedback="tap"
      scaleTo={0.98}
      ripple
      style={{
        marginTop: 16,
        borderRadius: radius.xl,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 10,
        paddingRight: 14,
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        overflow: "hidden",
      }}
    >
      <View style={{ width: 68, height: 68, borderRadius: 12, overflow: "hidden" }}>
        <SpiceArt name={spice.name} covers={spice.covers} label={false} />
      </View>
      <View style={{ flex: 1 }}>
        <Kicker>Spice</Kicker>
        <Text size={18} weight={700} numberOfLines={1} style={{ letterSpacing: -0.36 }}>
          {spice.name}
        </Text>
        <Text size={13} color={colors.text2} numberOfLines={2}>
          {spice.name} picked for you, different every day
        </Text>
      </View>
      <PlayButton loading={loading} onPress={() => void runCollection(collection)} />
    </Press>
  );
}

function HeroCard({
  art,
  source,
  round,
  kicker,
  title,
  meta,
  onPress,
  onLongPress,
  playing,
  onPlay,
}: {
  art?: string;
  source?: { uri: string; headers?: Record<string, string> };
  round?: boolean;
  kicker: string;
  title: string;
  meta?: string;
  onPress: () => void;
  onLongPress: () => void;
  playing: boolean;
  onPlay: () => void;
}) {
  const theme = useArtworkColors(art);
  const { ink, inkMuted } = theme ? inkFor(theme) : { ink: colors.text, inkMuted: colors.text2 };
  return (
    <Press
      onPress={onPress}
      onLongPress={onLongPress}
      feedback="tap"
      scaleTo={0.98}
      style={{ padding: 20, borderRadius: radius.xl, backgroundColor: theme?.color ?? colors.surface2, gap: 20 }}
    >
      <View style={{ elevation: round ? 10 : 0, shadowColor: "#000", ...iosShadow(round ? 10 : 0), alignSelf: "flex-start", borderRadius: round ? 68 : 16 }}>
        <Artwork url={art} source={source} size={136} round={round} radius={16} fallback={round ? "user" : "music"} />
      </View>
      <View style={{ paddingRight: 64, gap: 6 }}>
        <Kicker color={inkMuted}>{kicker}</Kicker>
        <Text size={28} weight={700} color={ink} numberOfLines={2} style={{ letterSpacing: -0.8, lineHeight: 31 }}>
          {title}
        </Text>
        {meta ? (
          <Text variant="subhead" color={inkMuted} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <View style={{ position: "absolute", right: 24, bottom: 24 }}>
        <PlayButton playing={playing} onPress={onPlay} bg={theme ? ink : colors.accent} fg={theme ? theme.color : colors.accentInk} />
      </View>
    </Press>
  );
}

function TopSong({ song }: { song: Song }) {
  const pb = usePlayback();
  const current = pb.song?.id === song.id;
  const go = () => (current ? player.toggle() : player.play([song], 0));
  return (
    <HeroCard
      art={song.artworkUrl}
      kicker="Song"
      title={song.title}
      meta={artistLine(song)}
      onPress={go}
      onLongPress={() => openSongMenu(song)}
      playing={current && pb.playing}
      onPlay={go}
    />
  );
}

function TopArtist({ artist, results }: { artist: ArtistCard & { cover?: string }; results: Song[] }) {
  const pb = usePlayback();
  const theirs = results.filter((s) => s.artists.some((a) => a.id === artist.id));
  const current = !!pb.song && theirs.some((s) => s.id === pb.song!.id);
  const proxied = useArtistImage(artist.imageUrl ? undefined : artist.id);
  return (
    <HeroCard
      art={artist.imageUrl ?? artist.cover}
      source={proxied}
      round
      kicker="Artist"
      title={artist.name}
      meta={theirs.length ? `${theirs.length === 1 ? "1 song" : `${theirs.length} songs`} in these results` : undefined}
      onPress={() => router.push(`/artist/${artist.id}`)}
      onLongPress={() =>
        openCollectionMenu(
          { kind: "artist", id: artist.id, name: artist.name },
          { subtitle: "Artist", artwork: artist.imageUrl ?? artist.cover, round: true },
        )
      }
      playing={current && pb.playing}
      onPlay={() => (current ? player.toggle() : player.play(theirs, 0))}
    />
  );
}
