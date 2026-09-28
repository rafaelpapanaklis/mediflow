"use client";

/**
 * Tab "Módulos del marketplace" en /admin/clinics/[id]. Lista los módulos
 * dentales del catálogo (Module.isActive=true) con un toggle por cada uno.
 * El estado se lee de ClinicModule y los toggles llaman a toggleClinicModule
 * (server action). Si la clínica no es categoría DENTAL, se muestra un empty
 * state — los módulos del marketplace hoy son todos dentales (ver
 * prisma/seed.ts SEED_MODULES).
 *
 * Qué enseña de cada módulo (ws1-t5, 28-sep-2026): cómo llegó (tarjeta,
 * SPEI/OXXO, cortesía), LO QUE LA CLÍNICA PAGA de verdad —no solo el precio
 * de catálogo— y hasta cuándo. Qué pasa al apagar o encender lo decide
 * `@/lib/admin/modulos-core` (planDeApagado / planDeEncendido), con tests;
 * aquí solo se pregunta y se pinta.
 */
import { useState, useTransition } from "react";
import toast from "react-hot-toast";
import { Baby, Bone, Layers, Smile, Syringe } from "lucide-react";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { formatCurrency } from "@/lib/utils";
import { fechaAdmin } from "@/lib/admin/zona-horaria";
import {
  ETIQUETA_ESTADO_MODULO,
  ETIQUETA_ORIGEN,
  estadoModulo,
  importeMensual,
  origenModulo,
  planDeApagado,
  planDeEncendido,
  type EstadoModulo,
  type FilaModulo,
} from "@/lib/admin/modulos-core";
import { toggleClinicModule } from "@/app/actions/admin/toggle-clinic-module";
import type {
  ToggleClinicModuleInput,
  ToggleClinicModuleResult,
} from "@/app/actions/admin/toggle-clinic-module-core";

const ICON_MAP: Record<string, typeof Smile> = {
  Smile,
  Layers,
  Syringe,
  Bone,
  Baby,
};

export interface ModuleCatalogRow {
  id:              string;
  key:             string;
  name:            string;
  description:     string;
  iconKey:         string;
  iconBg:          string;
  iconColor:       string;
  priceMxnMonthly: number;
}

export interface ClinicModuleRow {
  moduleKey:        string;
  status:           string;
  paymentMethod:    string;
  activatedAt:      string;        // ISO
  cancelledAt:      string | null; // ISO
  currentPeriodEnd: string;        // ISO
  /** "monthly" | "annual". Ausente = mensual. */
  billingCycle?:    string;
  /** Lo que pagó por el periodo, sin IVA. 0 en una cortesía. */
  pricePaidMxn?:    number;
  /** Hay una suscripción de Stripe cobrando sola. */
  tieneSuscripcionStripe?: boolean;
  /** La baja al fin del periodo ya está pedida. */
  bajaProgramada?:  boolean;
}

interface Props {
  clinicId:       string;
  clinicCategory: string;
  modules:        ModuleCatalogRow[];
  clinicModules:  ClinicModuleRow[];
  /** Solo para la vista previa: sustituye a la acción real. */
  accion?:        (input: ToggleClinicModuleInput) => Promise<ToggleClinicModuleResult>;
  /** El "ahora" del servidor. Sin él se usa el del navegador. */
  ahoraISO?:      string;
}

const TONO_ESTADO: Record<EstadoModulo, "success" | "warning" | "danger" | "neutral"> = {
  "activo":          "success",
  "baja-programada": "warning",
  "cobro-fallido":   "danger",
  "vencido":         "neutral",
  "cancelado":       "neutral",
};

function aFila(clinicId: string, mod: ModuleCatalogRow, cm: ClinicModuleRow): FilaModulo {
  return {
    clinicId,
    moduleKey:              mod.key,
    moduleName:             mod.name,
    status:                 cm.status,
    paymentMethod:          cm.paymentMethod,
    billingCycle:           cm.billingCycle ?? "monthly",
    pricePaidMxn:           Number(cm.pricePaidMxn ?? 0),
    currentPeriodEnd:       cm.currentPeriodEnd,
    tieneSuscripcionStripe: cm.tieneSuscripcionStripe === true,
    bajaProgramada:         cm.bajaProgramada === true,
  };
}

/** «$129.00 al mes», «$1,316.00 al año ($109.67 al mes)» o «$0 · cortesía». Siempre sin IVA. */
function loQuePaga(fila: FilaModulo): string {
  if (origenModulo(fila) === "cortesia") return "No paga: cortesía de admin";
  const pagado = Number(fila.pricePaidMxn ?? 0);
  if (!(pagado > 0)) return "Sin importe registrado";
  if (fila.billingCycle === "annual") {
    const alMes = importeMensual(pagado, fila.billingCycle);
    return `Paga ${formatCurrency(pagado, "MXN")} al año (${formatCurrency(alMes, "MXN")} al mes), sin IVA`;
  }
  return `Paga ${formatCurrency(pagado, "MXN")} al mes, sin IVA`;
}

export function ClinicModulesTab({
  clinicId,
  clinicCategory,
  modules,
  clinicModules,
  accion = toggleClinicModule,
  ahoraISO,
}: Props) {
  const askConfirm = useConfirm();
  const [rows, setRows] = useState<ClinicModuleRow[]>(clinicModules);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const ahora = ahoraISO ? new Date(ahoraISO) : new Date();

  if (clinicCategory !== "DENTAL") {
    return (
      <CardNew>
        <div className="form-section__title">
          Módulos del marketplace <span className="form-section__rule" />
        </div>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
          No hay módulos del marketplace disponibles para clínicas de categoría {clinicCategory}.
          Hoy el marketplace ofrece solamente módulos dentales.
        </p>
      </CardNew>
    );
  }

  if (modules.length === 0) {
    return (
      <CardNew>
        <div className="form-section__title">
          Módulos del marketplace <span className="form-section__rule" />
        </div>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: 0 }}>
          No hay módulos activos en el catálogo (Module.isActive=true). Corre `npm run seed`.
        </p>
      </CardNew>
    );
  }

  function actualizar(moduleKey: string, cambio: (previa: ClinicModuleRow | undefined) => ClinicModuleRow | null) {
    startTransition(() => {
      setRows((prev) => {
        const previa = prev.find((r) => r.moduleKey === moduleKey);
        const nueva = cambio(previa);
        if (!nueva) return prev;
        return [...prev.filter((r) => r.moduleKey !== moduleKey), nueva];
      });
    });
  }

  async function ejecutar(mod: ModuleCatalogRow, enabled: boolean, confirmado: boolean) {
    setPendingKey(mod.key);
    try {
      const res = await accion({ clinicId, moduleKey: mod.key, enabled, confirmado });
      if (!res.ok) {
        toast.error(res.error ?? "Error");
        return;
      }
      // Optimistic local update — el revalidatePath del server action ya
      // refresca el RSC, pero queremos respuesta inmediata.
      if (res.status === "cancel_scheduled") {
        actualizar(mod.key, (previa) => (previa ? { ...previa, bajaProgramada: true } : null));
        toast.success(
          `Baja programada: ${mod.name} sigue activo hasta el ${fechaAdmin(res.hasta ?? null) ?? "fin del periodo"} y no se vuelve a cobrar`,
        );
        return;
      }
      if (res.status === "cancelled") {
        // Marcamos cancelado pero no lo borramos para conservar el "última fecha de cambio".
        actualizar(mod.key, (previa) =>
          previa ? { ...previa, status: "cancelled", cancelledAt: new Date().toISOString(), bajaProgramada: false } : null,
        );
        toast.success("Módulo desactivado");
        return;
      }
      if (res.paymentMethod && res.paymentMethod !== "admin") {
        // Se deshizo la baja: la suscripción sigue como estaba.
        actualizar(mod.key, (previa) => (previa ? { ...previa, bajaProgramada: false } : null));
        toast.success(`Baja deshecha: ${mod.name} se sigue renovando`);
        return;
      }
      actualizar(mod.key, () => ({
        moduleKey:        mod.key,
        status:           "active",
        paymentMethod:    "admin",
        activatedAt:      new Date().toISOString(),
        cancelledAt:      null,
        currentPeriodEnd: new Date("2099-12-31T23:59:59.999Z").toISOString(),
        billingCycle:     "monthly",
        pricePaidMxn:     0,
        tieneSuscripcionStripe: false,
        bajaProgramada:   false,
      }));
      toast.success("Módulo activado de cortesía");
    } catch {
      toast.error("Error de red");
    } finally {
      setPendingKey(null);
    }
  }

  async function apagar(mod: ModuleCatalogRow, fila: FilaModulo) {
    const plan = planDeApagado(fila, ahora);
    if (plan.tipo === "nada") return;

    if (plan.tipo === "fin-de-periodo") {
      const hasta = fechaAdmin(plan.hasta) ?? "el fin del periodo";
      if (plan.yaProgramada) {
        toast(`La baja de ${mod.name} ya está programada: sigue activo hasta el ${hasta}.`);
        return;
      }
      const ok = await askConfirm({
        title: `¿Dar de baja ${mod.name}?`,
        description:
          `Esta clínica lo paga con tarjeta por Stripe (${loQuePaga(fila).replace(/^Paga /, "")}). ` +
          `Al confirmar se cancela la suscripción al final del periodo ya pagado: ` +
          `conserva el módulo hasta el ${hasta} y no se le vuelve a cobrar. ` +
          `No se reembolsa nada y hoy no se apaga nada. Puedes deshacer la baja antes de esa fecha.`,
        variant: "warning",
        confirmText: "Dar de baja al fin del periodo",
      });
      if (!ok) return;
      await ejecutar(mod, false, true);
      return;
    }

    if (plan.tipo === "cancelar-en-stripe-ya") {
      const ok = await askConfirm({
        title: `¿Cancelar la suscripción de ${mod.name}?`,
        description:
          `Stripe no pudo cobrar este módulo y sigue reintentando. Al confirmar se cancela la suscripción ` +
          `ahora mismo: Stripe deja de intentar el cobro y el módulo queda apagado.`,
        variant: "danger",
        confirmText: "Cancelar la suscripción",
      });
      if (!ok) return;
      await ejecutar(mod, false, true);
      return;
    }

    if (plan.motivo === "cortesia") {
      const ok = await askConfirm({
        title: `¿Apagar ${mod.name}?`,
        description: "Es una cortesía de admin: se apaga ahora mismo. No hay ningún cobro que cancelar.",
        variant: "warning",
        confirmText: "Apagar",
      });
      if (!ok) return;
      await ejecutar(mod, false, true);
      return;
    }

    const pierde = plan.pierdeHasta ? fechaAdmin(plan.pierdeHasta) : null;
    const ok = await askConfirm({
      title: `¿Apagar ${mod.name}?`,
      description:
        (plan.motivo === "pago-unico"
          ? "Esta clínica lo pagó con SPEI/OXXO (pago único, no se renueva solo). "
          : "Este módulo figura como pagado pero no tiene una suscripción de Stripe detrás. ") +
        (pierde ? `Tiene pagado hasta el ${pierde}: si lo apagas ahora pierde ese tiempo y no se le reembolsa solo. ` : "") +
        "Se apaga ahora mismo.",
      variant: "danger",
      confirmText: "Apagar ahora",
    });
    if (!ok) return;
    await ejecutar(mod, false, true);
  }

  async function encender(mod: ModuleCatalogRow, fila: FilaModulo | null) {
    const plan = planDeEncendido(fila, ahora);
    if (plan.tipo === "nada") return;
    if (plan.tipo === "bloqueado") {
      toast.error("Stripe sigue reintentando el cobro de este módulo. Cancela primero esa suscripción.");
      return;
    }
    if (plan.tipo === "deshacer-baja") {
      const ok = await askConfirm({
        title: `¿Deshacer la baja de ${mod.name}?`,
        description:
          "La suscripción de Stripe vuelve a renovarse sola al final del periodo, al mismo precio. " +
          "No se cobra nada hoy.",
        variant: "default",
        confirmText: "Deshacer la baja",
      });
      if (!ok) return;
      await ejecutar(mod, true, true);
      return;
    }
    const ok = await askConfirm({
      title: `¿Activar ${mod.name} de cortesía?`,
      description:
        "La clínica recibe el módulo sin pagar y sin fecha de fin, y le llega el correo «Módulo activado». " +
        "No suma al MRR.",
      variant: "default",
      confirmText: "Activar de cortesía",
    });
    if (!ok) return;
    await ejecutar(mod, true, true);
  }

  return (
    <CardNew>
      <div className="form-section__title">
        Módulos del marketplace <span className="form-section__rule" />
      </div>
      <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 0, marginBottom: 16 }}>
        Lo que esta clínica tiene y lo que paga por ello. Encender un módulo desde aquí lo da de
        cortesía (no se cobra y no suma al MRR). Apagar uno que se paga con tarjeta no lo quita hoy:
        cancela la suscripción al final del periodo ya pagado.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {modules.map((mod) => {
          const Icon = ICON_MAP[mod.iconKey] ?? Smile;
          const cm = rows.find((r) => r.moduleKey === mod.key) ?? null;
          const fila = cm ? aFila(clinicId, mod, cm) : null;
          const estado: EstadoModulo | null = fila ? estadoModulo(fila, ahora) : null;
          const enUso = estado === "activo" || estado === "baja-programada";
          const isPending = pendingKey === mod.key;
          const ultimoCambio = cm ? cm.cancelledAt ?? cm.activatedAt : null;

          return (
            <div
              key={mod.id}
              className="list-row"
              data-modulo={mod.key}
              data-estado={estado ?? "sin-modulo"}
              style={{ alignItems: "center", gap: 12, padding: 12 }}
            >
              <div
                className={mod.iconBg}
                style={{
                  width:        36,
                  height:       36,
                  borderRadius: 8,
                  display:      "grid",
                  placeItems:   "center",
                  flexShrink:   0,
                }}
              >
                <Icon size={18} className={mod.iconColor} />
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-1)" }}>
                    {mod.name}
                  </span>
                  {fila && estado && estado !== "cancelado" && (
                    <BadgeNew tone={TONO_ESTADO[estado]} dot>
                      {ETIQUETA_ESTADO_MODULO[estado]} · {ETIQUETA_ORIGEN[origenModulo(fila)]}
                    </BadgeNew>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                  {mod.description}
                </div>

                {/* Lo que PAGA esta clínica, y hasta cuándo. */}
                {fila && estado && estado !== "cancelado" && (
                  <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 6 }} data-lo-que-paga>
                    <span className="mono">{loQuePaga(fila)}</span>
                    {estado === "activo" && origenModulo(fila) === "tarjeta" && (
                      <> · se renueva el {fechaAdmin(fila.currentPeriodEnd) ?? "—"}</>
                    )}
                    {estado === "activo" && origenModulo(fila) === "pago-unico" && (
                      <> · pagado hasta el {fechaAdmin(fila.currentPeriodEnd) ?? "—"}, no se renueva solo</>
                    )}
                    {estado === "baja-programada" && (
                      <> · activo hasta el {fechaAdmin(fila.currentPeriodEnd) ?? "—"}; después se apaga y no se vuelve a cobrar</>
                    )}
                    {estado === "cobro-fallido" && (
                      <> · Stripe no pudo cobrar y sigue reintentando; la clínica no tiene acceso</>
                    )}
                    {estado === "vencido" && (
                      <> · venció el {fechaAdmin(fila.currentPeriodEnd) ?? "—"}</>
                    )}
                  </div>
                )}

                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span className="mono" title="Precio de catálogo (tabla modules), sin IVA. Es lo que pagaría quien lo contrate hoy.">
                    Catálogo: {formatCurrency(mod.priceMxnMonthly, "MXN")} al mes
                  </span>
                  <span>·</span>
                  <span>Último cambio: {fechaAdmin(ultimoCambio) ?? "—"}</span>
                </div>
              </div>

              {estado === "baja-programada" && fila ? (
                <ButtonNew size="sm" variant="secondary" disabled={isPending} onClick={() => encender(mod, fila)}>
                  Deshacer la baja
                </ButtonNew>
              ) : estado === "cobro-fallido" && fila ? (
                <ButtonNew size="sm" variant="secondary" disabled={isPending} onClick={() => apagar(mod, fila)}>
                  Cancelar la suscripción
                </ButtonNew>
              ) : (
                <SwitchToggle
                  enabled={enUso}
                  disabled={isPending}
                  onChange={(next) => (next ? encender(mod, fila) : fila ? apagar(mod, fila) : undefined)}
                  label={`${enUso ? "Desactivar" : "Activar"} ${mod.name}`}
                />
              )}
            </div>
          );
        })}
      </div>
    </CardNew>
  );
}

interface SwitchToggleProps {
  enabled:  boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
  label:    string;
}

function SwitchToggle({ enabled, disabled, onChange, label }: SwitchToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      style={{
        position:   "relative",
        width:      40,
        height:     22,
        borderRadius: 999,
        border:     "1px solid var(--border-soft)",
        background: enabled ? "var(--brand)" : "var(--bg-elev)",
        cursor:     disabled ? "wait" : "pointer",
        flexShrink: 0,
        opacity:    disabled ? 0.6 : 1,
        transition: "background 120ms ease",
        padding:    0,
      }}
    >
      <span
        style={{
          position:   "absolute",
          top:        1,
          left:       enabled ? 19 : 1,
          width:      18,
          height:     18,
          borderRadius: "50%",
          background: "var(--bg-1)",
          boxShadow:  "0 1px 2px rgba(0,0,0,0.2)",
          transition: "left 120ms ease",
        }}
      />
    </button>
  );
}
