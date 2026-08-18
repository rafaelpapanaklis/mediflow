import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { DentalLabStatus } from "@/lib/laboratorios/types";
import { parsePageParams } from "@/lib/pagination";
import { LAB_SELECT } from "@/lib/b2b/vendor-fields";


const LAB_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;

// GET /api/admin/labs[?status=PENDING]
// DentalLab es GLOBAL (sin clinicId): el admin de plataforma ve TODOS los
// laboratorios sin importar la clínica. `status` filtra opcionalmente.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get("status");
  const status = (LAB_STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as DentalLabStatus)
    : undefined;

  const { take, skip } = parsePageParams(req.nextUrl.searchParams);
  // B2B-12: sin `select` esto devolvía la fila entera de CADA laboratorio, con
  // su mpAccessToken de MercadoPago dentro — la credencial con la que se cobra
  // a nombre del vendedor. Es un secreto de un tercero, no de la plataforma.
  const labs = await prisma.dentalLab.findMany({
    where: status ? { status } : undefined,
    select: LAB_SELECT,
    orderBy: { createdAt: "desc" },
    take,
    skip,
  });
  return NextResponse.json(labs);
}
