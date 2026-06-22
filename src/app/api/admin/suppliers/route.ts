import { isAdminAuthed } from "@/lib/admin-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { SupplierStatus } from "@/lib/suppliers/types";
import { parsePageParams } from "@/lib/pagination";


const SUPPLIER_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;

// GET /api/admin/suppliers[?status=PENDING]
// Supplier es GLOBAL (sin clinicId): el admin de plataforma ve TODOS los
// proveedores sin importar la clínica. `status` filtra opcionalmente.
export async function GET(req: NextRequest) {
  if (!(await isAdminAuthed())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get("status");
  const status = (SUPPLIER_STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as SupplierStatus)
    : undefined;

  const { take, skip } = parsePageParams(req.nextUrl.searchParams);
  const suppliers = await prisma.supplier.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    take,
    skip,
  });
  return NextResponse.json(suppliers);
}
