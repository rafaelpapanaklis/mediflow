import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const photo = await prisma.beforeAfterPhoto.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId },
  });
  if (!photo) {
    return NextResponse.json({ error: "Photo not found" }, { status: 404 });
  }

  await prisma.beforeAfterPhoto.delete({ where: { id: params.id } });

  return NextResponse.json({ success: true });
}
