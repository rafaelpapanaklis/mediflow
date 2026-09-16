"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  FileText,
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
import piel from "@/components/dashboard/sabina-rx-ia-rediseno/rediseno.module.css";

/**
 * REDISEÑO (interruptor `menu-dos-niveles`): la tarjeta conserva su JSX y
 * elige el juego de clases con `rediseno`, igual que `sabina-client.tsx`.
 * Apagado, `propuesta.module.css` tal cual; encendido, las piezas de
 * `sabina-rx-ia-rediseno/rediseno.module.css`.
 */
const CLASES_REDISENO: Record<string, string> = {
  card: piel.propuesta,
  head: piel.propuestaCabeza,
  badge: piel.propuestaInsignia,
  timer: piel.propuestaReloj,
  body: piel.propuestaCuerpo,
  title: piel.propuestaTitulo,
  frase: piel.propuestaFrase,
  detalles: piel.propuestaDetalles,
  fila: piel.propuestaFila,
  antes: piel.propuestaAntes,
  flecha: piel.propuestaFlecha,
  valor: piel.propuestaValor,
  tablaCaja: piel.propuestaTablaCaja,
  tabla: piel.propuestaTabla,
  pie: piel.propuestaPie,
  avisos: piel.propuestaAvisos,
  irreversible: piel.propuestaIrreversible,
  deshacer: piel.propuestaDeshacer,
  resultado: piel.propuestaResultado,
  enlace: piel.propuestaEnlace,
  nota: piel.propuestaNota,
  acciones: piel.propuestaAcciones,
  confirmar: piel.propuestaConfirmar,
  descartar: piel.propuestaDescartar,
  casilla: piel.propuestaCasilla,
  spin: piel.girar,
};

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
  rediseno = false,
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
  /** Interruptor `menu-dos-niveles` de la clínica: viste la tarjeta con el rediseño. */
  rediseno?: boolean;
}) {
  const c: Record<string, string> = rediseno ? CLASES_REDISENO : styles;
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
      className={c.card}
      data-estado={dudoso ? "dudoso" : estado}
      data-irreversible={irreversible || undefined}
      aria-label={`Propuesta de Sabina: ${propuesta.titulo}`}
    >
      <header className={c.head}>
        <span className={c.badge} data-tono={etiqueta.tono}>
          <Icono size={12} aria-hidden />
          {etiqueta.texto}
        </span>
        {pendiente && (
          <span className={c.timer}>
            <Clock size={11} aria-hidden />
            {textoCaducidad(propuesta, ahora, desfase)}
          </span>
        )}
      </header>

      <div className={c.body}>
        <h3 className={c.title}>{propuesta.titulo}</h3>
        <p className={c.frase}>{propuesta.tarjeta.frase}</p>

        {propuesta.tarjeta.detalles.length > 0 && (
          <dl className={c.detalles}>
            {propuesta.tarjeta.detalles.map((d, i) => (
              <div key={`${d.etiqueta}-${i}`} className={c.fila}>
                <dt>{d.etiqueta}</dt>
                <dd>
                  {d.antes && (
                    <>
                      <s className={c.antes}>{d.antes}</s>
                      <ArrowRight size={11} aria-label="cambia a" className={c.flecha} />
                    </>
                  )}
                  <span className={c.valor}>{d.valor}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}

        {propuesta.tarjeta.tabla && (
          // Con scroll propio: en 390 px una tabla de cuatro columnas no cabe y
          // lo que no se puede es partir un importe en dos renglones.
          <div className={c.tablaCaja}>
            <table className={c.tabla}>
              <thead>
                <tr>
                  {propuesta.tarjeta.tabla.columnas.map((c, i) => (
                    <th key={i} scope="col" data-numerica={c.numerica || undefined}>
                      {c.titulo}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {propuesta.tarjeta.tabla.filas.map((fila, i) => (
                  <tr key={i}>
                    {fila.map((celda, j) => (
                      <td key={j} data-numerica={propuesta.tarjeta.tabla!.columnas[j]?.numerica || undefined}>
                        {celda}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {propuesta.tarjeta.tabla.pie && (
              <dl className={c.pie}>
                {propuesta.tarjeta.tabla.pie.map((p, i) => (
                  <div key={`${p.etiqueta}-${i}`} data-fuerte={p.fuerte || undefined}>
                    <dt>{p.etiqueta}</dt>
                    <dd>{p.valor}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        {pendiente && propuesta.tarjeta.avisos.length > 0 && (
          <ul className={c.avisos}>
            {propuesta.tarjeta.avisos.map((a, i) => (
              <li key={i}>
                <AlertTriangle size={13} aria-hidden />
                <span>{a}</span>
              </li>
            ))}
          </ul>
        )}

        {pendiente && irreversible && (
          <div className={c.irreversible} role="note">
            <ShieldAlert size={15} aria-hidden />
            <div>
              <strong>No se puede deshacer.</strong>{" "}
              {/* Sin strictNullChecks TS no estrecha por `reversible` (booleano). */}
              {(propuesta.deshacer as { aviso?: string }).aviso}
            </div>
          </div>
        )}
        {pendiente && propuesta.deshacer.reversible && (
          <p className={c.deshacer}>Se puede deshacer: {(propuesta.deshacer as { como?: string }).como}</p>
        )}

        <div aria-live="polite">
          {propuesta.resultado && !dudoso && (
            <p className={c.resultado} data-ok={propuesta.resultado.ok || undefined}>
              {propuesta.resultado.frase}
              {propuesta.resultado.enlace && (
                <a
                  className={c.enlace}
                  href={propuesta.resultado.enlace.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <FileText size={13} aria-hidden />
                  {propuesta.resultado.enlace.texto}
                </a>
              )}
            </p>
          )}
          {dudoso && (
            <p className={c.resultado}>
              No llegó la respuesta del servidor, así que no sé si se hizo. «Consultar» no hace nada: solo te dice en qué quedó.
            </p>
          )}
          {notaEstado && <p className={c.nota}>{notaEstado}</p>}
        </div>
      </div>

      {dudoso && (
        <div className={c.acciones}>
          <button
            type="button"
            className={c.confirmar}
            onClick={pulsar(onConsultar)}
            disabled={!!trabajando || ocupado}
          >
            {trabajando === "consultar" ? <Loader2 size={14} aria-hidden className={c.spin} /> : <HelpCircle size={14} aria-hidden />}
            {trabajando === "consultar" ? "Consultando…" : "Consultar qué pasó"}
          </button>
        </div>
      )}

      {pendiente && (
        <>
          {pideCasilla(propuesta) && (
            <label className={c.casilla}>
              <input
                type="checkbox"
                checked={casilla}
                onChange={(e) => setCasilla(e.target.checked)}
                disabled={!!trabajando}
              />
              <span>Entiendo que no se puede deshacer</span>
            </label>
          )}
          <div className={c.acciones}>
            <button
              type="button"
              className={c.descartar}
              onClick={pulsar(onDescartar)}
              disabled={!!trabajando || ocupado}
            >
              {trabajando === "descartar" && <Loader2 size={14} aria-hidden className={c.spin} />}
              Descartar
            </button>
            <button
              type="button"
              className={c.confirmar}
              data-peligro={irreversible || undefined}
              onClick={pulsar(onConfirmar)}
              disabled={!habilitado}
            >
              {trabajando === "confirmar" ? (
                <>
                  <Loader2 size={14} aria-hidden className={c.spin} /> Haciéndolo…
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
