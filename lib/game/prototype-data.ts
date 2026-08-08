import type { ControlMode } from "./rules";

export const campaignChapters = [
  {
    number: "01",
    title: "Rookie Driver",
    mode: "Buttons",
    description: "Learn movement, dashing, arena safety, and your first skill.",
    progress: 72,
    status: "active",
    lessons: ["Move & turn", "Dash timing", "Boost & Stone", "First battle"],
    reward: "150 XP · 40 gold",
  },
  {
    number: "02",
    title: "Robot Commander",
    mode: "Live Command",
    description: "Translate intent into commands and learn action durations.",
    progress: 0,
    status: "locked",
    lessons: ["forward(x)", "Turning", "Dash & skill", "Command battle"],
    reward: "220 XP · 60 gold",
  },
  {
    number: "03",
    title: "Junior Programmer",
    mode: "In-game Script",
    description: "Modify a small bot brain, then test it in the ring.",
    progress: 0,
    status: "locked",
    lessons: ["Run a template", "Tune variables", "If conditions", "Script battle"],
    reward: "300 XP · 90 gold",
  },
  {
    number: "04",
    title: "Bot Engineer",
    mode: "Analytics Lab",
    description: "Use replays and behavior data to improve a strategy.",
    progress: 0,
    status: "locked",
    lessons: ["Read a replay", "Action mix", "Trajectory heatmap", "Final assessment"],
    reward: "450 XP · 140 gold",
  },
] as const;

export const marketItems = [
  { id: "wheel-rally", name: "Rally Wheels", slot: "wheel", price: 80, rarity: "Common", color: "#f59f31" },
  { id: "wheel-neon", name: "Neon Rollers", slot: "wheel", price: 180, rarity: "Rare", color: "#b8ff3d" },
  { id: "body-citrus", name: "Citrus Shell", slot: "body", price: 140, rarity: "Common", color: "#ffd166" },
  { id: "body-night", name: "Night Runner", slot: "body", price: 260, rarity: "Rare", color: "#7267f0" },
  { id: "face-happy", name: "Happy Pixels", slot: "face", price: 110, rarity: "Common", color: "#5de0e6" },
  { id: "face-focus", name: "Focus Mode", slot: "face", price: 220, rarity: "Rare", color: "#ff6b6b" },
  { id: "acc-antenna", name: "Signal Antenna", slot: "accessory", price: 160, rarity: "Common", color: "#f2f0e8" },
  { id: "acc-flag", name: "Victory Flag", slot: "accessory", price: 320, rarity: "Epic", color: "#ff5d8f" },
] as const;

export const lobbies: Array<{
  code: string;
  host: string;
  bot: string;
  mode: ControlMode;
  rating: number;
  latency: string;
}> = [
  { code: "RING42", host: "Mika", bot: "Tangerine", mode: "buttons", rating: 8.5, latency: "24 ms" },
  { code: "BYTE17", host: "Noah", bot: "Loop Jr.", mode: "live", rating: 6.25, latency: "31 ms" },
  { code: "STONE9", host: "Ari", bot: "Pebble", mode: "script", rating: 11.75, latency: "42 ms" },
];

export const leaderboard = [
  { rank: 1, player: "Aria", bot: "Orbit", mode: "script", points: 18.5, record: "16W · 3D · 4L" },
  { rank: 2, player: "Kenji", bot: "Push.exe", mode: "script", points: 16.75, record: "14W · 3D · 5L" },
  { rank: 3, player: "Mika", bot: "Tangerine", mode: "buttons", points: 14.25, record: "13W · 1D · 3L" },
  { rank: 4, player: "Noah", bot: "Loop Jr.", mode: "live", points: 12.5, record: "10W · 4D · 2L" },
  { rank: 5, player: "You", bot: "Rivet", mode: "buttons", points: 7.25, record: "6W · 2D · 1L" },
] as const;
