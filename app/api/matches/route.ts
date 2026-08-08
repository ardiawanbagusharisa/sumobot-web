import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/server";
import { getFeaturedReplays, recordMatch, validateMatchSubmission } from "@/lib/matches/server";

export async function GET() {
  try {
    const pool = await getFeaturedReplays();
    const featured = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
    return NextResponse.json({ featured, poolSize: pool.length }, { headers: { "Cache-Control": "public, max-age=15" } });
  } catch {
    return NextResponse.json({ featured: null }, { status: 200 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return NextResponse.json({ error: "Sign in to record a match." }, { status: 401 });
    const submission = validateMatchSubmission(await request.json());
    if (!submission) return NextResponse.json({ error: "Invalid match record." }, { status: 400 });
    return NextResponse.json(await recordMatch(user, submission), { status: 201 });
  } catch {
    return NextResponse.json({ error: "The match database is temporarily unavailable." }, { status: 503 });
  }
}
