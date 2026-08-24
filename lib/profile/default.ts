import { FSM_SCRIPT, PRIMITIVE_SCRIPT } from "@/lib/game/rules";

export interface StoredProfile {
  bots: Array<Record<string, unknown>>;
  scripts: Array<Record<string, unknown>>;
  analytics: Record<string, unknown[]>;
  battleHistory: Array<Record<string, unknown>>;
  owned: string[];
  gold: number;
  xp: number;
  campaignCompleted: boolean;
}

export function defaultOnlineProfile(): StoredProfile {
  return {
    bots: [
      { id: "rivet", name: "Rivet", skill: "boost", scriptId: "primitive", loadout: { wheel: null, body: "body-citrus", face: "face-happy", accessory: null } },
      { id: "relay", name: "Relay", skill: "stone", scriptId: null, loadout: { wheel: null, body: null, face: null, accessory: null } },
    ],
    scripts: [
      { id: "primitive", name: "Primitive Rules", source: PRIMITIVE_SCRIPT, updatedAt: "Built-in template" },
      { id: "fsm", name: "State Machine", source: FSM_SCRIPT, updatedAt: "Built-in template" },
    ],
    analytics: {},
    battleHistory: [],
    owned: ["body-citrus", "face-happy"],
    gold: 480,
    xp: 320,
    campaignCompleted: false,
  };
}
