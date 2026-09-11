import { BOT_SCRIPT_TEMPLATES } from "@/lib/game/rules";

export interface StoredProfile {
  bots: Array<Record<string, unknown>>;
  scripts: Array<Record<string, unknown>>;
  analytics: Record<string, unknown[]>;
  battleHistory: Array<Record<string, unknown>>;
  owned: string[];
  gold: number;
  xp: number;
  campaignCompleted: boolean;
  campaignProgress: Record<string, Record<string, unknown>>;
  campaignLicenses: string[];
}

export function defaultOnlineProfile(): StoredProfile {
  return {
    bots: [
      { id: "rivet", name: "Rivet", skill: "boost", scriptId: "primitive", loadout: { wheel: null, body: "body-citrus", face: "face-happy", accessory: null } },
      { id: "relay", name: "Relay", skill: "stone", scriptId: null, loadout: { wheel: null, body: null, face: null, accessory: null } },
    ],
    scripts: BOT_SCRIPT_TEMPLATES.map((template) => ({ ...template, updatedAt: "Built-in template" })),
    analytics: {},
    battleHistory: [],
    owned: ["body-citrus", "face-happy"],
    gold: 480,
    xp: 320,
    campaignCompleted: false,
    campaignProgress: {},
    campaignLicenses: [],
  };
}
