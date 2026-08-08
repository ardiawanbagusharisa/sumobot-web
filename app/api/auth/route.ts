import { NextResponse } from "next/server";
import {
  clearSessionCookie,
  getSessionUser,
  loginAccount,
  logoutSession,
  normalizeLoginId,
  registerAccount,
  sessionCookie,
  validateCredentials,
} from "@/lib/auth/server";

export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    return NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "The account database is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  let body: { action?: unknown; loginId?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (body.action === "logout") {
    await logoutSession(request);
    const response = NextResponse.json({ ok: true });
    response.headers.append("Set-Cookie", clearSessionCookie(request));
    return response;
  }

  if (body.action !== "login" && body.action !== "register") {
    return NextResponse.json({ error: "Unknown authentication action." }, { status: 400 });
  }

  const loginId = normalizeLoginId(body.loginId);
  const validationError = validateCredentials(loginId, body.password);
  if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

  try {
    const result = body.action === "register"
      ? await registerAccount(loginId, body.password as string)
      : await loginAccount(loginId, body.password as string);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });

    const response = NextResponse.json({ user: result.user });
    response.headers.append("Set-Cookie", sessionCookie(result.token, request));
    return response;
  } catch {
    return NextResponse.json({ error: "The account database is temporarily unavailable." }, { status: 503 });
  }
}
