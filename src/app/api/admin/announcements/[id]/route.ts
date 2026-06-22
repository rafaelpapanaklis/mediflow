import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


const ALLOWED_TYPES = ["info", "warning", "success", "maintenance"] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const data: any = {};
  if (typeof body?.message === "string") {
    const m = body.message.trim();
    if (!m) return NextResponse.json({ error: "Mensaje vacío" }, { status: 400 });
    data.message = m;
  }
  if (typeof body?.type === "string" && ALLOWED_TYPES.includes(body.type)) data.type = body.type;
  if (typeof body?.active === "boolean") data.active = body.active;
  if (body?.startsAt) data.startsAt = new Date(body.startsAt);
  if (body?.endsAt !== undefined) data.endsAt = body.endsAt ? new Date(body.endsAt) : null;

  const updated = await prisma.adminAnnouncement.update({
    where: { id: params.id },
    data,
  });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.adminAnnouncement.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
