import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStripeSafe } from "@/lib/stripe";
import { sendEmail } from "@/lib/email";
import { crearCandadoDeCobro } from "@/lib/billing/candado-cobro.server";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { getResolvedPlan, getPlanLimits } from "@/lib/plans";
import { clearOverridesData } from "@/lib/billing/plan-overrides";
import { exencionIvaDeClinica } from "@/lib/billing/iva-clinica";
import { bloqueoDeSedesParaPlan, leerGrupoDePago, sincronizarSedesIncluidas } from "@/lib/billing/sedes-incluidas";
import { avisoSedeIncluida } from "@/lib/billing/sedes-incluidas-core";
import { parsearCuerpo, type RespuestaPago } from "@/lib/billing/pago-pendiente";
import {
  consultarPendiente,
  pagarPendiente,
  subirYPagar,
  type DepsPago,
  type StripePago,
} from "@/lib/billing/pago-pendiente.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/billing/pago-pendiente — cobro de tarjeta rechazado (ws1-t2).
 *
 *   GET  → { estado: "sin_pendiente" }
 *          | { estado: "pendiente", planActual, montoPendiente, moneda: "MXN", opcionesSubir: [{ plan, nombre, monto, ivaIncluido }] }
 *   POST { accion: "pagar" }               → cobra la factura abierta del plan actual con el método guardado.
 *   POST { accion: "subir", plan }         → en la MISMA suscripción: anula la factura vieja y cobra el plan nuevo
 *                                            completo (ciclo nuevo desde hoy, sin prorrateo, sin promo).
 *     Resultado de ambos: { ok: true, pagado: true } | { ok: true, pagado: false, url } (pagar en la página de Stripe).
 *   Errores: 400 plan inválido o no más grande · 403 sin permiso · 409 sin pendiente o sedes bloquean ·
 *            502 Stripe no contestó · 503 Stripe o el IVA sin configurar.
 *
 * Multi-tenant: la clínica sale de la SESIÓN, nunca del body. Solo dueño/administrador de facturación
 * (igual que /api/billing/portal y change-plan). La lógica vive en lib/billing/pago-pendiente*.ts.
 * La reactivación de la clínica la hace el webhook de Stripe; esta ruta no escribe `subscriptionStatus`.
 */

async function armarDeps(req: NextRequest): Promise<DepsPago | NextResponse> {
  const user = await getCurrentUser();
  const clinicId = user.clinicId;
  if (!clinicId) return NextResponse.json({ error: "Sin sesión de clínica" }, { status: 401 }); // sin clinicId Prisma no filtraría

  const clinic = await prisma.clinic.findUnique({
    where: { id: clinicId },
    select: {
      id: true,
      name: true,
      plan: true,
      subscriptionStatus: true,
      trialEndsAt: true,
      createdAt: true,
      stripeCustomerId: true,
      stripeSubscriptionId: true,
      subscriptionId: true,
    },
  });
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  const { ipAddress, userAgent } = extractAuditMeta(req);
  return {
    stripe: getStripeSafe() as unknown as StripePago | null,
    role: user.role,
    clinica: {
      id: clinic.id,
      nombre: clinic.name,
      subscriptionStatus: clinic.subscriptionStatus,
      trialEndsAt: clinic.trialEndsAt,
      plan: clinic.plan,
      stripeCustomerId: clinic.stripeCustomerId,
      stripeSubscriptionId: clinic.stripeSubscriptionId,
    },
    env: process.env,
    plan: async (id) => {
      const p = await getResolvedPlan(id);
      return { id, name: p.name, priceMxn: p.priceMxn, priceMxnAnnual: p.priceMxnAnnual };
    },
    bloqueoDeSedes: (id) => bloqueoDeSedesParaPlan(clinic.id, id),
    sedeIncluida: async () => {
      const g = await leerGrupoDePago(clinic.id);
      return g.esSedeIncluida ? { pagadoraId: g.pagadoraId, pagadoraNombre: g.pagadoraNombre } : null;
    },
    exencionIva: () => exencionIvaDeClinica(clinic),
    aplicarPlanLocal: async (plan) => {
      const limites = await getPlanLimits(plan);
      await prisma.clinic.update({
        where: { id: clinic.id },
        data: { plan, aiTokensLimit: limites.aiTokensDefault, ...clearOverridesData() },
      });
      await sincronizarSedesIncluidas(clinic.id);
    },
    auditar: async (evento) => {
      await logAudit({
        clinicId: clinic.id,
        userId: user.id,
        entityType: "subscription",
        entityId: clinic.stripeSubscriptionId ?? clinic.id,
        action: "update",
        changes: { _source: { before: null, after: evento } },
        ipAddress,
        userAgent,
      }).catch(() => {});
    },
    avisoSedeIncluida,
    esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
    releerEstadoClinica: async () => {
      const c = await prisma.clinic.findUnique({ where: { id: clinic.id }, select: { subscriptionStatus: true, trialEndsAt: true } });
      return c ?? {};
    },
    // Candado por clínica de «Pagar» y «Subir»: failban (Upstash o memoria) + candado en la base entre instancias.
    candado: crearCandadoDeCobro({ clinicId: clinic.id, userId: user.id }),
    // Mismo buzón que el aviso de afiliados y el de SPEI: ADMIN_NOTIFY_EMAIL, o el general.
    avisarAlAdmin: async ({ asunto, lineas }) => {
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      await sendEmail({
        to: process.env.ADMIN_NOTIFY_EMAIL?.trim() || "hola@dalecontrol.com",
        subject: asunto,
        html: lineas.map((l) => `<p>${esc(l)}</p>`).join(""),
        text: lineas.join("\n"),
      });
    },
  };
}

const enviar = (r: RespuestaPago) => NextResponse.json(r.body, { status: r.status });

export async function GET(req: NextRequest) {
  const deps = await armarDeps(req);
  if (deps instanceof NextResponse) return deps;
  return enviar(await consultarPendiente(deps));
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = parsearCuerpo(body);
  if (parsed.ok === false) return enviar(parsed.respuesta);

  const deps = await armarDeps(req);
  if (deps instanceof NextResponse) return deps;
  return enviar(parsed.cuerpo.accion === "pagar" ? await pagarPendiente(deps) : await subirYPagar(deps, parsed.cuerpo.plan));
}
