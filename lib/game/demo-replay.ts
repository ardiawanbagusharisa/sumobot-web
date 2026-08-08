import type { BattleReplayData, ReplayFrame } from "@/app/components/BattleArena";

const WIDTH = 760;
const HEIGHT = 510;
const ARENA_X = WIDTH / 2;
const ARENA_Y = HEIGHT / 2 + 8;
const ARENA_RADIUS = 205;
const ROUND_MS = 12_000;
const DEMO_DURATION_MS = ROUND_MS * 3;
const collisionTimes = [3_000, 9_000, 15_000, 21_000, 27_000, 33_000];

function createDemoFrames(): ReplayFrame[] {
  const frames: ReplayFrame[] = [];
  for (let elapsed = 0; elapsed <= DEMO_DURATION_MS; elapsed += 200) {
    const round = Math.min(3, Math.floor(elapsed / ROUND_MS) + 1);
    const roundElapsed = elapsed % ROUND_MS;
    const phase = roundElapsed / ROUND_MS * Math.PI * 2;
    const separation = 30 + 82 * Math.abs(Math.cos(phase));
    const vertical = Math.sin(phase * 1.5) * 34;
    const playerX = ARENA_X - separation;
    const enemyX = ARENA_X + separation;
    const playerY = ARENA_Y + vertical;
    const enemyY = ARENA_Y - vertical;
    const nearestCollision = collisionTimes.reduce((nearest, value) => Math.min(nearest, Math.abs(elapsed - value)), Number.POSITIVE_INFINITY);
    const stunned = nearestCollision < 500 ? 1 : 0;
    const collisions = collisionTimes.filter((value) => value <= elapsed).length;
    const playerScore = elapsed >= 12_000 ? elapsed >= 36_000 ? 2 : 1 : 0;
    const enemyScore = elapsed >= 24_000 ? 1 : 0;
    frames.push([
      elapsed,
      round,
      elapsed === DEMO_DURATION_MS ? 0 : ROUND_MS - roundElapsed,
      playerScore,
      enemyScore,
      Math.round(playerX * 10) / 10,
      Math.round(playerY * 10) / 10,
      Math.atan2(enemyY - playerY, enemyX - playerX),
      0,
      stunned,
      Math.round(enemyX * 10) / 10,
      Math.round(enemyY * 10) / 10,
      Math.atan2(playerY - enemyY, playerX - enemyX),
      elapsed % 10_000 > 7_000 ? 1 : 0,
      stunned,
      Math.floor(elapsed / 520),
      Math.floor(elapsed / 1_850),
      Math.floor(elapsed / 2_150),
      Math.floor(elapsed / 5_200),
      Math.floor(elapsed / 10_000),
      collisions,
      Math.floor(elapsed / 610),
      Math.floor(elapsed / 2_050),
      Math.floor(elapsed / 1_760),
      Math.floor(elapsed / 6_100),
      Math.floor(elapsed / 10_000),
      collisions,
    ]);
  }
  return frames;
}

export const HOME_DEMO_REPLAY: BattleReplayData = {
  version: 3,
  arena: { width: WIDTH, height: HEIGHT, x: ARENA_X, y: ARENA_Y, radius: ARENA_RADIUS },
  roundSeconds: ROUND_MS / 1000,
  player: {
    name: "Vector",
    skill: "boost",
    appearance: { wheel: "#30394d", body: "#ffd166", face: "#5de0e6", accessory: "#b8ff3d", faceId: "face-happy", accessoryId: "acc-antenna" },
  },
  enemy: {
    name: "Pebble",
    skill: "stone",
    appearance: { wheel: "#541f25", body: "#ff554f", face: "#fff1e8", accessory: "#ff554f", faceId: "face-focus", accessoryId: "acc-antenna" },
  },
  frames: createDemoFrames(),
};

export const HOME_DEMO_META = {
  id: "demo-replay",
  result: "win" as const,
  playedAt: "Featured prototype match",
};
