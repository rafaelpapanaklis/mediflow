import { getAdminSession } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAdminClinicMutation } from "@/lib/admin-audit";


export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; noteId: string } },
) {
  const admin = await getAdminSession();
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const note = await prisma.adminClinicNote.findFirst({
    where: { id: params.noteId, clinicId: params.id },
  });
  if (!note) return NextResponse.json({ error: "Nota no encontrada" }, { status: 404 });

  await prisma.adminClinicNote.delete({ where: { id: params.noteId } });

  await logAdminClinicMutation({
    req, admin: admin.user, clinicId: params.id,
    entityType: "clinic-note", entityId: params.noteId, action: "delete",
    before: { content: note.content },
  });

  return NextResponse.json({ success: true });
}
