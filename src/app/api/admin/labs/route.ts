import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { DentalLabStatus } from "@/lib/laboratorios/types";
import { parsePageParams } from "@/lib/pagination";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

const LAB_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;

// GET /api/admin/labs[?status=PENDING]
// DentalLab es GLOBAL (sin clinicId): el admin de plataforma ve TODOS los
// laboratorios sin importar la clínica. `status` filtra opcionalmente.
export async function GET(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get("status");
  const status = (LAB_STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as DentalLabStatus)
    : undefined;

  const { take, skip } = parsePageParams(req.nextUrl.searchParams);
  const labs = await prisma.dentalLab.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    skip,
  });
  return NextResponse.json(labs);
}
