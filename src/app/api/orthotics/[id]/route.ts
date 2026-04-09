import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getAuthContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const record = await prisma.formulaRecord.findFirst({
    where: { id: params.id, clinicId: ctx.clinicId, type: "orthotics_pipeline" },
  });
  if (!record) return NextResponse.json({ error: "Orthotics record not found" }, { status: 404 });

  const body = await req.json();
  const currentFormula = record.formula as Record<string, any>;

  const updatedFormula = {
    ...currentFormula,
    ...(body.status !== undefined && { status: body.status }),
    ...(body.notes !== undefined && { notes: body.notes }),
    ...(body.orthoticType !== undefined && { orthoticType: body.orthoticType }),
  };

  const updated = await prisma.formulaRecord.update({
    where: { id: params.id },
    data: { formula: updatedFormula },
  });

  return NextResponse.json(updated);
}
