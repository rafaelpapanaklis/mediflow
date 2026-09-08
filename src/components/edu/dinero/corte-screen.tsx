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
  type EduCorteGrupo,
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
                {/* H-54 · la nota de la apertura, a la vista mientras el
                    turno está vivo: es donde se explica el fondo raro. */}
                {session.notes ? ` Nota: ${session.notes}` : ""}
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

            <div className="edu-tablewrap">
              {/* `edu-tablewrap` no es decoración: es lo que hace que esta lista se
                 mida a SÍ MISMA (`@container`) en vez de a la ventana, y lo que
                 hace que se DESPLACE en vez de recortar si algún día no cabe.
                 Sin él, la forma renglón de esta tabla no se estrena nunca:
                 desde la Ola B su umbral vive en un `@container`, no en un
                 `@media`. */}
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

          {/* ══ 🔴 H-09 · DOS SEDES, UN TURNO. DICHO CON LETRAS ══════════
              El turno de caja es del INSTITUTO y no de la sede
              (EduCashSession no tiene columna de sede), así que cuando dos
              mostradores cobran a la vez los dos sellan sus pagos con el
              MISMO turno y el "efectivo esperado" de arriba es el de LOS
              DOS CAJONES. La cajera que cuenta solo el suyo cerraba con
              "Faltaron $8,400" todos los días y no había nada en pantalla
              que lo explicara: la limitación estaba escrita en el código,
              no donde se cuadra el cajón.
              Mientras no exista esa columna, esto es lo que sí se puede
              decir: de quién es cada peso, derivándolo de la SEDE DEL COBRO
              (EduCharge.campusId, que sí está sellada). */}
          {corte.porSede.length > 0 && (
            <section className="edu-section">
              <div className="edu-section__head">
                <div>
                  <h2 className="edu-section__title">De qué sede es el dinero de este turno</h2>
                  <p className="edu-section__lead">
                    Este turno es del <strong>instituto</strong>, no de una sede: mientras esté
                    abierto, todo lo que cobre cualquier mostrador entra aquí. El{" "}
                    <strong>efectivo esperado de arriba es el de todos los cajones juntos</strong>,
                    así que no cierres el turno contando solo el tuyo — o cuentan los dos, o se
                    cierra cuando la otra sede haya terminado. Abajo, cuánto puso cada una
                    (derivado de la sede en la que se emitió cada cobro).
                  </p>
                </div>
              </div>

              <div className="edu-tablewrap">
                <div className="edu-table edu-table--corte">
                  <div className="edu-rowhead" aria-hidden="true">
                    <span>Sede</span>
                    <span>Movimientos</span>
                    <span>Efectivo neto</span>
                    <span>Todos los métodos</span>
                  </div>
                  {corte.porSede.map((s) => (
                    <div className="edu-row" key={s.key || "sin-sede"}>
                      <div className="edu-cell">
                        <span className="edu-cell__label">Sede</span>
                        <span className="edu-cell__value edu-cell__value--strong">{s.label}</span>
                      </div>
                      <div className="edu-cell">
                        <span className="edu-cell__label">Movimientos</span>
                        <span className="edu-cell__value">{s.count}</span>
                      </div>
                      <div className="edu-cell">
                        <span className="edu-cell__label">Efectivo neto</span>
                        <span className="edu-cell__value edu-precio">
                          {eduMoney(s.cashNetCents)}
                        </span>
                      </div>
                      <div className="edu-cell">
                        <span className="edu-cell__label">Todos los métodos</span>
                        <span className="edu-cell__value edu-precio">{eduMoney(s.netCents)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <p className="edu-note">
                El <strong>fondo de apertura no se reparte</strong>: es uno solo y es del turno, así
                que estas columnas son solo el movimiento, sin fondo. La solución de verdad —un
                turno por sede— pide una columna nueva en la base y no se hace en esta ola.
              </p>
            </section>
          )}

          {/* ══ 🔴 H-60 · QUIÉN COBRÓ QUÉ ═══════════════════════════════
              Con dos cajeras en el mismo turno —que es lo único que el
              sistema permite, ver arriba— el corte enseñaba "Efectivo: 14
              movimientos, $8,300" y los nombres de quien abrió y quien
              cerró, y faltaban $600 de nadie. `EduPayment.receivedByUserId`
              estaba guardado desde la Ola 5 y no llegaba a la pantalla. */}
          {corte.porCajero.length > 0 && (
            <section className="edu-section">
              <div className="edu-section__head">
                <div>
                  <h2 className="edu-section__title">Quién cobró qué</h2>
                  <p className="edu-section__lead">
                    Un descuadre con nombre se resuelve preguntando; uno sin nombre, no se resuelve.
                  </p>
                </div>
              </div>

              <div className="edu-tablewrap">
                <div className="edu-table edu-table--corte">
                  <div className="edu-rowhead" aria-hidden="true">
                    <span>Cajero</span>
                    <span>Movimientos</span>
                    <span>Efectivo neto</span>
                    <span>Todos los métodos</span>
                  </div>
                  {corte.porCajero.map((c) => (
                    <div className="edu-row" key={c.key}>
                      <div className="edu-cell">
                        <span className="edu-cell__label">Cajero</span>
                        <span className="edu-cell__value edu-cell__value--strong">{c.label}</span>
                      </div>
                      <div className="edu-cell">
                        <span className="edu-cell__label">Movimientos</span>
                        <span className="edu-cell__value">{c.count}</span>
                      </div>
                      <div className="edu-cell">
                        <span className="edu-cell__label">Efectivo neto</span>
                        <span className="edu-cell__value edu-precio">
                          {eduMoney(c.cashNetCents)}
                        </span>
                      </div>
                      <div className="edu-cell">
                        <span className="edu-cell__label">Todos los métodos</span>
                        <span className="edu-cell__value edu-precio">{eduMoney(c.netCents)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {corte.previous.length > 0 && (
        <section className="edu-section">
          <div className="edu-section__head">
            <div>
              <h2 className="edu-section__title">Turnos cerrados</h2>
              <p className="edu-section__lead">
                Lo esperado y la diferencia quedaron congelados al cerrar: un pago registrado
                después no cambia un corte ya firmado. Debajo de cada diferencia va la nota que
                se escribió al abrir y al cerrar.
              </p>
            </div>
          </div>

          <div className="edu-tablewrap">
            {/* `edu-tablewrap` no es decoración: es lo que hace que esta lista se
               mida a SÍ MISMA (`@container`) en vez de a la ventana, y lo que
               hace que se DESPLACE en vez de recortar si algún día no cabe.
               Sin él, la forma renglón de esta tabla no se estrena nunca:
               desde la Ola B su umbral vive en un `@container`, no en un
               `@media`. */}
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
                      {/* 🔴 H-54 · LA NOTA, LEÍDA. El cierre la pide con
                          insistencia ("un descuadre con explicación es un
                          dato; sin explicación, es una pregunta abierta"),
                          el servidor la concatena con cuidado con la de la
                          apertura… y no la pintaba NADIE. La cajera escribía
                          "faltaron $50: se pagó un taxi de la escuela",
                          cerraba, y esa frase no se podía volver a leer. */}
                      {s.notes && <span className="edu-cell__sub">{s.notes}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
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
          // 🔴 H-09 · el desglose por sede viaja al arqueo: quien cuenta el
          // cajón tiene que saber que el esperado incluye el de la otra.
          porSede={corte.porSede}
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
  porSede,
  onClose,
  onDone,
}: {
  esperado: number;
  /** H-09 · más de un renglón = el esperado es el de varios cajones. */
  porSede: EduCorteGrupo[];
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

      {/* 🔴 H-09 · EL ARQUEO NO LE PUEDE PEDIR A UNA SEDE EL EFECTIVO DE
          LAS DOS SIN DECIRLO. El turno es del instituto y el esperado suma
          los dos mostradores: sin este aviso, quien contaba su cajón
          cerraba con "Faltaron $8,400" todos los días. */}
      {porSede.length > 1 && (
        <div className="edu-banner edu-banner--warn" role="alert">
          <div>
            <p className="edu-banner__title">
              En este turno cobraron {porSede.length} sedes: el esperado es el de TODOS los cajones
            </p>
            <p className="edu-banner__detail">
              {porSede
                .map((s) => `${s.label}: ${eduMoney(s.cashNetCents)} de efectivo`)
                .join(" · ")}
              . El fondo de apertura ({eduMoney(esperado - porSede.reduce((a, s) => a + s.cashNetCents, 0))}
              ) es uno solo y es del turno. Cuenta los dos cajones antes de escribir el total, o
              cierra el turno cuando la otra sede haya terminado: si escribes solo el tuyo, el corte
              dirá que falta dinero que sí está.
            </p>
          </div>
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
