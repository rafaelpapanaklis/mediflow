import { type NextRequest, NextResponse } from "next/server";
import { getSupplierContext } from "@/lib/supplier-auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// GET /api/proveedores/profile → perfil del proveedor en sesión.
// Nunca expone mpAccessToken en claro: solo `mpConnected` (boolean).
export async function GET() {
  const ctx = await getSupplierContext();
  if (!ctx) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const supplier = await prisma.supplier.findUnique({ where: { id: ctx.supplierId } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });

  const { mpAccessToken, ...safe } = supplier;
  return NextResponse.json(
    { ...safe, mpConnected: Boolean(mpAccessToken) },
    { headers: { "Cache-Control": "no-store, must-revalidate" } },
  );
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
  const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

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

  // Métodos de pago B2B (rails reales) + token de MercadoPago del proveedor.
  const payTransferEnabled = bool(b.payTransferEnabled);
  const payMercadoPagoEnabled = bool(b.payMercadoPagoEnabled);
  const payCashEnabled = bool(b.payCashEnabled);

  // mpAccessToken: undefined = no tocar; "" = desconectar (null); string = set.
  // Nunca se devuelve en claro (ver GET). Sólo OWNER/MANAGER (gateado arriba).
  let mpAccessToken: string | null | undefined = undefined;
  if (b.mpAccessToken !== undefined) {
    const t = typeof b.mpAccessToken === "string" ? b.mpAccessToken.trim() : "";
    mpAccessToken = t.length > 0 ? t : null;
  }

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
    payTransferEnabled,
    payMercadoPagoEnabled,
    payCashEnabled,
    mpAccessToken,
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
      ...(payTransferEnabled !== undefined ? { payTransferEnabled } : {}),
      ...(payMercadoPagoEnabled !== undefined ? { payMercadoPagoEnabled } : {}),
      ...(payCashEnabled !== undefined ? { payCashEnabled } : {}),
      ...(mpAccessToken !== undefined ? { mpAccessToken } : {}),
    },
  });

  // No devolvemos el token en claro en la respuesta del PATCH.
  const { mpAccessToken: _omit, ...safe } = supplier;
  return NextResponse.json({ ...safe, mpConnected: Boolean(supplier.mpAccessToken) });
}
