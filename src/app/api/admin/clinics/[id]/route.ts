import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return token === process.env.ADMIN_SECRET_TOKEN;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const clinic = await prisma.clinic.update({
    where: { id: params.id },
    data: {
      ...(body.plan        ? { plan: body.plan as any } : {}),
      ...(body.trialEndsAt ? { trialEndsAt: new Date(body.trialEndsAt) } : {}),
      ...(body.name        ? { name: body.name } : {}),
    },
  });
  return NextResponse.json(clinic);
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await prisma.clinic.delete({ where: { id: params.id } });
  return NextResponse.json({ success: true });
}
