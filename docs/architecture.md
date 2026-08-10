# Sumobot Web Architecture

This document describes the architecture implemented on the `online-alpha` branch as of 2026-08-10. It deliberately separates the authoritative online PvP path from the retained browser-simulated PvAI and Lab paths.

## System overview

```mermaid
flowchart LR
    User["Player"]

    subgraph Browser["Browser"]
        App["SumobotApp<br/>React client application"]
        Arena["BattleArena<br/>Canvas simulation and match rules"]
        Script["Script runtime<br/>tokenizer, parser, bounded interpreter"]
        Replay["BattleReplay<br/>Canvas playback and diagnostics"]
        Profile[("localStorage<br/>per-user local profile")]

        App --> Arena
        Arena --> Script
        Arena -->|"telemetry and sampled frames"| App
        App --> Replay
        App <--> Profile
    end

    subgraph Edge["Cloudflare Worker via Vinext"]
        Router["Next App Router / RSC handler"]
        AuthAPI["/api/auth"]
        MatchAPI["/api/matches"]
        RankAPI["/api/leaderboard"]
        AuthService["Auth service"]
        MatchService["Match and leaderboard service"]

        Router --> AuthAPI
        Router --> MatchAPI
        Router --> RankAPI
        AuthAPI --> AuthService
        MatchAPI --> MatchService
        RankAPI --> MatchService
        MatchAPI --> AuthService
    end

    D1[("Cloudflare D1<br/>SQLite-compatible database")]
    Assets[("Static assets")]
    R2[("Cloudflare R2<br/>REPLAYS binding")]

    User --> App
    App -->|"session, match and leaderboard HTTP"| Router
    AuthService --> D1
    MatchService --> D1
    Router --> Assets
    R2 -.->|"configured but not used"| Router
```

The database is now authoritative for account profiles, economy, rooms, PvP outcomes, public records, and leaderboards. Existing browser profiles are imported once and retained only as a device cache. PvAI and Lab simulations still run in the browser; PvP simulation, scripts, scoring, rewards, and disconnect outcomes run on the server.

## Online multiplayer architecture

```mermaid
flowchart LR
    subgraph Clients["Two signed-in browsers"]
        Host["Room creator<br/>bot setup and controls"]
        Guest["Joining player<br/>bot setup and controls"]
        OnlineUI["OnlineBattleRoom<br/>authoritative state renderer"]
        Host --> OnlineUI
        Guest --> OnlineUI
    end

    subgraph API["Sites Worker API"]
        Rooms["/api/rooms<br/>list, search, create, join, ready, act, leave"]
        Profiles["/api/profile<br/>import, sync, market"]
        Service["Online room service<br/>optimistic version checks"]
        Simulation["Server simulation<br/>50 ms fixed steps"]
        DSL["Bounded script runtime<br/>serializable snapshots"]
        Rewards["Idempotent rewards<br/>and match records"]
        Rooms --> Service
        Service --> Simulation
        Simulation --> DSL
        Service --> Rewards
        Profiles --> Service
    end

    D1[("Cloudflare D1<br/>profiles, rooms, matches, reward claims")]

    OnlineUI -->|"200-500 ms polling and actions"| Rooms
    Service <--> D1
    Rewards --> D1
```

Sites currently exposes D1 and R2 bindings but not a dedicated stateful room binding, so the online alpha uses a Sites-compatible HTTP authoritative loop. Each room state has a monotonically increasing version; concurrent updates use compare-and-swap writes and retry. The server advances physics from the last persisted simulation timestamp whenever a player polls or submits an action.

Room lifecycle:

1. The creator chooses public or private access, control mode, timing, and a bot.
2. The guest joins publicly or with the correct hashed private code.
3. Both players receive a 30-second setup deadline and may press Ready early.
4. When both are ready, the server starts a five-second countdown.
5. The server creates and advances the authoritative best-of-three simulation.
6. Explicit departure or a missed heartbeat ends the match as a forfeit.
7. A unique per-room reward claim updates both profiles and public match records exactly once.

## Browser component and gameplay flow

```mermaid
flowchart TD
    Entry["app/page.tsx"] --> Shell["SumobotApp"]

    Shell --> Views["Views<br/>home, battles, campaign, hangar, market, ranks, lab"]
    Shell --> State["React state<br/>bots, scripts, economy, campaign, history, analytics"]
    State <--> Local[("localStorage<br/>sumobot-profile:user-handle")]

    Views --> Setup["Battle configuration"]
    Views --> Lab["Script Lab"]
    Setup --> Arena["BattleArena"]
    Lab -->|"practice script"| Arena

    Buttons["Keyboard and touch input"] --> Actions["Action gate<br/>duration, tick interval, cooldown, stun"]
    Commands["Live command parser"] --> Actions
    DSL["Saved script source"] --> Runtime["Custom script runtime"]
    Runtime -->|"decide game sensors"| Actions
    AI["Built-in opponent decision loop"] --> Actions

    Arena --> Sensors["Arena sensors and bot state"]
    Sensors --> Runtime
    Actions --> Physics["requestAnimationFrame simulation<br/>movement, collision, skills, round outcome"]
    Physics --> Canvas["Canvas arena plus DOM bot visuals"]
    Physics --> Telemetry["250 ms telemetry samples"]
    Physics --> Frames["200 ms replay frames"]

    Telemetry --> Complete["Match completion callback"]
    Frames --> Complete
    Complete --> State
    Frames --> Replay["BattleReplay<br/>interpolation, seeking, diagnostics"]
```

### Simulation authority

`BattleArena` remains the source of truth only for PvAI and Lab matches. Its animation loop:

1. accepts button, live-command, or script actions;
2. runs the opponent decision loop;
3. updates motion and cooldown state;
4. resolves collisions, Stone reflection, stun, and arena exits;
5. advances the best-of-three match state;
6. samples telemetry every 250 ms and replay frames every 200 ms; and
7. returns the final result, telemetry, and replay to `SumobotApp` only after the player claims the result.

For PvP, `lib/online/simulation.ts` is the source of truth. Button and Live actions are validated by the server; Script actions are produced by the bounded interpreter on the server with serialized global state between requests. Clients render returned positions and cannot submit outcomes, rewards, or scores.

## Match completion sequence

```mermaid
sequenceDiagram
    actor Player
    participant Arena as BattleArena
    participant App as SumobotApp
    participant Local as localStorage
    participant Matches as POST /api/matches
    participant Auth as Session lookup
    participant D1 as Cloudflare D1
    participant Ranks as GET /api/leaderboard

    Player->>Arena: Claim result
    Arena->>App: result + telemetry + replay
    App->>App: Apply XP, gold, campaign and analytics
    App->>App: Keep up to 50 logs and 12 full replays
    App->>Local: Persist the local profile
    App->>Matches: Submit client-produced match record
    Matches->>Auth: Resolve HttpOnly session cookie
    Auth->>D1: Read active session and player
    Matches->>D1: Insert match record
    Matches->>D1: Rotate one of three featured replay slots
    Matches-->>App: Created + rank points
    App->>Ranks: Refresh leaderboard
    Ranks->>D1: Aggregate records by player, bot, mode and battle type
    Ranks-->>App: Leaderboard entries
```

Practice matches stop after the local callback and do not grant rewards, update analytics, or submit a public record.

## Active persistence model

```mermaid
erDiagram
    PLAYERS ||--|| AUTH_CREDENTIALS : authenticates_with
    PLAYERS ||--o{ AUTH_SESSIONS : owns
    PLAYERS ||--o{ PROTOTYPE_MATCH_RECORDS : submits
    PROTOTYPE_MATCH_RECORDS ||--o{ FEATURED_REPLAYS : can_fill

    PLAYERS {
        text id PK
        text handle UK
        text display_name
        integer level
        integer total_xp
        integer gold_balance
        text unlocked_modes
    }

    AUTH_CREDENTIALS {
        text player_id PK,FK
        text password_hash
        text password_salt
        integer password_iterations
    }

    AUTH_SESSIONS {
        text token_hash PK
        text player_id FK
        integer expires_at
    }

    PROTOTYPE_MATCH_RECORDS {
        text id PK
        text player_id FK
        text player_handle
        text bot_id
        text bot_name
        text control_mode
        text battle_mode
        text result
        real rank_points
        json telemetry
        json replay
        text played_at
    }

    FEATURED_REPLAYS {
        text slot PK
        text match_record_id FK
        json replay
        text result
        text played_at
        text updated_at
    }
```

The active tables above are created lazily by `ensureAuthSchema` and `ensureMatchSchema`. Passwords use PBKDF2-SHA-256 with per-account salts. Session cookies are HttpOnly, SameSite=Lax, and valid for seven days; only a SHA-256 hash of each session token is stored.

## Data ownership and extension boundaries

| Concern | Current owner | Current persistence | Natural extension boundary |
| --- | --- | --- | --- |
| Live simulation and physics | `BattleArena` in the browser | In-memory refs/state | Move the same commands and rules to an authoritative realtime room |
| Bot scripts | `SumobotApp` and the bounded DSL runtime | Browser `localStorage` | Persist versioned scripts using `bot_profiles` and `bot_versions` |
| Inventory, loadout, currency, campaign | `SumobotApp` | Browser `localStorage` | Wire the corresponding Drizzle tables and server mutations |
| Account and session | Auth API/service | D1 | Add rate limiting, recovery, and account lifecycle operations |
| Public match history and featured replay | Match API/service | D1 JSON columns | Store compact replay manifests in D1 and replay streams in R2 |
| Leaderboard | SQL aggregation over prototype matches | Computed from D1 on request | Materialize seasonal entries and validate authoritative results |
| Analytics | Browser aggregation from telemetry/replays | Browser `localStorage` | Process replay streams asynchronously into `analytics_summaries` |

Online-alpha ownership overrides:

| Concern | Authoritative owner | Persistence |
| --- | --- | --- |
| PvP rooms, readiness, countdown and heartbeat | Online room service | `online_rooms` in D1 |
| PvP physics, scripts, telemetry and replay capture | Server simulation | Versioned JSON room state in D1 |
| Bots, scripts, loadouts, inventory, economy, campaign and history | Profile API | `online_profiles` plus player totals in D1 |
| Reward idempotency | Match/profile services | `online_reward_claims` in D1 |

`db/schema.ts` already defines the intended expanded model (`bot_profiles`, `bot_versions`, inventory/loadout/economy, campaign, normalized matches/rounds/participants, leaderboard entries, replay artifacts, and analytics summaries). Those tables are architectural placeholders today: application routes do not read or write them. Likewise, the `REPLAYS` R2 binding is configured, but replay payloads are currently stored directly in D1.

## Key implementation map

| Area | Primary files |
| --- | --- |
| Application shell and feature orchestration | `app/components/SumobotApp.tsx` |
| Live battle, rules execution, telemetry, replay capture | `app/components/BattleArena.tsx` |
| Replay playback and diagnostics | `app/components/BattleReplay.tsx`, `app/components/BotDiagnosticsPanels.tsx` |
| Script language parser and interpreter | `lib/game/script-runtime.ts` |
| Shared game constants and rewards | `lib/game/rules.ts` |
| Authentication routes and service | `app/api/auth/route.ts`, `lib/auth/server.ts` |
| Match and leaderboard routes and service | `app/api/matches/route.ts`, `app/api/leaderboard/route.ts`, `lib/matches/server.ts` |
| Online rooms and authoritative simulation | `app/api/rooms/route.ts`, `lib/online/server.ts`, `lib/online/simulation.ts` |
| Online profile migration and persistence | `app/api/profile/route.ts`, `lib/profile/server.ts` |
| PvP room browser, lobby and battle renderer | `app/components/OnlineRooms.tsx` |
| Database model and migrations | `db/schema.ts`, `drizzle/` |
| Edge deployment entry and bindings | `worker/index.ts`, `vite.config.ts`, `.openai/hosting.json` |

## Important constraints for future changes

- PvAI outcomes still originate in the browser and are submitted to the match API; PvP outcomes are server-generated.
- Online profiles use optimistic revisions. A stale device write receives the latest server profile instead of overwriting newer rewards.
- The online alpha uses HTTP polling because Sites currently provisions D1/R2 bindings. A future persistent-connection milestone can move each room behind WebSockets and a stateful room runtime without changing the client room contract.
- API schemas are hand-written SQL at runtime even though Drizzle schema and migrations are present. Schema evolution should converge on one migration path before production use.
- Replays are compact tuple arrays, but they are still embedded as JSON in D1 and capped at 750,000 serialized characters per submission.
- The Worker has image, D1, static asset, and R2 bindings. Only D1 and static assets participate in current application data flows.
