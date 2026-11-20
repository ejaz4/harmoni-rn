import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as WebBrowser from "expo-web-browser";
import Native from "harmoni-player";
import { Platform } from "react-native";

import { kv } from "@/lib/storage";
import { ServerError, type FoundServer, type ServerMeta } from "./server";

export { findServer, normalizeServer, ServerError, type FoundServer } from "./server";

export const REDIRECT_URI = "com.ceccun.harmoni:/oauth";
const CLIENT_NAME = Platform.OS === "ios" ? "Harmoni for iOS" : "Harmoni for Android";

function b64url(bytes: Uint8Array) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkce() {
  const verifier = b64url(Crypto.getRandomBytes(32));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const challenge = digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { verifier, challenge };
}

const clientKey = (issuer: string) => `oauth.client.${issuer}`;

async function register(meta: ServerMeta): Promise<string> {
  const res = await fetch(meta.registration_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_name: CLIENT_NAME,
      redirect_uris: [REDIRECT_URI],
      token_endpoint_auth_method: "none",
    }),
  });
  if (res.status === 429) throw new ServerError("Too many sign-in attempts from this network. Try again in a while.");
  if (!res.ok) throw new ServerError(`The server wouldn't register the app (${res.status}).`);
  const j = await res.json();
  return j.client_id as string;
}

export class SignInCancelled extends Error {}

/**
 * The whole OAuth dance: register (or reuse) a client, open Harmoni in a Custom
 * Tab, check state and iss, swap the code (with the PKCE verifier) for tokens,
 * and hand the session to the native side, which keeps and refreshes it.
 */
export async function signIn(server: FoundServer): Promise<void> {
  const { meta } = server;
  let clientId = kv.get<string | null>(clientKey(meta.issuer), null);
  let fresh = false;
  if (!clientId) {
    clientId = await register(meta);
    fresh = true;
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const { verifier, challenge } = await pkce();
    const state = b64url(Crypto.getRandomBytes(16));
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
      scope: "harmoni",
    });
    const result = await WebBrowser.openAuthSessionAsync(`${meta.authorization_endpoint}?${params}`, REDIRECT_URI, {
      showInRecents: false,
      createTask: false,
    });
    if (result.type !== "success") throw new SignInCancelled();

    const back = new URL(result.url);
    const q = back.searchParams;
    if (q.get("state") !== state) throw new ServerError("The sign-in didn't match. Try again.");
    if (q.get("iss") && q.get("iss") !== meta.issuer) throw new ServerError("The sign-in came back from a different server.");
    const error = q.get("error");
    if (error === "access_denied") throw new SignInCancelled();
    if (error) throw new ServerError(q.get("error_description") || `Sign-in failed (${error}).`);
    const code = q.get("code");
    if (!code) throw new ServerError("The server didn't send a sign-in code.");

    const res = await fetch(meta.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier,
        device_name: (Device.modelName || (Platform.OS === "ios" ? "iPhone" : "Android")).slice(0, 60),
      }).toString(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      if ((body.error === "invalid_client" || body.error === "invalid_grant") && !fresh) {
        // The server forgot this app. Register again and start over.
        clientId = await register(meta);
        fresh = true;
        continue;
      }
      throw new ServerError(body.error_description || "The server wouldn't finish the sign-in.");
    }

    kv.set(clientKey(meta.issuer), clientId);
    await Native.setSession(
      JSON.stringify({
        server: server.origin,
        issuer: meta.issuer,
        apiBase: meta.harmoni_api ?? `${server.origin}/api`,
        tokenEndpoint: meta.token_endpoint,
        revocationEndpoint: meta.revocation_endpoint ?? "",
        clientId,
        accessToken: body.access_token,
        refreshToken: body.refresh_token,
        expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
      }),
    );
    kv.set("server.last", { origin: server.origin, name: server.setup.name });
    return;
  }
  throw new ServerError("Couldn't sign in. Try again.");
}
