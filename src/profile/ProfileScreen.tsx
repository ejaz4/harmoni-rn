import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { BackHandler, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeInDown, FadeOut, LinearTransition } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { errorMessage } from "@/api/client";
import { Api } from "@/api/endpoints";
import type { Profile, ProfileBanner, ProfileFont, Song } from "@/api/types";
import { firstName } from "@/lib/day-part";
import { plural } from "@/lib/format";
import { copyLink, profilePath, shareLink } from "@/lib/share";
import { TOPBAR } from "@/shell/layout";
import { CardLink, useGridWidth } from "@/song/cards";
import { SongList } from "@/song/SongList";
import { useSession } from "@/state/session";
import { queryClient } from "@/state/query";
import { EmptyState, Section, Skeleton, Switch } from "@/ui/bits";
import { Icon } from "@/ui/Icon";
import { openMenu, toast } from "@/ui/overlays";
import { IconButton, Press } from "@/ui/Press";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { colors, font as fontName, fonts } from "@/ui/theme";
import { Avatar } from "./Avatar";
import { Banner } from "./Banner";
import { FollowButton, FollowsYou } from "./people";
import { pickPicture, removePicture } from "./pictures";
import { ACCENTS, BANNERS, BIO_MAX, FONTS, fontFor, inkFor } from "./style";

interface Draft {
  name: string;
  bio: string;
  accent: string;
  font: ProfileFont;
  banner: ProfileBanner;
  showLikes: boolean;
  showPlaylists: boolean;
}

const draftOf = (p: Profile): Draft => ({
  name: p.user.name,
  bio: p.bio ?? "",
  accent: p.accent,
  font: p.font,
  banner: p.banner,
  showLikes: p.showLikes,
  showPlaylists: p.showPlaylists,
});

export const profileKey = (username: string) => ["profile", username.toLowerCase()];

/** Someone's profile, as the web app's /u/{username}; your own one edits in place. */
export function ProfileScreen({ username }: { username: string }) {
  const q = useQuery({ queryKey: profileKey(username), queryFn: () => Api.profile(username) });
  const [draft, setDraft] = useState<Draft>();
  const [saving, setSaving] = useState(false);
  const profile = q.data;
  const editing = !!draft;

  // Back while editing stops editing, as Cancel does.
  useEffect(() => {
    if (!editing) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      setDraft(undefined);
      return true;
    });
    return () => sub.remove();
  }, [editing]);

  const setProfile = (p: Profile) => queryClient.setQueryData(profileKey(username), p);

  async function save() {
    if (!draft || !profile) return;
    setSaving(true);
    try {
      const updated = await Api.updateProfile({
        name: draft.name.trim(),
        bio: draft.bio.trim() || null,
        accent: draft.accent,
        font: draft.font,
        ...(draft.banner !== "image" && draft.banner !== profile.banner ? { banner: draft.banner } : {}),
        showLikes: draft.showLikes,
        showPlaylists: draft.showPlaylists,
      });
      setProfile(updated);
      setDraft(undefined);
      useSession.getState().refreshMe();
      toast("Profile saved");
    } catch (e) {
      toast(errorMessage(e) || "Couldn't save your profile.", "error");
    } finally {
      setSaving(false);
    }
  }

  // Pictures save as soon as they're picked.
  async function picture(kind: "avatar" | "banner") {
    if (!profile) return;
    const has = kind === "avatar" ? !!profile.user.avatarUrl : !!profile.bannerUrl;
    const after = async (changed: boolean) => {
      if (!changed) return;
      const updated = await Api.myProfile().catch(() => null);
      if (updated) {
        setProfile(updated);
        if (kind === "banner") setDraft((d) => d && { ...d, banner: updated.banner });
      }
      useSession.getState().refreshMe();
    };
    if (!has) return after(await pickPicture(kind));
    openMenu({
      label: kind === "avatar" ? "Profile picture" : "Banner photo",
      items: [
        { label: "Choose a new picture", icon: "image", onPress: async () => after(await pickPicture(kind)) },
        { label: "Remove", icon: "trash", danger: true, onPress: async () => after(await removePicture(kind)) },
      ],
    });
  }

  const name = profile?.user.name;
  return (
    <Screen
      back={!editing}
      left={
        editing ? (
          <Press
            onPress={() => setDraft(undefined)}
            disabled={saving}
            feedback="tap"
            scaleTo={1}
            dim
            hitSlop={10}
            accessibilityRole="button"
          >
            <Text variant="body" color={colors.tint}>
              Cancel
            </Text>
          </Press>
        ) : undefined
      }
      right={
        editing ? (
          <Press
            onPress={save}
            disabled={saving || !draft.name.trim()}
            feedback="confirm"
            scaleTo={0.94}
            accessibilityRole="button"
            style={{
              height: 34,
              paddingHorizontal: 16,
              borderRadius: 17,
              backgroundColor: colors.accent,
              justifyContent: "center",
              opacity: saving || !draft.name.trim() ? 0.5 : 1,
            }}
          >
            <Text variant="subhead" weight={600} color={colors.accentInk}>
              {saving ? "Saving…" : "Save"}
            </Text>
          </Press>
        ) : undefined
      }
      title={name}
      titleAt={260}
      bleedTop
      padded={false}
      refreshing={q.isRefetching}
      onRefresh={editing ? undefined : () => q.refetch()}
      keyboardShouldPersistTaps="handled"
    >
      {profile ? (
        <Animated.View entering={FadeIn.duration(220)}>
          <Body
            profile={profile}
            draft={draft}
            setDraft={setDraft}
            onPicture={picture}
            onEdit={() => setDraft(draftOf(profile))}
            onChange={setProfile}
          />
        </Animated.View>
      ) : q.isError ? (
        <View style={{ paddingTop: 140, paddingHorizontal: 20 }}>
          <EmptyState
            title="No one by that name"
            body="They may have changed their username, or there's nobody here called that."
            icon="user"
          />
        </View>
      ) : (
        <ProfileSkeleton />
      )}
    </Screen>
  );
}

function Body({
  profile,
  draft,
  setDraft,
  onPicture,
  onEdit,
  onChange,
}: {
  profile: Profile;
  draft?: Draft;
  setDraft: (d: Draft | undefined) => void;
  onPicture: (kind: "avatar" | "banner") => void;
  onEdit: () => void;
  onChange: (p: Profile) => void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const editing = !!draft;
  const look = draft ?? draftOf(profile);
  const font = fontFor(look.font);
  const family = font.family ? fontName(font.family) : undefined;
  const bannerH = insets.top + TOPBAR + 150;
  const path = profilePath(profile.user.username);
  const grid = useGridWidth();

  const share = () =>
    openMenu({
      label: "Share profile",
      preview: { title: profile.user.name, subtitle: `@${profile.user.username}`, artwork: null, round: true },
      items: [
        { label: "Share…", icon: "share", onPress: () => shareLink(path, profile.user.name) },
        {
          label: "Copy link to profile",
          icon: "copy",
          onPress: () => copyLink(path).then((ok) => toast(ok ? "Link copied" : "Couldn't copy the link.", ok ? "info" : "error")),
        },
      ],
    });

  async function movePin(i: number, by: -1 | 1) {
    const pinned = [...profile.pinned];
    const [song] = pinned.splice(i, 1);
    pinned.splice(i + by, 0, song);
    onChange({ ...profile, pinned });
    try {
      await Api.updateProfile({ pinnedSongs: pinned.map((s) => s.id) });
      useSession.getState().refreshMe();
    } catch {
      toast("Couldn't change your profile.", "error");
    }
  }

  const pinExtras = profile.isMe
    ? (song: Song, i: number) => [
        ...(i > 0 ? [{ label: "Move up", icon: "arrow-up" as const, onPress: () => movePin(i, -1) }] : []),
        ...(i < profile.pinned.length - 1 ? [{ label: "Move down", icon: "arrow-down" as const, onPress: () => movePin(i, 1) }] : []),
      ]
    : undefined;

  return (
    <View>
      <View>
        <Banner kind={look.banner} accent={look.accent} url={profile.bannerUrl} width={width} height={bannerH} artists={profile.topArtists} />
        {editing ? (
          <Animated.View entering={FadeIn} exiting={FadeOut} style={{ position: "absolute", right: 16, top: insets.top + TOPBAR + 8 }}>
            <PictureButton
              label={profile.bannerUrl ? "Change banner photo" : "Add a banner photo"}
              text="Photo"
              onPress={() => onPicture("banner")}
            />
          </Animated.View>
        ) : null}
      </View>

      <View style={{ alignItems: "center", marginTop: -70, paddingHorizontal: 20 }}>
        <View>
          <Avatar name={look.name} url={profile.user.avatarUrl} accent={look.accent} size={128} ring />
          {editing ? (
            <Animated.View entering={FadeIn} exiting={FadeOut} style={{ position: "absolute", right: 2, bottom: 2 }}>
              <PictureButton label="Change profile picture" onPress={() => onPicture("avatar")} />
            </Animated.View>
          ) : null}
        </View>

        {editing ? (
          <TextInput
            value={look.name}
            onChangeText={(t) => setDraft({ ...look, name: t })}
            maxLength={60}
            accessibilityLabel="Your name"
            placeholder="Your name"
            placeholderTextColor={colors.text3}
            style={[styles.nameInput, { fontFamily: family ?? fonts[700], fontSize: 30 * (font.scale ?? 1) }]}
          />
        ) : (
          <Text
            size={32 * (font.scale ?? 1)}
            weight={700}
            align="center"
            style={{
              marginTop: 14,
              alignSelf: "stretch",
              lineHeight: 38 * (font.scale ?? 1),
              letterSpacing: -0.6,
              ...(family ? { fontFamily: family } : null),
            }}
          >
            {profile.user.name}
          </Text>
        )}

        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <Text variant="subhead" color={colors.text2}>
            @{profile.user.username}
          </Text>
          <FollowsYou user={profile.user} />
        </View>

        {editing ? (
          <View style={{ alignSelf: "stretch", marginTop: 14 }}>
            <TextInput
              value={look.bio}
              onChangeText={(t) => setDraft({ ...look, bio: t })}
              maxLength={BIO_MAX}
              multiline
              placeholder="A line or two about you and what you listen to"
              placeholderTextColor={colors.text3}
              accessibilityLabel="Bio"
              style={styles.bioInput}
            />
            <Text variant="caption" color={colors.text3} style={{ position: "absolute", right: 12, bottom: 8 }} tabular>
              {BIO_MAX - look.bio.length}
            </Text>
          </View>
        ) : profile.bio ? (
          <Text variant="callout" color={colors.text} align="center" style={{ marginTop: 12, alignSelf: "stretch" }}>
            {profile.bio}
          </Text>
        ) : null}

        <View style={{ flexDirection: "row", gap: 22, marginTop: 12 }}>
          <Count
            n={profile.followers}
            label={profile.followers === 1 ? "follower" : "followers"}
            onPress={() => router.push(`${path}/followers` as never)}
          />
          <Count n={profile.following} label="following" onPress={() => router.push(`${path}/following` as never)} />
        </View>

        {editing ? null : (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 18 }}>
            {profile.isMe ? (
              <Press
                onPress={onEdit}
                feedback="tap"
                scaleTo={0.95}
                accessibilityRole="button"
                style={{
                  height: 40,
                  paddingHorizontal: 18,
                  borderRadius: 20,
                  backgroundColor: colors.surface3,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 7,
                }}
              >
                <Icon name="edit" size={17} color={colors.text} />
                <Text variant="subhead" weight={600}>
                  Edit profile
                </Text>
              </Press>
            ) : (
              <FollowButton
                user={profile.user}
                accent={look.accent}
                onChange={(u) => onChange({ ...profile, user: u, followers: profile.followers + (u.youFollow ? 1 : -1) })}
              />
            )}
            <IconButton label="Share profile" onPress={share} size={40} style={{ backgroundColor: colors.surface3, borderRadius: 20 }}>
              <Icon name="share" size={19} color={colors.text} />
            </IconButton>
          </View>
        )}
      </View>

      <View style={{ paddingHorizontal: 20 }}>
        {editing ? (
          <StylePanel
            look={look}
            onChange={setDraft}
            bannerUrl={profile.bannerUrl}
            artists={profile.topArtists}
            onUploadBanner={() => onPicture("banner")}
          />
        ) : null}

        <Animated.View layout={LinearTransition.springify().damping(22)}>
          <Section title="On display" titleFont={family}>
            {profile.pinned.length ? (
              <SongList songs={profile.pinned} numbered extras={pinExtras} />
            ) : profile.isMe ? (
              <EmptyState
                title="Put your favourites on display"
                body="Hold any song, or open its menu, and choose Show on your profile. Up to 10 go here, in the order you pick them."
                icon="pin"
              />
            ) : (
              <EmptyState title="Nothing on display yet" body={`${firstName(profile.user.name)} hasn't picked any songs to show off.`} />
            )}
          </Section>

          {profile.playlists && (profile.playlists.length > 0 || profile.isMe) ? (
            <Section title="Playlists" titleFont={family}>
              {profile.isMe && !look.showPlaylists ? <OnlyYou /> : null}
              {profile.playlists.length ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 14, rowGap: 20 }}>
                  {profile.playlists.map((p) => (
                    <CardLink
                      key={p.id}
                      title={p.name}
                      subtitle={`Playlist · ${plural(p.count, "song")}`}
                      artwork={p.artworks[0]}
                      width={grid}
                      onPress={() => router.push(`/playlist/${p.id}`)}
                    />
                  ))}
                </View>
              ) : (
                <EmptyState
                  title="No public playlists"
                  body="Open one of your playlists, tap Share and pick Public. It'll show up here for everyone."
                />
              )}
            </Section>
          ) : null}

          {profile.likes && (profile.likes.count > 0 || profile.isMe) ? (
            <Section
              title="Liked songs"
              titleFont={family}
              link={profile.likes.count > profile.likes.songs.length ? `See all ${profile.likes.count.toLocaleString()}` : undefined}
              onLink={profile.likes.count > profile.likes.songs.length ? () => router.push(`${path}/likes` as never) : undefined}
            >
              {profile.isMe && !look.showLikes ? <OnlyYou /> : null}
              {profile.likes.songs.length ? (
                <SongList songs={profile.likes.songs} />
              ) : (
                <EmptyState title="No liked songs yet" body="Tap the heart on songs you love." />
              )}
            </Section>
          ) : null}
        </Animated.View>
      </View>
    </View>
  );
}

function Count({ n, label, onPress }: { n: number; label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} feedback="tap" scaleTo={0.95} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${n} ${label}`}>
      <Text variant="subhead" color={colors.text2}>
        <Text variant="subhead" weight={600}>
          {n.toLocaleString()}
        </Text>{" "}
        {label}
      </Text>
    </Press>
  );
}

function OnlyYou() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: -6, marginBottom: 12 }}>
      <Icon name="lock" size={14} color={colors.text3} />
      <Text variant="footnote" color={colors.text3}>
        Hidden: only you can see these here.
      </Text>
    </View>
  );
}

function PictureButton({ label, text, onPress }: { label: string; text?: string; onPress: () => void }) {
  return (
    <Press
      onPress={onPress}
      feedback="tap"
      scaleTo={0.92}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        height: 36,
        minWidth: 36,
        paddingHorizontal: text ? 12 : 0,
        borderRadius: 18,
        backgroundColor: "rgba(20,19,18,0.82)",
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: "rgba(255,255,255,0.18)",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <Icon name="snapshot" size={18} color="#fff" />
      {text ? (
        <Text variant="footnote" weight={600} color="#fff">
          {text}
        </Text>
      ) : null}
    </Press>
  );
}

/** Colour, font, banner and what's shown, previewed on the page as they're picked. */
function StylePanel({
  look,
  onChange,
  bannerUrl,
  artists,
  onUploadBanner,
}: {
  look: Draft;
  onChange: (d: Draft) => void;
  bannerUrl?: string;
  artists?: Profile["topArtists"];
  onUploadBanner: () => void;
}) {
  const swatches: string[] = (ACCENTS as readonly string[]).includes(look.accent) ? [...ACCENTS] : [...ACCENTS, look.accent];
  return (
    <Animated.View entering={FadeInDown.springify().damping(20)} exiting={FadeOut.duration(160)} style={styles.panel}>
      <PanelTitle>Colour</PanelTitle>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {swatches.map((c) => {
          const on = look.accent.toLowerCase() === c.toLowerCase();
          return (
            <Press
              key={c}
              onPress={() => onChange({ ...look, accent: c })}
              feedback="select"
              scaleTo={0.88}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={c}
            >
              <View style={[styles.swatchRing, on ? { borderColor: colors.text } : null]}>
                <View style={[styles.swatch, { backgroundColor: c }]}>{on ? <Icon name="check" size={16} color={inkFor(c)} /> : null}</View>
              </View>
            </Press>
          );
        })}
      </View>

      <PanelTitle>Font</PanelTitle>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -18 }}
        contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}
      >
        {FONTS.map((f) => {
          const on = look.font === f.key;
          return (
            <Press
              key={f.key}
              onPress={() => onChange({ ...look, font: f.key })}
              feedback="select"
              scaleTo={0.94}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.chip, on ? { backgroundColor: look.accent } : null]}
            >
              <Text
                size={16 * (f.scale ?? 1)}
                weight={600}
                color={on ? inkFor(look.accent) : colors.text}
                style={f.family ? { fontFamily: fontName(f.family) } : null}
              >
                {f.label}
              </Text>
            </Press>
          );
        })}
      </ScrollView>

      <PanelTitle>Banner</PanelTitle>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ marginHorizontal: -18 }}
        contentContainerStyle={{ paddingHorizontal: 18, gap: 10 }}
      >
        {BANNERS.map((b) => (
          <BannerTile key={b.key} label={b.label} on={look.banner === b.key} onPress={() => onChange({ ...look, banner: b.key })}>
            <Banner kind={b.key} accent={look.accent} width={116} height={64} fade={false} artists={artists} />
          </BannerTile>
        ))}
        {bannerUrl ? (
          <BannerTile label="Your photo" on={look.banner === "image"} onPress={() => onChange({ ...look, banner: "image" })}>
            <Banner kind="image" url={bannerUrl} accent={look.accent} width={116} height={64} fade={false} />
          </BannerTile>
        ) : null}
        <BannerTile label={bannerUrl ? "New photo" : "Upload a photo"} onPress={onUploadBanner}>
          <View style={{ width: 116, height: 64, backgroundColor: colors.surface3, alignItems: "center", justifyContent: "center" }}>
            <Icon name="image" size={22} color={colors.text2} />
          </View>
        </BannerTile>
      </ScrollView>

      <PanelTitle>On your profile</PanelTitle>
      <ToggleRow label="Your public playlists" value={look.showPlaylists} onChange={(v) => onChange({ ...look, showPlaylists: v })} />
      <ToggleRow label="Songs you've liked" value={look.showLikes} onChange={(v) => onChange({ ...look, showLikes: v })} last />
    </Animated.View>
  );
}

function PanelTitle({ children }: { children: string }) {
  return (
    <Text
      variant="footnote"
      weight={600}
      color={colors.text2}
      style={{ textTransform: "uppercase", letterSpacing: 0.6, marginTop: 20, marginBottom: 10 }}
    >
      {children}
    </Text>
  );
}

function BannerTile({ label, on, onPress, children }: { label: string; on?: boolean; onPress: () => void; children: React.ReactNode }) {
  return (
    <Press
      onPress={onPress}
      feedback="select"
      scaleTo={0.94}
      accessibilityRole="radio"
      accessibilityState={{ selected: !!on }}
      accessibilityLabel={label}
      style={{ gap: 6 }}
    >
      <View style={[styles.tile, on ? { borderColor: colors.text } : null]}>
        <View style={{ borderRadius: 10, overflow: "hidden" }}>{children}</View>
      </View>
      <Text variant="caption" color={on ? colors.text : colors.text2} align="center">
        {label}
      </Text>
    </Press>
  );
}

function ToggleRow({ label, value, onChange, last }: { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: 48,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth,
        borderColor: colors.border,
      }}
    >
      <Text variant="body" style={{ flex: 1 }}>
        {label}
      </Text>
      <Switch value={value} onChange={onChange} />
    </View>
  );
}

function ProfileSkeleton() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  return (
    <View>
      <Skeleton width={width} height={insets.top + TOPBAR + 150} radius={0} />
      <View style={{ alignItems: "center", marginTop: -70, gap: 12 }}>
        <Skeleton width={140} height={140} round />
        <Skeleton width={200} height={30} radius={8} />
        <Skeleton width={110} height={14} radius={6} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  nameInput: {
    marginTop: 14,
    alignSelf: "stretch",
    textAlign: "center",
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
    includeFontPadding: false,
  },
  bioInput: {
    minHeight: 92,
    color: colors.text,
    backgroundColor: colors.surface2,
    borderRadius: 14,
    paddingTop: 12,
    paddingBottom: 26,
    paddingHorizontal: 14,
    fontFamily: fonts[400],
    fontSize: 16,
    lineHeight: 21,
    textAlignVertical: "top",
    textAlign: "center",
  },
  panel: { marginTop: 24, padding: 18, paddingTop: 2, borderRadius: 22, backgroundColor: colors.surface },
  swatchRing: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 2,
    borderColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  swatch: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  chip: { height: 40, paddingHorizontal: 16, borderRadius: 20, backgroundColor: colors.surface3, justifyContent: "center" },
  tile: { borderRadius: 13, borderWidth: 2, borderColor: "transparent", padding: 1 },
});
