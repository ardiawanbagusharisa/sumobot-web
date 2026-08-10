import type { OnlineRoomBootstrap, RealtimeTicketClaims } from "./realtime-protocol";

const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(normalized);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function hashRealtimePayload(value: unknown) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(JSON.stringify(value))));
  return bytesToBase64Url(bytes);
}

export async function signRealtimeTicket(claims: RealtimeTicketClaims, secret: string) {
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(claims)));
  return `${payload}.${bytesToBase64Url(await hmac(payload, secret))}`;
}

export async function verifyRealtimeTicket(token: string, secret: string): Promise<RealtimeTicketClaims | null> {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const expected = await hmac(payload, secret);
    if (!constantTimeEqual(expected, base64UrlToBytes(signature))) return null;
    const claims = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as RealtimeTicketClaims;
    if (!claims.roomId || !claims.playerId || !["host", "guest"].includes(claims.side) || claims.expiresAt <= Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function createCompletionProof(roomId: string, state: unknown, secret: string) {
  const stateHash = await hashRealtimePayload(state);
  const completedAt = Date.now();
  const value = `${roomId}.${completedAt}.${stateHash}`;
  return { completedAt, stateHash, signature: bytesToBase64Url(await hmac(value, secret)) };
}

export async function verifyCompletionProof(roomId: string, state: unknown, proof: { completedAt: number; stateHash: string; signature: string }, secret: string) {
  try {
    if (!Number.isFinite(proof.completedAt) || Math.abs(Date.now() - proof.completedAt) > 5 * 60_000) return false;
    const stateHash = await hashRealtimePayload(state);
    if (stateHash !== proof.stateHash) return false;
    const expected = await hmac(`${roomId}.${proof.completedAt}.${stateHash}`, secret);
    return constantTimeEqual(expected, base64UrlToBytes(proof.signature));
  } catch {
    return false;
  }
}

export async function verifyBootstrap(bootstrap: OnlineRoomBootstrap, claims: RealtimeTicketClaims) {
  return bootstrap.roomId === claims.roomId && await hashRealtimePayload(bootstrap) === claims.bootstrapHash;
}
