import { NextRequest, NextResponse } from "next/server";
import { cfdiTimbradosDelGrupo } from "@/lib/billing/sedes-incluidas";
import { getAuthContext, requireAdmin } from "@/lib/auth-context";
import { prisma } from "@/lib/prisma";
import { getResolvedPlan } from "@/lib/plans";
import { cfdiPeriodFor, cfdiOverage } from "@/lib/cfdi-quota";
import { resolveOverageBilling, CFDI_OVERAGE_METHOD } from "@/lib/cfdi-overage";
import { isFacturapiLive } from "@/lib/facturapi-env";
import { avisosDelEmisor, faltantesDelEmisor, textoDeFaltantes } from "@/lib/cfdi/emisor";
import { retencionDelEmisor } from "@/lib/invoices/cfdi-reglas";
import { retencionesEncendidas } from "@/lib/cfdi/retenciones.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cfdi/usage
 *
 * Consumo de facturas CFDI del mes en curso de la clínica de la sesión, para la
 * card "Facturación CFDI" del panel (Configuración → Suscripción). Admin de la
 * clínica. Aísla por clinicId de la sesión (nunca del cliente).
 */
export async function GET(_req: NextRequest) {
  const ctx = await getAuthContext();
  const err = requireAdmin(ctx);
  if (err) return err;

  const clinicId = ctx!.clinicId;
  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      plan: true,
      timezone: true,
      stripeSubscriptionId: true,
      stripeCustomerId: true,
      stripePaymentMethodId: true,
      // Impuestos por default de la clínica: el modal de timbrado ya pide este
      // endpoint al abrir el sub-form, así lo usa para pre-llenar el selector sin
      // un round-trip extra ni pasar la clínica por props a los 4 sitios donde se
      // monta InvoiceDetailModal.
      cfdiTaxMode: true,
      // ws1-t8 (F-15): CSD vencido / por vencer y persona moral en «exento» para el formulario
      // de timbrado. Sin llamar a Facturapi (el RFC del CSD se compara en Configuración).
      rfcEmisor: true,
      csdUploaded: true,
      csdValidUntil: true,
      locale: true,
      // C-44 (auditoría de uso): ¿puede timbrar ya? Para avisarlo al ABRIR el formulario.
      facturApiEnabled: true,
      facturApiOrgId: true,
      regimenFiscal: true,
      cpEmisor: true,
      // C-54: sin WhatsApp conectado el formulario no ofrece mandar el CFDI por ahí.
      waConnected: true,
      waPhoneNumberId: true,
      waAccessToken: true,
    },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const period = cfdiPeriodFor(new Date(), clinic.timezone);

  const [usage, plan, debtRows] = await Promise.all([
    prisma.cfdiUsage.findUnique({
      where: { clinicId_period: { clinicId, period } },
      select: { stamped: true },
    }),
    getResolvedPlan(clinic.plan),
    // Adeudos por excedente de meses previos sin pagar (SPEI/sin método/cobro
    // fallido) — mismo ledger SubscriptionInvoice con método propio.
    prisma.subscriptionInvoice.findMany({
      where: { clinicId, status: "pending", method: CFDI_OVERAGE_METHOD },
      select: { amount: true },
    }),
  ]);

  // M5 (ws1-t5): el cupo del mes es del dueño, compartido con sus sedes incluidas.
  const q = cfdiOverage(await cfdiTimbradosDelGrupo(clinicId, period, usage?.stamped ?? 0), plan.cfdiMonthly, plan.cfdiOverageCents);
  const debtCents = Math.round(debtRows.reduce((sum, r) => sum + (r.amount ?? 0), 0) * 100);

  // Cómo se cobrará el excedente (para el copy de la card). Solo consulta Stripe
  // cuando SÍ hay excedente — evita un round-trip en cada carga de la pestaña
  // para las clínicas dentro de cupo (la mayoría).
  const billing = q.overage > 0 ? await resolveOverageBilling(clinic) : null;
  // Mejora de la auditoría de uso (ws1-t4): avisar del candado de retención en cuanto se
  // teclea el RFC de una empresa, no al final. Datos del emisor GUARDADOS.
  const retencionAplica = retencionDelEmisor({ regimenEmisor: clinic.regimenFiscal, rfcEmisor: clinic.rfcEmisor });
  const retencion = {
    regimenEmisor: clinic.regimenFiscal ?? null,
    aplica: retencionAplica,
    encendida: retencionAplica === "si" ? await retencionesEncendidas(prisma, clinicId) : false,
  };

  return NextResponse.json({
    period,
    used: q.used,
    included: q.included,
    remaining: Math.max(0, q.included - q.used),
    overage: q.overage,
    overagePriceCents: q.overageCents,
    overageProjectionCents: q.overageTotalCents,
    debtCents,
    debtCount: debtRows.length,
    billingMode: billing?.mode ?? "manual",
    taxMode: clinic.cfdiTaxMode ?? "exempt",
    // Solo el boolean del ambiente (nunca la env): el modal de timbrado lo usa
    // para no prometer validez fiscal en pruebas ni hablar de pruebas en Live.
    live: isFacturapiLive(),
    // C-44: lo que le falta al emisor para timbrar (vacío = listo) y el texto para el formulario.
    faltaEmisor: faltantesDelEmisor({ ...clinic, live: isFacturapiLive() }),
    textoFaltaEmisor: textoDeFaltantes(faltantesDelEmisor({ ...clinic, live: isFacturapiLive() }), clinic.locale),
    retencion,
    // Segunda auditoría (C-47 en pantalla): el CP del emisor, el que va al receptor XAXX.
    cpEmisor: clinic.cpEmisor ?? null,
    // Solo el booleano: el token nunca sale del servidor.
    waConectado: !!(clinic.waConnected && clinic.waPhoneNumberId && clinic.waAccessToken),
    avisosEmisor: avisosDelEmisor({
      rfcEmisor: clinic.rfcEmisor, cfdiTaxMode: clinic.cfdiTaxMode, csdUploaded: clinic.csdUploaded,
      csdValidUntil: clinic.csdValidUntil, ahora: new Date(), locale: clinic.locale,
    }),
  });
}
