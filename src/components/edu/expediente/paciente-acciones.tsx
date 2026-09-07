"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Banknote, CalendarPlus, FolderPlus, Printer, Upload, XCircle } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_APPOINTMENT_TYPE_LABELS,
  EDU_APPOINTMENT_TYPES,
  EDU_PAYMENT_METHODS_COBRABLES,
  EDU_PAYMENT_METHOD_LABELS,
  type EduAppointmentType,
  type EduPaymentMethod,
} from "@/lib/edu/types";
import { eduMoney, parseEduMoneyCents } from "@/lib/edu/dinero-core";
import type {
  EduChairOption,
  EduStudentOption,
  EduSupervisorOption,
} from "@/lib/edu/agenda-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * OLA 12 · LAS ACCIONES DE LA FICHA — la ficha deja de ser de solo lectura.
 *
 * Cuatro acciones, cada una detrás de SU permiso (lo resolvió el layout en
 * el servidor; aquí solo se pinta lo que llegó en true):
 *
 *   · AGENDAR CITA  → agenda.manage (caja y dirección). Modal aquí mismo:
 *     recepción agenda con el paciente en el mostrador, sin ir a la agenda.
 *   · ABRIR CASO    → casos.assign (docente y dirección). Caja NO lo ve —
 *     es la línea del contrato: caja no abre expediente clínico.
 *   · SUBIR ESTUDIO → estudios.upload. Es un enlace a la pestaña Estudios
 *     con ?subir=1: el modal de subida YA existe ahí (con su barra de
 *     progreso y su subida directa) y duplicarlo aquí sería la segunda
 *     copia que se desincroniza.
 *   · COBRAR        → caja.charge. Enlace a la caja con el paciente YA
 *     elegido (?cobrar=id): el alumno no lo ve ni de lejos — no lleva la
 *     key, y aunque la llevara, el alcance del dinero le devuelve "none".
 *
 * 🔴 Los desplegables (alumnos, sillones, docentes) SOLO llegan cuando
 * quien mira puede usarlos (canAgendar / canAbrirCaso): es la lección del
 * P1-4 — lo que viaja en el payload RSC ya se filtró en el servidor.
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface EduProgramaOption {
  id: string;
  name: string;
  isActive: boolean;
}

export interface EduPacienteAccionesProps {
  patientId: string;
  patientName: string;
  base: string;
  todayISO: string;
  canAgendar: boolean;
  canAbrirCaso: boolean;
  canSubirEstudio: boolean;
  canCobrar: boolean;
  /** Vacíos cuando quien mira no puede agendar/abrir caso (no viajan). */
  alumnos: EduStudentOption[];
  sillones: EduChairOption[];
  docentes: EduSupervisorOption[];
  programas: EduProgramaOption[];
}

export function EduPacienteAcciones(props: EduPacienteAccionesProps) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [agendar, setAgendar] = useState(false);
  const [abrirCaso, setAbrirCaso] = useState(false);
  const [cobrar, setCobrar] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  // ═══════════════════════════════════════════════════════════════════
  // IMPRIMIR EL RESUMEN (fila 45 del comparativo con el dental)
  //
  // 🔴 SE IMPRIME EL RESUMEN, NO LA PESTAÑA EN LA QUE ESTÉS. Esta barra
  // vive en el LAYOUT, así que el botón se ve en las diez pestañas: pulsar
  // «Imprimir» estando en Estudios habría sacado por la impresora la
  // galería de radiografías. Si ya estás en el Resumen, imprime; si no, te
  // lleva al Resumen con `?imprimir=1` y el efecto de abajo dispara la
  // impresión en cuanto la página está pintada.
  //
  // 🔴 Y SE LEE `window.location`, NO `useSearchParams()`. El hook obliga a
  // envolver el componente en un <Suspense> para que Next pueda
  // prerenderizar, y esta barra la monta un layout de servidor que no lo
  // tiene: el build fallaría por un parámetro que solo se usa una vez.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("imprimir") !== "1") return;
    // Se limpia la URL ANTES de imprimir: si no, quedaría `?imprimir=1` en
    // la barra y volver atrás con el navegador reimprimiría sola.
    sp.delete("imprimir");
    const qs = sp.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${qs ? `?${qs}` : ""}`,
    );
    // Un tick para que el navegador acabe de pintar lo que acaba de llegar
    // del servidor; sin él, Chrome abre el diálogo sobre media página.
    const t = window.setTimeout(() => window.print(), 150);
    return () => window.clearTimeout(t);
  }, []);

  function imprimirResumen() {
    if (typeof window === "undefined") return;
    if (window.location.pathname === props.base) window.print();
    else window.location.href = `${props.base}?imprimir=1`;
  }

  // ⚠️ ESTA BARRA YA NO SE ESCONDE NUNCA, y es un cambio consciente. Hasta
  // la Ola B devolvía `null` cuando quien miraba no podía agendar, abrir
  // caso, subir estudio ni cobrar. Ahora siempre hay al menos «Imprimir
  // resumen», que no cuelga de ningún permiso y no es un descuido: imprime
  // lo que YA está en la pantalla de quien lo pulsa —lo que su alcance y
  // sus permisos le dejaron ver— y poner una llave delante no cerraría
  // nada, porque Ctrl+P sigue existiendo.

  function hecho(mensaje: string) {
    setAgendar(false);
    setAbrirCaso(false);
    setCobrar(false);
    setFlash(mensaje);
    startNav(() => router.refresh());
  }

  return (
    <>
      {flash && (
        <div className="edu-banner edu-alert--ok" role="status">
          <div>
            <p className="edu-banner__title">{flash}</p>
          </div>
        </div>
      )}

      <div className="edu-acciones-ficha" role="group" aria-label="Acciones del paciente">
        {props.canAgendar && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setAgendar(true);
            }}
          >
            <CalendarPlus size={15} />
            Agendar cita
          </button>
        )}
        {props.canAbrirCaso && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setAbrirCaso(true);
            }}
          >
            <FolderPlus size={15} />
            Abrir caso
          </button>
        )}
        {props.canSubirEstudio && (
          <Link href={`${props.base}/estudios?subir=1`} className="edu-btn edu-btn--ghost edu-btn--sm">
            <Upload size={15} />
            Subir estudio
          </Link>
        )}
        {/* 🔴 COBRAR, AQUÍ MISMO (fila 28). Antes esto era un enlace que te
            sacaba de la ficha a /instituto/caja con el paciente
            preseleccionado: para cobrar una consulta de $300 había que
            cambiar de pantalla, esperar la caja entera y volver. El modal
            llama al MISMO endpoint que la caja
            (POST /api/instituto/caja/cobros), así que el folio del recibo,
            la sede, el turno abierto, la idempotencia y el corte salen
            exactamente igual: aquí no hay ni una línea de lógica de
            recibos. Para un cobro de varios conceptos, con descuento o a
            meses, el modal remite a la caja — que es donde eso vive. */}
        {props.canCobrar && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setCobrar(true);
            }}
          >
            <Banknote size={15} />
            Cobrar
          </button>
        )}
        <button
          type="button"
          className="edu-btn edu-btn--ghost edu-btn--sm"
          onClick={imprimirResumen}
        >
          <Printer size={15} />
          Imprimir resumen
        </button>
      </div>

      {agendar && (
        <AgendarCita
          patientId={props.patientId}
          patientName={props.patientName}
          todayISO={props.todayISO}
          alumnos={props.alumnos}
          sillones={props.sillones}
          docentes={props.docentes}
          onClose={() => setAgendar(false)}
          onDone={hecho}
        />
      )}
      {abrirCaso && (
        <AbrirCaso
          patientId={props.patientId}
          patientName={props.patientName}
          alumnos={props.alumnos}
          programas={props.programas}
          onClose={() => setAbrirCaso(false)}
          onDone={hecho}
        />
      )}
      {cobrar && (
        <CobrarAqui
          patientId={props.patientId}
          patientName={props.patientName}
          onClose={() => setCobrar(false)}
          onDone={hecho}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// AGENDAR — el paciente ya está elegido: es el de la ficha.
// ═══════════════════════════════════════════════════════════════════════

const DURACIONES = [30, 45, 60, 90, 120];

function AgendarCita({
  patientId,
  patientName,
  todayISO,
  alumnos,
  sillones,
  docentes,
  onClose,
  onDone,
}: {
  patientId: string;
  patientName: string;
  todayISO: string;
  alumnos: EduStudentOption[];
  sillones: EduChairOption[];
  docentes: EduSupervisorOption[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [chairId, setChairId] = useState("");
  const [supervisorUserId, setSupervisorUserId] = useState("");
  const [supervisorTocado, setSupervisorTocado] = useState(false);
  const [day, setDay] = useState(todayISO);
  const [hora, setHora] = useState("09:00");
  const [minutes, setMinutes] = useState(60);
  const [type, setType] = useState<EduAppointmentType>("TRATAMIENTO");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activos = useMemo(() => sillones.filter((s) => s.isActive), [sillones]);
  // La sede solo se dice cuando hay más de una en la lista (regla de la
  // Ola 11: con una sola, nadie debe enterarse de que existen).
  const multiSede = useMemo(() => new Set(activos.map((s) => s.campusId)).size > 1, [activos]);

  function elegirAlumno(id: string) {
    setStudentId(id);
    // El titular VIGENTE del alumno se propone solo (viaja en la opción):
    // si hubiera que elegirlo a mano en cada cita, la mitad quedarían sin
    // supervisor. Quien lo tocó a mano, manda.
    if (!supervisorTocado) {
      const alumno = alumnos.find((a) => a.id === id);
      setSupervisorUserId(alumno?.supervisorUserId ?? "");
    }
  }

  async function guardar() {
    setError(null);
    if (!studentId) return setError("Elige al estudiante que va a atender.");
    if (!chairId) return setError("Elige el sillón.");
    if (!day) return setError("Elige la fecha.");
    if (!hora) return setError("Elige la hora.");
    setBusy(true);
    try {
      await eduRequest("/api/instituto/agenda", {
        method: "POST",
        body: {
          patientId,
          studentId,
          chairId,
          supervisorUserId: supervisorUserId || undefined,
          day,
          startMinute: hora,
          minutes,
          type,
          notes: notes.trim() || undefined,
        },
      });
      onDone(`Cita agendada para ${patientName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agendar.");
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Agendar cita"
      subtitle={`Para ${patientName}. El caso se engancha solo en el servidor cuando el estudiante tiene uno vivo con este paciente.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="edu-btn edu-btn--primary" onClick={guardar} disabled={busy}>
            {busy ? "Agendando…" : "Agendar"}
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
        <label className="edu-field__label" htmlFor="edu-acc-alumno">
          Estudiante
        </label>
        <select
          id="edu-acc-alumno"
          className="edu-input"
          value={studentId}
          disabled={busy}
          onChange={(e) => elegirAlumno(e.target.value)}
        >
          <option value="">Elige…</option>
          {alumnos.map((a) => (
            <option key={a.id} value={a.id}>
              {a.matricula} · {a.name} · {a.programName}
            </option>
          ))}
        </select>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-acc-sillon">
          Sillón
        </label>
        <select
          id="edu-acc-sillon"
          className="edu-input"
          value={chairId}
          disabled={busy}
          onChange={(e) => setChairId(e.target.value)}
        >
          <option value="">Elige…</option>
          {activos.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
              {multiSede ? ` · ${s.campusName}` : ""}
            </option>
          ))}
        </select>
        {multiSede && (
          <span className="edu-field__hint">
            La hora se interpreta con el reloj de la sede del sillón.
          </span>
        )}
      </div>

      <div className="edu-kv edu-kv--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-acc-dia">
            Fecha
          </label>
          <input
            id="edu-acc-dia"
            className="edu-input"
            type="date"
            value={day}
            disabled={busy}
            onChange={(e) => setDay(e.target.value)}
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-acc-hora">
            Hora
          </label>
          <input
            id="edu-acc-hora"
            className="edu-input"
            type="time"
            value={hora}
            disabled={busy}
            onChange={(e) => setHora(e.target.value)}
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-acc-min">
            Duración
          </label>
          <select
            id="edu-acc-min"
            className="edu-input"
            value={minutes}
            disabled={busy}
            onChange={(e) => setMinutes(Number(e.target.value))}
          >
            {DURACIONES.map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </select>
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-acc-tipo">
            Tipo
          </label>
          <select
            id="edu-acc-tipo"
            className="edu-input"
            value={type}
            disabled={busy}
            onChange={(e) => setType(e.target.value as EduAppointmentType)}
          >
            {EDU_APPOINTMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EDU_APPOINTMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-acc-sup">
          Docente que supervisa
        </label>
        <select
          id="edu-acc-sup"
          className="edu-input"
          value={supervisorUserId}
          disabled={busy}
          onChange={(e) => {
            setSupervisorTocado(true);
            setSupervisorUserId(e.target.value);
          }}
        >
          <option value="">Sin docente asignado</option>
          {docentes
            .filter((d) => d.isActive)
            .map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
        </select>
        <span className="edu-field__hint">
          Se propone solo el titular vigente del estudiante al elegirlo.
        </span>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-acc-notas">
          Notas (opcional)
        </label>
        <textarea
          id="edu-acc-notas"
          className="edu-input"
          rows={2}
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// ABRIR CASO — alumno + especialidad; el supervisor lo resuelve el
// servidor (el titular vigente del alumno), igual que en el tamizaje.
// ═══════════════════════════════════════════════════════════════════════

function AbrirCaso({
  patientId,
  patientName,
  alumnos,
  programas,
  onClose,
  onDone,
}: {
  patientId: string;
  patientName: string;
  alumnos: EduStudentOption[];
  programas: EduProgramaOption[];
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [studentId, setStudentId] = useState("");
  const [programId, setProgramId] = useState("");
  const [programTocado, setProgramTocado] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activas = useMemo(() => programas.filter((p) => p.isActive), [programas]);

  function elegirAlumno(id: string) {
    setStudentId(id);
    // La especialidad se propone sola: es la del alumno. Se puede cambiar
    // (dirección abre casos cruzados), pero el default es el correcto en
    // casi todos.
    if (!programTocado) {
      const alumno = alumnos.find((a) => a.id === id);
      setProgramId(alumno?.programId ?? "");
    }
  }

  async function guardar() {
    setError(null);
    if (!studentId) return setError("Elige al estudiante responsable.");
    if (!programId) return setError("Elige la especialidad del caso.");
    setBusy(true);
    try {
      await eduRequest("/api/instituto/casos", {
        method: "POST",
        body: { patientId, studentId, programId, notes: notes.trim() || undefined },
      });
      onDone(`Caso abierto para ${patientName}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo abrir el caso.");
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Abrir caso"
      subtitle={`${patientName} queda asignado a un estudiante en una especialidad. El docente responsable se toma del titular vigente del estudiante.`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="edu-btn edu-btn--primary" onClick={guardar} disabled={busy}>
            {busy ? "Abriendo…" : "Abrir caso"}
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
        <label className="edu-field__label" htmlFor="edu-caso-alumno">
          Estudiante responsable
        </label>
        <select
          id="edu-caso-alumno"
          className="edu-input"
          value={studentId}
          disabled={busy}
          onChange={(e) => elegirAlumno(e.target.value)}
        >
          <option value="">Elige…</option>
          {alumnos.map((a) => (
            <option key={a.id} value={a.id}>
              {a.matricula} · {a.name} · {a.programName}
            </option>
          ))}
        </select>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-caso-programa">
          Especialidad
        </label>
        <select
          id="edu-caso-programa"
          className="edu-input"
          value={programId}
          disabled={busy}
          onChange={(e) => {
            setProgramTocado(true);
            setProgramId(e.target.value);
          }}
        >
          <option value="">Elige…</option>
          {activas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-caso-notas">
          Notas (opcional)
        </label>
        <textarea
          id="edu-caso-notas"
          className="edu-input"
          rows={2}
          value={notes}
          disabled={busy}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// COBRAR DESDE LA FICHA (fila 28 del comparativo con el dental)
//
// 🔴 QUÉ ARREGLA. La ficha tenía un botón «Cobrar» que era un ENLACE a
// /instituto/caja?cobrar=<id>: para cobrar una consulta de $300 con el
// paciente delante había que salir de la ficha, esperar a que cargara la
// caja entera y volver. Ahora se cobra sin moverse.
//
// 🔴 CERO LÓGICA DE RECIBOS AQUÍ. Manda al MISMO endpoint que la caja
// (`POST /api/instituto/caja/cobros`), así que el folio C-0001, la sede en
// la que se cobra, el turno abierto, la idempotencia contra el doble clic,
// el corte y el CFDI salen exactamente igual. Lo único que este modal
// decide es qué formulario enseña.
//
// 🔴 UNA LÍNEA LIBRE, Y ES A PROPÓSITO. El cobro va como una línea SIN
// `procedureId` (concepto escrito + importe), que es el camino que el
// servidor ya tiene para "un material, una placa" y que queda registrado
// como tal en el recibo y en el corte. Cobrar del CATÁLOGO exige elegir
// procedimiento, cantidad y lista de precios, y eso ES la pantalla de caja:
// reconstruirla en un modal de la ficha sería la segunda copia que se
// desincroniza el día que cambien las tarifas. Por eso el pie remite allí.
//
// ⚠️ El precio de una línea libre lo pone quien cobra, no el catálogo. No es
// un hueco: el servidor solo descarta el precio del cliente cuando la línea
// TIENE procedimiento (ahí manda la lista). Sin procedimiento no hay lista
// que consultar, y así estaba desde la Ola 5.
// ═══════════════════════════════════════════════════════════════════════

function CobrarAqui({
  patientId,
  patientName,
  onClose,
  onDone,
}: {
  patientId: string;
  patientName: string;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [concepto, setConcepto] = useState("");
  const [importe, setImporte] = useState("");
  const [method, setMethod] = useState<EduPaymentMethod>(EDU_PAYMENT_METHODS_COBRABLES[0]);
  const [reference, setReference] = useState("");
  const [cobrado, setCobrado] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 🔴 P2-10 · LA CLAVE DE IDEMPOTENCIA SE GENERA UNA VEZ POR MODAL, no por
  // envío. Es lo que convierte dos POST idénticos (un reintento de red, un
  // Enter doble) en UN cobro: el servidor devuelve el que ya existía en vez
  // de emitir un segundo folio con su segundo pago. Si se generara en cada
  // `guardar()`, el reintento traería una clave nueva y volveríamos a
  // cobrar dos veces — que es justo lo que la clave existe para impedir.
  const [idempotencyKey] = useState(() =>
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `ficha-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
  );

  const cents = parseEduMoneyCents(importe);
  const motivo = !concepto.trim()
    ? "Escribe qué se está cobrando: es lo que va impreso en el recibo del paciente."
    : cents === null || cents <= 0
      ? "El importe tiene que ser una cantidad mayor que cero."
      : null;

  async function guardar() {
    if (motivo) return;
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ folio?: string; duplicado?: boolean }>(
        "/api/instituto/caja/cobros",
        {
          method: "POST",
          body: {
            patientId,
            items: [{ description: concepto.trim(), quantity: 1, unitPriceCents: cents }],
            // El pago solo viaja si de verdad se está cobrando ahora. Sin
            // él el cobro queda emitido y pendiente, que es "queda a
            // deber" — un estado legítimo y el que usa recepción cuando el
            // paciente paga el viernes.
            ...(cobrado
              ? {
                  payment: {
                    method,
                    amountCents: cents,
                    reference: reference.trim() || undefined,
                  },
                }
              : {}),
            idempotencyKey,
          },
        },
      );
      onDone(
        res.duplicado
          ? `Ese cobro ya estaba registrado: ${res.folio}. No se cobró dos veces.`
          : `Cobro ${res.folio ?? ""} registrado a ${patientName}.`.trim(),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cobrar.");
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Cobrar"
      subtitle={`A ${patientName}. Se emite el recibo con su folio, entra en el corte del turno y se puede facturar después.`}
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
            onClick={guardar}
            disabled={busy || Boolean(motivo)}
          >
            {busy ? "Cobrando…" : cobrado ? `Cobrar ${eduMoney(cents ?? 0)}` : "Dejar a deber"}
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
        <label className="edu-field__label" htmlFor="edu-cob-concepto">
          Concepto
        </label>
        <input
          id="edu-cob-concepto"
          className="edu-input"
          value={concepto}
          maxLength={160}
          disabled={busy}
          autoComplete="off"
          placeholder="Consulta de valoración, radiografía periapical…"
          onChange={(e) => setConcepto(e.target.value)}
        />
        <span className="edu-field__hint">
          Es lo que el paciente va a leer en su recibo.
        </span>
      </div>

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-cob-importe">
            Importe
          </label>
          <input
            id="edu-cob-importe"
            className="edu-input"
            inputMode="decimal"
            value={importe}
            disabled={busy}
            autoComplete="off"
            placeholder="300.00"
            onChange={(e) => setImporte(e.target.value)}
          />
          {cents !== null && cents > 0 && (
            <span className="edu-field__hint">{eduMoney(cents)}</span>
          )}
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-cob-forma">
            Forma de pago
          </label>
          <select
            id="edu-cob-forma"
            className="edu-input"
            value={method}
            disabled={busy || !cobrado}
            onChange={(e) => setMethod(e.target.value as EduPaymentMethod)}
          >
            {EDU_PAYMENT_METHODS_COBRABLES.map((m) => (
              <option key={m} value={m}>
                {EDU_PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-cob-ref">
          Referencia (opcional)
        </label>
        <input
          id="edu-cob-ref"
          className="edu-input"
          value={reference}
          maxLength={80}
          disabled={busy || !cobrado}
          autoComplete="off"
          placeholder="Últimos 4 de la tarjeta, folio de la transferencia…"
          onChange={(e) => setReference(e.target.value)}
        />
      </div>

      {/* «Queda a deber» es un estado real de la caja y tiene que caber
          aquí: recepción emite el cobro con el paciente delante y lo cobra
          el viernes. Sin esta casilla, la única forma de dejarlo pendiente
          sería no usar este modal. */}
      <label className="edu-check">
        <input
          type="checkbox"
          checked={cobrado}
          disabled={busy}
          onChange={(e) => setCobrado(e.target.checked)}
        />
        <span className="edu-check__body">
          <span className="edu-check__label">Lo está pagando ahora</span>
          <span className="edu-check__hint">
            Desmárcalo si queda a deber: el cobro se emite igual y el pago se registra después,
            desde la caja.
          </span>
        </span>
      </label>

      <p className="edu-note">
        Esto emite un cobro de UN concepto. Para varios conceptos, descuentos, pago dividido o
        mensualidades,{" "}
        <Link href={`/instituto/caja?cobrar=${patientId}`} className="edu-link">
          ve a la caja
        </Link>
        : ahí vive el catálogo de tarifas y esa pantalla no se duplica.
      </p>
    </EduModal>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// CANCELAR UNA CITA DESDE LA FICHA (fila 24 del comparativo con el dental)
//
// 🔴 QUÉ ARREGLA. La pestaña Agenda de la ficha enseñaba las citas del
// paciente y no dejaba hacer NADA con ellas: para cancelar la del jueves
// había que salir a la agenda general, encontrar el día, encontrar el hueco
// y volver. Agendar sí se podía desde la ficha desde la Ola 12; cancelar no.
//
// 🔴 LA REGLA DE ESTADO NO SE TOCA. El endpoint llama a
// `setEduAppointmentStatus`, la MISMA función de la agenda general: las
// transiciones válidas, la ventana que impide dar por ocurrido el futuro y
// la cancelación del recordatorio siguen viviendo en un solo sitio.
//
// 🔴 EL MOTIVO ES OBLIGATORIO AQUÍ. Una cita cancelada sin motivo, tres
// semanas después, no le sirve a nadie: ni al docente que quiere saber por
// qué no se hizo el tratamiento, ni a la escuela que cuenta horas clínicas.
// El servidor lo acepta vacío a propósito (la agenda general lleva años
// cancelando sin él y romperla no era el encargo); la pantalla que lo pide
// es ésta.
//
// ⚠️ Vive en este archivo y no en uno nuevo porque es una ACCIÓN de la
// ficha, igual que agendar, cobrar o imprimir — y porque la pestaña Agenda
// es una página de servidor que necesita un componente de cliente que le
// preste el botón.
// ═══════════════════════════════════════════════════════════════════════

export function EduCitaCancelar({
  patientId,
  appointmentId,
  cuando,
  canManage,
}: {
  patientId: string;
  appointmentId: string;
  /** «jue 12 sep · 10:00», para que el modal diga QUÉ cita se cancela. */
  cuando: string;
  /** `agenda.manage`. Sin él no se pinta: el alumno registra lo que pasa en
   *  el sillón, pero cancelar libera el hueco y toca el cobro. */
  canManage: boolean;
}) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [abierto, setAbierto] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!canManage) return null;

  async function cancelar() {
    if (!reason.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/pacientes/${patientId}/agenda/${appointmentId}`, {
        method: "PATCH",
        body: { status: "CANCELLED", reason: reason.trim() },
      });
      setAbierto(false);
      setReason("");
      startNav(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cancelar la cita.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="edu-btn edu-btn--ghost edu-btn--sm"
        onClick={() => setAbierto(true)}
      >
        <XCircle size={15} />
        Cancelar cita
      </button>

      {abierto && (
        <EduModal
          title="Cancelar la cita"
          subtitle={cuando}
          onClose={() => setAbierto(false)}
          busy={busy}
          footer={
            <>
              <button
                type="button"
                className="edu-btn edu-btn--ghost"
                onClick={() => setAbierto(false)}
                disabled={busy}
              >
                Dejarla como está
              </button>
              <button
                type="button"
                className="edu-btn edu-btn--primary"
                onClick={cancelar}
                disabled={busy || !reason.trim()}
              >
                {busy ? "Cancelando…" : "Cancelar la cita"}
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
            <label className="edu-field__label" htmlFor={`edu-cancel-${appointmentId}`}>
              ¿Por qué se cancela?
            </label>
            <textarea
              id={`edu-cancel-${appointmentId}`}
              className="edu-input"
              rows={3}
              value={reason}
              maxLength={300}
              disabled={busy}
              placeholder="El paciente avisó que no puede, se enfermó el estudiante, se cayó el sillón…"
              onChange={(e) => setReason(e.target.value)}
            />
            <span className="edu-field__hint">
              Queda anotado en la cita. Sin motivo, dentro de tres semanas nadie sabe por qué no se
              hizo el tratamiento.
            </span>
          </div>

          <p className="edu-note">
            El hueco queda libre para otro paciente y el recordatorio automático no sale. La cita no
            se borra: se queda como constancia de que existió.
          </p>
        </EduModal>
      )}
    </>
  );
}
