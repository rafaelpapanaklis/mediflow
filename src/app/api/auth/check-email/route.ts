import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { persistentRateLimit, failbanGuard, recordAuthFailure, AUTH_FLOOD_RATE_LIMIT } from "@/lib/failban";

const schema = z.object({ email: z.string().email() });

// Anti-enumeración: cada consulta cuenta como un "sondeo" por IP. Umbral alto
// para no estorbar el alta legítima (el form valida el correo unas pocas
// veces), pero frena el escaneo masivo de correos desde una misma IP.
const CHECK_EMAIL_POLICY = {
  threshold: 60,
  windowSec: 15 * 60,
  baseLockSec: 30,
  maxLockSec: 10 * 60,
};

async function emailExists(raw: string) {
  const email = raw.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return !!user;
}

export async function GET(req: NextRequest) {
  // Anti-flood (15/60s). El anti-enumeración real lo hace el lockout
  // (CHECK_EMAIL_POLICY, 60/15min); este límite solo frena ráfagas.
  const limited = await persistentRateLimit(req, AUTH_FLOOD_RATE_LIMIT);
  if (limited) return limited;
  const locked = await failbanGuard(req, { scope: "check-email" });
  if (locked) return locked;
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ error: "email required" }, { status: 400 });
  await recordAuthFailure(req, { scope: "check-email", policy: CHECK_EMAIL_POLICY });
  return NextResponse.json({ exists: await emailExists(email) });
}

export async function POST(req: NextRequest) {
  // Anti-flood (15/60s). El anti-enumeración real lo hace el lockout
  // (CHECK_EMAIL_POLICY, 60/15min); este límite solo frena ráfagas.
  const limited = await persistentRateLimit(req, AUTH_FLOOD_RATE_LIMIT);
  if (limited) return limited;
  const locked = await failbanGuard(req, { scope: "check-email" });
  if (locked) return locked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Email inválido" }, { status: 400 });
  }

  await recordAuthFailure(req, { scope: "check-email", policy: CHECK_EMAIL_POLICY });
  try {
    return NextResponse.json({ exists: await emailExists(parsed.data.email) });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
