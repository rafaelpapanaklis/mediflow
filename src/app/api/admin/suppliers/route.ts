import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { SupplierStatus } from "@/lib/suppliers/types";

function isAdminAuthed() {
  const token = cookies().get("admin_token")?.value;
  return !!token && token === process.env.ADMIN_SECRET_TOKEN;
}

const SUPPLIER_STATUSES = ["PENDING", "APPROVED", "REJECTED", "SUSPENDED"] as const;

// GET /api/admin/suppliers[?status=PENDING]
// Supplier es GLOBAL (sin clinicId): el admin de plataforma ve TODOS los
// proveedores sin importar la clínica. `status` filtra opcionalmente.
export async function GET(req: NextRequest) {
  if (!isAdminAuthed()) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const statusParam = req.nextUrl.searchParams.get("status");
  const status = (SUPPLIER_STATUSES as readonly string[]).includes(statusParam ?? "")
    ? (statusParam as SupplierStatus)
    : undefined;

  const suppliers = await prisma.supplier.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(suppliers);
}
