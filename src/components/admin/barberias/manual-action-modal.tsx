"use client";

// ═══════════════════════════════════════════════════════════════════════
// Acción MANUAL sobre una barbería: suspender, reactivar o mover el plan.
//
// La nota es OBLIGATORIA y se valida en los dos lados: aquí para no dejar
// enviar, y otra vez en src/lib/barber/admin.ts (que es quien de verdad
// manda). Sin nota no hay escritura — el punto es que una palanca movida a
// mano siempre pueda explicarse después.
//
// SE MONTA FUERA DE .dcba a propósito: ese contenedor declara
// `container-type: inline-size`, que crea contención y ATRAPA a los
// `position: fixed` de dentro; el backdrop quedaría anclado al bloque en vez
// de a la ventana. Ver la cabecera de barberias.css.
// ═══════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { AlertTriangle } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import type { BarberPlanId, BarberResolvedPlan } from "@/lib/barber/plan-shared";
import { formatMoney } from "@/components/admin/barberias/shared";

export type ManualActionKind = "suspend" | "reactivate" | "plan";

/** Mismo mínimo que exige el server (BARBER_ADMIN_NOTE_MIN). */
const NOTE_MIN = 8;
const NOTE_MAX = 1000;

export interface ManualActionResult {
  branchesUpdated: number;
  audited: boolean;
  shop: { id: string; plan: BarberPlanId; subscriptionStatus: string };
}

interface Props {
  kind: ManualActionKind;
  barbershopId: string;
  barbershopName: string;
  currentPlan: BarberPlanId;
  plans: BarberResolvedPlan[];
  onClose: () => void;
  onDone: (result: ManualActionResult) => void;
}

const COPY: Record<ManualActionKind, { title: string; body: string; cta: string }> = {
  suspend: {
    title: "Suspender la barbería",
    body:
      "Deja la cuenta sin suscripción activa: su equipo verá la pantalla de pago al entrar. El cambio se propaga a las sucursales. Si la barbería tiene una suscripción viva en Stripe, el siguiente evento de esa suscripción devolverá el estado real.",
    cta: "Suspender",
  },
  reactivate: {
    title: "Reactivar la barbería",
    body:
      "Devuelve la cuenta a estado activo y lo propaga a las sucursales. Stripe manda: el siguiente evento de la suscripción reescribe este valor con el real.",
    cta: "Reactivar",
  },
  plan: {
    title: "Cambiar de plan a mano",
    body:
      "Mueve el plan de la cuenta y de sus sucursales. NO toca Stripe: el importe que se cobra sigue siendo el de la suscripción vigente hasta que se cambie desde el panel de la barbería.",
    cta: "Cambiar plan",
  },
};

export function ManualActionModal({
  kind,
  barbershopId,
  barbershopName,
  currentPlan,
  plans,
  onClose,
  onDone,
}: Props) {
  const copy = COPY[kind];
  const [note, setNote] = useState("");
  const [plan, setPlan] = useState<BarberPlanId>(currentPlan);
  const [saving, setSaving] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, saving]);

  const trimmed = note.trim();
  const noteOk = trimmed.length >= NOTE_MIN && trimmed.length <= NOTE_MAX;
  const planOk = kind !== "plan" || plan !== currentPlan;
  const canSend = noteOk && planOk && !saving;

  async function submit() {
    if (!canSend) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/barberias/${barbershopId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: kind,
          note: trimmed,
          ...(kind === "plan" ? { plan } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(data?.error || "No se pudo aplicar el cambio");
        return;
      }
      if (data?.audited === false) {
        toast(
          "Cambio aplicado, pero NO quedó en la bitácora: falta aplicar sql/barber_admin.sql.",
          { icon: "⚠️", duration: 7000 },
        );
      } else {
        toast.success("Cambio aplicado y registrado");
      }
      onDone(data as ManualActionResult);
    } catch {
      toast.error("Error de red al aplicar el cambio");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="dcba-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={copy.title}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div className="dcba-modal">
        <h2 className="dcba-modal__title">{copy.title}</h2>
        <p className="dcba-modal__body">
          <strong style={{ color: "var(--text-2)" }}>{barbershopName}</strong> — {copy.body}
        </p>

        {kind === "plan" && (
          <div className="dcba-modal__field">
            <label className="dcba-label" htmlFor="dcba-plan">
              Plan nuevo
            </label>
            <select
              id="dcba-plan"
              className="input-new"
              value={plan}
              onChange={(e) => setPlan(e.target.value as BarberPlanId)}
              disabled={saving}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {formatMoney(p.priceMonthly)}/mes
                  {p.id === currentPlan ? " (actual)" : ""}
                </option>
              ))}
            </select>
            {!planOk && (
              <div className="dcba-counter" style={{ color: "var(--warning)", textAlign: "left" }}>
                Elige un plan distinto del actual.
              </div>
            )}
          </div>
        )}

        <div className="dcba-modal__field">
          <label className="dcba-label" htmlFor="dcba-note">
            Nota — por qué haces este cambio (obligatoria)
          </label>
          <textarea
            id="dcba-note"
            ref={noteRef}
            className="dcba-textarea"
            value={note}
            maxLength={NOTE_MAX}
            disabled={saving}
            placeholder="Ej.: acordado por teléfono con el dueño mientras resuelve su tarjeta."
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="dcba-counter">
            {trimmed.length < NOTE_MIN
              ? `Faltan ${NOTE_MIN - trimmed.length} caracteres`
              : `${trimmed.length} / ${NOTE_MAX}`}
          </div>
        </div>

        <div className="dcba-warn">
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Queda registrado con tu correo y la fecha. Es una palanca de operación, no un cobro:
            nada de esto emite ni cancela facturas en Stripe.
          </span>
        </div>

        <div className="dcba-modal__foot">
          <ButtonNew size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            Cancelar
          </ButtonNew>
          <ButtonNew
            size="sm"
            variant={kind === "suspend" ? "danger" : "primary"}
            onClick={submit}
            disabled={!canSend}
          >
            {saving ? "Aplicando…" : copy.cta}
          </ButtonNew>
        </div>
      </div>
    </div>
  );
}
