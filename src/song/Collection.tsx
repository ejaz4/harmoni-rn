import { FlashList } from "@shopify/flash-list";
import { BlurTargetView } from "expo-blur";
import { useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { Platform, StyleSheet, TextInput, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, interpolate, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Song } from "@/api/types";
import { download, prioritizeDownloads, removeDownloads, useListDownloadState } from "@/downloads/downloads";
import { matches, plural, sameList, total } from "@/lib/format";
import { kv } from "@/lib/storage";
import { usePrefs } from "@/settings/prefs";
import { useArtworkColors, usePlayback } from "@/player/hooks";
import { player } from "@/player/player";
import { TOPBAR, useContentBottom } from "@/shell/layout";
import { Artwork } from "@/ui/Artwork";
import { Chip, EmptyState, PlayButton, Skeleton } from "@/ui/bits";
import { Icon, type IconName } from "@/ui/Icon";
import { confirm, openMenu, toast, type MenuItem } from "@/ui/overlays";
import { IconButton, Press } from "@/ui/Press";
import { BlurTargetContext, TopBar } from "@/ui/Screen";
import { Spinner } from "@/ui/Spinner";
import { Kicker, Text } from "@/ui/Text";
import { iosShadow } from "@/ui/shadow";
import { colors, fonts, radius } from "@/ui/theme";
import { openSongMenu, type Extra } from "./menu";
import { usePlaySong } from "./SongList";
import { SongRow } from "./SongRow";

type SortField = "order" | "title" | "artist";
interface Sort {
  field: SortField;
  descending: boolean;
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

function sortSongs(songs: Song[], s: Sort): Song[] {
  if (s.field === "order") return s.descending ? songs.slice().reverse() : songs;
  const a1 = (x: Song) => x.artists[0]?.name ?? "";
  return songs
    .map((song, i) => ({ song, i }))
    .sort((a, b) => {
      let c =
        s.field === "title"
          ? collator.compare(a.song.title, b.song.title) || collator.compare(a1(a.song), a1(b.song))
          : collator.compare(a1(a.song), a1(b.song)) || collator.compare(a.song.title, b.song.title);
      if (s.descending) c = -c;
      return c || a.i - b.i;
    })
    .map((x) => x.song);
}

export interface CollectionProps {
  kind: string;
  title: string;
  description?: string;
  meta?: ReactNode;
  art?: ReactNode;
  artUrl?: string;
  round?: boolean;
  songs: Song[] | undefined;
  loading?: boolean;
  error?: { title: string; body: string } | null;
  numbered?: boolean;
  sortKey?: string;
  orderLabel?: string;
  orderIcon?: IconName;
  defaultSort?: Sort;
  findLabel?: string;
  menu?: () => MenuItem[];
  menuLabel?: string;
  rowExtras?: (song: Song, i: number) => Extra[];
  empty?: { title: string; body: string; action?: string; onAction?: () => void };
  noMatch?: (q: string) => string;
  footer?: ReactNode;
  below?: ReactNode;
  loadingNote?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  hideDownload?: boolean;
  /** Album tracklists: numbers instead of repeating the same cover on every row. */
  compact?: boolean;
  /** Shown after the kind in the small line (e.g. the year). */
  kindNote?: string;
  /** More buttons in the nav bar, before download and the menu (Share). */
  actions?: ReactNode;
}

/** An album, playlist, Spice or library list, laid out like Apple Music's. */
export function Collection(p: CollectionProps) {
  const insets = useSafeAreaInsets();
  const bottom = useContentBottom();
  const { width } = useWindowDimensions();
  // Settings › Look & feel › Hide song numbers.
  const numbered = usePrefs((s) => !s.hideNumbers) && p.numbered;
  const scrollY = useSharedValue(0);
  const target = useRef<ComponentRef<typeof View>>(null);
  const [sort, setSortState] = useState<Sort>(
    () =>
      (p.sortKey ? kv.get<Record<string, Sort>>("sort", {})[p.sortKey] : undefined) ??
      p.defaultSort ?? { field: "order", descending: false },
  );
  const [query, setQuery] = useState("");
  const [finding, setFinding] = useState(false);
  const findRef = useRef<ComponentRef<typeof TextInput>>(null);

  const setSort = (s: Sort) => {
    setSortState(s);
    if (p.sortKey) kv.set("sort", { ...kv.get<Record<string, Sort>>("sort", {}), [p.sortKey]: s });
  };

  const songs = p.songs;
  const sorted = useMemo(() => (songs ? (p.sortKey ? sortSongs(songs, sort) : songs) : []), [songs, sort, p.sortKey]);
  const shown = useMemo(() => (query.trim() ? sorted.filter((s) => matches(s, query)) : sorted), [sorted, query]);
  const firstArt = p.artUrl ?? songs?.find((s) => s.artworkUrl)?.artworkUrl;
  const theme = useArtworkColors(firstArt);
  const onPress = usePlaySong(shown);
  const extrasRef = useRef(p.rowExtras);
  extrasRef.current = p.rowExtras;
  const onMore = useCallback((song: Song, i: number) => openSongMenu(song, extrasRef.current?.(song, i) ?? []), []);
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollY.value = e.nativeEvent.contentOffset.y;
  };

  // Songs here still waiting to download go next, top to bottom, while this screen is in front.
  const waiting = useListDownloadState(sorted).saving > 0;
  useFocusEffect(
    useCallback(() => {
      if (waiting) prioritizeDownloads(sorted);
    }, [waiting, sorted]),
  );

  const artSize = Math.round(Math.min(width * 0.64, 260));
  const sortable = !!p.sortKey && !!songs && songs.length > 1;
  const findable = !!p.findLabel && !!songs && songs.length > 1;
  const startFind = () => {
    setFinding(true);
    setTimeout(() => findRef.current?.focus(), 60);
  };

  // The artwork drifts up a little slower than the page, and shrinks as it goes (parallax).
  // Pulled down, the artwork grows; scrolled up, it shrinks toward the top and fades (never into the title).
  const artStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scrollY.value, [-200, 0], [-100, 0], "clamp") },
      { scale: interpolate(scrollY.value, [-200, 0, artSize], [1.14, 1, 0.9], "clamp") },
    ],
    opacity: interpolate(scrollY.value, [artSize * 0.2, artSize * 0.95], [1, 0], "clamp"),
  }));
  const count = songs ? `${plural(songs.length, "song")}${total(songs) ? `, ${total(songs)}` : ""}` : "";

  const cover = p.art ?? <Artwork url={firstArt} size={artSize} radius={p.round ? artSize / 2 : radius.lg} round={p.round} px={900} />;
  const header = (
    <View>
      <HeaderWash color={theme?.color} height={insets.top + TOPBAR + artSize + 300} />
      <View style={{ paddingTop: insets.top + TOPBAR + 12, paddingHorizontal: 20, alignItems: "center" }}>
        <Animated.View
          entering={FadeIn.duration(450)}
          style={[
            styles.art,
            { width: artSize, height: artSize, borderRadius: p.round ? artSize / 2 : radius.lg, transformOrigin: "50% 0%" },
            artStyle,
          ]}
        >
          {IOS ? (
            // iOS clips a view's shadow with its overflow, so the clip moves to an inner view there.
            <View style={{ flex: 1, overflow: "hidden", borderRadius: p.round ? artSize / 2 : radius.lg }}>{cover}</View>
          ) : (
            cover
          )}
        </Animated.View>
        <View style={{ alignSelf: "stretch", alignItems: "center", marginTop: 22, gap: 6 }}>
          <Kicker align="center">{p.kind}</Kicker>
          <Text variant="title1" align="center" numberOfLines={2} style={{ letterSpacing: -0.8 }}>
            {p.title}
          </Text>
          {p.description ? (
            <Text variant="subhead" color={colors.text2} align="center" numberOfLines={3}>
              {p.description}
            </Text>
          ) : null}
          {songs || p.meta ? (
            <View style={styles.meta}>
              {typeof p.meta === "string" ? (
                <Text variant="footnote" weight={600} numberOfLines={1}>
                  {p.meta}
                </Text>
              ) : (
                p.meta
              )}
              <Text variant="footnote" color={colors.text3} numberOfLines={1}>
                {(p.meta && (p.kindNote || count) ? " · " : "") + [p.kindNote, count].filter(Boolean).join(" · ")}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {songs && (songs.length || p.menu) ? (
        <ActionRow
          songs={sorted}
          title={p.title}
          hideDownload={p.hideDownload}
          sortable={sortable}
          sort={sort}
          onSort={setSort}
          orderLabel={p.orderLabel ?? "Date added"}
          orderIcon={p.orderIcon ?? "history"}
          findLabel={findable ? p.findLabel : undefined}
          onFind={startFind}
          menu={p.menu}
          menuLabel={p.menuLabel}
          artwork={firstArt}
          subtitle={typeof p.meta === "string" ? p.meta : p.kind}
          actions={p.actions}
        />
      ) : (
        <View style={{ height: 20 }} />
      )}
      {finding ? (
        <Animated.View entering={FadeInDown.springify().damping(20)} exiting={FadeOut.duration(140)} style={styles.find}>
          <Icon name="search" size={17} color={colors.text3} />
          <TextInput
            ref={findRef}
            value={query}
            onChangeText={setQuery}
            placeholder={p.findLabel}
            placeholderTextColor={colors.text3}
            selectionColor={colors.accent}
            cursorColor={colors.accent}
            returnKeyType="done"
            onBlur={() => !query && setFinding(false)}
            style={{ flex: 1, color: colors.text, fontFamily: fonts[400], fontSize: 16, paddingVertical: 0 }}
          />
          {query ? (
            <Text variant="footnote" color={colors.text3}>
              {plural(shown.length, "song")}
            </Text>
          ) : null}
          <Press
            onPress={() => (query ? setQuery("") : setFinding(false))}
            accessibilityLabel={query ? "Clear" : "Close"}
            scaleTo={0.85}
            style={{ width: 30, height: 30, alignItems: "center", justifyContent: "center" }}
          >
            <Icon name="close" size={16} color={colors.text2} />
          </Press>
        </Animated.View>
      ) : null}
      <View style={{ paddingHorizontal: 20 }}>
        {p.error && !songs?.length ? (
          <EmptyState title={p.error.title} body={p.error.body} icon="cloud-off" />
        ) : !songs ? (
          <View style={{ gap: 16, paddingVertical: 8 }}>
            {typeof p.loadingNote === "string" ? (
              <Text variant="footnote" color={colors.text3} align="center">
                {p.loadingNote}
              </Text>
            ) : (
              p.loadingNote
            )}
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <Skeleton width={48} height={48} radius={6} delay={i * 80} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Skeleton width={`${40 + ((i * 13) % 30)}%`} height={14} delay={i * 80} />
                  <Skeleton width="28%" height={12} delay={i * 80} />
                </View>
              </View>
            ))}
          </View>
        ) : !songs.length && p.empty ? (
          <EmptyState title={p.empty.title} body={p.empty.body} action={p.empty.action} onAction={p.empty.onAction} icon="music" />
        ) : query.trim() && !shown.length ? (
          <EmptyState title="No matches" body={p.noMatch?.(query.trim()) ?? `Nothing here matches “${query.trim()}”.`} icon="search" />
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <BlurTargetContext.Provider value={target}>
        <BlurTargetView ref={target} style={{ flex: 1, backgroundColor: colors.bg }}>
          <FlashList
            data={shown}
            keyExtractor={(s, i) => `${s.id}:${i}`}
            renderItem={({ item, index }) => (
              <View style={{ paddingHorizontal: 20 }}>
                <SongRow
                  song={item}
                  index={index}
                  numbered={numbered}
                  compact={p.compact}
                  onPress={onPress}
                  onMore={onMore}
                  last={index === shown.length - 1}
                />
              </View>
            )}
            ListHeaderComponent={header}
            ListFooterComponent={
              <View style={{ paddingHorizontal: 20 }}>
                {p.footer}
                {p.below}
              </View>
            }
            contentContainerStyle={{ paddingBottom: bottom }}
            onScroll={onScroll}
            scrollEventThrottle={16}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            refreshing={p.refreshing}
            onRefresh={p.onRefresh}
            progressViewOffset={insets.top + TOPBAR}
          />
        </BlurTargetView>
        <TopBar back avatar={false} title={p.title} scrollY={scrollY} titleAt={artSize + 40} target={target} />
      </BlurTargetContext.Provider>
    </View>
  );
}

/**
 * The cover's colour washing down from behind the status bar, edge to edge,
 * fading out behind the play button and the first rows (the web's header).
 */
function HeaderWash({ color, height }: { color?: string; height: number }) {
  const c = color ?? "#3c3832";
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { bottom: undefined, height, opacity: color ? 1 : 0.6 }]}>
      <LinearGradient colors={[`${c}57`, `${c}00`]} style={StyleSheet.absoluteFill} />
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <RadialGradient id="collectionWash" cx="20%" cy="0%" rx="70%" ry="60%">
            <Stop offset="0" stopColor={c} stopOpacity={0.55} />
            <Stop offset="0.75" stopColor={c} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#collectionWash)" />
      </Svg>
    </View>
  );
}

/**
 * One row of actions under the header, as the web has it: the big cream play
 * button, then shuffle, download, the list's own (Share) and more, and how
 * it's sorted on the right.
 */
function ActionRow({
  songs,
  title,
  hideDownload,
  sortable,
  sort,
  onSort,
  orderLabel,
  orderIcon,
  findLabel,
  onFind,
  menu,
  menuLabel,
  artwork,
  subtitle,
  actions,
}: {
  actions?: ReactNode;
  songs: Song[];
  title: string;
  hideDownload?: boolean;
  sortable: boolean;
  sort: Sort;
  onSort: (s: Sort) => void;
  orderLabel: string;
  orderIcon: IconName;
  findLabel?: string;
  onFind: () => void;
  menu?: () => MenuItem[];
  menuLabel?: string;
  artwork?: string | null;
  subtitle?: string;
}) {
  const { width } = useWindowDimensions();
  const pb = usePlayback();
  const isCurrent = songs.length > 0 && pb.queue.length === songs.length && sameList(pb.queue, songs);
  const playing = isCurrent && pb.playing;
  const dl = useListDownloadState(songs);
  const askRemove = async () => {
    const yes = await confirm({
      title: "Remove downloads?",
      note: `The ${plural(dl.saved + dl.saving, "song")} from ${title} saved on this phone will be removed. You can download them again any time.`,
      confirm: "Remove",
      danger: true,
    });
    if (yes) removeDownloads(songs.map((s) => s.id));
  };
  // Tap downloads whatever isn't saved yet; only a fully saved list offers to remove.
  const onDownload = () => {
    if (dl.state === "all") return askRemove();
    const n = download(songs);
    if (n === 0) toast(dl.saving ? "Already saving these" : "Already on this phone");
    else toast(n === 1 ? "Saving 1 song for offline" : `Saving ${n.toLocaleString()} songs for offline`);
  };
  const onDownloadLong = () => {
    if (dl.saved + dl.saving === 0) return;
    openMenu({
      label: "Downloads",
      preview: { title, subtitle: `${plural(dl.saved, "song")} on this phone`, artwork },
      items: [
        ...(dl.state !== "all" ? [{ label: "Download the rest", icon: "download" as const, onPress: onDownload }] : []),
        { label: `Remove ${plural(dl.saved + dl.saving, "download")}`, icon: "trash" as const, danger: true, onPress: askRemove },
      ],
    });
  };
  const sortLabel = sort.field === "order" ? orderLabel : sort.field === "title" ? "Title" : "Artist";
  const sortItems = (): MenuItem[] => [
    {
      label: orderLabel,
      icon: orderIcon,
      checked: sort.field === "order",
      keepOpen: true,
      onPress: () => onSort({ ...sort, field: "order" }),
    },
    { label: "Title", icon: "music", checked: sort.field === "title", keepOpen: true, onPress: () => onSort({ ...sort, field: "title" }) },
    {
      label: "Artist",
      icon: "user",
      checked: sort.field === "artist",
      keepOpen: true,
      onPress: () => onSort({ ...sort, field: "artist" }),
    },
    "divider",
    {
      label: "Ascending",
      icon: "arrow-up",
      checked: !sort.descending,
      keepOpen: true,
      onPress: () => onSort({ ...sort, descending: false }),
    },
    {
      label: "Descending",
      icon: "arrow-down",
      checked: sort.descending,
      keepOpen: true,
      onPress: () => onSort({ ...sort, descending: true }),
    },
  ];
  const openSort = () => openMenu({ label: "Sort by", items: sortItems });
  const openMore = () =>
    openMenu({
      label: menuLabel ?? title,
      preview: { title, subtitle, artwork },
      items: () => {
        const items: MenuItem[] = [];
        if (songs.length) {
          items.push({ label: "Play next", icon: "next", onPress: () => [...songs].reverse().forEach((s) => player.playNext(s)) });
          items.push({
            label: "Add to queue",
            icon: "queue",
            onPress: () => {
              songs.forEach((s) => player.addToQueue(s));
              toast(`Added ${plural(songs.length, "song")} to your queue`);
            },
          });
        }
        if (findLabel) items.push({ label: findLabel, icon: "search", onPress: onFind });
        if (sortable)
          items.push({
            label: "Sort by",
            icon: "sort",
            detail: `${sortLabel}, ${sort.descending ? "descending" : "ascending"}`,
            submenu: sortItems,
          });
        const own = menu?.() ?? [];
        if (own.length && items.length) items.push("divider");
        return [...items, ...own];
      },
    });
  const iconColor = colors.text2;
  return (
    <View style={styles.actions}>
      {songs.length ? (
        <View style={{ marginRight: 8 }}>
          <PlayButton
            size={56}
            playing={playing}
            onPress={() => (isCurrent ? player.toggle() : player.play(songs, 0))}
            label={playing ? "Pause" : `Play ${title}`}
          />
        </View>
      ) : null}
      {songs.length > 1 ? (
        <IconButton
          label="Shuffle"
          onPress={() => player.play(songs, Math.floor(Math.random() * songs.length), { shuffle: true })}
          size={42}
        >
          <Icon name="shuffle" size={22} color={iconColor} />
        </IconButton>
      ) : null}
      {!hideDownload && songs.length ? (
        <IconButton
          label={dl.state === "all" ? "Downloaded" : dl.saving ? "Downloading" : "Download"}
          onPress={onDownload}
          onLongPress={onDownloadLong}
          size={42}
        >
          {dl.saving > 0 ? (
            <Spinner size={20} color={iconColor} />
          ) : (
            <Icon
              name={dl.state === "all" ? "download-solid" : "download"}
              size={22}
              color={dl.state === "all" ? colors.accent : iconColor}
            />
          )}
        </IconButton>
      ) : null}
      {actions}
      <IconButton label={menuLabel ?? "More"} onPress={openMore} size={42} feedback="contextClick">
        <Icon name="ellipsis" size={22} color={iconColor} />
      </IconButton>
      <View style={{ flex: 1 }} />
      {sortable ? (
        width >= 400 ? (
          <Chip
            label={sortLabel}
            icon={sort.descending ? "arrow-down" : "arrow-up"}
            accessibilityLabel={`Sort by ${sortLabel}`}
            onPress={openSort}
          />
        ) : (
          <IconButton label={`Sort by ${sortLabel}`} onPress={openSort} size={42}>
            <Icon name="sort" size={22} color={iconColor} />
          </IconButton>
        )
      ) : null}
    </View>
  );
}

const IOS = Platform.OS === "ios";

const styles = StyleSheet.create({
  art: {
    overflow: IOS ? "visible" : "hidden",
    backgroundColor: colors.surface2,
    elevation: 24,
    shadowColor: "#000",
    ...iosShadow(24),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  meta: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", marginTop: 2 },
  actions: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 20, marginTop: 20, marginBottom: 16 },
  find: {
    marginHorizontal: 20,
    marginBottom: 12,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 12,
    paddingRight: 6,
    gap: 8,
  },
});
