"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, X } from "lucide-react";
import toast from "react-hot-toast";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useLocale } from "@/i18n/i18n-provider";
import type { PlanSubida } from "@/lib/team/cupo-usuarios-shared";

/**
 * Aviso de «tope de usuarios alcanzado» (ws1-t8). Sustituye al formulario de
 * «Agregar miembro»: nunca se deja llenar para fallar al guardar.
 *
 * El cobro NO es nuevo: reutiliza /api/billing/change-plan/preview (la factura
 * próxima de Stripe con el prorrateo, o la cotización manual) y
 * /api/billing/change-plan (always_invoice: cobra solo la diferencia de los días
 * que quedan). Nada se cobra hasta pulsar «Confirmar» con el monto a la vista.
 * Solo el dueño/admin (isClinicBillingAdmin) ve las opciones de subida.
 */

interface Linea { description: string; amount: number }
interface Vista {
  mode: "subscription" | "manual" | "in-place";
  currency: string;
  interval: "month" | "year";
  amountDueNow: number;
  daysRemaining: number;
  nextBillingDate: string | null;
  nextAmount: number;
  lines: Linea[];
  unavailable: boolean;
}

const es = {
  titulo: "Llegaste al tope de usuarios",
  incluye: (plan: string, n: number) => `Tu plan ${plan} incluye ${n} ${n === 1 ? "usuario" : "usuarios"} en tu equipo`,
  sinPermiso: "Pídele al dueño que suba de plan para agregar más miembros.",
  reactivar: "Desactiva a alguien o sube de plan para reactivar a este miembro.",
  sube: "Sube de plan y paga solo la diferencia de los días que quedan de tu periodo.",
  usuarios: (n: number | null) => (n == null ? "Usuarios ilimitados" : `${n} usuarios`),
  mes: "/mes",
  calculando: "Calculando la diferencia…",
  sinVista: "No pudimos calcular el monto exacto ahora. Revisa tu plan en Suscripción.",
  pagasHoy: "Pagas hoy",
  sinCobro: "Sin cobro ahora: tu plan se actualiza y se cobra al activarlo.",
  renovacion: (monto: string, fecha: string) => `En tu renovación (${fecha}) se cobra ${monto} del plan completo.`,
  renovacionSinFecha: (monto: string) => `En tu renovación se cobra ${monto} del plan completo.`,
  confirmar: (plan: string) => `Confirmar y subir a ${plan}`,
  procesando: "Procesando…",
  cerrar: "Cerrar",
  suscripcion: "Ir a Suscripción",
  listo: (plan: string) => `Plan ${plan} activo: ya puedes agregar más usuarios`,
  error: "No se pudo cambiar de plan",
};
const en: typeof es = {
  titulo: "You've reached your user limit",
  incluye: (plan, n) => `Your ${plan} plan includes ${n} ${n === 1 ? "user" : "users"} on your team`,
  sinPermiso: "Ask the owner to upgrade the plan to add more members.",
  reactivar: "Deactivate someone or upgrade your plan to reactivate this member.",
  sube: "Upgrade and pay only the difference for the days left in your period.",
  usuarios: (n) => (n == null ? "Unlimited users" : `${n} users`),
  mes: "/mo",
  calculando: "Calculating the difference…",
  sinVista: "We couldn't calculate the exact amount right now. Check your plan under Subscription.",
  pagasHoy: "You pay today",
  sinCobro: "No charge now: your plan is updated and billed when you activate it.",
  renovacion: (monto, fecha) => `On your renewal (${fecha}) the full plan is billed: ${monto}.`,
  renovacionSinFecha: (monto) => `On your renewal the full plan is billed: ${monto}.`,
  confirmar: (plan) => `Confirm and upgrade to ${plan}`,
  procesando: "Processing…",
  cerrar: "Close",
  suscripcion: "Go to Subscription",
  listo: (plan) => `${plan} plan active: you can add more users now`,
  error: "The plan could not be changed",
};

function dinero(n: number, moneda: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency: moneda }).format(n);
  } catch {
    return `$${n.toFixed(2)} ${moneda}`;
  }
}

export function UpgradeUsuariosDialog({
  planNombre, max, opciones, puedeSubir, reactivando = false, onClose,
}: {
  planNombre: string;
  max: number | null;
  opciones: PlanSubida[];
  puedeSubir: boolean;
  reactivando?: boolean;
  onClose: () => void;
}) {
  const locale = useLocale();
  const x = locale.startsWith("en") ? en : es;
  const loc = locale.startsWith("en") ? "en-US" : "es-MX";
  const router = useRouter();
  const [elegido, setElegido] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista | null>(null);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const peticion = useRef(0);

  useEffect(() => {
    if (!elegido) return;
    const id = ++peticion.current;
    setVista(null); setFallo(false); setCargando(true);
    fetch("/api/billing/change-plan/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: elegido }),
    })
      .then(async (r) => { if (!r.ok) throw new Error("preview"); return (await r.json()) as Vista; })
      .then((d) => { if (peticion.current === id) { setVista(d); setFallo(!!d.unavailable); } })
      .catch(() => { if (peticion.current === id) setFallo(true); })
      .finally(() => { if (peticion.current === id) setCargando(false); });
  }, [elegido]);

  async function confirmar() {
    if (!elegido || !vista || fallo || enviando) return;
    setEnviando(true);
    try {
      const res = await fetch("/api/billing/change-plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: elegido }),
      });
      const d = (await res.json().catch(() => ({}))) as { mode?: string; url?: string; error?: string };
      if (!res.ok) throw new Error(d.error || x.error);
      // SPEI/OXXO: el diferencial se paga en el Checkout de Stripe; el plan se aplica al confirmarse.
      if (d.mode === "checkout" && d.url) { window.location.href = d.url; return; }
      toast.success(x.listo(opciones.find((o) => o.id === elegido)?.name ?? ""));
      router.refresh();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : x.error);
    } finally {
      setEnviando(false);
    }
  }

  const plan = opciones.find((o) => o.id === elegido) ?? null;

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget && !enviando) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tope-usuarios-titulo" style={{ maxWidth: 520 }}>
        <div className="modal__header">
          <h2 className="modal__title" id="tope-usuarios-titulo">{x.titulo}</h2>
          <button type="button" onClick={onClose} className="btn-new btn-new--ghost" style={{ padding: 0, width: 36 }} aria-label={x.cerrar}>
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>
        <div style={{ padding: "4px 22px 22px", display: "grid", gap: 14 }}>
          <p style={{ margin: 0, fontSize: 14, color: "var(--text-1)", fontWeight: 600 }}>
            {max != null ? x.incluye(planNombre, max) : planNombre}
          </p>

          {!puedeSubir || opciones.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-3)" }}>
              {puedeSubir ? (reactivando ? x.reactivar : x.suscripcion) : x.sinPermiso}
            </p>
          ) : (
            <>
              <p style={{ margin: 0, fontSize: 13, color: "var(--text-3)" }}>{x.sube}</p>
              <div style={{ display: "grid", gap: 8 }} role="radiogroup">
                {opciones.map((o) => (
                  <button
                    key={o.id} type="button" role="radio" aria-checked={elegido === o.id}
                    onClick={() => setElegido(o.id)}
                    style={{
                      textAlign: "left", padding: "12px 14px", borderRadius: 10, cursor: "pointer",
                      border: `1.5px solid ${elegido === o.id ? "var(--brand)" : "var(--border-soft)"}`,
                      background: "var(--bg-elev)", color: "var(--text-1)",
                      display: "flex", justifyContent: "space-between", gap: 12,
                    }}
                  >
                    <span><strong>{o.name}</strong><br /><span style={{ fontSize: 12, color: "var(--text-3)" }}>{x.usuarios(o.maxUsers)}</span></span>
                    <span style={{ fontWeight: 600 }}>{dinero(o.priceMxn, "MXN", loc)}{x.mes}</span>
                  </button>
                ))}
              </div>

              {elegido && (
                <div aria-live="polite" style={{ fontSize: 13, color: "var(--text-2)", display: "grid", gap: 6 }}>
                  {cargando && (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Loader2 size={14} className="animate-spin" aria-hidden /> {x.calculando}
                    </span>
                  )}
                  {!cargando && fallo && <span>{x.sinVista}</span>}
                  {!cargando && vista && !fallo && (
                    <>
                      {vista.lines.map((l, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                          <span>{l.description}</span><span>{dinero(l.amount, vista.currency, loc)}</span>
                        </div>
                      ))}
                      {vista.amountDueNow > 0 ? (
                        <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "var(--text-1)", borderTop: "1px solid var(--border-soft)", paddingTop: 6 }}>
                          <span>{x.pagasHoy}</span><span>{dinero(vista.amountDueNow, vista.currency, loc)}</span>
                        </div>
                      ) : (
                        <span>{x.sinCobro}</span>
                      )}
                      {vista.nextAmount > 0 && (
                        <span style={{ color: "var(--text-3)" }}>
                          {vista.nextBillingDate
                            ? x.renovacion(dinero(vista.nextAmount, vista.currency, loc), new Date(vista.nextBillingDate).toLocaleDateString(loc, { day: "numeric", month: "long", year: "numeric" }))
                            : x.renovacionSinFecha(dinero(vista.nextAmount, vista.currency, loc))}
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
            </>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            {puedeSubir && <Link href="/dashboard/settings?tab=subscription" className="btn-new btn-new--ghost">{x.suscripcion}</Link>}
            {puedeSubir && plan && (
              <ButtonNew variant="primary" onClick={confirmar} disabled={cargando || fallo || !vista || enviando}>
                {enviando ? x.procesando : x.confirmar(plan.name)}
              </ButtonNew>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
