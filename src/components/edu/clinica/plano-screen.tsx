"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Maximize2, MapPinned, Pencil } from "lucide-react";
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
// ── La capa visual COMPARTIDA (src/components/floor-plan) ──────────────
// La misma que usa "Mi Clínica Visual" del dental. Aquí no vive ni un
// color ni una caja: solo QUÉ se pinta y con qué palabras — que son las de
// una escuela ("Estudiante", "Sede") y por eso viajan como props.
import {
  FloorBar,
  FloorBarSpacer,
  FloorChairCard,
  FloorChairEmpty,
  FloorChairGrid,
  FloorChairNumber,
  FloorCounters,
  FloorLegend,
  FloorNote,
  FloorPopCard,
  FloorPopData,
  FloorPopLabel,
  FloorPopList,
  FloorPopName,
  FloorPopClock,
  FloorPulse,
  FloorSlot,
  FloorSlotList,
  FloorWorldBox,
  type FloorCountItem,
  type FloorLegendItem,
} from "@/components/floor-plan/floor-chrome";

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
 * ── LA CÁSCARA TAMPOCO ES DE AQUÍ ──────────────────────────────────────
 * 🔴 Los contadores, el pulso, la ficha que se abre, la rejilla del
 * horario y la leyenda salen de src/components/floor-plan/, que es de los
 * DOS productos. Cuando esta ola las escribió aquí, el dental tenía su
 * propia versión de casi todas; el día que alguien pidiera "que el estado
 * también se lea escrito" habría que hacerlo dos veces. Ahora se hace una.
 *
 * ⚠️ Lo que NO se comparte es el vocabulario. Esa capa no sabe qué es un
 * estudiante ni una sede: cada texto entra por prop, escrito aquí en el
 * castellano del vertical, y en el dental con su `t()` de es/en.
 *
 * ── LO QUE SE MONTA Y LO QUE NO ────────────────────────────────────────
 * El mundo es de OTRO producto y se importa entero (ver plano-mundo.tsx).
 * De este lado viven las tres cosas que son del instituto: QUÉ dice la
 * tarjeta que se abre (folio, caso, especialidad, estudiante, docente y el
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

  const conteos = useMemo<FloorCountItem[]>(
    () =>
      ESTADOS.map((s) => ({
        key: s,
        tone: s,
        count: board.counts[s],
        label: EDU_VIVA_STATE_LABELS[s].toLowerCase(),
        detail: EDU_VIVA_STATE_DETAILS[s],
      })),
    [board.counts],
  );

  const leyenda = useMemo<FloorLegendItem[]>(
    () =>
      ESTADOS.map((s) => ({
        key: s,
        tone: s,
        label: EDU_VIVA_STATE_LABELS[s],
        detail: EDU_VIVA_STATE_DETAILS[s],
      })),
    [],
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
      <FloorBar>
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

        <FloorCounters items={conteos} ariaLabel="Sillones por estado" />

        <FloorPulse
          live={latiendo}
          text={
            latiendo
              ? `En vivo · ${relojDe(board.generatedAt)}`
              : `Sin conexión · último corte ${relojDe(board.generatedAt)}`
          }
        />

        <FloorBarSpacer />

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
      </FloorBar>

      {/* ── Avisos que solo se pueden dar aquí ────────────────────────── */}
      {campusActiveId === null && campuses.length > 1 && (
        <FloorNote>
          Un plano es de <strong>una sede</strong>: se está pintando el de{" "}
          <strong>{campus.name}</strong>. Elige otra arriba para ver la suya.
        </FloorNote>
      )}

      {layout.auto && !sinSillones && (
        <FloorNote>
          Este plano es <strong>automático</strong>: los {chairs.length}{" "}
          {chairs.length === 1 ? "sillón" : "sillones"} de {campus.name} puestos en rejilla, para
          que la pantalla sirva desde hoy.{" "}
          {puedeEditar ? "Acomódalo como es el piso de verdad con «Acomodar el plano»." : null}
        </FloorNote>
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
        <FloorNote tone="ocupado">
          Los sillones <strong>fuera de tu supervisión</strong> se pintan ocupados —para eso es
          el piso— y no dicen de quién.
        </FloorNote>
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
        <FloorWorldBox>
          <EduPlanoMundo
            key={campus.id}
            campus={campus}
            elements={layout.elements}
            metadata={layout.metadata}
            chairs={chairs3D}
            endpoint={endpoint}
            onEstado={recibirEstado}
            onPick={abrirSillon}
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
        </FloorWorldBox>
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

      <FloorLegend
        items={leyenda}
        help={
          <>
            El piso se ve <strong>desde arriba</strong> y entero: arrastra para girarlo y usa la
            rueda para acercarte. Clic en el paciente o en el estudiante de un sillón para abrir
            su ficha.
          </>
        }
      />
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
 *
 * La CAJA es la compartida (`FloorPopCard`); lo de dentro —matrícula,
 * caso, especialidad, docente— es del instituto y de nadie más.
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
    <FloorPopCard
      variant="floating"
      tone={estado}
      title={card?.chairName ?? pick.name}
      stateLabel={EDU_VIVA_STATE_LABELS[estado]}
      onClose={onCerrar}
      closeLabel="Cerrar"
      ariaLabel={`Sillón ${pick.name}`}
      // Debajo de la fila de botones del HUD del visor (pantalla completa),
      // que vive en esta misma esquina y mide ~44 px.
      style={{ top: 58, right: 14 }}
    >
      {ocupado && card?.masked && (
        <>
          <FloorPopName muted>{card.patient}</FloorPopName>
          <FloorPopData>
            Fuera de tu supervisión. El sillón está ocupado —eso no es secreto— y de quién, sí.
          </FloorPopData>
        </>
      )}

      {ocupado && card && !card.masked && (
        <>
          {foco === "estudiante" ? (
            <>
              <FloorPopLabel>Estudiante</FloorPopLabel>
              <FloorPopName>{card.student}</FloorPopName>
              {card.studentMatricula && (
                <FloorPopData>Matrícula {card.studentMatricula}</FloorPopData>
              )}
              <FloorPopData>
                Atendiendo a <strong>{card.patient}</strong>
                {card.patientFolio ? ` · ${card.patientFolio}` : ""}
              </FloorPopData>
            </>
          ) : (
            <>
              <FloorPopLabel>Paciente</FloorPopLabel>
              <FloorPopName>{card.patient}</FloorPopName>
              {card.patientFolio && <FloorPopData>Folio {card.patientFolio}</FloorPopData>}
              {card.caseLabel && <FloorPopData label="Caso">{card.caseLabel}</FloorPopData>}
              {card.specialty && (
                <FloorPopData label="Especialidad">{card.specialty}</FloorPopData>
              )}
              <FloorPopData label="Estudiante">
                {card.student}
                {card.studentMatricula ? ` · ${card.studentMatricula}` : ""}
              </FloorPopData>
            </>
          )}

          <FloorPopData label="Docente">
            {card.supervisor ?? "sin docente asignado"}
          </FloorPopData>
          <FloorPopClock>
            Desde {card.startLabel}
            {lleva !== null ? ` · lleva ${duracion(lleva)}` : ""}
          </FloorPopClock>

          {card.patientId ? (
            <Link
              className="edu-btn edu-btn--primary edu-btn--sm edu-plano__tcta"
              href={`/instituto/pacientes/${card.patientId}`}
            >
              Abrir ficha
            </Link>
          ) : null}
        </>
      )}

      {!ocupado && (
        <>
          {card?.state === "proximo" && card.startLabel ? (
            <FloorPopClock strong>
              Próxima cita a las {card.startLabel}
              {card.startsInMin !== null ? ` · en ${duracion(card.startsInMin)}` : ""}
            </FloorPopClock>
          ) : (
            <FloorPopClock>
              {card?.nextLabel
                ? `Libre. Siguiente a las ${card.nextLabel}`
                : `Libre. Sin nada en las próximas ${EDU_VIVA_PROXIMA_MIN} min`}
            </FloorPopClock>
          )}

          {siguientes.length > 0 && (
            <FloorPopList>
              {siguientes.slice(0, 4).map((s) => (
                <li key={s.id}>
                  <b>{s.startLabel}</b> {s.patient ?? "—"}
                  {s.specialty ? ` · ${s.specialty}` : ""}
                </li>
              ))}
            </FloorPopList>
          )}

          {/* La pregunta que hace quien mira un sillón libre es "¿puedo
              sentar aquí a alguien?", y la respuesta vive en la agenda de
              ESE sillón. No se agenda desde aquí —esto es un tablero, no un
              formulario— pero el salto es de un clic y llega filtrado. */}
          <Link
            className="edu-btn edu-btn--ghost edu-btn--sm edu-plano__tcta"
            href={`/instituto/agenda?sillon=${encodeURIComponent(pick.resourceId)}`}
          >
            Ver este sillón en la agenda
          </Link>
        </>
      )}
    </FloorPopCard>
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

      <FloorChairGrid>
        {chairs.map((c) => {
          const lista = porSillon.get(c.id) ?? [];
          const estado = tarjetas.get(c.id)?.state ?? "libre";
          return (
            <FloorChairCard
              key={c.id}
              name={c.name}
              prefix={<FloorChairNumber>{c.number}</FloorChairNumber>}
              stateLabel={EDU_VIVA_STATE_LABELS[estado]}
              tone={estado}
              onOpen={() => onVerSillon(c.id, c.name)}
              openTitle={`Ver ${c.name} en el plano`}
            >
              {lista.length === 0 ? (
                <FloorChairEmpty>Sin nada más hoy</FloorChairEmpty>
              ) : (
                <FloorSlotList>
                  {lista.map((s) => (
                    <FloorSlot
                      key={s.id}
                      start={s.startLabel}
                      end={s.endLabel}
                      active={s.enCurso}
                      primary={s.patient ?? "—"}
                      secondary={
                        s.masked ? "Fuera de tu supervisión" : (s.student ?? undefined)
                      }
                      tag={EDU_APPOINTMENT_STATUS_LABELS[s.status]}
                    />
                  ))}
                </FloorSlotList>
              )}
            </FloorChairCard>
          );
        })}
      </FloorChairGrid>
    </section>
  );
}
