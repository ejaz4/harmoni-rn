import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";

import { serverOrigin } from "@/api/client";
import { Api } from "@/api/endpoints";
import type { Invite } from "@/api/types";
import { shortDate } from "@/lib/format";
import { Icon } from "@/ui/Icon";
import { toast } from "@/ui/overlays";
import { IconButton, Press } from "@/ui/Press";
import { Text } from "@/ui/Text";
import { colors, monospace } from "@/ui/theme";
import { Group, Row } from "./parts";

function ago(iso: string | null) {
  if (!iso) return "never";
  return shortDate(iso);
}

export function Invites() {
  const q = useQuery({ queryKey: ["invites"], queryFn: Api.invites });
  const mine = (q.data ?? []).filter((i) => !i.createdBy);
  const link = (code: string) => `${serverOrigin()}/signup?invite=${code}`;
  const copy = async (code: string) => {
    await Clipboard.setStringAsync(link(code));
    toast("Invite link copied");
  };
  const status = (i: Invite) => {
    if (i.usedAt) return i.usedBy ? `Used by @${i.usedBy}` : "Used";
    if (i.expiresAt && Date.parse(i.expiresAt) < Date.now()) return "Expired";
    return i.expiresAt ? `Not used yet · lasts until ${ago(i.expiresAt)}` : "Not used yet";
  };
  return (
    <Group>
      <Row first title="New invite link" note="Created and copied to your clipboard.">
        <Press
          onPress={async () => {
            try {
              const r = await Api.createInvite();
              await copy(r.code);
              q.refetch();
            } catch {
              toast("Couldn't make an invite.", "error");
            }
          }}
          feedback="confirm"
          scaleTo={0.95}
          style={{
            height: 34,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: colors.accent,
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="ticket" size={15} color={colors.accentInk} />
          <Text size={13} weight={500} color={colors.accentInk}>
            Create link
          </Text>
        </Press>
      </Row>
      {mine.map((i) => {
        const expired = !!i.expiresAt && Date.parse(i.expiresAt) < Date.now();
        return (
          <Row key={i.code} title={<Text style={{ fontFamily: monospace, letterSpacing: 1 }}>{i.code}</Text>} note={status(i)}>
            {!i.usedAt && !expired ? (
              <IconButton label="Copy link" size={36} onPress={() => copy(i.code)}>
                <Icon name="copy" size={19} color={colors.text2} />
              </IconButton>
            ) : null}
            {!i.usedAt ? (
              <IconButton
                label={expired ? "Remove" : "Take back"}
                size={36}
                onPress={async () => {
                  try {
                    await Api.deleteInvite(i.code);
                    q.refetch();
                  } catch {
                    toast("Couldn't take that invite back.", "error");
                  }
                }}
              >
                <Icon name="trash" size={19} color={colors.text2} />
              </IconButton>
            ) : null}
          </Row>
        );
      })}
    </Group>
  );
}

