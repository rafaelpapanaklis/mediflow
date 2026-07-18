import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";


export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const clinicId = params.id;
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      id: true,
      name: true,
      plan: true,
      aiTokensUsed: true,
      aiTokensLimit: true,
      aiLastResetAt: true,
    },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [storageAgg, whatsappCount, xrayAnalysesMonth, cfdiCount] = await Promise.all([
    prisma.patientFile.aggregate({
      where: { clinicId },
      _sum:  { size: true },
      _count: { id: true },
    }),
    prisma.whatsAppReminder.count({
      where: { clinicId, sentAt: { gte: monthStart } },
    }),
    prisma.xrayAnalysis.count({
      where: { clinicId, createdAt: { gte: monthStart } },
    }),
    prisma.cfdiRecord.count({
      where: { clinicId, createdAt: { gte: monthStart } },
    }),
  ]);

  const limits = await getPlanLimits(clinic.plan);
  const storageUsed = storageAgg._sum.size ?? 0;
  const filesCount  = storageAgg._count.id ?? 0;

  return NextResponse.json({
    plan: clinic.plan,
    planLabel: limits.label,
    limits,
    ai: {
      used:  clinic.aiTokensUsed,
      limit: clinic.aiTokensLimit,
      lastResetAt: clinic.aiLastResetAt,
    },
    storage: {
      used:  storageUsed,
      limit: limits.storageBytes,
      files: filesCount,
    },
    whatsapp: {
      sentThisMonth: whatsappCount,
      limit: limits.whatsappMonthly,
    },
    cfdi: {
      stampedThisMonth: cfdiCount,
      limit: limits.cfdiMonthly,
    },
    xray: {
      analysesThisMonth: xrayAnalysesMonth,
    },
  });
}
