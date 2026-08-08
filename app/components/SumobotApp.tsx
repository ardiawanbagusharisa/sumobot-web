"use client";
import { useMemo, useState, useEffect, type CSSProperties, type FormEvent } from "react";
import { BattleArena, type BattleReplayData, type BattleTelemetry } from "./BattleArena";
import { BattleReplay } from "./BattleReplay";
import { BotVisual, type BotAppearance } from "./BotVisual";
import { campaignChapters, marketItems } from "@/lib/game/prototype-data";
import { FSM_SCRIPT, MATCH_REWARDS, PRIMITIVE_SCRIPT, RANK_POINTS, STARTER_SCRIPT, type ControlMode, type MatchResult, type SkillType } from "@/lib/game/rules";
import { migrateLegacyJsonScript, parseBotScript } from "@/lib/game/script-runtime";
import { HOME_DEMO_META, HOME_DEMO_REPLAY } from "@/lib/game/demo-replay";
type View = "home" | "play" | "campaign" | "hangar" | "market" | "leaderboard" | "lab";
type CosmeticSlot = (typeof marketItems)[number]["slot"];
type CosmeticId = (typeof marketItems)[number]["id"];
type BattleType = "pvai" | "pvp";
interface BotProfile {
    id: string;
    name: string;
    skill: SkillType;
    scriptId: string | null;
    loadout: Record<CosmeticSlot, CosmeticId | null>;
}
interface SavedScript {
    id: string;
    name: string;
    source: string;
    updatedAt: string;
}
interface ScriptRecord {
    id: string;
    result: MatchResult;
    playedAt: string;
    telemetry: BattleTelemetry;
}
interface BattleLog {
    id: string;
    result: MatchResult;
    mode: ControlMode;
    battleType: BattleType;
    botId: string;
    scriptId: string | null;
    playedAt: string;
    telemetry: BattleTelemetry;
    replay?: BattleReplayData;
}
interface LocalPlayer {
    id: string;
    handle: string;
    displayName: string;
}
interface DatabaseLeaderboardEntry {
    playerId: string;
    player: string;
    botId: string;
    bot: string;
    mode: ControlMode;
    battleMode: BattleType;
    wins: number;
    draws: number;
    losses: number;
    points: number;
}
interface PublicFeaturedReplay {
    replay: BattleReplayData;
    result: MatchResult;
    playedAt: string;
}
interface SavedProfile {
    bots: BotProfile[];
    scripts: SavedScript[];
    analytics: Record<string, ScriptRecord[]>;
    battleHistory: BattleLog[];
    owned: CosmeticId[];
    gold: number;
    xp: number;
    campaignCompleted: boolean;
}
const navItems: Array<{
    id: View;
    label: string;
    mark: string;
}> = [
    { id: "home", label: "Home", mark: "." },
    { id: "play", label: "Battles", mark: ">" }, { id: "campaign", label: "Campaign", mark: "#" }, { id: "hangar", label: "Hangar", mark: "[]" },
    { id: "market", label: "Market", mark: "$" }, { id: "leaderboard", label: "Ranks", mark: "^" }, { id: "lab", label: "Lab", mark: "{}" },
];
const modeCopy: Record<ControlMode, {
    title: string;
    description: string;
}> = {
    buttons: { title: "Button Pilot", description: "Compact keyboard and touch controls." },
    live: { title: "Live Command", description: "Type one API command at a time." },
    script: { title: "Script Pilot", description: "Run the script attached to your selected bot." },
};
const SCRIPT_API_SECTIONS = [
    {
        id: "movement", title: "Movement actions", summary: "Return one action from decide(game) on each game tick.", entries: [
            ["forward(x)", "Move forward for x seconds. x must be between 0.1 and 3.", "return forward(0.4);"],
            ["turnleft(x)", "Rotate counter-clockwise for x seconds.", "if (game.enemy.angle < -10) return turnleft(0.2);"],
            ["turnright(x)", "Rotate clockwise for x seconds.", "if (game.enemy.angle > 10) return turnright(0.2);"],
        ],
    },
    {
        id: "abilities", title: "Ability actions", summary: "Instant actions are accepted only when their cooldown is ready.", entries: [
            ["dash()", "Burst forward. Check game.self.dashReady before calling it.", "if (game.self.dashReady) return dash();"],
            ["skill()", "Activate the bot's equipped Boost or Stone skill.", "if (game.self.skillReady) return skill();"],
        ],
    },
    {
        id: "self", title: "game.self", summary: "Read-only information about your bot.", entries: [
            ["distanceFromCenter", "Distance from the arena center in pixels.", "game.self.distanceFromCenter > game.arena.radius * 0.75"],
            ["angleToCenter", "Signed heading difference toward the center, in degrees.", "game.self.angleToCenter < -10"],
            ["dashReady", "Boolean indicating whether dash() can be accepted.", "game.self.dashReady"],
            ["skillReady", "Boolean indicating whether skill() can be accepted.", "game.self.skillReady"],
            ["skill", "The equipped skill: boost or stone.", `game.self.skill == "stone"`],
        ],
    },
    {
        id: "sensors", title: "Enemy & arena sensors", summary: "Read-only opponent and arena measurements.", entries: [
            ["game.enemy.distance", "Current distance between the bots in bot-width units.", "game.enemy.distance < 2"],
            ["game.enemy.angle", "Signed heading difference toward the opponent, in degrees.", "game.enemy.angle > 10"],
            ["game.enemy.stunned", "Whether the opponent is currently stunned.", "game.enemy.stunned"],
            ["game.enemy.stone", "Whether the opponent currently has Stone active.", "game.enemy.stone"],
            ["game.arena.radius", "Arena radius in pixels; multiply it for portable edge thresholds.", "game.arena.radius * 0.78"],
            ["game.elapsed", "Seconds elapsed since the current match started.", "game.elapsed > 15"],
        ],
    },
] as const;
const emptyLoadout = (): BotProfile["loadout"] => ({ wheel: null, body: null, face: null, accessory: null });
const initialScripts: SavedScript[] = [
    { id: "primitive", name: "Primitive Rules", source: PRIMITIVE_SCRIPT, updatedAt: "Built-in template" },
    { id: "fsm", name: "State Machine", source: FSM_SCRIPT, updatedAt: "Built-in template" },
];
const initialBots: BotProfile[] = [
    { id: "rivet", name: "Rivet", skill: "boost", scriptId: "primitive", loadout: { wheel: null, body: "body-citrus", face: "face-happy", accessory: null } },
    { id: "relay", name: "Relay", skill: "stone", scriptId: null, loadout: emptyLoadout() },
];
const defaultColors: Record<CosmeticSlot, string> = { wheel: "#30394d", body: "#ffd166", face: "#5de0e6", accessory: "#b8ff3d" };
function appearanceFor(bot: BotProfile): BotAppearance {
    const itemFor = (slot: CosmeticSlot) => marketItems.find((item) => item.id === bot.loadout[slot]);
    return {
        wheel: itemFor("wheel")?.color ?? defaultColors.wheel,
        body: itemFor("body")?.color ?? defaultColors.body,
        face: itemFor("face")?.color ?? defaultColors.face,
        accessory: itemFor("accessory")?.color ?? defaultColors.accessory,
        faceId: bot.loadout.face ?? undefined,
        accessoryId: bot.loadout.accessory ?? undefined,
    };
}
function normalizeBots(value: BotProfile[]) {
    return value.map((bot) => ({ ...bot, scriptId: bot.scriptId ?? null, loadout: { ...emptyLoadout(), ...bot.loadout } }));
}
export function SumobotApp() {
    const [view, setView] = useState<View>("home");
    const [player, setPlayer] = useState<LocalPlayer | null>(null);
    const [loginOpen, setLoginOpen] = useState(false);
    const [pendingView, setPendingView] = useState<View | null>(null);
    const [loginName, setLoginName] = useState("");
    const [accessCode, setAccessCode] = useState("");
    const [authMode, setAuthMode] = useState<"login" | "register">("login");
    const [authBusy, setAuthBusy] = useState(false);
    const [authError, setAuthError] = useState("");
    const [bots, setBots] = useState<BotProfile[]>(initialBots);
    const [scripts, setScripts] = useState<SavedScript[]>(initialScripts);
    const [analytics, setAnalytics] = useState<Record<string, ScriptRecord[]>>({});
    const [battleHistory, setBattleHistory] = useState<BattleLog[]>([]);
    const [hangarBotId, setHangarBotId] = useState("rivet");
    const [battleBotId, setBattleBotId] = useState("rivet");
    const [mode, setMode] = useState<ControlMode>("buttons");
    const [battleType, setBattleType] = useState<BattleType>("pvai");
    const [roundSeconds, setRoundSeconds] = useState(60);
    const [actionIntervalMs, setActionIntervalMs] = useState(250);
    const [customTick, setCustomTick] = useState("250");
    const [battleActive, setBattleActive] = useState(false);
    const [practiceBattle, setPracticeBattle] = useState(false);
    const [campaignBattle, setCampaignBattle] = useState(false);
    const [gold, setGold] = useState(480);
    const [xp, setXp] = useState(320);
    const [owned, setOwned] = useState<CosmeticId[]>(["body-citrus", "face-happy"]);
    const [campaignCompleted, setCampaignCompleted] = useState(false);
    const [toast, setToast] = useState<string | null>(null);
    const [selectedScriptId, setSelectedScriptId] = useState("primitive");
    const [scriptName, setScriptName] = useState("Primitive Rules");
    const [scriptDraft, setScriptDraft] = useState(STARTER_SCRIPT);
    const [scriptStatus, setScriptStatus] = useState("Starter script loaded");
    const [leaderboardMode, setLeaderboardMode] = useState<"all" | ControlMode>("all");
    const [leaderboardBattleMode, setLeaderboardBattleMode] = useState<BattleType>("pvai");
    const [databaseLeaderboard, setDatabaseLeaderboard] = useState<DatabaseLeaderboardEntry[]>([]);
    const [publicFeaturedReplay, setPublicFeaturedReplay] = useState<PublicFeaturedReplay | null>(null);
    const [replayLogId, setReplayLogId] = useState<string | null>(null);
    const [homeReplayLogId, setHomeReplayLogId] = useState<string | null>(null);
    const [hangarTab, setHangarTab] = useState<"logs" | "diagnostics">("logs");
    const [labTab, setLabTab] = useState<"api" | "diagnostics">("api");
    const [apiSection, setApiSection] = useState<(typeof SCRIPT_API_SECTIONS)[number]["id"]>("movement");
    const [marketFilter, setMarketFilter] = useState<"all" | CosmeticSlot>("all");
    const [marketEquipItemId, setMarketEquipItemId] = useState<CosmeticId | null>(null);
    const showToast = (message: string) => { setToast(message); window.setTimeout(() => setToast(null), 2800); };
    const applySaved = (saved: SavedProfile | null) => {
        if (!saved)
            return;
        if (saved.bots?.length) {
            const normalized = normalizeBots(saved.bots).slice(0, 3).map((bot) => ({ ...bot, scriptId: bot.scriptId === "starter" ? "primitive" : bot.scriptId }));
            setBots(normalized);
            setHangarBotId(normalized[0].id);
            setBattleBotId(normalized[0].id);
        }
        if (saved.scripts?.length) {
            const custom = saved.scripts.filter((script) => !["starter", "primitive", "fsm"].includes(script.id)).slice(0, 1).map((script) => script.source.trim().startsWith("{") ? { ...script, source: migrateLegacyJsonScript(script.source), updatedAt: "Migrated to Sumobot DSL" } : script);
            const persistedTemplates = initialScripts.map((template) => {
                const savedTemplate = saved.scripts.find((script) => script.id === template.id);
                return !savedTemplate ? template : savedTemplate.source.trim().startsWith("{") ? { ...savedTemplate, source: migrateLegacyJsonScript(savedTemplate.source), updatedAt: "Migrated to Sumobot DSL" } : savedTemplate;
            });
            setScripts([...persistedTemplates, ...custom]);
            setSelectedScriptId("primitive");
            setScriptName(persistedTemplates[0].name);
            setScriptDraft(persistedTemplates[0].source);
        }
        if (saved.analytics)
            setAnalytics(saved.analytics);
        if (saved.battleHistory || saved.analytics) {
            const storedHistory = saved.battleHistory ?? [];
            const storedIds = new Set(storedHistory.map((record) => record.id));
            const recovered: BattleLog[] = Object.entries(saved.analytics ?? {}).flatMap(([scriptId, records]) => records
                .filter((record) => !storedIds.has(record.id))
                .map((record) => ({ ...record, mode: "script" as const, battleType: "pvai" as const, botId: "legacy", scriptId, replay: undefined })));
            const mergedHistory: BattleLog[] = [...recovered, ...storedHistory].slice(-50);
            setBattleHistory(mergedHistory);
            const replayable = mergedHistory.filter((entry) => entry.replay?.frames.length);
            setHomeReplayLogId(replayable.length ? replayable[Math.floor(Math.random() * replayable.length)].id : null);
        }
        if (saved.owned)
            setOwned(saved.owned);
        if (typeof saved.gold === "number")
            setGold(saved.gold);
        if (typeof saved.xp === "number")
            setXp(saved.xp);
        setCampaignCompleted(Boolean(saved.campaignCompleted));
    };
    const resetLocalProfile = () => {
        setBots(initialBots);
        setScripts(initialScripts);
        setAnalytics({});
        setBattleHistory([]);
        setHangarBotId("rivet");
        setBattleBotId("rivet");
        setMode("buttons");
        setBattleType("pvai");
        setRoundSeconds(60);
        setActionIntervalMs(250);
        setCustomTick("250");
        setGold(480);
        setXp(320);
        setOwned(["body-citrus", "face-happy"]);
        setCampaignCompleted(false);
        setSelectedScriptId("primitive");
        setScriptName("Primitive Rules");
        setScriptDraft(STARTER_SCRIPT);
        setScriptStatus("Starter script loaded");
        setReplayLogId(null);
        setHomeReplayLogId(null);
    };
    useEffect(() => {
        const controller = new AbortController();
        void fetch("/api/auth", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
            .then(async (response) => response.ok ? response.json() as Promise<{ user: LocalPlayer | null }> : { user: null })
            .then(({ user }) => {
                if (!user) return;
                try {
                    const profileRaw = window.localStorage.getItem(`sumobot-profile:${user.handle}`);
                    applySaved(profileRaw ? JSON.parse(profileRaw) as SavedProfile : null);
                } catch {
                    showToast("Your device profile could not be read, so defaults were loaded.");
                }
                setPlayer(user);
            })
            .catch(() => undefined);
        return () => controller.abort();
    }, []);
    useEffect(() => {
        const controller = new AbortController();
        void Promise.all([
            fetch("/api/matches", { cache: "no-store", signal: controller.signal }).then((response) => response.json() as Promise<{ featured: PublicFeaturedReplay | null }>),
            fetch("/api/leaderboard", { cache: "no-store", signal: controller.signal }).then((response) => response.json() as Promise<{ entries: DatabaseLeaderboardEntry[] }>),
        ]).then(([featuredPayload, leaderboardPayload]) => {
            setPublicFeaturedReplay(featuredPayload.featured ?? null);
            setDatabaseLeaderboard(leaderboardPayload.entries ?? []);
        }).catch(() => undefined);
        return () => controller.abort();
    }, []);
    useEffect(() => {
        if (!player)
            return;
        const saved: SavedProfile = { bots, scripts, analytics, battleHistory, owned, gold, xp, campaignCompleted };
        window.localStorage.setItem(`sumobot-profile:${player.handle}`, JSON.stringify(saved));
    }, [analytics, battleHistory, bots, campaignCompleted, gold, owned, player, scripts, xp]);
    const protectedViews: View[] = ["play", "campaign", "hangar", "market", "lab"];
    const navigate = (next: View) => {
        if (!player && protectedViews.includes(next)) {
            setPendingView(next);
            setLoginOpen(true);
            showToast("Sign in before entering the arena.");
            return;
        }
        if (next !== "play")
            setBattleActive(false);
        setView(next);
        window.scrollTo({ top: 0, behavior: "smooth" });
    };
    const signIn = async (event: FormEvent) => {
        event.preventDefault();
        setAuthBusy(true);
        setAuthError("");
        try {
            const response = await fetch("/api/auth", {
                method: "POST",
                credentials: "same-origin",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: authMode, loginId: loginName, password: accessCode }),
            });
            const payload = await response.json() as { user?: LocalPlayer; error?: string };
            if (!response.ok || !payload.user) {
                setAuthError(payload.error ?? "Unable to sign in.");
                return;
            }
            const nextPlayer = payload.user;
            try {
                const raw = window.localStorage.getItem(`sumobot-profile:${nextPlayer.handle}`);
                applySaved(raw ? JSON.parse(raw) as SavedProfile : null);
            } catch {
                showToast("Your device profile could not be read, so defaults were loaded.");
            }
            setPlayer(nextPlayer);
            setAccessCode("");
            setLoginOpen(false);
            if (pendingView) setView(pendingView);
            setPendingView(null);
            showToast(authMode === "register" ? `Account created for ${nextPlayer.displayName}.` : `Welcome back, ${nextPlayer.displayName}.`);
        } catch {
            setAuthError("The account service is unavailable. Please try again.");
        } finally {
            setAuthBusy(false);
        }
    };
    const signOut = async () => {
        try { await fetch("/api/auth", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "logout" }) }); } catch { /* The local UI still signs out if the request fails. */ }
        resetLocalProfile();
        setPlayer(null);
        setView("home");
        setBattleActive(false);
        setPendingView(null);
        setAuthMode("login");
        setAuthError("");
    };
    const updateBot = (id: string, changes: Partial<BotProfile>) => setBots((items) => items.map((bot) => bot.id === id ? { ...bot, ...changes } : bot));
    const createBot = () => {
        if (bots.length >= 3) {
            showToast("You can own up to 3 bots.");
            return;
        }
        const bot: BotProfile = { id: `bot-${Date.now()}`, name: `Unit ${bots.length + 1}`, skill: "boost", scriptId: null, loadout: emptyLoadout() };
        setBots((items) => [...items, bot]);
        setHangarBotId(bot.id);
        setBattleBotId(bot.id);
        showToast(`${bot.name} created.`);
    };
    const deleteBot = (id: string) => {
        if (bots.length <= 1) { showToast("You need at least one bot."); return; }
        const target = bots.find((bot) => bot.id === id);
        if (!target || !window.confirm(`Delete ${target.name}? Its saved match logs will be kept.`)) return;
        const remaining = bots.filter((bot) => bot.id !== id);
        setBots(remaining);
        if (hangarBotId === id) setHangarBotId(remaining[0].id);
        if (battleBotId === id) setBattleBotId(remaining[0].id);
        showToast(`${target.name} deleted.`);
    };
    const hangarBot = bots.find((bot) => bot.id === hangarBotId) ?? bots[0];
    const battleBot = bots.find((bot) => bot.id === battleBotId) ?? bots[0];
    const attachedScript = scripts.find((item) => item.id === battleBot?.scriptId) ?? initialScripts[0];
    const selectedScript = scripts.find((item) => item.id === selectedScriptId) ?? scripts[0];
    const marketEquipItem = marketItems.find((item) => item.id === marketEquipItemId) ?? null;
    const filteredMarketItems = marketItems.filter((item) => marketFilter === "all" || item.slot === marketFilter);
    const selectHangarBot = (id: string) => { setHangarBotId(id); setBattleBotId(id); };
    const equipItem = (itemId: CosmeticId) => { const item = marketItems.find((entry) => entry.id === itemId); if (!item || !hangarBot || !owned.includes(itemId))
        return; updateBot(hangarBot.id, { loadout: { ...hangarBot.loadout, [item.slot]: item.id } }); showToast(`${item.name} equipped on ${hangarBot.name}.`); };
    const equipItemOnBot = (itemId: CosmeticId, botId: string) => {
        const item = marketItems.find((entry) => entry.id === itemId);
        const bot = bots.find((entry) => entry.id === botId);
        if (!item || !bot || !owned.includes(itemId)) return;
        updateBot(bot.id, { loadout: { ...bot.loadout, [item.slot]: item.id } });
        setMarketEquipItemId(null);
        showToast(`${item.name} equipped on ${bot.name}.`);
    };
    const clearSlot = (slot: CosmeticSlot) => hangarBot && updateBot(hangarBot.id, { loadout: { ...hangarBot.loadout, [slot]: null } });
    const buyOrEquip = (item: (typeof marketItems)[number]) => {
        if (owned.includes(item.id)) {
            setMarketEquipItemId(item.id);
            return;
        }
        if (gold < item.price) {
            showToast("Not enough gold yet.");
            return;
        }
        setGold((value) => value - item.price);
        setOwned((items) => [...items, item.id]);
        setMarketEquipItemId(item.id);
        showToast(`${item.name} purchased. Choose a bot to equip it.`);
    };
    const selectScript = (script: SavedScript) => { setSelectedScriptId(script.id); setScriptName(script.name); setScriptDraft(script.source); setScriptStatus(`Loaded ${script.name}`); };
    const saveScript = (asCopy: boolean) => {
        try {
            parseBotScript(scriptDraft);
        }
        catch (error) {
            setScriptStatus(error instanceof Error ? error.message : "Invalid script");
            return;
        }
        if (asCopy) {
            if (scripts.length >= 3) {
                setScriptStatus("You can save up to 3 scripts.");
                return;
            }
            const copy: SavedScript = { id: `script-${Date.now()}`, name: scriptName.trim() || "Untitled Strategy", source: scriptDraft, updatedAt: new Date().toLocaleDateString() };
            setScripts((items) => [...items, copy]);
            setSelectedScriptId(copy.id);
            setScriptStatus("Saved as a new script");
        }
        else {
            setScripts((items) => items.map((item) => item.id === selectedScriptId ? { ...item, name: scriptName.trim() || item.name, source: scriptDraft, updatedAt: new Date().toLocaleDateString() } : item));
            setScriptStatus("Saved changes");
        }
    };
    const deleteScript = () => {
        if (!selectedScriptId || ["primitive", "fsm"].includes(selectedScriptId)) { showToast("Built-in learning templates cannot be deleted."); return; }
        const target = scripts.find((script) => script.id === selectedScriptId);
        if (!target || !window.confirm(`Delete ${target.name}? Bots using it will be detached. Existing game logs will remain.`)) return;
        const remaining = scripts.filter((script) => script.id !== target.id);
        const fallback = remaining[0];
        setScripts(remaining);
        setBots((items) => items.map((bot) => bot.scriptId === target.id ? { ...bot, scriptId: null } : bot));
        setAnalytics((current) => { const next = { ...current }; delete next[target.id]; return next; });
        setSelectedScriptId(fallback.id);
        setScriptName(fallback.name);
        setScriptDraft(fallback.source);
        setScriptStatus(`${target.name} deleted`);
    };
    const applyCustomTick = () => {
        const parsed = Number(customTick);
        const next = Number.isFinite(parsed) ? Math.round(Math.min(3000, Math.max(50, parsed))) : actionIntervalMs;
        setActionIntervalMs(next);
        setCustomTick(String(next));
    };
    const startBattle = (practice = false) => {
        if (!battleBot)
            return;
        if (mode === "script" && !battleBot.scriptId && !practice) {
            showToast("Attach a saved script to this bot in the Hangar first.");
            return;
        }
        setPracticeBattle(practice);
        setCampaignBattle(false);
        setBattleActive(true);
        setView("play");
        window.scrollTo({ top: 0, behavior: "smooth" });
    };
    const startLabTest = () => { setMode("script"); setPracticeBattle(true); setCampaignBattle(false); setBattleActive(true); setView("play"); };
    const applyLabBattleScript = (source: string) => {
        setScriptDraft(source);
        if (selectedScriptId) {
            setScripts((items) => items.map((item) => item.id === selectedScriptId ? { ...item, source, updatedAt: new Date().toLocaleDateString() } : item));
        }
        setScriptStatus("Applied from the Lab training match");
    };
    const startCampaignBattle = (nextMode: ControlMode) => { setMode(nextMode); setPracticeBattle(false); setCampaignBattle(true); setBattleActive(true); setView("play"); };
    const finishBattle = (result: MatchResult, telemetry: BattleTelemetry, replay: BattleReplayData) => {
        if (practiceBattle) {
            setBattleActive(false);
            setView("lab");
            showToast("Test complete. No rewards, rank, or analytics were recorded.");
            return;
        }
        const reward = MATCH_REWARDS[result];
        const campaignBonus = campaignBattle && !campaignCompleted;
        setGold((value) => value + reward.gold + (campaignBonus ? 40 : 0));
        setXp((value) => value + reward.xp + (campaignBonus ? 150 : 0));
        if (campaignBonus)
            setCampaignCompleted(true);
        const logId = `match-${Date.now()}`;
        const playedAt = new Date().toLocaleString();
        const publicRecord: PublicFeaturedReplay = { replay, result, playedAt };
        setBattleHistory((current) => {
            const next = [...current, { id: logId, result, mode, battleType, botId: battleBot.id, scriptId: mode === "script" ? battleBot.scriptId : null, playedAt, telemetry, replay }].slice(-50);
            return next.map((entry, index) => index < next.length - 12 && entry.replay ? { ...entry, replay: undefined } : entry);
        });
        setHomeReplayLogId(logId);
        setPublicFeaturedReplay(publicRecord);
        void fetch("/api/matches", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: logId, botId: battleBot.id, botName: battleBot.name, controlMode: mode, battleMode: battleType, result, telemetry, replay, playedAt }),
        }).then(async (response) => {
            if (!response.ok) throw new Error("Match recording failed");
            const leaderboardResponse = await fetch("/api/leaderboard", { cache: "no-store" });
            const payload = await leaderboardResponse.json() as { entries: DatabaseLeaderboardEntry[] };
            setDatabaseLeaderboard(payload.entries ?? []);
        }).catch(() => showToast("Rewards were claimed locally, but the public record could not be updated."));
        if (mode === "script" && battleBot.scriptId) {
            const record: ScriptRecord = { id: logId, result, playedAt, telemetry };
            setAnalytics((current) => ({ ...current, [battleBot.scriptId!]: [...(current[battleBot.scriptId!] ?? []), record].slice(-30) }));
            const usedScript = scripts.find((item) => item.id === battleBot.scriptId);
            if (usedScript) {
                setSelectedScriptId(usedScript.id);
                setScriptName(usedScript.name);
                setScriptDraft(usedScript.source);
            }
        }
        setBattleActive(false);
        setView(campaignBattle ? "campaign" : "home");
        setCampaignBattle(false);
        showToast(`${result.toUpperCase()}: +${reward.xp + (campaignBonus ? 150 : 0)} XP and +${reward.gold + (campaignBonus ? 40 : 0)} gold.`);
    };
    const selectedRecords = useMemo<ScriptRecord[]>(() => battleHistory
        .filter((record) => record.mode === "script" && record.scriptId === selectedScriptId)
        .map(({ id, result, playedAt, telemetry }) => ({ id, result, playedAt, telemetry })), [battleHistory, selectedScriptId]);
    const scriptRecordCounts = useMemo(() => battleHistory.reduce<Record<string, number>>((counts, record) => {
        if (record.mode === "script" && record.scriptId) counts[record.scriptId] = (counts[record.scriptId] ?? 0) + 1;
        return counts;
    }, {}), [battleHistory]);
    const activeApiSection = SCRIPT_API_SECTIONS.find((section) => section.id === apiSection) ?? SCRIPT_API_SECTIONS[0];
    const replayLog = battleHistory.find((entry) => entry.id === replayLogId && entry.replay) ?? null;
    const homeReplayCandidates = useMemo(() => player ? battleHistory.filter((entry) => entry.replay?.frames.length) : [], [battleHistory, player]);
    const selectedHomeReplay = homeReplayCandidates.find((entry) => entry.id === homeReplayLogId) ?? null;
    const homeReplay = publicFeaturedReplay?.replay ?? selectedHomeReplay?.replay ?? HOME_DEMO_REPLAY;
    const homeReplayResult = publicFeaturedReplay?.result ?? selectedHomeReplay?.result ?? HOME_DEMO_META.result;
    const homeReplayPlayedAt = publicFeaturedReplay?.playedAt ?? selectedHomeReplay?.playedAt ?? HOME_DEMO_META.playedAt;
    const selectedBotHistory = useMemo(() => battleHistory.filter((entry) => entry.botId === hangarBot.id), [battleHistory, hangarBot.id]);
    const overallSummary = useMemo(() => {
        const actionCounts = { forward: 0, turnleft: 0, turnright: 0, dash: 0, skill: 0 };
        const heatmap = Array(64).fill(0) as number[];
        const modes = { buttons: { matches: 0, wins: 0, points: 0 }, live: { matches: 0, wins: 0, points: 0 }, script: { matches: 0, wins: 0, points: 0 } };
        let collisions = 0, center = 0, edge = 0, duration = 0, distance = 0;
        battleHistory.forEach((record) => {
            (Object.keys(actionCounts) as Array<keyof typeof actionCounts>).forEach((key) => actionCounts[key] += record.telemetry.actionCounts[key]);
            record.telemetry.trajectory.forEach((value, index) => heatmap[index] += value);
            collisions += record.telemetry.collisions;
            center += record.telemetry.centerSeconds;
            edge += record.telemetry.edgeSeconds;
            duration += record.telemetry.durationSeconds;
            distance += record.telemetry.distanceTravelled;
            modes[record.mode].matches += 1;
            if (record.result === "win") modes[record.mode].wins += 1;
            modes[record.mode].points += RANK_POINTS[record.result];
        });
        const wins = battleHistory.filter((record) => record.result === "win").length;
        const draws = battleHistory.filter((record) => record.result === "draw").length;
        const losses = battleHistory.filter((record) => record.result === "loss").length;
        const totalActions = Object.values(actionCounts).reduce((sum, value) => sum + value, 0);
        const probabilities = Object.values(actionCounts).filter(Boolean).map((value) => value / Math.max(1, totalActions));
        const diversity = probabilities.length > 1 ? -probabilities.reduce((sum, probability) => sum + probability * Math.log(probability), 0) / Math.log(5) : 0;
        return { matches: battleHistory.length, wins, draws, losses, winRate: battleHistory.length ? wins / battleHistory.length : 0, points: battleHistory.reduce((sum, record) => sum + RANK_POINTS[record.result], 0), actionCounts, totalActions, heatmap, collisions, centerShare: duration ? center / duration : 0, edgeShare: duration ? edge / duration : 0, distancePerSecond: duration ? distance / duration : 0, diversity, modes };
    }, [battleHistory]);
    const analyticSummary = useMemo(() => {
        const records = selectedRecords;
        const actionCounts = { forward: 0, turnleft: 0, turnright: 0, dash: 0, skill: 0 };
        const heatmap = Array(64).fill(0) as number[];
        let collisions = 0, center = 0, edge = 0, duration = 0, distance = 0, speed = 0;
        records.forEach((record) => { (Object.keys(actionCounts) as Array<keyof typeof actionCounts>).forEach((key) => actionCounts[key] += record.telemetry.actionCounts[key]); record.telemetry.trajectory.forEach((value, index) => heatmap[index] += value); collisions += record.telemetry.collisions; center += record.telemetry.centerSeconds; edge += record.telemetry.edgeSeconds; duration += record.telemetry.durationSeconds; distance += record.telemetry.distanceTravelled; speed += record.telemetry.averageSpeed; });
        const totalActions = Object.values(actionCounts).reduce((sum, value) => sum + value, 0);
        const probabilities = Object.values(actionCounts).filter(Boolean).map((value) => value / Math.max(1, totalActions));
        const entropy = probabilities.length > 1 ? -probabilities.reduce((sum, p) => sum + p * Math.log(p), 0) / Math.log(5) : 0;
        return { matches: records.length, winRate: records.length ? records.filter((record) => record.result === "win").length / records.length : 0, actionCounts, totalActions, heatmap, collisions, centerShare: duration ? center / duration : 0, edgeShare: duration ? edge / duration : 0, distancePerSecond: duration ? distance / duration : 0, averageSpeed: records.length ? speed / records.length : 0, diversity: entropy };
    }, [selectedRecords]);
    const filteredLeaderboard = useMemo(() => {
        return databaseLeaderboard
            .filter((entry) => entry.battleMode === leaderboardBattleMode && (leaderboardMode === "all" || entry.mode === leaderboardMode))
            .sort((left, right) => right.points - left.points)
            .map((entry, index) => ({ ...entry, player: entry.playerId === player?.id ? "You" : entry.player, record: `${entry.wins}W · ${entry.draws}D · ${entry.losses}L`, rank: index + 1 }));
    }, [databaseLeaderboard, leaderboardBattleMode, leaderboardMode, player]);
    const battleSource = practiceBattle ? scriptDraft : attachedScript.source;
    const visibleNavItems = player ? navItems : navItems.filter((item) => item.id === "home" || item.id === "leaderboard");
    const playerRecordStyle = { "--analytics-empty-display": analyticSummary.matches === 0 ? "block" : "none" } as CSSProperties;
    const battleLogPanel = <section className="battle-log-section" aria-labelledby="battle-log-title">
      <div className="battle-log-heading">
        <div><span className="eyebrow">Selected bot history</span><h2 id="battle-log-title">{hangarBot.name} game log</h2><p>Only claimed matches fought by this bot are shown. The latest 12 profile matches retain replay snapshots.</p></div>
        <strong>{selectedBotHistory.length} match{selectedBotHistory.length === 1 ? "" : "es"}</strong>
      </div>
      <div className="battle-log-table">
        <div className="battle-log-head"><span>Played</span><span>Bot / opponent</span><span>Mode</span><span>Result</span><span>Telemetry</span><span>Replay</span></div>
        {selectedBotHistory.length === 0 ? <div className="battle-log-empty"><strong>No claimed battles for {hangarBot.name} yet.</strong><span>Select this bot before starting a battle to create its first log.</span></div> : [...selectedBotHistory].reverse().map((entry) => {
          const loggedBot = bots.find((bot) => bot.id === entry.botId);
          return <div className="battle-log-row" key={entry.id}>
            <time>{entry.playedAt}</time>
            <span><strong>{entry.replay?.player.name ?? loggedBot?.name ?? "Archived bot"}</strong><small>vs. {entry.battleType === "pvai" ? "Pebble" : "Rival"}</small></span>
            <span className={`table-mode ${entry.mode}`}>{modeCopy[entry.mode].title}</span>
            <strong className={`log-result ${entry.result}`}>{entry.result}</strong>
            <span><strong>{entry.telemetry.collisions} collisions</strong><small>{Math.round(entry.telemetry.durationSeconds)}s · {Object.values(entry.telemetry.actionCounts).reduce((sum, value) => sum + value, 0)} actions</small></span>
            <button type="button" disabled={!entry.replay?.frames.length} onClick={() => setReplayLogId(entry.id)}>{entry.replay?.frames.length ? "Watch replay" : "Log only"}</button>
          </div>;
        })}
      </div>
      {replayLog?.replay && <BattleReplay data={replayLog.replay} result={replayLog.result} playedAt={replayLog.playedAt} onClose={() => setReplayLogId(null)} />}
    </section>;
    const playerDiagnosticsPanel = <section className="player-strategy-diagnostics" aria-labelledby="player-diagnostics-title">
      <div className="player-diagnostics-heading"><div><span className="eyebrow">All bots · all recorded modes</span><h2 id="player-diagnostics-title">Player strategy diagnostics</h2><p>An overall view of claimed battle performance. Lab tests remain excluded.</p></div><strong>{overallSummary.matches} recorded match{overallSummary.matches === 1 ? "" : "es"}</strong></div>
      <div className="player-diagnostic-metrics">
        <article><small>WIN RATE</small><strong>{Math.round(overallSummary.winRate * 100)}%</strong><span>{overallSummary.wins}W · {overallSummary.draws}D · {overallSummary.losses}L</span></article>
        <article><small>RANK POINTS</small><strong>{overallSummary.points.toFixed(2)}</strong><span>Across all control modes</span></article>
        <article><small>CENTER CONTROL</small><strong>{Math.round(overallSummary.centerShare * 100)}%</strong><span>Time in the inner 45%</span></article>
        <article><small>EDGE EXPOSURE</small><strong>{Math.round(overallSummary.edgeShare * 100)}%</strong><span>Time in the outer 22%</span></article>
        <article><small>ACTION DIVERSITY</small><strong>{Math.round(overallSummary.diversity * 100)}%</strong><span>Entropy of action selection</span></article>
        <article><small>COLLISIONS / MATCH</small><strong>{overallSummary.matches ? (overallSummary.collisions / overallSummary.matches).toFixed(1) : "0"}</strong><span>{overallSummary.distancePerSecond.toFixed(1)} px/s path velocity</span></article>
      </div>
      <div className="player-diagnostic-details">
        <article className="player-action-mix"><span className="eyebrow">Overall action distribution</span>{Object.entries(overallSummary.actionCounts).map(([action, count]) => <span key={action}><small>{action}</small><i><b style={{ width: `${overallSummary.totalActions ? count / overallSummary.totalActions * 100 : 0}%` }} /></i><strong>{count}</strong></span>)}</article>
        <article className="player-trajectory"><span className="eyebrow">Aggregate trajectory heatmap</span><div>{overallSummary.heatmap.map((value, index) => { const max = Math.max(1, ...overallSummary.heatmap); return <i key={index} style={{ opacity: value ? .18 + value / max * .82 : .04 }} />; })}</div><small>{overallSummary.matches ? "All authoritative player-position samples" : "Complete a claimed battle to populate this map"}</small></article>
        <article className="player-mode-performance"><span className="eyebrow">Performance by pilot mode</span>{(Object.keys(modeCopy) as ControlMode[]).map((entryMode) => { const modeStats = overallSummary.modes[entryMode]; return <div key={entryMode}><span><strong>{modeCopy[entryMode].title}</strong><small>{modeStats.matches} matches · {modeStats.matches ? Math.round(modeStats.wins / modeStats.matches * 100) : 0}% wins</small></span><b>{modeStats.points.toFixed(2)} pts</b></div>; })}</article>
        <article className="player-outcome-timeline"><span className="eyebrow">Recent outcomes</span><div>{battleHistory.slice(-16).map((record) => <i key={record.id} className={record.result} title={`${record.result} · ${record.playedAt}`} />)}</div><small>Oldest to newest · green win, cyan draw, orange loss</small></article>
      </div>
    </section>;
    const hangarInsightsPanel = <section className="hangar-insights">
      <div className="section-tabs" role="tablist" aria-label="Hangar records">
        <button type="button" role="tab" aria-selected={hangarTab === "logs"} className={hangarTab === "logs" ? "active" : ""} onClick={() => setHangarTab("logs")}>Game logs</button>
        <button type="button" role="tab" aria-selected={hangarTab === "diagnostics"} className={hangarTab === "diagnostics" ? "active" : ""} onClick={() => setHangarTab("diagnostics")}>Diagnostics</button>
      </div>
      {hangarTab === "logs" ? battleLogPanel : playerDiagnosticsPanel}
    </section>;
    const labApiPanel = <section className="api-docs-panel">
      <aside><span className="eyebrow">Script reference</span><h2>Available API</h2><p>Sumobot DSL uses familiar function, variable, if/else, and return syntax. Your decide(game) function returns one action per game tick.</p>{SCRIPT_API_SECTIONS.map((section) => <button type="button" className={apiSection === section.id ? "active" : ""} onClick={() => setApiSection(section.id)} key={section.id}>{section.title}</button>)}</aside>
      <div className="api-docs-content"><section id={`api-${activeApiSection.id}`}><div><span className="eyebrow">{activeApiSection.id}</span><h3>{activeApiSection.title}</h3><p>{activeApiSection.summary}</p></div>{activeApiSection.entries.map(([api, description, example]) => <article key={api}><code>{api}</code><p>{description}</p><pre>{example}</pre></article>)}</section></div>
    </section>;
    const labDiagnosticsPanel = <section className="deep-analytics lab-tab-diagnostics"><div className="analytics-title"><div><span className="eyebrow">Recorded evidence for {selectedScript.name}</span><h2>Strategy diagnostics</h2></div><span>{analyticSummary.matches} real match{analyticSummary.matches === 1 ? "" : "es"} | Lab tests excluded</span></div><div className="deep-metric-grid"><article><small>WIN RATE</small><strong>{Math.round(analyticSummary.winRate * 100)}%</strong><span>Claimed Script battles</span></article><article><small>CENTER CONTROL</small><strong>{Math.round(analyticSummary.centerShare * 100)}%</strong><span>Time in the inner 45%</span></article><article><small>EDGE EXPOSURE</small><strong>{Math.round(analyticSummary.edgeShare * 100)}%</strong><span>Time in the outer 22%</span></article><article><small>ACTION DIVERSITY</small><strong>{Math.round(analyticSummary.diversity * 100)}%</strong><span>Predictability / entropy score</span></article><article><small>PATH VELOCITY</small><strong>{analyticSummary.distancePerSecond.toFixed(1)}</strong><span>Pixels travelled per second</span></article><article><small>COLLISION PRESSURE</small><strong>{analyticSummary.matches ? (analyticSummary.collisions / analyticSummary.matches).toFixed(1) : "0"}</strong><span>Contacts per match</span></article></div><div className="analytics-detail-grid"><article className="behavior-card"><span className="eyebrow">Action distribution</span><div className="behavior-bars">{Object.entries(analyticSummary.actionCounts).map(([label, value]) => <span key={label}><small>{label}</small><i><b style={{ width: `${analyticSummary.totalActions ? value / analyticSummary.totalActions * 100 : 0}%` }}/></i><strong>{value}</strong></span>)}</div></article><article className="actual-heatmap"><span className="eyebrow">Actual trajectory heatmap</span><div className="mini-heatmap">{analyticSummary.heatmap.map((value, index) => { const max = Math.max(1, ...analyticSummary.heatmap); return <i key={index} style={{ opacity: value ? .18 + value / max * .82 : .05 }}/>; })}</div><small>{analyticSummary.matches ? "Aggregated authoritative position samples" : "Complete a real Script battle to populate this map"}</small></article><article className="match-timeline"><span className="eyebrow">Recent outcome timeline</span><div>{selectedRecords.slice(-12).map((record, index) => <i key={record.id} className={record.result} style={{ height: record.result === "win" ? "85%" : record.result === "draw" ? "55%" : "28%" }} title={`${index + 1}. ${record.result} | ${record.playedAt}`}/>)}</div><small>Win / draw / loss sequence reveals strategy stability and drift.</small></article></div></section>;
    const homePanel = <section className="hero-section home-replay-hero">
      <div className="hero-copy">
        <h1>CODE YOUR BOT<br /><em>LEAD THE BOARD.</em></h1>
        <p>Analyze the replays, build the bots, and code a real portfolio.</p>
        <div className="hero-actions"><button className="button button-primary" type="button" onClick={() => navigate("play")}>Battle</button></div>
      </div>
      <div className="home-replay-showcase">
        <div className="home-replay-label"><span className="status-dot" /><small>{publicFeaturedReplay ? "RANDOM PUBLIC BATTLE" : selectedHomeReplay ? "YOUR RANDOM MATCH" : "FEATURED REPLAY"}</small></div>
        <BattleReplay key={publicFeaturedReplay?.playedAt ?? selectedHomeReplay?.id ?? HOME_DEMO_META.id} data={homeReplay} result={homeReplayResult} playedAt={homeReplayPlayedAt} embedded />
      </div>
    </section>;
    const loginPanel = <div className="login-backdrop"><form className="login-card" onSubmit={signIn}>
      <button type="button" className="login-close" onClick={() => { setLoginOpen(false); setAuthError(""); }}>×</button>
      <span className="brand-mark"><i /><i /></span>
      <span className="eyebrow">Database-backed pilot account</span>
      <h2>{authMode === "login" ? "Sign in to battle." : "Create your pilot ID."}</h2>
      <p>{authMode === "login" ? "Use the user ID and password registered for this prototype." : "Choose a simple user ID and a password of at least eight characters."}</p>
      <div className="auth-mode-switch"><button type="button" className={authMode === "login" ? "active" : ""} onClick={() => { setAuthMode("login"); setAuthError(""); }}>Sign in</button><button type="button" className={authMode === "register" ? "active" : ""} onClick={() => { setAuthMode("register"); setAuthError(""); }}>Create account</button></div>
      <label><span>USER ID</span><input autoFocus autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,23}" value={loginName} onChange={(event) => setLoginName(event.target.value)} /></label>
      <label><span>PASSWORD</span><input type="password" autoComplete={authMode === "login" ? "current-password" : "new-password"} minLength={8} maxLength={72} value={accessCode} onChange={(event) => setAccessCode(event.target.value)} /></label>
      {authError && <p className="auth-error" role="alert">{authError}</p>}
      <button className="button button-primary" type="submit" disabled={authBusy}>{authBusy ? "Please wait..." : authMode === "login" ? "Enter hangar →" : "Create account →"}</button>
    </form></div>;
    return <main className="app-shell" style={playerRecordStyle}>
    <header className="site-header"><button className="brand" type="button" onClick={() => navigate("home")}><span className="brand-mark"><i /><i /></span><span>SUMO<strong>BOT</strong></span></button><nav>
{visibleNavItems.map((item) => <button key={item.id} className={view === item.id ? "active" : ""} type="button" onClick={() => navigate(item.id)}><span>{item.mark}</span>{item.label}</button>)}
</nav><div className="player-strip">{player ? <><span><small>XP</small><strong>{xp}</strong></span><span className="gold-pill"><i />{gold}</span><button className="avatar-button" type="button" onClick={() => navigate("hangar")}>{player.displayName.slice(0, 2).toUpperCase()}</button><button className="text-signout" type="button" onClick={signOut}>Sign out</button></> : <button className="header-login" type="button" onClick={() => setLoginOpen(true)}>Login</button>}</div></header>


    {view === "home" && homePanel}

    {view === "play" &&
<section className="content-page page-width play-page">{battleActive ? <><div className="battle-page-heading"><button type="button" onClick={() => { setBattleActive(false); if (practiceBattle)
        setView("lab"); }}>Back to setup</button><span>{practiceBattle ? "Unrecorded Lab test" : `${battleType === "pvai" ? "vs AI" : "vs Player"} | ${roundSeconds}s | ${actionIntervalMs}ms tick`}</span></div><BattleArena key={`${battleBot.id}-${mode}-${practiceBattle}`} mode={mode} playerSkill={battleBot.skill} playerBotName={battleBot.name} playerAppearance={appearanceFor(battleBot)} scriptSource={battleSource} roundSeconds={roundSeconds} actionIntervalMs={actionIntervalMs} battleType={battleType} practice={practiceBattle} onExit={() => { setBattleActive(false); if (practiceBattle)
        setView("lab"); }} onMatchComplete={finishBattle} onApplyScript={practiceBattle ? applyLabBattleScript : undefined}/></> : <><div className="page-intro"><div><span className="eyebrow">Battle configuration</span><h1>Build the match.</h1><p>Select your bot, input mode, round timer, and game tick.</p></div></div><span className="config-section-label">BATTLE MODE</span><div className="battle-type-grid"><button type="button" className={battleType === "pvai" ? "active" : ""} onClick={() => setBattleType("pvai")}><span>AI</span><strong>vs AI</strong><p>Practice against the slower Pebble bot.</p></button><button type="button" className="coming-soon" disabled><span>2P</span><strong>vs Player</strong><p>Coming soon</p></button></div><div className="battle-config-panel"><div className="config-group"><span>1. SELECT BOT</span><div className="config-bot-list">{bots.map((bot) => <button type="button" key={bot.id} className={battleBot.id === bot.id ? "active" : ""} onClick={() => setBattleBotId(bot.id)}>
      <span className="config-bot-visual"><BotVisual name={bot.name} skill={bot.skill} appearance={appearanceFor(bot)} variant="compact"/></span>
      <strong>{bot.name}</strong><small>{scripts.find((item) => item.id === bot.scriptId)?.name ?? "No script"}</small><span className={`config-skill-badge ${bot.skill}`}><i>{bot.skill === "boost" ? "B" : "S"}</i><span><strong>{bot.skill === "boost" ? "BOOST" : "STONE"}</strong><small>{bot.skill === "boost" ? "Speed ×1.5" : "Reflect ×2"}</small></span></span></button>)}</div></div><div className="config-group"><span>2. INPUT MODE</span><div className="config-options">{(Object.keys(modeCopy) as ControlMode[]).map((id) => <button type="button" key={id} className={mode === id ? "active" : ""} onClick={() => setMode(id)}><strong>{modeCopy[id].title}</strong><small>{modeCopy[id].description}</small></button>)}</div></div><div className="config-split"><div className="config-group"><span>3. ROUND TIMER</span><div className="segmented-control">{[30, 60, 120].map((value) => <button type="button" key={value} className={roundSeconds === value ? "active" : ""} onClick={() => { setRoundSeconds(value); }}>{value}s</button>)}</div></div><div className="config-group"><span>4. GAME TICK</span><div className="tick-control"><div className="segmented-control">{[100, 250, 500].map((value) => <button type="button" key={value} className={actionIntervalMs === value ? "active" : ""} onClick={() => { setActionIntervalMs(value); setCustomTick(String(value)); }}>{value}ms</button>)}</div><label><span>CUSTOM</span><input type="number" min="50" max="3000" step="10" value={customTick} onChange={(event) => setCustomTick(event.target.value)} onBlur={applyCustomTick} onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} aria-label="Custom game tick in milliseconds"/><small>ms</small></label></div></div></div>{mode === "script" && <div className={`attached-script-notice ${battleBot.scriptId ? "ready" : "missing"}`}><strong>{battleBot.scriptId ? `Attached: ${attachedScript.name}` : "No script attached"}</strong><span>{battleBot.scriptId ? "A temporary copy can be edited during this battle." : "Open Hangar and attach a saved Lab script before starting Script Pilot."}</span></div>}<button className="button button-primary battle-launch" type="button" onClick={() => startBattle(false)}>START BATTLE &gt;</button></div></>}</section>}

    {view === "campaign" && <section className="content-page page-width"><div className="page-intro campaign-intro"><div><span className="eyebrow">Training pathway</span><h1>From pilot to programmer.</h1><p>Campaign battles use your currently selected bot; input mode is chosen by the lesson.</p></div><div className="campaign-total"><strong>{campaignCompleted ? "25%" : "18%"}</strong><span>CAMPAIGN COMPLETE</span></div></div><div className="campaign-path">{campaignChapters.map((chapter, index) => { const unlocked = index === 0 || (index === 1 && campaignCompleted); const completed = index === 0 && campaignCompleted; return <article key={chapter.number} className={`chapter-card ${completed ? "completed" : unlocked ? "active" : "locked"}`}><div className="chapter-index">{chapter.number}</div><div className="chapter-body"><span className="eyebrow">{chapter.mode}</span><h2>{chapter.title}</h2><p>{chapter.description}</p><div className="lesson-list">{chapter.lessons.map((lesson, lessonIndex) => <span key={lesson} className={(completed || (index === 0 && lessonIndex < 3)) ? "done" : ""}><i>{lessonIndex + 1}</i>{lesson}</span>)}</div><div className="chapter-footer"><span>{chapter.reward}</span>{unlocked ? <button type="button" onClick={() => startCampaignBattle(index === 0 ? "buttons" : "live")}>{completed ? "Replay battle" : "Start lesson battle ->"}</button> : <strong>Locked</strong>}</div></div>{index < campaignChapters.length - 1 && <div className="path-line"/>}</article>; })}</div></section>}

    {view === "hangar" && hangarBot && <section className="content-page page-width"><div className="page-intro"><div><span className="eyebrow">Bots & owned inventory</span><h1>Build Sumo Bot.</h1><p>Customize your bot appearance, skill, and script.</p></div><button className="button button-primary" type="button" onClick={createBot} disabled={bots.length >= 3}>Create Bot</button></div><div className="bot-roster">{bots.map((bot) => <button type="button" key={bot.id} className={hangarBot.id === bot.id ? "active" : ""} onClick={() => selectHangarBot(bot.id)}><span>{bot.name.slice(0, 1).toUpperCase()}</span><strong>{bot.name}</strong><small>{scripts.find((item) => item.id === bot.scriptId)?.name ?? "No script"}</small></button>)}</div><div className="hangar-layout"><div className="hangar-stage"><div className="stage-ring"/><BotVisual name={hangarBot.name} skill={hangarBot.skill} appearance={appearanceFor(hangarBot)}/><div className="hangar-caption"><h2>{hangarBot.name.toUpperCase()}</h2><p>{scripts.find((item) => item.id === hangarBot.scriptId)?.name ?? "No script attached"} | {hangarBot.skill} skill</p></div></div><div className="loadout-panel"><div className="bot-profile-fields"><label><span>BOT NAME</span><input value={hangarBot.name} maxLength={24} onChange={(event) => updateBot(hangarBot.id, { name: event.target.value || "Unnamed Bot" })}/></label><button className="delete-bot" type="button" onClick={() => deleteBot(hangarBot.id)} disabled={bots.length <= 1}>Delete</button></div><span className="eyebrow">Owned cosmetic inventory</span>{(["wheel", "body", "face", "accessory"] as CosmeticSlot[]).map((slot) => <div className="inventory-slot" key={slot}><div><small>{slot.toUpperCase()}</small><strong>{marketItems.find((item) => item.id === hangarBot.loadout[slot])?.name ?? `Standard ${slot}`}</strong></div><div className="inventory-options"><button className={hangarBot.loadout[slot] === null ? "active" : ""} type="button" onClick={() => clearSlot(slot)}>Default</button>{marketItems.filter((item) => item.slot === slot && owned.includes(item.id)).map((item) => <button type="button" key={item.id} className={hangarBot.loadout[slot] === item.id ? "active" : ""} style={{ "--swatch": item.color } as CSSProperties} onClick={() => equipItem(item.id)}>{item.name}</button>)}</div></div>)}<div className="script-inventory"><label><span className="eyebrow">Saved script</span><select value={hangarBot.scriptId ?? ""} onChange={(event) => { if (event.target.value === "__new__") navigate("lab"); else updateBot(hangarBot.id, { scriptId: event.target.value || null }); }}><option value="">No attached script</option>{scripts.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}<option value="__new__">+ Add New Script</option></select></label></div><div className="loadout-skill"><span><small>SPECIAL SKILL</small><strong>{hangarBot.skill === "boost" ? "Boost Drive" : "Stone Guard"}</strong></span><button type="button" onClick={() => updateBot(hangarBot.id, { skill: hangarBot.skill === "boost" ? "stone" : "boost" })}>Switch skill</button></div></div></div>{hangarInsightsPanel}</section>}

    {/* Legacy placement removed:
      <div className="battle-log-heading">
        <div><span className="eyebrow">Saved match history</span><h2 id="battle-log-title">Game log</h2><p>Claimed battles are recorded here. The latest 12 include position snapshots for replay.</p></div>
        <strong>{battleHistory.length} match{battleHistory.length === 1 ? "" : "es"}</strong>
      </div>
      <div className="battle-log-table">
        <div className="battle-log-head"><span>Played</span><span>Bot / opponent</span><span>Mode</span><span>Result</span><span>Telemetry</span><span>Replay</span></div>
        {battleHistory.length === 0 ? <div className="battle-log-empty"><strong>No claimed battles yet.</strong><span>Complete a battle and claim its rewards to create your first replay.</span></div> : [...battleHistory].reverse().map((entry) => {
          const loggedBot = bots.find((bot) => bot.id === entry.botId);
          return <div className="battle-log-row" key={entry.id}>
            <time>{entry.playedAt}</time>
            <span><strong>{entry.replay?.player.name ?? loggedBot?.name ?? "Archived bot"}</strong><small>vs. {entry.battleType === "pvai" ? "Pebble" : "Rival"}</small></span>
            <span className={`table-mode ${entry.mode}`}>{modeCopy[entry.mode].title}</span>
            <strong className={`log-result ${entry.result}`}>{entry.result}</strong>
            <span><strong>{entry.telemetry.collisions} collisions</strong><small>{Math.round(entry.telemetry.durationSeconds)}s · {Object.values(entry.telemetry.actionCounts).reduce((sum, value) => sum + value, 0)} actions</small></span>
            <button type="button" disabled={!entry.replay?.frames.length} onClick={() => setReplayLogId(entry.id)}>{entry.replay?.frames.length ? "Watch replay" : "Log only"}</button>
          </div>;
        })}
      </div>
      {replayLog?.replay && <BattleReplay data={replayLog.replay} result={replayLog.result} playedAt={replayLog.playedAt} onClose={() => setReplayLogId(null)} />}
    </section> */}

    {view === "market" && hangarBot &&
      <section className="content-page page-width market-page"><div className="page-intro"><div><span className="eyebrow">Cosmetic market</span><h1>Make every bot distinct.</h1><p>Equip your bot with the killer looks.</p></div><div className="wallet-card"><small>YOUR BALANCE</small><strong><i className="coin-icon"/> {gold}</strong></div></div><div className="market-filter"><span>Category</span>{(["all", "wheel", "body", "face", "accessory"] as const).map((filter) => <button type="button" key={filter} className={marketFilter === filter ? "active" : ""} onClick={() => setMarketFilter(filter)}>{filter}</button>)}</div><div className="market-scroll"><div className="market-grid">{filteredMarketItems.map((item) => { const isOwned = owned.includes(item.id), equippedBots = bots.filter((bot) => bot.loadout[item.slot] === item.id); return <article className={`market-card ${equippedBots.length ? "equipped" : ""}`} key={item.id}><div className="market-art" style={{ "--item-color": item.color } as CSSProperties}><span className={`cosmetic-shape ${item.slot}`}/><small>{item.slot}</small></div><div className="market-info"><span>{item.rarity}</span><h2>{item.name}</h2><button className={isOwned ? "owned" : ""} type="button" onClick={() => buyOrEquip(item)}>{isOwned ? equippedBots.length ? `Equip · ${equippedBots.length} bot${equippedBots.length === 1 ? "" : "s"}` : "Equip" : <><i className="coin-icon"/> {item.price}</>}</button></div></article>; })}</div></div></section>}
    {marketEquipItem && <div className="equip-prompt-backdrop"><section className="equip-prompt" role="dialog" aria-modal="true" aria-label={`Equip ${marketEquipItem.name}`}><button type="button" className="equip-prompt-close" onClick={() => setMarketEquipItemId(null)}>×</button><span className="eyebrow">Choose a bot</span><h2>Equip {marketEquipItem.name}</h2><p>This changes only the {marketEquipItem.slot} slot.</p><div>{bots.map((bot) => <button type="button" key={bot.id} onClick={() => equipItemOnBot(marketEquipItem.id, bot.id)}><strong>{bot.name}</strong><small>{bot.loadout[marketEquipItem.slot] === marketEquipItem.id ? "Currently equipped" : `Equip ${marketEquipItem.slot}`}</small></button>)}</div></section></div>}

    {view === "leaderboard" && <section className="content-page page-width"><div className="page-intro ranks-intro"><div><span className="eyebrow">Rankings</span><h1>Every claimed match counts.</h1><p>Win +1.00 | Draw +0.50 | Loss +0.25.</p></div><div className="rank-filters"><div><small>BATTLE MODE</small><div className="segmented-control"><button type="button" className={leaderboardBattleMode === "pvai" ? "active" : ""} onClick={() => setLeaderboardBattleMode("pvai")}>vs AI</button><button type="button" className={`${leaderboardBattleMode === "pvp" ? "active " : ""}coming-soon`} onClick={() => setLeaderboardBattleMode("pvp")}>vs Player · coming soon</button></div></div><div><small>INPUT MODE</small><div className="segmented-control">{(["all", "buttons", "live", "script"] as const).map((filter) => <button type="button" key={filter} className={leaderboardMode === filter ? "active" : ""} onClick={() => setLeaderboardMode(filter)}>{filter}</button>)}</div></div></div></div><div className="leaderboard-table"><div className="table-head"><span>Rank</span><span>Competitor</span><span>Mode</span><span>Record</span><span>Points</span></div>{filteredLeaderboard.length ? filteredLeaderboard.map((entry) => <div className={`table-row ${entry.player === "You" ? "you" : ""}`} key={`${entry.playerId}-${entry.botId}-${entry.mode}`}><strong>#{entry.rank}</strong><span><i>{entry.player.slice(0, 2).toUpperCase()}</i><span><small>{entry.player}</small><strong>{entry.bot}</strong></span></span><span className={`table-mode ${entry.mode}`}>{modeCopy[entry.mode].title}</span><code>{entry.record}</code><strong>{entry.points.toFixed(2)}</strong></div>) : <div className="leaderboard-empty"><strong>{leaderboardBattleMode === "pvp" ? "vs Player is coming soon." : "No recorded rankings yet."}</strong><span>{leaderboardBattleMode === "pvp" ? "This mode intentionally has no ranking data yet." : "Complete a claimed vs AI battle to create the first database ranking."}</span></div>}</div></section>}

    {view === "lab" && selectedScript && <section className="content-page page-width lab-page">
      <div className="page-intro"><div><span className="eyebrow">Script library & evidence</span><h1>Build. Test. Inspect.</h1><p>Write familiar code, attach it to bots, and inspect data from real claimed Script battles.</p></div><button className="button button-primary" type="button" onClick={startLabTest}>TEST RUN &gt;</button></div>
      <div className="script-workbench"><div className="editor-card">
        <div className="editor-toolbar lab-editor-toolbar">
          <label><span>Saved script · {scripts.length}/3</span><select value={selectedScriptId} onChange={(event) => { const item = scripts.find((script) => script.id === event.target.value); if (item) selectScript(item); }}><option value="" disabled>Unsaved script</option>{scripts.map((item) => <option key={item.id} value={item.id}>{item.name} · {scriptRecordCounts[item.id] ?? 0} matches</option>)}</select></label>
          <button type="button" disabled={scripts.length >= 3} onClick={() => { setScriptName("Untitled Strategy"); setScriptDraft(STARTER_SCRIPT); setSelectedScriptId(""); setScriptStatus("New script ready"); }}>+ New script</button>
          <button className="delete-script" type="button" title={["primitive", "fsm"].includes(selectedScriptId) ? "Built-in templates are always available" : "Delete selected script"} disabled={!selectedScriptId || ["primitive", "fsm"].includes(selectedScriptId)} onClick={deleteScript}>Delete</button>
          <input value={scriptName} onChange={(event) => setScriptName(event.target.value)} aria-label="Script name"/><span>{scriptStatus}</span>
        </div>
        <div className="editor-body"><div className="line-numbers">{Array.from({ length: scriptDraft.split("\n").length }, (_, index) => <span key={index}>{index + 1}</span>)}</div><textarea value={scriptDraft} onChange={(event) => setScriptDraft(event.target.value)} spellCheck={false}/></div>
        <div className="editor-footer"><button type="button" onClick={() => saveScript(false)} disabled={!selectedScriptId}>Save changes</button><button type="button" onClick={() => saveScript(true)} disabled={scripts.length >= 3}>Save as new</button></div>
      </div></div>
      <div className="section-tabs lab-section-tabs" role="tablist" aria-label="Lab reference and diagnostics"><button type="button" role="tab" aria-selected={labTab === "api"} className={labTab === "api" ? "active" : ""} onClick={() => setLabTab("api")}>Available API</button><button type="button" role="tab" aria-selected={labTab === "diagnostics"} className={labTab === "diagnostics" ? "active" : ""} onClick={() => setLabTab("diagnostics")}>Diagnostics</button></div>{labTab === "api" ? labApiPanel : labDiagnosticsPanel}
    </section>}

    <footer className="site-footer"><button type="button" className="brand footer-brand" onClick={() => navigate("home")}><span className="brand-mark"><i /><i /></span><span>SUMO<strong>BOT</strong></span></button><p>Local prototype | Build 0.3 | Recorded Lab analytics</p><span>ANALYZE | BUILD | CODE</span></footer>
    {loginOpen && loginPanel}
    {toast && <div className="toast" role="status">{toast}</div>}
  </main>;
}
