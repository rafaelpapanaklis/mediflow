import { NextResponse } from "next/server";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getPlanLimits } from "@/lib/plans";
import { medirAlmacenamiento } from "@/lib/storage-usage";
import { resumirAlmacenamiento } from "@/lib/storage-usage-core";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/storage/usage
 *
 * Almacenamiento de la clínica de la sesión para la tarjeta «Almacenamiento»
 * (Configuración → Suscripción) y el aviso del panel. Admin de la clínica. Usa
 * la MISMA función de uso (`medirAlmacenamiento`) que la cuota de subida y
 * /admin. El clinicId sale de la sesión, nunca del cliente.
 */
export async function GET() {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;
  const clinicId = ctx!.clinicId;
  if (!clinicId) return NextResponse.json({ error: "Sin clínica" }, { status: 400 });

  const clinic = await prisma.clinic.findUnique({ where: { id: clinicId }, select: { plan: true } });
  const { storageBytes } = await getPlanLimits(clinic?.plan);
  const { porClinica, avisos } = await medirAlmacenamiento([clinicId]);
  const resumen = resumirAlmacenamiento(porClinica.get(clinicId)!, storageBytes ?? null);
  return NextResponse.json({ ...resumen, clinicId, parcial: avisos.length > 0 }, { headers: { "Cache-Control": "private, no-store" } });
}
