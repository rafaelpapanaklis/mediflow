"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { REALTY_PLAN_IDS, type RealtyPlanId } from "@/lib/realty/plan-shared";

/**
 * Modal de las acciones manuales de soporte sobre una cuenta de inmuebles.
 *
 * 🔴 Se monta FUERA de `.dcin` (ver la cabecera de inmobiliarias.css):
 * `container-type: inline-size` crea contexto de contención y ATRAPA a
 * `position: fixed`, así que el modal quedaría encajonado dentro de la ficha.
 *
 * La NOTA es obligatoria y se valida aquí Y en el servidor: una acción de
 * soporte sin motivo escrito es una acción que nadie va a poder explicar en
 * seis meses.
 */
export type ManualActionKind = "suspend" | "reactivate" | "plan" | "grant-days";

const NOTE_MIN = 8;
const NOTE_MAX = 1000;

const COPY: Record<
  ManualActionKind,
  { title: string; body: string; cta: string; danger?: boolean }
> = {
  suspend: {
    title: "Suspender la cuenta",
    body:
      "La cuenta pierde el acceso al panel de inmediato. El estado queda como " +
      '"suspendida" (no como un cobro fallido), así que se distingue de un ' +
      "impago de Stripe. No se cancela nada en Stripe: si tiene suscripción, sigue cobrando.",
    cta: "Suspender",
    danger: true,
  },
  reactivate: {
    title: "Reactivar la cuenta",
    body:
      "Devuelve el acceso al panel marcando la suscripción como activa. Ojo: " +
      "esto NO cobra nada ni pone fecha de fin. Si lo que quieres es dar tiempo " +
      "con vencimiento, usa Días de cortesía.",
    cta: "Reactivar",
  },
  plan: {
    title: "Cambiar el plan",
    body:
      "Cambia el plan que la cuenta VE y los cupos que se le aplican. Solo " +
      "funciona si la cuenta NO tiene una suscripción viva en Stripe: cuando " +
      "la tiene, el plan lo manda el precio que paga y el webhook revertiría " +
      "este cambio en la próxima renovación. Para una cuenta que paga, el " +
      "cambio con prorrateo lo hace ella desde su pantalla de Suscripción.",
    cta: "Cambiar el plan",
  },
  "grant-days": {
    title: "Otorgar días de cortesía",
    body:
      "Se le regalan días como periodo de cortesía EN STRIPE, así que expiran " +
      "solos y el webhook actualiza la cuenta cuando terminan. Si no tiene " +
      "suscripción, se le crea una en cortesía sin tarjeta: al vencer, Stripe " +
      "la cancela sola.",
    cta: "Otorgar los días",
  },
};

export function RealtyManualActionModal({
  accountId,
  accountName,
  currentPlan,
  planOptions,
  kind,
  onClose,
  onDone,
}: {
  accountId: string;
  accountName: string;
  currentPlan: RealtyPlanId;
  /** Catálogo con los NOMBRES de la tabla: aquí no se escribe ninguno. */
  planOptions: { id: RealtyPlanId; name: string }[];
  kind: ManualActionKind;
  onClose: () => void;
  onDone: () => void;
}) {
  const destinos = planOptions.filter((p) => p.id !== currentPlan);
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState<RealtyPlanId>(
    destinos[0]?.id ?? REALTY_PLAN_IDS.find((p) => p !== currentPlan) ?? currentPlan,
  );
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const copy = COPY[kind];
  const trimmed = note.trim();
  const noteOk = trimmed.length >= NOTE_MIN && trimmed.length <= NOTE_MAX;
  const daysNum = Number(days);
  const daysOk =
    kind !== "grant-days" || (Number.isInteger(daysNum) && daysNum >= 1 && daysNum <= 365);

  async function submit() {
    if (!noteOk || !daysOk || busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/inmobiliarias/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: kind,
          note: trimmed,
          ...(kind === "plan" ? { plan } : {}),
          ...(kind === "grant-days" ? { days: daysNum } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error ?? "No se pudo aplicar la acción.");
        return;
      }
      if (data?.audited === false) {
        // La acción SÍ se aplicó; lo que falló fue el registro.
        toast(
          "Se aplicó, pero no se pudo guardar en la bitácora (falta aplicar sql/realty.sql).",
          { icon: "⚠️" },
        );
      } else {
        toast.success("Listo.");
      }
      onDone();
      onClose();
    } catch {
      toast.error("No se pudo conectar. Inténtalo de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="dcin-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div className="dcin-modal">
        <h3 className="dcin-modal__title">{copy.title}</h3>
        <p className="dcin-modal__body">
          <strong>{accountName}</strong> — {copy.body}
        </p>

        {kind === "plan" ? (
          <div className="dcin-modal__field">
            <label className="dcin-label" htmlFor="dcin-plan">
              Plan destino
            </label>
            <select
              id="dcin-plan"
              className="dcin-control"
              value={plan}
              onChange={(e) => setPlan(e.target.value as RealtyPlanId)}
              disabled={busy}
            >
              {destinos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {kind === "grant-days" ? (
          <div className="dcin-modal__field">
            <label className="dcin-label" htmlFor="dcin-days">
              Días (1 a 365)
            </label>
            <input
              id="dcin-days"
              className="dcin-control"
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              disabled={busy}
            />
          </div>
        ) : null}

        <div className="dcin-modal__field">
          <label className="dcin-label" htmlFor="dcin-note">
            Por qué haces este cambio (obligatorio)
          </label>
          <textarea
            id="dcin-note"
            className="dcin-textarea"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX}
            disabled={busy}
            placeholder="Ej.: el cliente pidió pausa por remodelación de su oficina."
          />
          <span className="dcin-counter">
            {trimmed.length}/{NOTE_MAX} · mínimo {NOTE_MIN}
          </span>
        </div>

        <div className="dcin-modal__foot">
          <button type="button" className="dcin-btn" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className={`dcin-btn ${copy.danger ? "dcin-btn--danger" : "dcin-btn--primary"}`}
            onClick={submit}
            disabled={!noteOk || !daysOk || busy}
          >
            {busy ? "Aplicando…" : copy.cta}
          </button>
        </div>
      </div>
    </div>
  );
}
