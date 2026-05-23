import { type NextRequest, NextResponse } from "next/server";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/proveedores/profile → perfil del proveedor en sesión.
export async function GET() {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const supplier = await prisma.supplier.findUnique({ where: { id: ctx.supplierId } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });

  return NextResponse.json(supplier, {
    headers: { "Cache-Control": "no-store, must-revalidate" },
  });
}

// PATCH /api/proveedores/profile → editar datos del negocio.
// No se permite cambiar email (identidad de auth) ni slug (URL pública estable).
export async function PATCH(req: NextRequest) {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  if (ctx.status !== "APPROVED") {
    return NextResponse.json({ error: "Cuenta no aprobada." }, { status: 403 });
  }
  if (ctx.role !== "OWNER" && ctx.role !== "MANAGER") {
    return NextResponse.json(
      { error: "No tienes permiso para editar el perfil del negocio." },
      { status: 403 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Cuerpo de la solicitud inválido." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const str = (v: unknown): string | undefined => (typeof v === "string" ? v.trim() : undefined);
  const strList = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined;

  const businessName = str(b.businessName);
  if (businessName !== undefined && businessName.length === 0) {
    return NextResponse.json(
      { error: "El nombre del negocio no puede estar vacío." },
      { status: 400 },
    );
  }

  const phone = str(b.phone);
  const address = str(b.address);
  const city = str(b.city);
  const state = str(b.state);
  const description = str(b.description);
  const rfcRaw = str(b.rfc);
  const rfc = rfcRaw !== undefined ? rfcRaw.slice(0, 13) : undefined;
  const categories = strList(b.categories);
  const paymentMethods = strList(b.paymentMethods);

  const willUpdate = [
    businessName,
    phone,
    address,
    city,
    state,
    description,
    rfc,
    categories,
    paymentMethods,
  ].some((v) => v !== undefined);
  if (!willUpdate) {
    return NextResponse.json({ error: "Nada que actualizar." }, { status: 400 });
  }

  const supplier = await prisma.supplier.update({
    where: { id: ctx.supplierId },
    data: {
      ...(businessName !== undefined ? { businessName } : {}),
      ...(phone !== undefined ? { phone: phone || null } : {}),
      ...(address !== undefined ? { address: address || null } : {}),
      ...(city !== undefined ? { city: city || null } : {}),
      ...(state !== undefined ? { state: state || null } : {}),
      ...(description !== undefined ? { description: description || null } : {}),
      ...(rfc !== undefined ? { rfc: rfc || null } : {}),
      ...(categories !== undefined ? { categories } : {}),
      ...(paymentMethods !== undefined ? { paymentMethods } : {}),
    },
  });

  return NextResponse.json(supplier);
}
