import { isAdminAuthed, getAdminSession } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminGlobalEvent } from "@/lib/admin-audit";


const ALLOWED_TYPES = ["info", "warning", "success", "maintenance"] as const;

export async function GET() {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const announcements = await prisma.adminAnnouncement.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(announcements);
}

export async function POST(req: NextRequest) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  logAdminGlobalEvent({
    req, admin: admin.user, entity: "announcement", entityId: created.id,
    action: "create", after: { message, type, active: created.active },
  });

  return NextResponse.json(created, { status: 201 });
}
