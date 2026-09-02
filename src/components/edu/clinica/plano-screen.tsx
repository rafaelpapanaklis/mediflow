"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Maximize2, MapPinned, Pencil, X } from "lucide-react";
import { eduRequest } from "@/components/edu/edu-http";
import { EDU_CAMPUS_ALL } from "@/lib/edu/campus-core";
import {
  EDU_VIVA_PROXIMA_MIN,
  EDU_VIVA_REFRESCO_MS,
  EDU_VIVA_STATE_DETAILS,
  EDU_VIVA_STATE_LABELS,
  EDU_VIVA_TIC_MS,
  type EduVivaBoard,
  type EduVivaCard,
  type EduVivaSlot,
  type EduVivaState,
} from "@/lib/edu/clinica-viva-core";
import { EDU_APPOINTMENT_STATUS_LABELS } from "@/lib/edu/types";
import type { EduPlanoLayout, EduPlanoRevision } from "@/lib/edu/plano-core";
import type { Clinic3DPick } from "@/components/clinic-3d/Clinic3DClient";
import { EduPlanoMundo } from "@/components/edu/clinica/plano-mundo";
import { EduVivaScreen } from "@/components/edu/clinica/viva-screen";

/**
 * /instituto/clinica — EL PLANO DE LA CLÍNICA, EN VIVO.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LA PANTALLA ES EL PISO, NO UNA LISTA DE SILLONES
 *
 * Antes era una tarjeta por sillón. Una tarjeta contesta "¿cuántos quedan
 * libres?" pero no contesta la pregunta que se hace de verdad en el piso:
 * "¿DÓNDE hay uno libre?". Un plano sí — y el que se pinta es el mismo
 * mundo 3D del dental, con el estudiante y el paciente dibujados en cada
 * unidad ocupada.
 *
 * ── LO QUE SE MONTA Y LO QUE NO ────────────────────────────────────────
 * El mundo es de OTRO producto y se importa entero (ver plano-mundo.tsx).
 * De este lado viven las tres cosas que son del instituto: la TARJETA que
 * se abre al clicar (folio, caso, especialidad, estudiante, docente y el
 * botón a la ficha), el HORARIO de la sede debajo, y el RESPALDO.
 *
 * ── EL RESPALDO NO ES UN ADORNO ────────────────────────────────────────
 * 🔴 Debajo de 768 px y sin WebGL se pintan LAS TARJETAS DE SIEMPRE
 * (`EduVivaScreen`, sin tocar). Un mundo 3D en el teléfono de un docente
 * de pie con guantes no es la pantalla correcta —y en una tableta vieja de
 * la escuela ni siquiera arranca—, así que ahí manda lo que ya funcionaba.
 * Se decide en el CLIENTE (el servidor no sabe si hay WebGL) y se puede
 * cambiar a mano con un botón: quien esté en el monitor de pared decide.
 *
 * ── EL SONDEO ES UNO SOLO ──────────────────────────────────────────────
 * Con el plano montado, el latido lo lleva el VISOR (su prop `host.state`
 * apunta a /api/instituto/clinica/3d-state) y esta pantalla recibe cada
 * payload por `host.onState`. Así el plano, la tarjeta y el horario son
 * SIEMPRE la misma foto y no hay dos consultas cada veinte segundos contra
 * las mismas tablas. Con el respaldo montado late `EduVivaScreen`, que
 * tiene el suyo desde su ola. Nunca los dos a la vez.
 */

export interface EduPlanoScreenProps {
  /** El tablero del primer render (del servidor). */
  board: EduVivaBoard;
  layout: EduPlanoLayout;
  revision: EduPlanoRevision;
  campus: { id: string; name: string; code: string };
  chairs: { id: string; name: string; number: number }[];
  /** Las sedes que esta persona puede elegir. */
  campuses: { id: string; name: string }[];
  campusActiveId: string | null;
  campusAllLabel: string;
  scopeKind: "all" | "supervised";
  /** true = esta cuenta puede acomodar el plano (clinica.edit). */
  puedeEditar: boolean;
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

/**
 * ¿Este navegador sabe pintar el mundo?
 *
 * Se pregunta con un canvas de usar y tirar, que es la única respuesta
 * honesta: `navigator.gpu` o el user-agent no dicen si el driver está
 * bloqueado. Si falla, el respaldo.
 *
 * 🔴 SE PREGUNTA UNA VEZ Y SE SUELTA EL CONTEXTO, y las dos cosas costaron
 * verlo en el navegador. Un contexto WebGL no se recoge solo: el navegador
 * aguanta ~16 vivos a la vez y, pasado el tope, empieza a NEGARLOS —o a
 * matar el más viejo, que sería justo el del mundo—. Esta función corre en
 * cada `resize`, así que sin `loseContext()` y sin memoria bastaba con
 * mover la ventana unas cuantas veces (o tener el plano abierto en dos
 * pestañas) para que contestara "este navegador no puede" en un navegador
 * que sí podía. Pasó de verdad, con el plano abierto en tres pestañas.
 */
let webglCache: boolean | null = null;
function hayWebGL(): boolean {
  if (webglCache !== null) return webglCache;
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl2") ??
      canvas.getContext("webgl")) as WebGLRenderingContext | null;
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    webglCache = !!gl;
  } catch {
    webglCache = false;
  }
  return webglCache;
}

/** Debajo de esto manda el respaldo de tarjetas. */
const EDU_PLANO_ANCHO_MIN = 768;

export function EduPlanoScreen({
  board: boardSSR,
  layout,
  revision,
  campus,
  chairs,
  campuses,
  campusActiveId,
  campusAllLabel,
  scopeKind,
  puedeEditar,
}: EduPlanoScreenProps) {
  const [board, setBoard] = useState<EduVivaBoard>(boardSSR);
  const [latiendo, setLatiendo] = useState(true);
  const [ahora, setAhora] = useState<number | null>(null);
  const [pick, setPick] = useState<Clinic3DPick | null>(null);

  /**
   * `null` = todavía no se ha medido nada (primer render, servidor
   * incluido). Se resuelve en el efecto de abajo, en el cliente, donde sí
   * se puede preguntar por WebGL y por el ancho de la ventana.
   */
  const [puedeMundo, setPuedeMundo] = useState<boolean | null>(null);
  /** Lo que eligió la persona a mano; manda sobre la medición. */
  const [modoManual, setModoManual] = useState<"mundo" | "tarjetas" | null>(null);

  useEffect(() => {
    setBoard(boardSSR);
    setLatiendo(true);
  }, [boardSSR]);

  useEffect(() => {
    const medir = () => {
      setPuedeMundo(hayWebGL() && window.innerWidth >= EDU_PLANO_ANCHO_MIN);
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  const mundoMontado = modoManual ? modoManual === "mundo" : puedeMundo === true;

  // ── El tic del minutero (sin red), igual que en el tablero de tarjetas ──
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

  /**
   * Cada payload del visor. Llega ya con el tablero entero y el horario:
   * es la MISMA lectura que pintó los sillones, así que la tarjeta no
   * puede contradecir al plano.
   */
  const recibirEstado = useCallback((payload: unknown) => {
    const p = payload as { board?: EduVivaBoard } | null;
    if (p && p.board && Array.isArray(p.board.cards)) {
      setBoard(p.board);
      setLatiendo(true);
    }
  }, []);

  const abrirSillon = useCallback((elegido: Clinic3DPick) => setPick(elegido), []);

  const rotulo = useCallback((p: Clinic3DPick) => {
    if (p.part === "patient") return "Clic: ver al paciente de este sillón";
    if (p.part === "doctor") return "Clic: ver al estudiante que atiende";
    return `Clic: ver ${p.name}`;
  }, []);

  const cambiarSede = useCallback(
    (valor: string) => {
      const destino =
        valor === EDU_CAMPUS_ALL
          ? "/instituto/clinica"
          : `/instituto/clinica?sede=${encodeURIComponent(valor)}`;
      // Navegación dura y no `router.replace`: cambiar de sede cambia el
      // MUNDO entero (otro plano, otros sillones), y arrastrar el estado
      // de cliente de la sede anterior es cómo se ve un plano con los
      // sillones de la otra. Misma lección que el selector de la barra.
      window.location.href = destino;
    },
    [],
  );

  // ── El respaldo late solo (y no cuando el visor ya está latiendo) ──────
  useEffect(() => {
    if (mundoMontado) return;
    let vivo = true;
    const url = `/api/instituto/clinica/3d-state?sede=${encodeURIComponent(campus.id)}`;

    async function latir() {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const data = await eduRequest<{ board: EduVivaBoard }>(url);
        if (!vivo) return;
        if (data?.board) setBoard(data.board);
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
  }, [mundoMontado, campus.id]);

  const chairs3D = useMemo(
    () => chairs.map((c) => ({ id: c.id, name: c.name, color: null })),
    [chairs],
  );

  const tarjetaPorSillon = useMemo(() => {
    const m = new Map<string, EduVivaCard>();
    for (const c of board.cards) m.set(c.chairId, c);
    return m;
  }, [board.cards]);

  const horarioPorSillon = useMemo(() => {
    const m = new Map<string, EduVivaSlot[]>();
    for (const s of board.schedule ?? []) {
      const lista = m.get(s.chairId) ?? [];
      lista.push(s);
      m.set(s.chairId, lista);
    }
    return m;
  }, [board.schedule]);

  const endpoint = useMemo(
    () => `/api/instituto/clinica/3d-state?sede=${encodeURIComponent(campus.id)}`,
    [campus.id],
  );

  const sinSillones = chairs.length === 0;
  const sinDibujar = revision.sinDibujar.length;

  // ── El respaldo: las tarjetas de siempre, sin tocar ───────────────────
  if (!mundoMontado) {
    return (
      <div className="edu-plano">
        <ModoBarra
          mundo={false}
          puedeMundo={puedeMundo === true}
          onCambiar={setModoManual}
          campusName={campus.name}
        />
        <EduVivaScreen
          board={board}
          campuses={campuses}
          campusActiveId={campusActiveId}
          campusAllLabel={campusAllLabel}
          scopeKind={scopeKind}
        />
      </div>
    );
  }

  return (
    <div className="edu-plano">
      {/* ── La barra: sede, conteos, pulso y el botón de acomodar ─────── */}
      <div className="edu-plano__bar">
        {campuses.length > 1 && (
          <label className="edu-plano__sede">
            <span className="edu-plano__sedelabel">Sede</span>
            <select
              className="edu-input edu-input--sm"
              value={campusActiveId ?? EDU_CAMPUS_ALL}
              onChange={(e) => cambiarSede(e.target.value)}
            >
              <option value={EDU_CAMPUS_ALL}>{campusAllLabel}</option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="edu-plano__counts" role="status" aria-live="polite">
          {ESTADOS.map((s) => (
            <span
              key={s}
              className={`edu-plano__count edu-plano__count--${s}`}
              title={EDU_VIVA_STATE_DETAILS[s]}
            >
              <b>{board.counts[s]}</b> {EDU_VIVA_STATE_LABELS[s].toLowerCase()}
            </span>
          ))}
        </div>

        <p className={`edu-plano__pulso${latiendo ? "" : " edu-plano__pulso--roto"}`}>
          <span className="edu-plano__punto" aria-hidden="true" />
          {latiendo
            ? `En vivo · ${relojDe(board.generatedAt)}`
            : `Sin conexión · último corte ${relojDe(board.generatedAt)}`}
        </p>

        <div className="edu-plano__acciones">
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => setModoManual("tarjetas")}
          >
            Ver como tarjetas
          </button>
          {puedeEditar && (
            <Link
              className="edu-btn edu-btn--ghost edu-btn--sm"
              href={`/instituto/clinica/plano?sede=${encodeURIComponent(campus.id)}`}
            >
              <Pencil size={14} aria-hidden="true" /> Acomodar el plano
            </Link>
          )}
        </div>
      </div>

      {/* ── Avisos que solo se pueden dar aquí ────────────────────────── */}
      {campusActiveId === null && campuses.length > 1 && (
        <p className="edu-plano__nota">
          Un plano es de <strong>una sede</strong>: se está pintando el de{" "}
          <strong>{campus.name}</strong>. Elige otra arriba para ver la suya.
        </p>
      )}

      {layout.auto && !sinSillones && (
        <p className="edu-plano__nota">
          Este plano es <strong>automático</strong>: los {chairs.length}{" "}
          {chairs.length === 1 ? "sillón" : "sillones"} de {campus.name} puestos en rejilla, para
          que la pantalla sirva desde hoy.{" "}
          {puedeEditar ? "Acomódalo como es el piso de verdad con «Acomodar el plano»." : null}
        </p>
      )}

      {!layout.auto && sinDibujar > 0 && (
        <div className="edu-banner edu-banner--warn" role="status">
          <div>
            <p className="edu-banner__title">
              {sinDibujar === 1
                ? "Hay un sillón que no está en el plano"
                : `Hay ${sinDibujar} sillones que no están en el plano`}
            </p>
            <p className="edu-banner__detail">
              {revision.sinDibujar.map((c) => c.name).join(", ")} —{" "}
              {sinDibujar === 1 ? "está activo pero nadie lo dibujó" : "están activos pero nadie los dibujó"}
              , así que aquí no se pintan y su estado no se ve.{" "}
              {puedeEditar ? "Se añaden en «Acomodar el plano»." : "Avísale a la dirección."}
            </p>
          </div>
        </div>
      )}

      {scopeKind === "supervised" && board.cards.some((c) => c.masked) && (
        <p className="edu-plano__nota">
          Los sillones <strong>fuera de tu supervisión</strong> se pintan ocupados —para eso es
          el piso— y no dicen de quién.
        </p>
      )}

      {/* ── El mundo ───────────────────────────────────────────────────── */}
      {sinSillones ? (
        <div className="edu-empty">
          <p className="edu-empty__title">Aquí todavía no hay sillones que pintar</p>
          <p className="edu-empty__detail">
            Esta sede no tiene ninguna unidad dental activa. Se dan de alta en Sillones, y las
            que están dadas de baja no se pintan: un sillón fuera de servicio en el plano es una
            invitación a sentar ahí a alguien.
          </p>
        </div>
      ) : (
        <div className="edu-plano__mundo">
          <EduPlanoMundo
            key={campus.id}
            campus={campus}
            elements={layout.elements}
            metadata={layout.metadata}
            chairs={chairs3D}
            endpoint={endpoint}
            onEstado={recibirEstado}
            onPick={abrirSillon}
            rotulo={rotulo}
          />

          {pick && (
            <TarjetaSillon
              pick={pick}
              card={tarjetaPorSillon.get(pick.resourceId) ?? null}
              siguientes={horarioPorSillon.get(pick.resourceId) ?? []}
              ahora={ahora}
              onCerrar={() => setPick(null)}
            />
          )}
        </div>
      )}

      {/* ── El horario de hoy, debajo del plano ────────────────────────── */}
      {!sinSillones && (
        <Horario
          chairs={chairs}
          porSillon={horarioPorSillon}
          tarjetas={tarjetaPorSillon}
          campusName={campus.name}
          onVerSillon={(chairId, name) =>
            setPick({ resourceId: chairId, name, part: "chair" })
          }
        />
      )}

      <ul className="edu-plano__leyenda">
        {ESTADOS.map((s) => (
          <li key={s}>
            <span className={`edu-plano__bolita edu-plano__bolita--${s}`} aria-hidden="true" />
            <b>{EDU_VIVA_STATE_LABELS[s]}</b> — {EDU_VIVA_STATE_DETAILS[s]}
          </li>
        ))}
        <li className="edu-plano__leyenda-ayuda">
          Camina con <kbd>W A S D</kbd>, mira con el ratón y <kbd>Esc</kbd> para soltarlo. El
          botón de la esquina sube a <strong>vista aérea</strong>: desde ahí se ve el piso
          entero y se clica cualquier sillón.
        </li>
      </ul>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// La barra del respaldo
// ═══════════════════════════════════════════════════════════════════════

function ModoBarra({
  mundo,
  puedeMundo,
  onCambiar,
  campusName,
}: {
  mundo: boolean;
  puedeMundo: boolean;
  onCambiar: (m: "mundo" | "tarjetas") => void;
  campusName: string;
}) {
  return (
    <div className="edu-plano__modo">
      <span className="edu-plano__modotexto">
        <MapPinned size={14} aria-hidden="true" />
        {puedeMundo
          ? `Estás viendo las tarjetas de ${campusName}.`
          : "Esta pantalla no puede pintar el plano en 3D (pantalla pequeña o sin aceleración), así que se muestran las tarjetas."}
      </span>
      {puedeMundo && !mundo && (
        <button
          type="button"
          className="edu-btn edu-btn--ghost edu-btn--sm"
          onClick={() => onCambiar("mundo")}
        >
          <Maximize2 size={14} aria-hidden="true" /> Ver el plano
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// LA TARJETA: lo que se abre al clicar
// ═══════════════════════════════════════════════════════════════════════

/**
 * 🔴 La tarjeta NO pide nada al servidor. Sale del payload que ya está en
 * memoria —el mismo que pintó el sillón— y por eso no puede enseñar algo
 * que el plano no esté enseñando. El id del paciente viene de ahí y NO del
 * estado del mundo: en el mundo viajan colores y nombres, no ids.
 */
function TarjetaSillon({
  pick,
  card,
  siguientes,
  ahora,
  onCerrar,
}: {
  pick: Clinic3DPick;
  card: EduVivaCard | null;
  siguientes: EduVivaSlot[];
  ahora: number | null;
  onCerrar: () => void;
}) {
  const estado = card?.state ?? "libre";
  const ocupado = estado === "ocupado";

  const lleva =
    card?.startISO && ahora !== null && ocupado
      ? Math.max(0, Math.floor((ahora - Date.parse(card.startISO)) / 60_000))
      : (card?.elapsedMin ?? null);

  // El foco es lo que se tocó: la figura del estudiante enseña al
  // estudiante y la del paciente al paciente. El resto sigue ahí debajo —
  // quien clica una figura quiere saber quién es, no perder el contexto.
  const foco: "paciente" | "estudiante" | "sillon" =
    !ocupado ? "sillon" : pick.part === "doctor" ? "estudiante" : "paciente";

  return (
    <aside className={`edu-plano__tarjeta edu-plano__tarjeta--${estado}`} role="dialog" aria-label={`Sillón ${pick.name}`}>
      <header className="edu-plano__thead">
        <div>
          <p className="edu-plano__tsillon">{card?.chairName ?? pick.name}</p>
          <span className={`edu-plano__testado edu-plano__testado--${estado}`}>
            {EDU_VIVA_STATE_LABELS[estado]}
          </span>
        </div>
        <button type="button" className="edu-plano__tcerrar" onClick={onCerrar} aria-label="Cerrar">
          <X size={16} aria-hidden="true" />
        </button>
      </header>

      {ocupado && card?.masked && (
        <div className="edu-plano__tbody">
          <p className="edu-plano__tnombre edu-plano__tnombre--mudo">{card.patient}</p>
          <p className="edu-plano__tdato">
            Fuera de tu supervisión. El sillón está ocupado —eso no es secreto— y de quién, sí.
          </p>
        </div>
      )}

      {ocupado && card && !card.masked && (
        <div className="edu-plano__tbody">
          {foco === "estudiante" ? (
            <>
              <p className="edu-plano__tetiqueta">Estudiante</p>
              <p className="edu-plano__tnombre">{card.student}</p>
              {card.studentMatricula && (
                <p className="edu-plano__tdato">Matrícula {card.studentMatricula}</p>
              )}
              <p className="edu-plano__tdato">
                Atendiendo a <strong>{card.patient}</strong>
                {card.patientFolio ? ` · ${card.patientFolio}` : ""}
              </p>
            </>
          ) : (
            <>
              <p className="edu-plano__tetiqueta">Paciente</p>
              <p className="edu-plano__tnombre">{card.patient}</p>
              {card.patientFolio && <p className="edu-plano__tdato">Folio {card.patientFolio}</p>}
              {card.caseLabel && (
                <p className="edu-plano__tdato">
                  <span className="edu-plano__tclave">Caso</span> {card.caseLabel}
                </p>
              )}
              {card.specialty && (
                <p className="edu-plano__tdato">
                  <span className="edu-plano__tclave">Especialidad</span> {card.specialty}
                </p>
              )}
              <p className="edu-plano__tdato">
                <span className="edu-plano__tclave">Estudiante</span> {card.student}
                {card.studentMatricula ? ` · ${card.studentMatricula}` : ""}
              </p>
            </>
          )}

          <p className="edu-plano__tdato">
            <span className="edu-plano__tclave">Docente</span>{" "}
            {card.supervisor ?? "sin docente asignado"}
          </p>
          <p className="edu-plano__treloj">
            Desde {card.startLabel}
            {lleva !== null ? ` · lleva ${duracion(lleva)}` : ""}
          </p>

          {card.patientId ? (
            <Link className="edu-btn edu-btn--primary edu-btn--sm" href={`/instituto/pacientes/${card.patientId}`}>
              Abrir ficha
            </Link>
          ) : null}
        </div>
      )}

      {!ocupado && (
        <div className="edu-plano__tbody">
          {card?.state === "proximo" && card.startLabel ? (
            <p className="edu-plano__treloj edu-plano__treloj--fuerte">
              Próxima cita a las {card.startLabel}
              {card.startsInMin !== null ? ` · en ${duracion(card.startsInMin)}` : ""}
            </p>
          ) : (
            <p className="edu-plano__treloj">
              {card?.nextLabel
                ? `Libre. Siguiente a las ${card.nextLabel}`
                : `Libre. Sin nada en las próximas ${EDU_VIVA_PROXIMA_MIN} min`}
            </p>
          )}

          {siguientes.length > 0 && (
            <ul className="edu-plano__tlista">
              {siguientes.slice(0, 4).map((s) => (
                <li key={s.id}>
                  <b>{s.startLabel}</b> {s.patient ?? "—"}
                  {s.specialty ? ` · ${s.specialty}` : ""}
                </li>
              ))}
            </ul>
          )}

          {/* La pregunta que hace quien mira un sillón libre es "¿puedo
              sentar aquí a alguien?", y la respuesta vive en la agenda de
              ESE sillón. No se agenda desde aquí —esto es un tablero, no un
              formulario— pero el salto es de un clic y llega filtrado. */}
          <Link
            className="edu-btn edu-btn--ghost edu-btn--sm"
            href={`/instituto/agenda?sillon=${encodeURIComponent(pick.resourceId)}`}
          >
            Ver este sillón en la agenda
          </Link>
        </div>
      )}
    </aside>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// EL HORARIO DE HOY (debajo del plano)
// ═══════════════════════════════════════════════════════════════════════

/**
 * La MISMA información que la rejilla, en lista compacta: por sillón, la
 * cita en curso y las que vienen. No es una segunda agenda —no se filtra,
 * no se arrastra, no se agenda— y sale del mismo payload: reimplementar la
 * agenda aquí sería el segundo sitio donde el piso puede contradecirse.
 */
function Horario({
  chairs,
  porSillon,
  tarjetas,
  campusName,
  onVerSillon,
}: {
  chairs: { id: string; name: string; number: number }[];
  porSillon: Map<string, EduVivaSlot[]>;
  tarjetas: Map<string, EduVivaCard>;
  campusName: string;
  onVerSillon: (chairId: string, name: string) => void;
}) {
  const total = Array.from(porSillon.values()).reduce((n, l) => n + l.length, 0);

  return (
    <section className="edu-plano__horario" aria-label={`Horario de hoy en ${campusName}`}>
      <header className="edu-plano__hhead">
        <h2 className="edu-plano__htitulo">Hoy en {campusName}</h2>
        <p className="edu-plano__hlead">
          {total === 0
            ? "No queda nada por atender hoy en esta sede."
            : `${total} ${total === 1 ? "cita" : "citas"} por delante, sillón por sillón. Lo que ya terminó no se pinta.`}
        </p>
      </header>

      <div className="edu-plano__hgrid">
        {chairs.map((c) => {
          const lista = porSillon.get(c.id) ?? [];
          const card = tarjetas.get(c.id);
          return (
            <article key={c.id} className="edu-plano__hsillon">
              <header className="edu-plano__hsillonhead">
                <button
                  type="button"
                  className="edu-plano__hnombre"
                  onClick={() => onVerSillon(c.id, c.name)}
                >
                  <span className="edu-plano__hnum">{c.number}</span>
                  {c.name}
                </button>
                <span
                  className={`edu-plano__hbolita edu-plano__hbolita--${card?.state ?? "libre"}`}
                  aria-hidden="true"
                />
              </header>

              {lista.length === 0 ? (
                <p className="edu-plano__hvacio">Sin nada más hoy</p>
              ) : (
                <ol className="edu-plano__hlista">
                  {lista.map((s) => (
                    <li
                      key={s.id}
                      className={`edu-plano__hfila${s.enCurso ? " edu-plano__hfila--curso" : ""}`}
                    >
                      <span className="edu-plano__hhora">
                        {s.startLabel}
                        <span className="edu-plano__hfin">–{s.endLabel}</span>
                      </span>
                      <span className="edu-plano__hquien">
                        <span className="edu-plano__hpaciente">{s.patient ?? "—"}</span>
                        {s.student && <span className="edu-plano__hest">{s.student}</span>}
                        {s.masked && <span className="edu-plano__hest">Fuera de tu supervisión</span>}
                      </span>
                      <span className={`edu-tag edu-plano__hestado edu-plano__hestado--${s.status.toLowerCase()}`}>
                        {EDU_APPOINTMENT_STATUS_LABELS[s.status]}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
