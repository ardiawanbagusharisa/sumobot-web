import { getDatabase } from "@/lib/db/server";
import { defaultOnlineProfile } from "@/lib/profile/default";

const SESSION_COOKIE = "sumobot_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
// Sites' production Web Crypto runtime caps PBKDF2 at 100,000 iterations.
// Store the work factor with every credential so it can be raised safely when
// the runtime limit changes without invalidating existing accounts.
const PASSWORD_ITERATIONS = 100_000;

export interface AuthUser {
  id: string;
  handle: string;
  displayName: string;
}

interface CredentialRow extends AuthUser {
  passwordHash: string;
  passwordSalt: string;
  passwordIterations: number;
}

let schemaReady = false;

export async function ensureAuthSchema() {
  if (schemaReady) return;
  const d1 = await getDatabase();
  await d1.batch([
    d1.prepare(`CREATE TABLE IF NOT EXISTS players (
      id TEXT PRIMARY KEY NOT NULL,
      handle TEXT NOT NULL,
      display_name TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      total_xp INTEGER NOT NULL DEFAULT 0,
      gold_balance INTEGER NOT NULL DEFAULT 0,
      unlocked_modes TEXT NOT NULL DEFAULT '["buttons"]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_players_handle ON players(handle)"),
    d1.prepare(`CREATE TABLE IF NOT EXISTS auth_credentials (
      player_id TEXT PRIMARY KEY NOT NULL REFERENCES players(id),
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      password_iterations INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      player_id TEXT NOT NULL REFERENCES players(id),
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL
    )`),
    d1.prepare(`CREATE TABLE IF NOT EXISTS online_profiles (
      player_id TEXT PRIMARY KEY NOT NULL REFERENCES players(id),
      profile TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    d1.prepare("CREATE INDEX IF NOT EXISTS idx_auth_sessions_player ON auth_sessions(player_id)"),
  ]);
  schemaReady = true;
}

export function normalizeLoginId(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateCredentials(loginId: string, password: unknown) {
  if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(loginId)) {
    return "User ID must be 3-24 characters using letters, numbers, underscores, or hyphens.";
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 72) {
    return "Password must be between 8 and 72 characters.";
  }
  return null;
}

export async function registerAccount(loginId: string, password: string) {
  await ensureAuthSchema();
  const d1 = await getDatabase();
  const existing = await d1.prepare("SELECT id FROM players WHERE handle = ? LIMIT 1").bind(loginId).first<{ id: string }>();
  if (existing) return { error: "That user ID is already registered.", status: 409 as const };

  const playerId = crypto.randomUUID();
  const salt = randomHex(16);
  const passwordHash = await derivePasswordHash(password, salt, PASSWORD_ITERATIONS);
  const now = new Date().toISOString();
  const profile = defaultOnlineProfile();
  await d1.batch([
    d1.prepare(`INSERT INTO players
      (id, handle, display_name, level, total_xp, gold_balance, unlocked_modes, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, '["buttons"]', ?, ?)`)
      .bind(playerId, loginId, loginId, profile.xp, profile.gold, now, now),
    d1.prepare(`INSERT INTO auth_credentials
      (player_id, password_hash, password_salt, password_iterations, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(playerId, passwordHash, salt, PASSWORD_ITERATIONS, now, now),
    d1.prepare("INSERT INTO online_profiles (player_id, profile, revision, imported_at, updated_at) VALUES (?, ?, 1, ?, ?)")
      .bind(playerId, JSON.stringify(profile), now, now),
  ]);
  return createSession({ id: playerId, handle: loginId, displayName: loginId });
}

export async function loginAccount(loginId: string, password: string) {
  await ensureAuthSchema();
  const d1 = await getDatabase();
  const row = await d1.prepare(`SELECT
      p.id AS id,
      p.handle AS handle,
      p.display_name AS displayName,
      c.password_hash AS passwordHash,
      c.password_salt AS passwordSalt,
      c.password_iterations AS passwordIterations
    FROM players p
    INNER JOIN auth_credentials c ON c.player_id = p.id
    WHERE p.handle = ?
    LIMIT 1`)
    .bind(loginId)
    .first<CredentialRow>();
  if (!row) return { error: "Incorrect user ID or password.", status: 401 as const };

  const candidate = await derivePasswordHash(password, row.passwordSalt, row.passwordIterations);
  if (!constantTimeEqual(candidate, row.passwordHash)) {
    return { error: "Incorrect user ID or password.", status: 401 as const };
  }
  return createSession({ id: row.id, handle: row.handle, displayName: row.displayName });
}

export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  await ensureAuthSchema();
  const d1 = await getDatabase();
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256Hex(token);
  const user = await d1.prepare(`SELECT
      p.id AS id,
      p.handle AS handle,
      p.display_name AS displayName
    FROM auth_sessions s
    INNER JOIN players p ON p.id = s.player_id
    WHERE s.token_hash = ? AND s.expires_at > ?
    LIMIT 1`)
    .bind(tokenHash, Date.now())
    .first<AuthUser>();
  return user ?? null;
}

export async function logoutSession(request: Request) {
  await ensureAuthSchema();
  const d1 = await getDatabase();
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (token) await d1.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
}

export function clearSessionCookie(request: Request) {
  return serializeCookie("", request, 0);
}

async function createSession(user: AuthUser) {
  const d1 = await getDatabase();
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const now = new Date().toISOString();
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  await d1.batch([
    d1.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").bind(Date.now()),
    d1.prepare("INSERT INTO auth_sessions (token_hash, player_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
      .bind(tokenHash, user.id, expiresAt, now),
  ]);
  return { user, token };
}

export function sessionCookie(token: string, request: Request) {
  return serializeCookie(token, request, SESSION_TTL_SECONDS);
}

function serializeCookie(token: string, request: Request, maxAge: number) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

async function derivePasswordHash(password: string, saltHex: string, iterations: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function randomHex(byteLength: number) {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(byteLength)));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}
