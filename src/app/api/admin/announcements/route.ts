import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

const ALLOWED_TYPES = ["info", "warning", "success", "maintenance"] as const;

export async function GET() {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const announcements = await prisma.adminAnnouncement.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(announcements);
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const message = String(body?.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "Mensaje requerido" }, { status: 400 });
  if (message.length > 2000) return NextResponse.json({ error: "Máximo 2000 caracteres" }, { status: 400 });

  const type = ALLOWED_TYPES.includes(body?.type) ? body.type : "info";
  const endsAt = body?.endsAt ? new Date(body.endsAt) : null;
  const startsAt = body?.startsAt ? new Date(body.startsAt) : new Date();

  const created = await prisma.adminAnnouncement.create({
    data: {
      message,
      type,
      active: body?.active !== false,
      startsAt,
      endsAt,
    },
  });

  return NextResponse.json(created, { status: 201 });
}
