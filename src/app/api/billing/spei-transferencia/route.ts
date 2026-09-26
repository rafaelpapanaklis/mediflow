import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { PLAN_IDS } from "@/lib/billing/plans";
import { isPlanExpired } from "@/lib/plan-status";
import { logAudit, extractAuditMeta } from "@/lib/audit";
import { SpeiError, crearSolicitudSpei, solicitudPendienteDe } from "@/lib/billing/spei-directo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  plan: z.enum(PLAN_IDS),
  billing: z.enum(["monthly", "annual"]).default("monthly"),
  // El importe que la pantalla le enseñó (centavos). Si ya no es el de hoy, 409.
  amountCents: z.number().int().positive().optional(),
});

/**
 * POST /api/billing/spei-transferencia — «Ya hice la transferencia».
 *
 * Crea (o devuelve, si ya existe) la solicitud PENDIENTE de la clínica de la
 * sesión. El clinicId sale de la sesión, nunca del body; el importe lo calcula
 * el servidor con el precio de plan_configs (mismo que el checkout de Stripe),
 * así que del cliente solo se lee plan y periodo. La clínica sigue sin acceso
 * al panel hasta que un admin la confirme en /admin/payments.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "plan o periodo inválido" }, { status: 400 });

  try {
    const { solicitud, creada } = await crearSolicitudSpei({
      clinicId: user.clinicId,
      userId: user.id,
      plan: parsed.data.plan,
      billing: parsed.data.billing,
      amountCentsEsperado: parsed.data.amountCents,
    });
    if (creada) {
      const { ipAddress, userAgent } = extractAuditMeta(req);
      await logAudit({
        clinicId: user.clinicId,
        userId: user.id,
        // NO "subscription"+"create" ni la clave `billing`: esa fila es la que
        // inferManualInterval/pickPurchasedInterval leen como «ciclo comprado», y una
        // transferencia que aún no se confirma no compra nada.
        entityType: "admin-billing",
        entityId: solicitud.id,
        action: "create",
        changes: {
          _created: {
            before: null,
            after: {
              kind: "spei-directo-solicitud",
              plan: solicitud.plan,
              periodo: solicitud.billing,
              amountCents: solicitud.amountCents,
              reference: solicitud.reference,
            },
          },
        },
        ipAddress,
        userAgent,
      });
    }
    return NextResponse.json({ solicitud, creada });
  } catch (err) {
    if (err instanceof SpeiError) {
      const status = err.codigo === "no-disponible" ? 503 : err.codigo === "precio-cambio" ? 409 : 400;
      return NextResponse.json({ error: err.message }, { status });
    }
    console.error("[billing/spei-transferencia] POST:", err);
    return NextResponse.json({ error: "No se pudo registrar la transferencia" }, { status: 500 });
  }
}

/**
 * GET — lo que la pantalla de espera pregunta cada pocos segundos:
 *   pendiente → sigue esperando · activa → entra al panel · ninguna de las dos
 *   → la rechazaron (recarga y ve el motivo). `activa` es exactamente lo
 *   contrario de lo que bloquea el gate (isPlanExpired), no una fecha a ojo.
 */
export async function GET() {
  const user = await getCurrentUser();
  const pendiente = (await solicitudPendienteDe(user.clinicId)) !== null;
  const activa = !isPlanExpired(user.clinic);
  return NextResponse.json({ pendiente, activa });
}
