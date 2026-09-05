"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";
import { EDU_CAMPUS_ALL } from "@/lib/edu/campus-core";
import {
  EDU_VIVA_PROXIMA_MIN,
  EDU_VIVA_REFRESCO_MS,
  EDU_VIVA_STATE_DETAILS,
  EDU_VIVA_STATE_LABELS,
  EDU_VIVA_TIC_MS,
  type EduVivaBoard,
  type EduVivaCard,
  type EduVivaState,
} from "@/lib/edu/clinica-viva-core";

/**
 * /instituto/clinica — LA CLÍNICA EN VIVO.
 *
 * Una tarjeta por sillón, con el número que está PINTADO EN LA PARED en
 * grande, y color por estado: libre / próxima / ocupada. Está pensada para
 * dos sitios a la vez y las dos son de verdad:
 *
 *   · un monitor colgado en el piso clínico, mirado desde cuatro metros —
 *     por eso el número es enorme, el color hace el 90 % del trabajo y no
 *     hay nada que haya que leer para saber si queda un sillón;
 *   · el teléfono de un docente de pie, con guantes — por eso la rejilla
 *     arranca en una columna y el filtro de sede es un <select> nativo y no
 *     una fila de píldoras que se sale de la pantalla.
 *
 * ── SE REFRESCA SOLA, SIN INFRAESTRUCTURA NUEVA ────────────────────────
 * Dos relojes, y hacen cosas distintas a propósito:
 *
 *   1. el LATIDO (cada 20 s) vuelve a pedir /api/instituto/clinica. Es lo
 *      que entera al tablero de que alguien se sentó.
 *   2. el TIC (cada 30 s) NO pide nada: solo recalcula "lleva 42 min" con
 *      el reloj del navegador. El minutero de una cita en curso avanza
 *      solo, y consultar al servidor para eso sería tráfico por nada.
 *
 * 🔴 LOS DOS SE PARAN CON LA PESTAÑA OCULTA. No es solo cortesía de red: el
 * navegador FRENA los temporizadores en segundo plano, así que un intervalo
 * que sigue corriendo ahí deja de ser el que dice su nombre y, al volver,
 * dispara una ráfaga de consultas atrasadas. Al hacerse visible se pide UNA
 * vez, inmediatamente, que es lo que hace falta.
 *
 * 🔴 Y SI EL LATIDO FALLA, SE DICE. Un tablero pegado que parece vivo es
 * peor que uno que avisa: se apaga el punto verde y se deja a la vista la
 * hora del último corte.
 */
export interface EduVivaScreenProps {
  board: EduVivaBoard;
  /** Las sedes que esta persona puede elegir (ya recortadas por su acceso). */
  campuses: { id: string; name: string }[];
  /** La sede elegida; null = consolidado. */
  campusActiveId: string | null;
  campusAllLabel: string;
  /**
   * "all" (dirección) o "supervised" (docente). Solo se usa para explicar
   * por qué hay tarjetas calladas: la decisión la tomó el servidor.
   */
  scopeKind: "all" | "supervised";
}

const ESTADOS: EduVivaState[] = ["libre", "proximo", "ocupado"];

/** "42 min", "1 h 05". Un número de tres cifras en minutos no se lee. */
function duracion(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h} h ${m.toString().padStart(2, "0")}`;
}

function relojDe(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("es-MX", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function EduVivaScreen({
  board: boardSSR,
  campuses,
  campusActiveId,
  campusAllLabel,
  scopeKind,
}: EduVivaScreenProps) {
  const router = useRouter();
  const [board, setBoard] = useState<EduVivaBoard>(boardSSR);
  const [latiendo, setLatiendo] = useState(true);
  const [, startNav] = useTransition();

  /**
   * El reloj local. Arranca en `null` A PROPÓSITO: en el primer render
   * —servidor y cliente— se pinta el minutero que calculó el servidor, así
   * que los dos HTML coinciden y no hay desajuste de hidratación. El efecto
   * lo enciende después y a partir de ahí manda el reloj del navegador.
   */
  const [ahora, setAhora] = useState<number | null>(null);

  // Cuando el servidor vuelve a pintar (cambió la sede), lo suyo manda
  // sobre lo que trajo el último latido.
  useEffect(() => {
    setBoard(boardSSR);
    setLatiendo(true);
  }, [boardSSR]);

  const qs = useMemo(
    () => (campusActiveId ? `?sede=${encodeURIComponent(campusActiveId)}` : ""),
    [campusActiveId],
  );

  // ── 1 · El latido ───────────────────────────────────────────────────
  useEffect(() => {
    let vivo = true;

    async function latir() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const data = await eduRequest<EduVivaBoard>(`/api/instituto/clinica${qs}`);
        if (!vivo) return;
        setBoard(data);
        setLatiendo(true);
      } catch {
        if (vivo) setLatiendo(false);
      }
    }

    const id = window.setInterval(latir, EDU_VIVA_REFRESCO_MS);
    const alVolver = () => {
      if (!document.hidden) void latir();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      vivo = false;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [qs]);

  // ── 2 · El tic del minutero (sin red) ───────────────────────────────
  useEffect(() => {
    const tic = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      setAhora(Date.now());
    };
    tic();
    const id = window.setInterval(tic, EDU_VIVA_TIC_MS);
    document.addEventListener("visibilitychange", tic);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tic);
    };
  }, []);

  const cambiarSede = useCallback(
    (valor: string) => {
      const destino =
        valor === EDU_CAMPUS_ALL
          ? "/instituto/clinica"
          : `/instituto/clinica?sede=${encodeURIComponent(valor)}`;
      startNav(() => router.replace(destino, { scroll: false }));
    },
    [router],
  );

  // El nombre de la sede solo se pinta cuando hay más de una EN LA REJILLA:
  // con una sola, repetirlo en cada tarjeta es ruido (misma regla que la
  // agenda desde la Ola 11).
  const variasSedes = useMemo(
    () => new Set(board.cards.map((c) => c.campusId)).size > 1,
    [board.cards],
  );

  const vacio = board.cards.length === 0;

  return (
    <div className="edu-viva">
      {/* ── Barra: sede, conteos y pulso ───────────────────────────── */}
      <div className="edu-viva__bar">
        {campuses.length > 1 && (
          <label className="edu-viva__sede">
            <span className="edu-viva__sedelabel">Sede</span>
            <select
              className="edu-input edu-input--sm"
              value={campusActiveId ?? EDU_CAMPUS_ALL}
              onChange={(e) => cambiarSede(e.target.value)}
            >
              {/* Un <select> y no una fila de píldoras: las sedes no tienen
                  techo bajo (el producto admite 40) y una fila que se sale
                  de la pantalla en un teléfono no es un filtro. */}
              <option value={EDU_CAMPUS_ALL}>{campusAllLabel}</option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="edu-viva__counts" role="status" aria-live="polite">
          {ESTADOS.map((s) => (
            <span
              key={s}
              className={`edu-viva__count edu-viva__count--${s}`}
              title={EDU_VIVA_STATE_DETAILS[s]}
            >
              <b>{board.counts[s]}</b> {EDU_VIVA_STATE_LABELS[s].toLowerCase()}
            </span>
          ))}
          <span className="edu-viva__count edu-viva__count--total">
            <b>{board.counts.total}</b> {board.counts.total === 1 ? "sillón" : "sillones"}
          </span>
        </div>

        <p className={`edu-viva__pulso${latiendo ? "" : " edu-viva__pulso--roto"}`}>
          <span className="edu-viva__punto" aria-hidden="true" />
          {latiendo
            ? `En vivo · ${relojDe(board.generatedAt)}`
            : `Sin conexión · último corte ${relojDe(board.generatedAt)}`}
        </p>
      </div>

      {/* Un DOCENTE ve el piso entero y el detalle solo de sus estudiantes
          vigentes. Se DICE, en vez de dejar tarjetas mudas que se leen como
          un fallo de carga. */}
      {scopeKind === "supervised" && board.cards.some((c) => c.masked) && (
        <p className="edu-viva__nota">
          Los sillones marcados <strong>fuera de tu supervisión</strong> son de estudiantes que
          hoy no supervisas: se ve que están ocupados —para eso es el tablero— y no de quién.
        </p>
      )}

      {board.truncated && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">Hay más citas de las que caben en un tablero</p>
            <p className="edu-banner__detail">
              Se están mirando las primeras de la jornada. El estado de cada sillón sigue
              siendo el correcto para las que sí entraron; si esto sale a diario, avísalo.
            </p>
          </div>
        </div>
      )}

      {vacio ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí todavía no hay sillones que pintar</p>
          <p className="edu-empty__detail">
            {campusActiveId
              ? "Esta sede no tiene ninguna unidad dental activa. Se dan de alta en Sillones, y las que están dadas de baja no se pintan: un sillón fuera de servicio en verde es una invitación a sentar ahí a alguien."
              : "El instituto todavía no tiene ninguna unidad dental activa. Se dan de alta en Sillones."}
          </p>
        </div>
      ) : (
        <div className="edu-viva__grid">
          {board.cards.map((c) => (
            <Tarjeta key={c.chairId} card={c} ahora={ahora} variasSedes={variasSedes} />
          ))}
        </div>
      )}

      {/* La leyenda va al FINAL y no arriba: quien mira la pared de lejos no
          la lee, y quien la necesita es quien abre la pantalla por primera
          vez y baja a buscarla. */}
      <ul className="edu-viva__leyenda">
        {ESTADOS.map((s) => (
          <li key={s}>
            <span className={`edu-viva__bolita edu-viva__bolita--${s}`} aria-hidden="true" />
            <b>{EDU_VIVA_STATE_LABELS[s]}</b> — {EDU_VIVA_STATE_DETAILS[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tarjeta({
  card,
  ahora,
  variasSedes,
}: {
  card: EduVivaCard;
  ahora: number | null;
  variasSedes: boolean;
}) {
  // El minutero: el del navegador si ya arrancó, si no el que calculó el
  // servidor. Los dos dan lo mismo en el primer render — ver la nota de
  // `ahora` arriba.
  const lleva =
    card.startISO && ahora !== null && card.state === "ocupado"
      ? Math.max(0, Math.floor((ahora - Date.parse(card.startISO)) / 60_000))
      : card.elapsedMin;

  const faltan =
    card.startISO && ahora !== null && card.state === "proximo"
      ? Math.max(0, Math.ceil((Date.parse(card.startISO) - ahora) / 60_000))
      : card.startsInMin;

  return (
    <article className={`edu-viva__card edu-viva__card--${card.state}`}>
      <header className="edu-viva__cardhead">
        <span className="edu-viva__num" aria-label={`Sillón ${card.number}`}>
          {card.number}
        </span>
        <span className={`edu-viva__estado edu-viva__estado--${card.state}`}>
          {EDU_VIVA_STATE_LABELS[card.state]}
        </span>
      </header>

      <p className="edu-viva__sillon">
        {card.chairName}
        {variasSedes && <span className="edu-viva__campus"> · {card.campusName}</span>}
      </p>

      {card.state === "ocupado" && (
        <div className="edu-viva__body">
          {card.masked ? (
            <>
              <p className="edu-viva__paciente edu-viva__paciente--mudo">{card.patient}</p>
              <p className="edu-viva__meta">Fuera de tu supervisión</p>
            </>
          ) : (
            <>
              <p className="edu-viva__paciente">
                <EduPersonaLink kind="paciente" id={card.patientId}>
                  {card.patient}
                </EduPersonaLink>
              </p>
              {card.patientFolio && <p className="edu-viva__folio">{card.patientFolio}</p>}
              <p className="edu-viva__meta">
                <EduPersonaLink kind="estudiante" id={card.studentId}>
                  {card.student}
                </EduPersonaLink>
                {card.studentMatricula ? ` · ${card.studentMatricula}` : ""}
              </p>
              {card.specialty && <p className="edu-viva__esp">{card.specialty}</p>}
            </>
          )}
          <p className="edu-viva__reloj">
            Desde {card.startLabel}
            {lleva !== null ? ` · lleva ${duracion(lleva)}` : ""}
          </p>
          {card.progress !== null && (
            <div
              className="edu-viva__barra"
              role="progressbar"
              aria-valuenow={Math.round(card.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Avance de la sesión"
            >
              <span style={{ width: `${Math.round(card.progress * 100)}%` }} />
            </div>
          )}
        </div>
      )}

      {card.state === "proximo" && (
        <div className="edu-viva__body">
          <p className="edu-viva__reloj edu-viva__reloj--fuerte">
            {card.startLabel}
            {faltan !== null ? ` · en ${duracion(faltan)}` : ""}
          </p>
          {card.masked ? (
            <>
              <p className="edu-viva__paciente edu-viva__paciente--mudo">{card.patient}</p>
              <p className="edu-viva__meta">Fuera de tu supervisión</p>
            </>
          ) : (
            <>
              <p className="edu-viva__paciente">
                <EduPersonaLink kind="paciente" id={card.patientId}>
                  {card.patient}
                </EduPersonaLink>
              </p>
              <p className="edu-viva__meta">
                <EduPersonaLink kind="estudiante" id={card.studentId}>
                  {card.student}
                </EduPersonaLink>
                {card.studentMatricula ? ` · ${card.studentMatricula}` : ""}
              </p>
              {card.specialty && <p className="edu-viva__esp">{card.specialty}</p>}
            </>
          )}
        </div>
      )}

      {card.state === "libre" && (
        <div className="edu-viva__body">
          {/* Un sillón libre NO enseña quién va a llegar en cuatro horas: la
              hora es lo útil ("libre hasta las 14:30") y el nombre no lo
              es. Lo decide el módulo puro, aquí solo se pinta. */}
          <p className="edu-viva__reloj">
            {card.nextLabel
              ? `Siguiente ${card.nextLabel}`
              : `Sin nada en las próximas ${EDU_VIVA_PROXIMA_MIN} min`}
          </p>
        </div>
      )}
    </article>
  );
}
