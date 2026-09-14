"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  HelpCircle,
  Loader2,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import {
  SABINA_ARMADO_MS,
  estadoVisible,
  etiquetaEstado,
  fraseDeEstado,
  pideCasilla,
  puedeConfirmar,
  textoCaducidad,
  type SabinaPropuestaVista,
} from "./propuesta-core";
import styles from "./propuesta.module.css";

const ICONO_TONO = {
  pendiente: Sparkles,
  bien: Check,
  mal: X,
  neutro: X,
} as const;

/**
 * La tarjeta de lo que Sabina PROPONE hacer.
 *
 * Tres cosas que no se negocian:
 *  · Se lee de un vistazo: la frase arriba, los datos resueltos debajo, los avisos
 *    antes del botón. «Todavía no se hizo nada» mientras no se confirme.
 *  · No se confirma por error: el botón nombra la acción («Sí, agendar»), nace
 *    apagado un instante, no responde a Enter del chat, y si la acción no se
 *    puede deshacer lo dice ANTES y pide marcar una casilla.
 *  · Nunca dice «hecho» por su cuenta: el resultado es la frase del servidor. Si
 *    la respuesta se pierde por la red, dice que no se sabe y ofrece consultar
 *    (volver a confirmar no repite: el servidor devuelve lo que pasó).
 */
export function PropuestaCard({
  propuesta,
  desfase,
  ocupado,
  trabajando,
  dudoso,
  onConfirmar,
  onDescartar,
  onConsultar,
  onCaducar,
}: {
  propuesta: SabinaPropuestaVista;
  /** ms que va adelantado el reloj del servidor (ver `desfaseReloj`). */
  desfase: number;
  /** Hay otra petición en marcha en la pantalla. */
  ocupado: boolean;
  trabajando: "confirmar" | "descartar" | "consultar" | null;
  /** Se confirmó y no llegó respuesta legible: no se sabe si se hizo. */
  dudoso: boolean;
  onConfirmar: () => void;
  onDescartar: () => void;
  /** Pregunta al servidor (GET, solo lectura) en qué quedó. */
  onConsultar: () => void;
  /** El plazo venció en pantalla: que el servidor diga en qué quedó. */
  onCaducar: () => void;
}) {
  const [ahora, setAhora] = useState(() => Date.now());
  const [armada, setArmada] = useState(false);
  const [casilla, setCasilla] = useState(false);
  // Un doble toque dispara dos clics antes de que el padre marque `trabajando`.
  const pulsadoRef = useRef(false);

  // Se arma al pintarse y OTRA VEZ si vuelve a estar pendiente tras una duda (la
  // consulta dijo que la confirmación nunca llegó): el botón reaparece bajo el
  // dedo que acaba de pulsar «Consultar».
  useEffect(() => {
    if (dudoso) return;
    setArmada(false);
    const t = setTimeout(() => setArmada(true), SABINA_ARMADO_MS);
    return () => clearTimeout(t);
  }, [dudoso]);

  useEffect(() => {
    if (propuesta.estado !== "pendiente") return;
    const id = setInterval(() => setAhora(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [propuesta.estado]);

  useEffect(() => {
    if (!trabajando) pulsadoRef.current = false;
  }, [trabajando]);

  const estado = estadoVisible(propuesta, ahora, desfase);
  const caducoEnPantalla = propuesta.estado === "pendiente" && estado === "caducada";
  useEffect(() => {
    if (caducoEnPantalla) onCaducar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caducoEnPantalla]);
  const pendiente = estado === "pendiente" && !dudoso;
  const etiqueta = dudoso
    ? { texto: "Sin respuesta · no se sabe si se hizo", tono: "mal" as const }
    : etiquetaEstado(estado);
  const Icono = dudoso ? HelpCircle : ICONO_TONO[etiqueta.tono];
  const irreversible = !propuesta.deshacer.reversible;
  const habilitado =
    !trabajando &&
    puedeConfirmar({ propuesta, ahoraCliente: ahora, desfase, armada, casillaMarcada: casilla, ocupado });
  const notaEstado = !propuesta.resultado && !dudoso ? fraseDeEstado(estado) : null;

  const pulsar = (fn: () => void) => () => {
    if (pulsadoRef.current) return;
    pulsadoRef.current = true;
    fn();
  };

  return (
    <section
      className={styles.card}
      data-estado={dudoso ? "dudoso" : estado}
      data-irreversible={irreversible || undefined}
      aria-label={`Propuesta de Sabina: ${propuesta.titulo}`}
    >
      <header className={styles.head}>
        <span className={styles.badge} data-tono={etiqueta.tono}>
          <Icono size={12} aria-hidden />
          {etiqueta.texto}
        </span>
        {pendiente && (
          <span className={styles.timer}>
            <Clock size={11} aria-hidden />
            {textoCaducidad(propuesta, ahora, desfase)}
          </span>
        )}
      </header>

      <div className={styles.body}>
        <h3 className={styles.title}>{propuesta.titulo}</h3>
        <p className={styles.frase}>{propuesta.tarjeta.frase}</p>

        {propuesta.tarjeta.detalles.length > 0 && (
          <dl className={styles.detalles}>
            {propuesta.tarjeta.detalles.map((d, i) => (
              <div key={`${d.etiqueta}-${i}`} className={styles.fila}>
                <dt>{d.etiqueta}</dt>
                <dd>
                  {d.antes && (
                    <>
                      <s className={styles.antes}>{d.antes}</s>
                      <ArrowRight size={11} aria-label="cambia a" className={styles.flecha} />
                    </>
                  )}
                  <span className={styles.valor}>{d.valor}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        {pendiente && propuesta.tarjeta.avisos.length > 0 && (
          <ul className={styles.avisos}>
            {propuesta.tarjeta.avisos.map((a, i) => (
              <li key={i}>
                <AlertTriangle size={13} aria-hidden />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        )}

        {pendiente && irreversible && (
          <div className={styles.irreversible} role="note">
            <ShieldAlert size={15} aria-hidden />
            <div>
              <strong>No se puede deshacer.</strong>{" "}
              {/* Sin strictNullChecks TS no estrecha por `reversible` (booleano). */}
              {(propuesta.deshacer as { aviso?: string }).aviso}
            </div>
          </div>
        )}
        {pendiente && propuesta.deshacer.reversible && (
          <p className={styles.deshacer}>Se puede deshacer: {(propuesta.deshacer as { como?: string }).como}</p>
        )}

        <div aria-live="polite">
          {propuesta.resultado && !dudoso && (
            <p className={styles.resultado} data-ok={propuesta.resultado.ok || undefined}>
              {propuesta.resultado.frase}
            </p>
          )}
          {dudoso && (
            <p className={styles.resultado}>
              No llegó la respuesta del servidor, así que no sé si se hizo. «Consultar» no hace nada: solo te dice en qué quedó.
            </p>
          )}
          {notaEstado && <p className={styles.nota}>{notaEstado}</p>}
        </div>
      </div>

      {dudoso && (
        <div className={styles.acciones}>
          <button
            type="button"
            className={styles.confirmar}
            onClick={pulsar(onConsultar)}
            disabled={!!trabajando || ocupado}
          >
            {trabajando === "consultar" ? <Loader2 size={14} aria-hidden className={styles.spin} /> : <HelpCircle size={14} aria-hidden />}
            {trabajando === "consultar" ? "Consultando…" : "Consultar qué pasó"}
          </button>
        </div>
      )}

      {pendiente && (
        <>
          {pideCasilla(propuesta) && (
            <label className={styles.casilla}>
              <input
                type="checkbox"
                checked={casilla}
                onChange={(e) => setCasilla(e.target.checked)}
                disabled={!!trabajando}
              />
              <span>Entiendo que no se puede deshacer</span>
            </label>
          )}
          <div className={styles.acciones}>
            <button
              type="button"
              className={styles.descartar}
              onClick={pulsar(onDescartar)}
              disabled={!!trabajando || ocupado}
            >
              {trabajando === "descartar" && <Loader2 size={14} aria-hidden className={styles.spin} />}
              Descartar
            </button>
            <button
              type="button"
              className={styles.confirmar}
              data-peligro={irreversible || undefined}
              onClick={pulsar(onConfirmar)}
              disabled={!habilitado}
            >
              {trabajando === "confirmar" ? (
                <>
                  <Loader2 size={14} aria-hidden className={styles.spin} /> Haciéndolo…
                </>
              ) : (
                propuesta.boton
              )}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
