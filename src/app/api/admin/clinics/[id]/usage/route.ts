import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const [storageAgg, whatsappCount, xrayAnalysesMonth] = await Promise.all([
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
  ]);

  const limits = getPlanLimits(clinic.plan);
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
    xray: {
      analysesThisMonth: xrayAnalysesMonth,
    },
  });
}
