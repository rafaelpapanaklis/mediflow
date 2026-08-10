"use client";

/**
 * Panel del afiliado — LOS DOS BOTONES del "Bono por tu equipo".
 *
 * Único trozo cliente de la tarjeta (network-bonus-card.tsx es de servidor):
 * elegir es la ÚNICA acción de todo el bloque.
 *
 * POR QUÉ DOS CLICS. La elección es definitiva: no hay endpoint para
 * cambiarla, así que un clic accidental sobre "un solo pago" le cuesta al
 * afiliado la modalidad mensual para siempre. El segundo paso repite en texto
 * QUÉ va a pasar y deja una salida ("Mejor no"). No se usa `confirm()` ni
 * `alert()` del navegador: en el WebView de Facebook —donde muchos afiliados
 * abren el panel— salen sin estilo, a veces bloqueados, y ninguno de los dos
 * puede decir "esto es definitivo" con el tono del panel.
 *
 * NI UN MONTO SE CALCULA AQUÍ: llegan ya formateados en props desde el
 * servidor (fmtMxn vive en public-offer, que toca Prisma y no cruza al
 * cliente). Este componente no sabe cuánto vale un bono; solo lo enseña.
 *
 * Tras registrar la elección se hace `router.refresh()`: la tarjeta es un
 * server component y tiene que volver a leer el estado real del award.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { showPanelToast } from "./ui/panel-toast";

type Choice = "once" | "monthly";

export interface NetworkBonusChoiceProps {
  /** Id del award en `pending_choice`. La propiedad la valida el servidor. */
  awardId: string;
  /** "20 clínicas activas de tu equipo" — ya redactado por el servidor. */
  tierLabel: string;
  /** Pago único YA formateado ("$15,000"). Cadena vacía = no se ofrece. */
  onceLabel: string;
  /** Mensualidad YA formateada ("$1,875"). Cadena vacía = no se ofrece. */
  monthlyLabel: string;
  /** 12 mensualidades, ya formateadas. Cadena vacía si no hay mensual. */
  monthlyYearlyLabel: string;
  /** Meses en que el mensual iguala al único (compareChoices, nunca a mano). */
  monthsToMatch: number | null;
  /** Primer mes en que lo supera. */
  monthsToBeat: number | null;
}

function monthsText(n: number): string {
  return n === 1 ? "1 mes" : `${n} meses`;
}

export function NetworkBonusChoice({
  awardId,
  tierLabel,
  onceLabel,
  monthlyLabel,
  monthlyYearlyLabel,
  monthsToMatch,
  monthsToBeat,
}: NetworkBonusChoiceProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<Choice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Choice | null>(null);

  const hasOnce = onceLabel.length > 0;
  const hasMonthly = monthlyLabel.length > 0;

  async function submit(choice: Choice) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/afiliados/bonos-red", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ awardId, choice }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok !== true) {
        // El mensaje del API ya viene en español y explica el caso concreto
        // (409 = alguien eligió antes desde otra pestaña, 503 = SQL sin correr).
        setError(typeof body?.error === "string" && body.error ? body.error : "No se pudo registrar tu elección.");
        setConfirming(null);
        return;
      }
      setDone(choice);
      setConfirming(null);
      showPanelToast(
        choice === "once"
          ? "Listo: tu bono se paga en un solo pago"
          : "Listo: tu bono se paga cada mes",
      );
      router.refresh();
    } catch {
      setError("No se pudo registrar tu elección. Revisa tu conexión e inténtalo otra vez.");
      setConfirming(null);
    } finally {
      setBusy(false);
    }
  }

  // Ya elegido en esta sesión: el `router.refresh()` va a reemplazar esta
  // tarjeta por la versión "ya elegido", pero mientras llega no puede quedar
  // un par de botones vivos invitando a elegir otra vez.
  if (done !== null) {
    return (
      <div className="dcafp-note dcafp-note--ok" role="status">
        Quedó registrado:{" "}
        <strong>
          {done === "once" ? `un solo pago de ${onceLabel}` : `${monthlyLabel} cada mes`}
        </strong>
        . Tu comisión ya está generada y aparecerá en tus pagos.
      </div>
    );
  }

  if (confirming !== null) {
    const choiceText =
      confirming === "once" ? `un solo pago de ${onceLabel}` : `${monthlyLabel} cada mes`;

    return (
      <div
        role="group"
        aria-label="Confirma cómo vas a cobrar este bono"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          padding: "14px 16px",
          borderRadius: "var(--dcafp-r-box)",
          background: "var(--dcafp-surface)",
          border: "1.5px solid var(--dcafp-brand-300)",
          boxShadow: "var(--dcafp-shadow-tier)",
        }}
      >
        <div style={{ fontSize: 14, lineHeight: 1.55, color: "var(--dcafp-ink)" }}>
          <strong>¿Seguro?</strong> El bono por sostener {tierLabel} se te va a pagar como{" "}
          <strong>{choiceText}</strong>. Esta elección{" "}
          <strong>es definitiva y no se puede cambiar después</strong>.
        </div>

        {confirming === "monthly" && monthsToMatch !== null ? (
          <div style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)", lineHeight: 1.5 }}>
            Recuerda: el mensual alcanza al pago único en {monthsText(monthsToMatch)} y solo corre
            mientras tu equipo sostenga el número.
          </div>
        ) : null}

        {confirming === "once" && monthsToBeat !== null ? (
          <div style={{ fontSize: 12.5, color: "var(--dcafp-ink-3)", lineHeight: 1.5 }}>
            Recuerda: el mensual habría superado a este pago a partir del mes {monthsToBeat} si tu
            equipo sostiene el número, y en un año suma {monthlyYearlyLabel}.
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="dcafp-btn dcafp-btn--primary"
            disabled={busy}
            onClick={() => submit(confirming)}
          >
            {busy ? "Registrando…" : `Sí, quiero ${choiceText}`}
          </button>
          <button
            type="button"
            className="dcafp-btn dcafp-btn--ghost"
            disabled={busy}
            onClick={() => setConfirming(null)}
          >
            Mejor no
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {hasOnce ? (
          <button
            type="button"
            className="dcafp-btn dcafp-btn--primary"
            disabled={busy}
            onClick={() => {
              setError("");
              setConfirming("once");
            }}
          >
            Un solo pago de {onceLabel}
          </button>
        ) : null}
        {hasMonthly ? (
          <button
            type="button"
            className="dcafp-btn dcafp-btn--outline"
            disabled={busy}
            onClick={() => {
              setError("");
              setConfirming("monthly");
            }}
          >
            {monthlyLabel} cada mes
          </button>
        ) : null}
      </div>

      {error ? (
        <div className="dcafp-note dcafp-note--danger" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
