"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  eduCorteMethodsVisibles,
  eduCorteTerminalCents,
  eduMoney,
  type EduCorte,
} from "@/lib/edu/dinero-core";
import { EDU_PAYMENT_METHOD_LABELS } from "@/lib/edu/types";

/**
 * /instituto/caja/corte — EL CORTE DEL TURNO.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 UN CORTE ES DE TURNO, NO DE DÍA. La ventana va de la apertura a
 * ahora. Si nadie corta en tres días, la ventana son tres días — y esta
 * pantalla lo DICE, con las fechas escritas, en vez de titular "hoy" unos
 * datos que no son de hoy.
 *
 * Es la lección que costó un bug en el producto dental: la lista y los
 * totales salían de la ventana del turno y la pantalla los llamaba "ventas
 * del día". Cuando el turno cruzaba la medianoche, todo el mundo leía mal
 * el mismo número.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface EduCorteScreenProps {
  corte: EduCorte;
  /** Fechas ya formateadas EN EL SERVIDOR, en la zona del instituto. */
  labels: {
    openedAt: string | null;
    previous: Record<string, { openedAt: string; closedAt: string }>;
  };
  canCorte: boolean;
}

export function EduCorteScreen({ corte, labels, canCorte }: EduCorteScreenProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [abrir, setAbrir] = useState(false);
  const [cerrar, setCerrar] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  function recargar(mensaje: string) {
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  const { session, methods, expectedCashCents, netCents, refundedCents } = corte;
  // Los renglones que se pintan: los cobrables siempre (también en cero) y
  // el legado "Tarjeta (sin especificar)" solo si de verdad hubo
  // movimientos con él — un renglón permanente en cero de algo que ya
  // nadie puede elegir es ruido en la hoja que se firma.
  const visibles = eduCorteMethodsVisibles(methods);
  // La TERMINAL: débito + crédito + el legado, en neto. Es el número que
  // se compara contra el corte que imprime la terminal bancaria, y que
  // desde que hay dos renglones de tarjeta habría que sumar de cabeza.
  const terminalCents = eduCorteTerminalCents(methods);

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      {!session ? (
        <div className="edu-empty">
          <p className="edu-empty__title">No hay ningún turno de caja abierto</p>
          <p className="edu-empty__detail">
            Abre uno al empezar el día o el turno, con el fondo que haya en el cajón. Se puede
            cobrar sin turno abierto —el corte no es un peaje— pero esos cobros no entran en ningún
            corte.
          </p>
          {canCorte && (
            <button
              type="button"
              className="edu-btn edu-btn--primary edu-btn--sm"
              onClick={() => setAbrir(true)}
            >
              Abrir turno
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="edu-banner">
            <div>
              <p className="edu-banner__title">Turno abierto el {labels.openedAt}</p>
              <p className="edu-banner__detail">
                Lo abrió {session.openedByName} con {eduMoney(session.openingCents)} de fondo.
                {corte.spanDays > 1 && (
                  <>
                    {" "}
                    <strong>
                      Este turno lleva {corte.spanDays} días naturales abiertos: lo que ves NO es
                      &quot;lo de hoy&quot;.
                    </strong>
                  </>
                )}
              </p>
            </div>
            {canCorte && (
              <button
                type="button"
                className="edu-btn edu-btn--primary edu-btn--sm"
                onClick={() => setCerrar(true)}
              >
                Cerrar turno
              </button>
            )}
          </div>

          <div className="edu-kpis">
            <div className="edu-kpi">
              <span className="edu-kpi__label">Efectivo esperado en el cajón</span>
              <span className="edu-kpi__value">{eduMoney(expectedCashCents)}</span>
              <span className="edu-kpi__note">
                Fondo {eduMoney(session.openingCents)} + efectivo cobrado − efectivo devuelto
              </span>
            </div>
            <div className="edu-kpi">
              <span className="edu-kpi__label">Entró en el turno (todos los métodos)</span>
              <span className="edu-kpi__value">{eduMoney(netCents)}</span>
              {refundedCents > 0 && (
                <span className="edu-kpi__note">
                  Ya descontadas {eduMoney(refundedCents)} de devoluciones
                </span>
              )}
            </div>
            <div className="edu-kpi">
              <span className="edu-kpi__label">Cobros emitidos</span>
              <span className="edu-kpi__value">{corte.chargeCount}</span>
              <span className="edu-kpi__note">
                {eduMoney(corte.chargedCents)} · quedan {eduMoney(corte.pendingCents)} por cobrar
              </span>
            </div>
          </div>

          <section className="edu-section">
            <div className="edu-section__head">
              <div>
                <h2 className="edu-section__title">Por método de pago</h2>
                <p className="edu-section__lead">
                  Lo cobrado y lo devuelto van en columnas distintas a propósito: un solo neto
                  esconde que hubo que devolver dinero, que es justo lo que la dirección pregunta.
                </p>
              </div>
            </div>

            <div className="edu-table edu-table--corte">
              <div className="edu-rowhead" aria-hidden="true">
                <span>Método</span>
                <span>Movimientos</span>
                <span>Cobrado</span>
                <span>Devuelto</span>
                <span>Neto</span>
              </div>

              {visibles.map((m) => (
                <div className="edu-row" key={m.method}>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Método</span>
                    <span className="edu-cell__value edu-cell__value--strong">
                      {EDU_PAYMENT_METHOD_LABELS[m.method]}
                    </span>
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Movimientos</span>
                    <span className="edu-cell__value">{m.count}</span>
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Cobrado</span>
                    <span className="edu-cell__value edu-precio">{eduMoney(m.chargedCents)}</span>
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Devuelto</span>
                    <span className="edu-cell__value edu-precio">
                      {m.refundedCents > 0 ? `−${eduMoney(m.refundedCents)}` : "—"}
                    </span>
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Neto</span>
                    <span className="edu-cell__value edu-precio">{eduMoney(m.netCents)}</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="edu-totales">
              <div className="edu-totales__fila edu-totales__fila--fuerte">
                <span>Terminal (débito + crédito)</span>
                <span className="edu-precio">{eduMoney(terminalCents)}</span>
              </div>
              <p className="edu-note">
                Para cuadrar contra el corte que imprime la terminal bancaria. El efectivo
                esperado del cajón NO incluye esto: una tarjeta no mete un peso en el cajón.
              </p>
            </div>
          </section>
        </>
      )}

      {corte.previous.length > 0 && (
        <section className="edu-section">
          <div className="edu-section__head">
            <div>
              <h2 className="edu-section__title">Turnos cerrados</h2>
              <p className="edu-section__lead">
                Lo esperado y la diferencia quedaron congelados al cerrar: un pago registrado
                después no cambia un corte ya firmado.
              </p>
            </div>
          </div>

          <div className="edu-table edu-table--turnos">
            <div className="edu-rowhead" aria-hidden="true">
              <span>Abierto</span>
              <span>Cerrado</span>
              <span>Esperado</span>
              <span>Contado</span>
              <span>Diferencia</span>
            </div>

            {corte.previous.map((s) => {
              const l = labels.previous[s.id];
              const dif = s.differenceCents ?? 0;
              return (
                <div className="edu-row" key={s.id}>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Abierto</span>
                    <span className="edu-cell__value">{l?.openedAt ?? "—"}</span>
                    <span className="edu-cell__sub">{s.openedByName}</span>
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Cerrado</span>
                    <span className="edu-cell__value">{l?.closedAt ?? "—"}</span>
                    <span className="edu-cell__sub">{s.closedByName ?? "—"}</span>
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Esperado</span>
                    <span className="edu-cell__value edu-precio">{eduMoney(s.expectedCents)}</span>
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Contado</span>
                    <span className="edu-cell__value edu-precio">{eduMoney(s.countedCents)}</span>
                  </div>
                  <div className="edu-cell">
                    <span className="edu-cell__label">Diferencia</span>
                    <span
                      className={`edu-tag ${dif === 0 ? "edu-tag--ok" : dif > 0 ? "edu-tag--info" : "edu-tag--danger"}`}
                    >
                      {dif === 0 ? "Cuadró" : dif > 0 ? `Sobró ${eduMoney(dif)}` : `Faltó ${eduMoney(-dif)}`}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {abrir && (
        <AbrirTurno
          onClose={() => setAbrir(false)}
          onDone={() => {
            setAbrir(false);
            recargar("Turno abierto. Lo que se cobre desde ahora entra en este corte.");
          }}
        />
      )}

      {cerrar && session && (
        <CerrarTurno
          esperado={expectedCashCents}
          onClose={() => setCerrar(false)}
          onDone={(mensaje) => {
            setCerrar(false);
            recargar(mensaje);
          }}
        />
      )}
    </>
  );
}

function AbrirTurno({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [fondo, setFondo] = useState("0.00");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function abrir() {
    setError(null);
    setBusy(true);
    try {
      await eduRequest("/api/instituto/caja/corte", {
        method: "POST",
        body: { openingCents: fondo, notes: notas.trim() || null },
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el turno.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Abrir turno de caja"
      subtitle="El fondo es lo que hay en el cajón antes de cobrarle a nadie."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={abrir}
            disabled={busy}
          >
            {busy ? "Abriendo…" : "Abrir turno"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-turno-fondo">
          Fondo de caja
        </label>
        <input
          id="edu-turno-fondo"
          className="edu-input"
          inputMode="decimal"
          value={fondo}
          onChange={(e) => setFondo(e.target.value)}
        />
        <span className="edu-field__hint">
          Si el cajón empieza vacío, deja 0. Este número entra en el esperado del arqueo.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-turno-notas">
          Nota (opcional)
        </label>
        <input
          id="edu-turno-notas"
          className="edu-input"
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          autoComplete="off"
        />
      </div>
    </EduModal>
  );
}

function CerrarTurno({
  esperado,
  onClose,
  onDone,
}: {
  esperado: number;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  // 🔴 El contado arranca VACÍO, no con el esperado. Prellenarlo con lo que
  // debería haber convierte el arqueo en un clic y el descuadre deja de
  // existir: la única forma de que ese número signifique algo es que
  // alguien cuente los billetes y lo escriba.
  const [contado, setContado] = useState("");
  const [notas, setNotas] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const contadoCents = centavos(contado);
  const dif = contado.trim() === "" ? null : contadoCents - esperado;

  async function cerrar() {
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ differenceCents: number }>("/api/instituto/caja/corte", {
        method: "PATCH",
        body: { countedCents: contado, notes: notas.trim() || null },
      });
      const d = res.differenceCents;
      onDone(
        d === 0
          ? "Turno cerrado y el cajón cuadró."
          : d > 0
            ? `Turno cerrado. Sobraron ${eduMoney(d)}.`
            : `Turno cerrado. Faltaron ${eduMoney(-d)}.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cerrar el turno.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Cerrar turno de caja"
      subtitle="Cuenta el efectivo del cajón y escríbelo. El esperado ya está calculado."
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={cerrar}
            disabled={busy || contado.trim() === ""}
          >
            {busy ? "Cerrando…" : "Cerrar turno"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-totales">
        <div className="edu-totales__fila edu-totales__fila--fuerte">
          <span>Efectivo esperado</span>
          <span className="edu-precio">{eduMoney(esperado)}</span>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-cierre-contado">
          Efectivo contado
        </label>
        <input
          id="edu-cierre-contado"
          className="edu-input"
          inputMode="decimal"
          value={contado}
          onChange={(e) => setContado(e.target.value)}
          placeholder="0.00"
          autoComplete="off"
        />
        <span className="edu-field__hint">
          Cuenta los billetes. Si escribes el esperado sin contar, el arqueo no sirve para nada.
        </span>
      </div>

      {dif !== null && (
        <p className={`edu-dif ${dif === 0 ? "edu-dif--ok" : dif < 0 ? "edu-dif--mal" : ""}`}>
          {dif === 0
            ? "Cuadra."
            : dif > 0
              ? `Sobran ${eduMoney(dif)}.`
              : `Faltan ${eduMoney(-dif)}.`}
        </p>
      )}

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-cierre-notas">
          Nota del cierre (opcional)
        </label>
        <textarea
          id="edu-cierre-notas"
          className="edu-input"
          rows={2}
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          placeholder="Faltaron $50: se pagó un taxi de la escuela."
        />
        <span className="edu-field__hint">
          Se suma a la nota de la apertura; no la pisa. Un descuadre con explicación es un dato; sin
          explicación, es una pregunta abierta.
        </span>
      </div>
    </EduModal>
  );
}

/** Centavos para el aviso que se pinta mientras se teclea. El servidor
 *  vuelve a leer y a calcular la diferencia que se guarda. */
function centavos(texto: string): number {
  const limpio = texto.replace(/[^\d.]/g, "");
  if (!limpio) return 0;
  const [ent, dec = ""] = limpio.split(".");
  const n = Number(ent || "0") * 100 + Number((dec + "00").slice(0, 2));
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
