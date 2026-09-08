"use client";

import { useState } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { eduMoney } from "@/lib/edu/dinero-core";
import { EDU_QUOTE_STATUS_LABELS } from "@/lib/edu/presupuestos-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL PRESUPUESTO QUE VE EL PACIENTE — en su teléfono, sin cuenta y sin
 * sesión.
 *
 * Hermana de `consentimiento-publico.tsx`, con las mismas tres reglas:
 *   · quien lee esto no trabaja aquí, así que no hay jerga del panel ni
 *     ids en pantalla;
 *   · el botón de aceptar solo aparece cuando de verdad se puede aceptar,
 *     y cuando no, la pantalla dice POR QUÉ en una frase entera (el
 *     servidor manda ese `bloqueo` ya escrito: no se inventa aquí);
 *   · nada de lo que se decide aquí es una garantía — el endpoint público
 *     vuelve a comprobar el estado, la vigencia y el doble toque.
 *
 * 🔴 EL TOTAL VA GRANDE Y ARRIBA DEL BOTÓN. Lo que esta persona está a
 * punto de aceptar es una cantidad de dinero, y el número por el que
 * responde tiene que estar a la vista en el mismo golpe de ojo que el
 * botón — no en una tabla de la que hay que sumar.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduQuotePublicView {
  folio: string;
  title: string;
  estadoVisible: string;
  validUntil: string | null;
  /** El DÍA de la vigencia, ya escrito por el servidor en la zona del instituto. */
  validUntilDia: string | null;
  totalCents: number;
  subtotalCents: number;
  discountCents: number;
  items: { name: string; quantity: number; lineTotalCents: number; phase: number | null }[];
  bloqueo: string | null;
}

export function EduPresupuestoPublico({
  token,
  inicial,
}: {
  token: string;
  inicial: EduQuotePublicView;
}) {
  const [vista, setVista] = useState<EduQuotePublicView>(inicial);
  const [nombre, setNombre] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listo, setListo] = useState<string | null>(null);

  async function aceptar() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/instituto/presupuestos/publico/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : "No se pudo aceptar el presupuesto.");
        return;
      }
      setListo("Listo. Tu aceptación quedó registrada.");
      // Se relee del servidor en vez de adivinar el estado nuevo: lo que
      // vale es lo que quedó guardado, no lo que este navegador cree.
      const fresco = await fetch(`/api/instituto/presupuestos/publico/${token}`, {
        cache: "no-store",
      });
      if (fresco.ok) setVista((await fresco.json()) as EduQuotePublicView);
    } catch {
      setError("No se pudo conectar. Revisa tu señal e inténtalo otra vez.");
    } finally {
      setBusy(false);
    }
  }

  // El DÍA de la vigencia lo manda el servidor ya resuelto en la zona del
  // instituto: para una vigencia («vale hasta el 12 de abril») la hora no
  // dice nada, y formatear el instante en el navegador pintaría la zona del
  // teléfono, que puede no ser la de la escuela.
  //
  // 🔴 OLA C·fin 2 · y por eso ya no se recorta el ISO aquí: `validUntil`
  // guarda el FINAL del día del instituto, así que sus diez primeros
  // caracteres son el día SIGUIENTE en UTC. El paciente leía un día de más.
  const vigencia = vista.validUntilDia;
  const puedeAceptar = vista.bloqueo === null;

  return (
    <div className="edu-auth edu-publico">
      <main className="edu-publico__hoja">
        <header className="edu-publico__head">
          <p className="edu-publico__marca">Presupuesto {vista.folio}</p>
          <h1 className="edu-publico__title">{vista.title}</h1>
          <p className="edu-publico__sub">
            {vigencia ? `Vale hasta el ${vigencia}` : "Sin fecha de vencimiento"}
          </p>
        </header>

        {listo && (
          <div className="edu-alert edu-alert--ok" role="status">
            <CheckCircle2 size={16} aria-hidden /> {listo} Esta es tu copia: guárdala o pide una
            impresa en la clínica.
          </div>
        )}

        {/* 🔴 EL MOTIVO, ESCRITO POR EL SERVIDOR. Vencido, ya aceptado,
            rechazado o retirado no son el mismo caso y no se pueden
            resumir en «no se puede»: cada uno lleva qué hacer ahora. */}
        {vista.bloqueo && !listo && (
          <div className="edu-alert" role="alert">
            <ShieldAlert size={16} aria-hidden /> {vista.bloqueo}
          </div>
        )}

        <section className="edu-publico__texto" style={{ whiteSpace: "normal" }}>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {vista.items.map((i, n) => (
              <li
                key={n}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "6px 0",
                  borderBottom: "1px solid var(--edu-line)",
                }}
              >
                <span style={{ overflowWrap: "anywhere" }}>
                  {i.quantity > 1 ? `${i.quantity} × ` : ""}
                  {i.name}
                  {i.phase !== null ? ` · fase ${i.phase}` : ""}
                </span>
                <span className="edu-precio" style={{ whiteSpace: "nowrap" }}>
                  {eduMoney(i.lineTotalCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <div className="edu-totales">
          <div className="edu-totales__fila">
            <span>Subtotal</span>
            <span className="edu-precio">{eduMoney(vista.subtotalCents)}</span>
          </div>
          {vista.discountCents > 0 && (
            <div className="edu-totales__fila">
              <span>Descuento</span>
              <span className="edu-precio">−{eduMoney(vista.discountCents)}</span>
            </div>
          )}
          <div className="edu-totales__fila edu-totales__fila--fuerte">
            <span>Total</span>
            <span className="edu-precio">{eduMoney(vista.totalCents)}</span>
          </div>
        </div>

        {puedeAceptar && !listo && (
          <section className="edu-publico__firmas">
            {error && (
              <div className="edu-alert" role="alert">
                {error}
              </div>
            )}
            <div className="edu-field">
              <label className="edu-field__label" htmlFor="edu-presu-nombre">
                Escribe tu nombre completo para aceptar
              </label>
              <input
                id="edu-presu-nombre"
                className="edu-input"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                autoComplete="name"
                placeholder="María Rodríguez Pérez"
              />
              <span className="edu-field__hint">
                Aceptar este presupuesto no es un pago: es decir que estás de acuerdo con el
                tratamiento y con su precio. En la clínica te dirán cómo y cuándo se paga.
              </span>
            </div>
            <button
              type="button"
              className="edu-btn edu-btn--primary"
              onClick={aceptar}
              disabled={busy || nombre.trim().length < 3}
            >
              {busy ? "Enviando…" : `Acepto el presupuesto por ${eduMoney(vista.totalCents)}`}
            </button>
          </section>
        )}

        <p className="edu-publico__pie">
          Este documento es un presupuesto: no es una factura, no es un recibo y no acredita ningún
          pago. Estado: {EDU_QUOTE_STATUS_LABELS[vista.estadoVisible as "BORRADOR"] ?? "Vencido"}.
        </p>
      </main>
    </div>
  );
}
