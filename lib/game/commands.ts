import { GAME_RULES } from "./rules";

export type BotCommandName = "forward" | "turnleft" | "turnright" | "dash" | "skill";
export interface ParsedBotCommand { name: BotCommandName; duration?: number }

export const BOT_COMMANDS = [
  { name: "forward", syntax: "forward(seconds)", detail: "Move for 0.1–3 seconds." },
  { name: "turnleft", syntax: "turnleft(seconds)", detail: "Rotate left for 0.1–3 seconds." },
  { name: "turnright", syntax: "turnright(seconds)", detail: "Rotate right for 0.1–3 seconds." },
  { name: "dash", syntax: "dash()", detail: "Burst forward when the dash cooldown is ready." },
  { name: "skill", syntax: "skill()", detail: "Activate Boost Drive or Stone Guard when ready." },
] as const;

export function commandHelp(topic?: string) {
  const normalized = topic?.trim().toLowerCase();
  if (normalized) {
    const command = BOT_COMMANDS.find((item) => item.name === normalized || item.syntax === normalized);
    return command ? [`> help ${command.name}`, `${command.syntax} · ${command.detail}`] : [`> help ${normalized}`, `No command named "${normalized}".`, "Type help to list all commands."];
  }
  return ["> help", ...BOT_COMMANDS.map((item) => `${item.syntax} · ${item.detail}`), "clear · clear this command log"];
}

export function parseBotCommand(value: string): { command?: ParsedBotCommand; error?: string } {
  const normalized = value.trim().toLowerCase();
  const timed = normalized.match(/^(forward|turnleft|turnright)\((\d+(?:\.\d+)?)\)$/);
  if (timed) {
    const duration = Number(timed[2]);
    if (duration < GAME_RULES.actionDuration.minimum || duration > GAME_RULES.actionDuration.maximum) return { error: `Duration must be between ${GAME_RULES.actionDuration.minimum} and ${GAME_RULES.actionDuration.maximum} seconds.` };
    return { command: { name: timed[1] as BotCommandName, duration } };
  }
  const instant = normalized.match(/^(dash|skill)\(\)$/);
  if (instant) return { command: { name: instant[1] as BotCommandName } };
  return { error: "Unknown command · type help to list commands." };
}
