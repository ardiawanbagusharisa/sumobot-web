import { NextResponse } from "next/server";
import { completeRealtimeRoom } from "@/lib/online/server";
import type { RealtimeCompletionProof } from "@/lib/online/realtime-protocol";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { roomId?: unknown; state?: unknown; proof?: RealtimeCompletionProof };
    if (typeof body.roomId !== "string" || !body.proof) return NextResponse.json({ error: "Invalid completion request." }, { status: 400 });
    const result = await completeRealtimeRoom(body.roomId, body.state, body.proof);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to complete realtime match." }, { status: 503 });
  }
}
