/**
 * Lógica pura del toggle de módulos por clínica. Sin Prisma, sin cookies,
 * sin revalidatePath — todo entra por dependencias inyectadas. Esto sigue
 * el mismo patrón que `evaluateAccess` (vive aparte de canAccessModule)
 * para que los tests unitarios no necesiten mocks de Next/Prisma.
 *
 * El wrapper que hace I/O real vive en ./toggle-clinic-module.ts.
 *
 * QUÉ HACE EL INTERRUPTOR (28-sep-2026, ws1-t5 — antes apagaba la fila y
 * dejaba a Stripe cobrando un módulo que la clínica ya no tenía):
 *
 *  Apagar
 *   · cortesía de admin → se apaga en el momento;
 *   · pagado con tarjeta → se pide a Stripe la baja AL FIN DEL PERIODO. La
 *     fila NO se toca: la clínica conserva el módulo hasta esa fecha, no se
 *     le vuelve a cobrar y la baja real la marca el webhook cuando Stripe
 *     cierra la suscripción (`customer.subscription.deleted`);
 *   · tarjeta con el cobro fallido → se cancela la suscripción ya (Stripe
 *     deja de reintentar) y se apaga;
 *   · pago único (SPEI/OXXO) → se apaga en el momento.
 *   Todo lo que no sea una cortesía exige `confirmado: true`: sin él la
 *   acción no cambia nada y devuelve qué va a pasar, para que la pantalla lo
 *   pregunte con la fecha delante.
 *
 *  Encender
 *   · sin fila, apagado o vencido → cortesía de admin (y sale el correo);
 *   · tarjeta con la baja programada → se deshace la baja en Stripe;
 *   · tarjeta con el cobro fallido → se rechaza: primero hay que cancelar esa
 *     suscripción.
 *
 * Si Stripe falla, no se cambia nada en la base.
 */
import { z } from "zod";
import {
  ACCION_BAJA_DESHECHA,
  ACCION_BAJA_PROGRAMADA,
  planDeApagado,
  planDeEncendido,
  type PlanDeApagado,
} from "@/lib/admin/modulos-core";

export const ADMIN_GRANT_PAYMENT_METHOD = "admin";
export const ADMIN_GRANT_BILLING_CYCLE  = "monthly";
export const ADMIN_GRANT_PERIOD_END     = new Date("2099-12-31T23:59:59.999Z");

export const toggleInputSchema = z.object({
  clinicId:  z.string().min(1, "clinicId requerido"),
  moduleKey: z.string().min(1, "moduleKey requerido"),
  enabled:   z.boolean(),
  /** El admin ya vio qué va a pasar (fecha, Stripe) y lo confirmó. */
  confirmado: z.boolean().optional(),
});

export type ToggleClinicModuleInput = z.infer<typeof toggleInputSchema>;

export type ToggleStatus =
  | "active"
  | "cancelled"
  /** La baja quedó pedida en Stripe; el módulo sigue activo hasta `hasta`. */
  | "cancel_scheduled";

export interface ToggleClinicModuleResult {
  ok:             boolean;
  error?:         string;
  /** `requiere_confirmacion`: no se cambió nada; `plan` dice qué pasaría. */
  code?:          "requiere_confirmacion" | "stripe" | "bloqueado";
  status?:        ToggleStatus;
  paymentMethod?: string;
  /** Hasta cuándo conserva el módulo (ISO), cuando la baja es al fin del periodo. */
  hasta?:         string;
  plan?:          PlanDeApagado;
}

export interface ExistingClinicModule {
  id:                   string;
  status:               string;
  paymentMethod:        string;
  stripeSubscriptionId: string | null;
  currentPeriodEnd:     Date;
  /** La baja al fin del periodo ya está pedida (según la bitácora). */
  bajaProgramada:       boolean;
}

export type AccionToggle =
  | "cortesia"
  | "apagado"
  | typeof ACCION_BAJA_PROGRAMADA
  | typeof ACCION_BAJA_DESHECHA
  | "suscripcion_cancelada";

export interface ToggleAuditEntry {
  type:                  "admin.clinic.module.toggled";
  clinicId:              string;
  moduleKey:             string;
  enabled:               boolean;
  at:                    string;
  by:                    "admin";
  previousStatus:        string | null;
  previousPaymentMethod: string | null;
  /** Qué se hizo de verdad. */
  action:                AccionToggle;
  /** La suscripción de Stripe que se tocó, si se tocó alguna. */
  stripeSubscriptionId:  string | null;
  /** Hasta cuándo conserva el módulo, en una baja al fin del periodo. */
  hasta:                 string | null;
}

export interface UpsertActiveArgs {
  clinicId: string;
  moduleId: string;
  now:      Date;
}

export interface CancelArgs {
  clinicModuleId: string;
  now:            Date;
}

export interface ToggleDeps {
  isAuthed:                 () => boolean;
  findClinic:               (id: string) => Promise<{ id: string } | null>;
  findModule:               (key: string) => Promise<{ id: string; key: string; isActive: boolean } | null>;
  findExistingClinicModule: (clinicId: string, moduleId: string) => Promise<ExistingClinicModule | null>;
  upsertActive:             (args: UpsertActiveArgs) => Promise<void>;
  cancel:                   (args: CancelArgs) => Promise<void>;
  /** Stripe: `cancel_at_period_end: true`. Lanza si Stripe no lo acepta. */
  programarBajaStripe:      (stripeSubscriptionId: string) => Promise<void>;
  /** Stripe: `cancel_at_period_end: false`. Lanza si Stripe no lo acepta. */
  deshacerBajaStripe:       (stripeSubscriptionId: string) => Promise<void>;
  /** Stripe: cancela la suscripción en el momento. Lanza si Stripe no lo acepta. */
  cancelarStripeYa:         (stripeSubscriptionId: string) => Promise<void>;
  /** Correo «Módulo activado» a la clínica. No debe lanzar; si lanza, se ignora. */
  avisarActivacion:         (args: { clinicId: string; moduleKey: string; now: Date }) => Promise<void>;
  log:                      (entry: ToggleAuditEntry) => void | Promise<void>;
  revalidate:               (path: string) => void;
  now:                      () => Date;
}

function filaParaPlan(previous: ExistingClinicModule) {
  return {
    status:                 previous.status,
    paymentMethod:          previous.paymentMethod,
    currentPeriodEnd:       previous.currentPeriodEnd,
    tieneSuscripcionStripe: !!previous.stripeSubscriptionId,
    bajaProgramada:         previous.bajaProgramada,
  };
}

function errorDeStripe(e: unknown): string {
  const detalle = e instanceof Error && e.message ? e.message : "sin detalle";
  return `Stripe no aceptó el cambio (${detalle}). No se cambió nada.`;
}

export async function toggleClinicModuleCore(
  rawInput: unknown,
  deps: ToggleDeps,
): Promise<ToggleClinicModuleResult> {
  if (!deps.isAuthed()) return { ok: false, error: "Unauthorized" };

  const parsed = toggleInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }
  const { clinicId, moduleKey, enabled } = parsed.data;
  const confirmado = parsed.data.confirmado === true;

  const clinic = await deps.findClinic(clinicId);
  if (!clinic) return { ok: false, error: "Clínica no encontrada" };

  const mod = await deps.findModule(moduleKey);
  if (!mod || !mod.isActive) return { ok: false, error: "Módulo no disponible" };

  const previous = await deps.findExistingClinicModule(clinicId, mod.id);
  const now = deps.now();

  let resultado: ToggleClinicModuleResult;
  let action: AccionToggle;
  let stripeSubscriptionId: string | null = null;
  let hasta: string | null = null;

  if (enabled) {
    const plan = planDeEncendido(previous ? filaParaPlan(previous) : null, now);
    if (plan.tipo === "nada") {
      // Ya estaba activo: no se pisa una suscripción pagada con una cortesía.
      return { ok: true, status: "active", paymentMethod: previous?.paymentMethod };
    }
    if (plan.tipo === "bloqueado") {
      return {
        ok: false,
        code: "bloqueado",
        error:
          "Este módulo tiene una suscripción de Stripe con el cobro fallido y Stripe sigue reintentando. " +
          "Cancela primero esa suscripción desde aquí y después actívalo de cortesía.",
      };
    }
    if (plan.tipo === "deshacer-baja") {
      stripeSubscriptionId = previous!.stripeSubscriptionId!;
      try {
        await deps.deshacerBajaStripe(stripeSubscriptionId);
      } catch (e) {
        return { ok: false, code: "stripe", error: errorDeStripe(e) };
      }
      action = ACCION_BAJA_DESHECHA;
      resultado = { ok: true, status: "active", paymentMethod: previous!.paymentMethod };
    } else {
      await deps.upsertActive({ clinicId, moduleId: mod.id, now });
      action = "cortesia";
      resultado = { ok: true, status: "active", paymentMethod: ADMIN_GRANT_PAYMENT_METHOD };
      try {
        await deps.avisarActivacion({ clinicId, moduleKey, now });
      } catch {
        // El correo es un aviso: si falla, el módulo ya quedó activo.
      }
    }
  } else {
    if (!previous) return { ok: false, error: "El módulo no está activo en esta clínica" };
    const plan = planDeApagado(filaParaPlan(previous), now);
    if (plan.tipo === "nada") {
      // Idempotente — ya estaba apagado, no logueamos ni revalidamos.
      return { ok: true, status: "cancelled" };
    }

    const esCortesia = plan.tipo === "inmediato" && plan.motivo === "cortesia";
    if (!esCortesia && !confirmado) {
      return {
        ok: false,
        code: "requiere_confirmacion",
        error: "Falta confirmar: este módulo está pagado.",
        plan,
      };
    }

    if (plan.tipo === "fin-de-periodo") {
      stripeSubscriptionId = previous.stripeSubscriptionId!;
      try {
        await deps.programarBajaStripe(stripeSubscriptionId);
      } catch (e) {
        return { ok: false, code: "stripe", error: errorDeStripe(e) };
      }
      hasta = plan.hasta;
      action = ACCION_BAJA_PROGRAMADA;
      // La fila NO se apaga: sigue activa hasta que Stripe cierre el periodo.
      resultado = { ok: true, status: "cancel_scheduled", paymentMethod: previous.paymentMethod, hasta };
    } else if (plan.tipo === "cancelar-en-stripe-ya") {
      stripeSubscriptionId = previous.stripeSubscriptionId!;
      try {
        await deps.cancelarStripeYa(stripeSubscriptionId);
      } catch (e) {
        return { ok: false, code: "stripe", error: errorDeStripe(e) };
      }
      await deps.cancel({ clinicModuleId: previous.id, now });
      action = "suscripcion_cancelada";
      resultado = { ok: true, status: "cancelled" };
    } else {
      await deps.cancel({ clinicModuleId: previous.id, now });
      action = "apagado";
      resultado = { ok: true, status: "cancelled" };
    }
  }

  await deps.log({
    type:                  "admin.clinic.module.toggled",
    clinicId,
    moduleKey,
    enabled,
    at:                    now.toISOString(),
    by:                    "admin",
    previousStatus:        previous?.status ?? null,
    previousPaymentMethod: previous?.paymentMethod ?? null,
    action,
    stripeSubscriptionId,
    hasta,
  });

  deps.revalidate(`/admin/clinics/${clinicId}`);
  deps.revalidate("/dashboard");

  return resultado;
}
