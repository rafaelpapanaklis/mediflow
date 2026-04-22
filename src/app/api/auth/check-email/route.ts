import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

const schema = z.object({ email: z.string().email() });

async function emailExists(raw: string) {
  const email = raw.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  return !!user;
}

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email");
  if (!email) return NextResponse.json({ exists: false });
  return NextResponse.json({ exists: await emailExists(email) });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(req, 10);
  if (limited) return limited;

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

  try {
    return NextResponse.json({ exists: await emailExists(parsed.data.email) });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
