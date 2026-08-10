# sumobot-web
Sumobot web version

An online web prototype for programmable sumo robot battles. The current vertical slice includes authoritative two-player rooms, a playable best-of-three match, three control modes, account-backed progression, a cosmetic market and inventory, leaderboards, a scripting lab, replays, and analytics views.

## Run locally

Requirements: Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. Local development uses only free and open-source dependencies; no domain, hosting account, or paid service is required.

## Validate

```bash
npm run build
npm run typecheck
npm test
```

Generate a migration after changing `db/schema.ts`:

```bash
npm run db:generate
```

## Prototype rules

- A match is best of three rounds.
- Button and script rounds last 60 seconds; live-command rounds last 120 seconds.
- If neither bot leaves the arena before time expires, the round is a draw.
- Ranked queues are separated by control mode.
- Timed movement accepts 0.1–3 seconds.
- Boost and Stone last 3 seconds and have a 10-second cooldown.
- Stone freezes the bot and reflects impacts with 2× force.
- Rank points start at 0: win +1, draw +0.5, loss +0.25.
- Match rewards are 100 XP / 25 gold for a win, 75 / 15 for a draw, and 50 / 10 for a loss.
- Online room players have up to 30 seconds to configure and ready their bot; a five-second countdown begins when both are ready.
- Leaving or losing the room heartbeat forfeits an online match to the remaining player.

## Architecture direction

See [docs/architecture.md](docs/architecture.md) for diagrams of the implemented runtime, gameplay flow, match-recording sequence, active persistence model, and extension boundaries.

The browser prototype keeps gameplay iteration fast with React and Canvas. The data model is already split into match, round, participant, replay artifact, telemetry summary, economy, campaign, and leaderboard records so the next milestone can move simulation authority to a realtime server without redesigning stored data.

For a public test, the intended free/open-source stack is Phaser or Canvas for rendering, Colyseus for authoritative rooms, Rapier for physics, PostgreSQL/Drizzle for durable records, Redis for ephemeral matchmaking, and object storage for compressed replay streams. Managed hosting may have usage limits, but none of those libraries requires a paid license.

Replay data should be stored as a compact initial snapshot plus timestamped player intents, authoritative collision/outcome events, and periodic correction keyframes. Analytics charts should read pre-aggregated per-match and per-version summaries; raw high-frequency telemetry remains in replay storage for asynchronous recomputation.
