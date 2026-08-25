import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/server";
import { claimCampaignLevel, getOnlineProfile, importOnlineProfile, purchaseMarketItem, saveOnlineProfile } from "@/lib/profile/server";

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to load your profile." }, { status: 401 });
  return NextResponse.json(await getOnlineProfile(user.id), { headers: { "Cache-Control": "no-store" } });
}
export async function POST(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to update your profile." }, { status: 401 });
  const body = await request.json() as { action?: string; profile?: unknown; itemId?: unknown; levelId?: unknown; attempt?: unknown };
  if (body.action === "import") return NextResponse.json(await importOnlineProfile(user, body.profile));
  if (body.action === "purchase" && typeof body.itemId === "string") {
    const result = await purchaseMarketItem(user, body.itemId);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  }
  if (body.action === "campaign_level" && typeof body.levelId === "string") {
    const result = await claimCampaignLevel(user, body.levelId, body.attempt);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json(result);
  }
  return NextResponse.json({ error: "Unknown profile action." }, { status: 400 });
}

export async function PUT(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to update your profile." }, { status: 401 });
  const body = await request.json() as { profile?: unknown; revision?: unknown };
  if (!Number.isInteger(body.revision)) return NextResponse.json({ error: "A profile revision is required." }, { status: 400 });
  const result = await saveOnlineProfile(user, body.profile, Number(body.revision));
  return NextResponse.json(result, { status: result.conflict ? 409 : 200 });
}
