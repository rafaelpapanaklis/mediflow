import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notes = await prisma.adminClinicNote.findMany({
    where: { clinicId: params.id },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { firstName: true, lastName: true, email: true } } },
  });

  return NextResponse.json(notes);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const content = String(body?.content ?? "").trim();
  if (!content) return NextResponse.json({ error: "Contenido vacío" }, { status: 400 });
  if (content.length > 5000) return NextResponse.json({ error: "Máximo 5000 caracteres" }, { status: 400 });

  const note = await prisma.adminClinicNote.create({
    data: { clinicId: params.id, content, authorId: null },
    include: { author: { select: { firstName: true, lastName: true, email: true } } },
  });

  return NextResponse.json(note, { status: 201 });
}
