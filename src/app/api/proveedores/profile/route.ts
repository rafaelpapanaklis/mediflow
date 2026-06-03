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
  const whatsapp = str(b.whatsapp);
  const website = str(b.website);
  const mapsUrl = str(b.mapsUrl);
  const shippingNote = str(b.shippingNote);
  const rfcRaw = str(b.rfc);
  const rfc = rfcRaw !== undefined ? rfcRaw.slice(0, 13) : undefined;
  const categories = strList(b.categories);
  const paymentMethods = strList(b.paymentMethods);

  // mapsUrl: si viene con valor, exige una URL http(s) válida (evita guardar
  // esquemas peligrosos como javascript:/data: que luego se renderizan como href).
  if (mapsUrl !== undefined && mapsUrl !== "") {
    let validUrl = false;
    try {
      const u = new URL(mapsUrl);
      validUrl = u.protocol === "http:" || u.protocol === "https:";
    } catch {
      validUrl = false;
    }
    if (!validUrl) {
      return NextResponse.json({ error: "El enlace de Google Maps no es válido." }, { status: 400 });
    }
  }

  // minOrderAmount: monto mínimo de pedido. undefined = no cambiar; null/"" = limpiar;
  // entero >= 0 en cualquier otro caso.
  let minOrderAmount: number | null | undefined = undefined;
  if (b.minOrderAmount !== undefined) {
    if (b.minOrderAmount === null || b.minOrderAmount === "") {
      minOrderAmount = null;
    } else {
      const n = Math.floor(Number(b.minOrderAmount));
      if (!Number.isInteger(n) || n < 0) {
        return NextResponse.json({ error: "El pedido mínimo no es válido." }, { status: 400 });
      }
      minOrderAmount = n;
    }
  }

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
    whatsapp,
    website,
    mapsUrl,
    shippingNote,
    minOrderAmount,
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
      ...(whatsapp !== undefined ? { whatsapp: whatsapp || null } : {}),
      ...(website !== undefined ? { website: website || null } : {}),
      ...(mapsUrl !== undefined ? { mapsUrl: mapsUrl || null } : {}),
      ...(shippingNote !== undefined ? { shippingNote: shippingNote || null } : {}),
      ...(minOrderAmount !== undefined ? { minOrderAmount } : {}),
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
