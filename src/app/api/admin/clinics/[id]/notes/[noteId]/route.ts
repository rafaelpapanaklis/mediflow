import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; noteId: string } },
) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const note = await prisma.adminClinicNote.findFirst({
    where: { id: params.noteId, clinicId: params.id },
  });
  if (!note) return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });

  await prisma.adminClinicNote.delete({ where: { id: params.noteId } });
  return NextResponse.json({ success: true });
}
