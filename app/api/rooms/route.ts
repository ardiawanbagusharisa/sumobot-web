import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/server";
import { createOnlineRoom, createRealtimeConnection, joinOnlineRoom, listOnlineRooms, synchronizeOnlineRoom, updateOnlineRoom } from "@/lib/online/server";
import type { ControlMode } from "@/lib/game/rules";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const roomId = url.searchParams.get("roomId");
  if (roomId) {
    const user = await getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to access this room." }, { status: 401 });
    try { return NextResponse.json({ room: await synchronizeOnlineRoom(user, roomId) }, { headers: { "Cache-Control": "no-store" } }); }
    catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Room unavailable." }, { status: 404 }); }
  }
  return NextResponse.json({ rooms: await listOnlineRooms(url.searchParams.get("query") ?? undefined) }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to use online rooms." }, { status: 401 });
  const body = await request.json() as {
    action?: string; roomId?: string; accessCode?: string; isPrivate?: boolean;
    controlMode?: ControlMode; roundSeconds?: number; actionIntervalMs?: number;
    bot?: unknown; name?: unknown; duration?: unknown; sequence?: unknown;
  };
  try {
    if (body.action === "create" && body.controlMode && ["buttons", "live", "script"].includes(body.controlMode)) {
      const result = await createOnlineRoom(user, {
        isPrivate: Boolean(body.isPrivate), accessCode: body.accessCode, controlMode: body.controlMode,
        roundSeconds: Number(body.roundSeconds ?? 60), actionIntervalMs: Number(body.actionIntervalMs ?? 250), bot: body.bot,
      });
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json(result, { status: 201 });
    }
    if (body.action === "join" && body.roomId) {
      const result = await joinOnlineRoom(user, body.roomId, body.accessCode, body.bot);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json(result);
    }
    if (body.action === "realtime_ticket" && body.roomId) {
      const result = await createRealtimeConnection(user, body.roomId);
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json(result);
    }
    if (body.roomId && body.action) {
      const result = await updateOnlineRoom(user, body.roomId, body.action, { bot: body.bot, name: body.name, duration: body.duration, sequence: body.sequence });
      if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json(result);
    }
    return NextResponse.json({ error: "Invalid room request." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "The room service is unavailable." }, { status: 503 });
  }
}
