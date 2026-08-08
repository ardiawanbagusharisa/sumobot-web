import { NextResponse } from "next/server";
import { getLeaderboard } from "@/lib/matches/server";

export async function GET() {
  try {
    return NextResponse.json({ entries: await getLeaderboard() }, { headers: { "Cache-Control": "public, max-age=15" } });
  } catch {
    return NextResponse.json({ entries: [] }, { status: 200 });
  }
}
