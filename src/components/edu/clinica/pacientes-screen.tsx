"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Search, UserPlus, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import { EduPersonaLink } from "@/components/edu/persona/persona-link";
import {
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_CASE_STATUS_LABELS,
  EDU_PATIENT_STATUSES,
  EDU_PATIENT_STATUS_LABELS,
  EDU_SEXES,
  EDU_SEX_LABELS,
  type EduPatientStatus,
} from "@/lib/edu/types";
import { EDU_PHONE_HELP, formatEduDate, type EduPatientRow } from "@/lib/edu/pacientes-core";
import {
  EduPacienteDatosFields,
  useEduPacienteDatosForm,
} from "@/components/edu/clinica/paciente-datos-form";
import {
  eduFormatDayShort,
  type EduAppointmentRow,
  type EduCaseRow,
  type EduStudentOption,
} from "@/lib/edu/agenda-core";

/**
 * /instituto/pacientes — los pacientes de la clínica de la escuela.
 *
 * QUÉ DECIDE ESTA PANTALLA Y QUÉ NO:
 *  · NO decide qué filas se ven. Eso lo resolvió el servidor con el helper
 *    de visibilidad: un ALUMNO recibe solo a sus pacientes (los de sus
 *    casos y sus citas) y aquí no hay forma de pedir más. Esconder filas en
 *    el cliente sería teatro.
 *  · NO decide quién puede editar. `canManage` y `canOrigin` llegan ya
 *    resueltos y CADA endpoint los vuelve a exigir.
 *
 * 🔴 EL ORIGEN se PINTA siempre y se EDITA solo con "pacientes.origen".
 * Esconderlo del alumno sería peor que enseñárselo bloqueado: ese dato
 * decide el precio en la Ola 5, y un alumno tiene derecho a ver si el
 * paciente que trajo cuenta como suyo.
 */
export interface EduPacientesScreenProps {
  rows: EduPatientRow[];
  truncated: boolean;
  maxRows: number;
  filters: { status: EduPatientStatus | null; referredByStudentId: string | null; q: string | null };
  students: EduStudentOption[];
  canManage: boolean;
  /**
   * ¿Puede corregir el TELÉFONO y el CORREO? (H-02). Es `pacientes.manage`
   * O `expediente.write`: el alumno y el docente con el paciente en el
   * sillón corrigen el contacto, y nada más. Lo resuelve el servidor con
   * `eduPatientEditAbilities`, y el endpoint lo vuelve a exigir.
   */
  canContacto: boolean;
  canOrigin: boolean;
  /**
   * ¿Es un DOCENTE al que la dirección todavía no le asignó ningún alumno?
   * (H-29). Su alcance es "supervised", nunca "none", así que la página no
   * entra por la rama que explica el recorte y caía en el vacío genérico
   * «Todavía no hay pacientes» — que le dice a un docente recién llegado
   * que la clínica de la escuela no tiene pacientes. Los tiene: no le tocan.
   */
  sinAlumnosAsignados?: boolean;
  /**
   * ¿Es un ESTUDIANTE cuya inscripción ya no está activa? (H-07). Desde
   * esta ola un alumno EGRESADO —o de baja— deja de alcanzar a sus
   * pacientes, y su alcance sigue siendo "own", nunca "none": sin esto
   * caería en el mismo vacío genérico que le arreglamos al docente y
   * leería «Todavía no hay pacientes», que es mentira. Se le dice la
   * verdad: la clínica tiene pacientes, y su cuenta ya no los alcanza.
   */
  inscripcionInactiva?: boolean;
}

const TAG_BY_STATUS: Record<EduPatientStatus, string> = {
  NEW: "edu-tag--info",
  ACTIVE: "edu-tag--ok",
  DISCHARGED: "edu-tag--muted",
  INACTIVE: "edu-tag--warn",
};

export function EduPacientesScreen({
  rows,
  truncated,
  maxRows,
  filters,
  students,
  canManage,
  canContacto,
  canOrigin,
  sinAlumnosAsignados = false,
  inscripcionInactiva = false,
}: EduPacientesScreenProps) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");
  const [alta, setAlta] = useState(false);
  const [ficha, setFicha] = useState<EduPatientRow | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const hayFiltros = Boolean(filters.status || filters.referredByStudentId || filters.q);

  function aplicar(next: Partial<Record<"estado" | "origen" | "q", string>>) {
    const actual: Record<string, string> = {};
    if (filters.status) actual.estado = filters.status;
    if (filters.referredByStudentId) actual.origen = filters.referredByStudentId;
    if (filters.q) actual.q = filters.q;

    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...actual, ...next })) {
      if (v) params.set(k, v);
    }
    const qs = params.toString();
    startNav(() => {
      router.replace(qs ? `/instituto/pacientes?${qs}` : "/instituto/pacientes", { scroll: false });
    });
  }

  function recargar(mensaje: string) {
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

      <form
        className="edu-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          aplicar({ q: q.trim() });
        }}
      >
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-pac-q">
            Buscar
          </label>
          <div className="edu-input-wrap">
            <input
              id="edu-pac-q"
              className="edu-input edu-input--sm"
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Nombre, folio o teléfono"
              autoComplete="off"
            />
            <button type="submit" className="edu-reveal" aria-label="Buscar">
              <Search size={17} />
            </button>
          </div>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-pac-estado">
            Estado
          </label>
          <select
            id="edu-pac-estado"
            className="edu-input edu-input--sm"
            value={filters.status ?? ""}
            onChange={(e) => aplicar({ estado: e.target.value })}
          >
            <option value="">Todos</option>
            {EDU_PATIENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EDU_PATIENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-pac-origen">
            Lo trajo
          </label>
          <select
            id="edu-pac-origen"
            className="edu-input edu-input--sm"
            value={filters.referredByStudentId ?? ""}
            onChange={(e) => aplicar({ origen: e.target.value })}
          >
            <option value="">Cualquiera</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.matricula} · {s.name}
              </option>
            ))}
          </select>
        </div>

        {hayFiltros && (
          <button
            type="button"
            className="edu-btn edu-btn--ghost edu-btn--sm"
            onClick={() => {
              setQ("");
              startNav(() => router.replace("/instituto/pacientes", { scroll: false }));
            }}
          >
            <X size={15} />
            Limpiar
          </button>
        )}
      </form>

      <div className="edu-toolbar__foot">
        <span className="edu-count">
          {navigating
            ? "Buscando…"
            : `${rows.length} ${rows.length === 1 ? "paciente" : "pacientes"}${
                truncated ? ` (se muestran los primeros ${maxRows})` : ""
              }`}
        </span>
        {canManage && (
          <button
            type="button"
            className="edu-btn edu-btn--primary edu-btn--sm"
            onClick={() => {
              setFlash(null);
              setAlta(true);
            }}
          >
            <UserPlus size={16} />
            Registrar paciente
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        /* 🔴 H-29 · UNA LISTA VACÍA TIENE QUE DECIR POR QUÉ ESTÁ VACÍA. Un
           docente sin alumnos asignados leía «Todavía no hay pacientes» —un
           texto que miente sobre el estado del sistema: la clínica SÍ tiene
           pacientes, solo que ninguno le toca. Su alcance es "supervised" y
           nunca "none", así que la página no entra por la rama que explica
           el recorte y caía en el vacío genérico. */
        <div className="edu-empty">
          <p className="edu-empty__title">
            {hayFiltros
              ? "Ningún paciente coincide"
              : inscripcionInactiva
                ? "Tu inscripción ya no está activa"
                : sinAlumnosAsignados
                  ? "No tienes alumnos asignados todavía"
                  : "Todavía no hay pacientes"}
          </p>
          <p className="edu-empty__detail">
            {hayFiltros
              ? "Prueba con menos filtros o revisa el folio que buscaste."
              : inscripcionInactiva
                ? "Tu ficha en el padrón está como egresado o dado de baja, así que ya no alcanzas los expedientes de los pacientes que atendiste. Tus casos y tu evaluación siguen siendo tuyos y los sigues viendo. Si esto es un error, la dirección lo corrige en el padrón."
                : sinAlumnosAsignados
                  ? "Cuando la dirección te asigne uno, aquí verás sus pacientes. La clínica de la escuela sí tiene pacientes: lo que todavía no tienes son estudiantes a tu cargo."
                  : "Aquí aparecen los pacientes que la clínica registra en recepción. Un paciente se ve para un estudiante o un docente cuando tiene una cita o un caso con él."}
          </p>
        </div>
      ) : (
        <div className="edu-table edu-table--pacientes">
          <div className="edu-rowhead" aria-hidden="true">
            <span>Folio</span>
            <span>Paciente</span>
            <span>Contacto</span>
            <span>Estado</span>
            <span>Casos</span>
            <span />
          </div>

          {rows.map((p) => (
            <div key={p.id} className={`edu-row ${p.status === "INACTIVE" ? "edu-row--off" : ""}`}>
              <div className="edu-cell">
                <span className="edu-cell__label">Folio</span>
                <span className="edu-cell__value edu-cell__value--strong">{p.folio}</span>
              </div>

              <div className="edu-cell edu-cell--wide">
                <span className="edu-cell__label">Paciente</span>
                <span className="edu-cell__value edu-cell__value--strong">
                  <EduPersonaLink kind="paciente" id={p.id}>
                    {p.name}
                  </EduPersonaLink>
                </span>
                <span className="edu-cell__sub">
                  {p.ageYears !== null ? `${p.ageYears} años` : "Sin fecha de nacimiento"}
                  {p.origin.studentMatricula && (
                    <>
                      {" · lo trajo "}
                      <EduPersonaLink kind="estudiante" id={p.origin.studentId}>
                        {p.origin.studentMatricula}
                      </EduPersonaLink>
                    </>
                  )}
                </span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Contacto</span>
                <span className="edu-cell__value">{p.phone ?? "—"}</span>
                {p.email && <span className="edu-cell__sub">{p.email}</span>}
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Estado</span>
                <span className={`edu-tag ${TAG_BY_STATUS[p.status]}`}>
                  {EDU_PATIENT_STATUS_LABELS[p.status]}
                </span>
              </div>

              <div className="edu-cell">
                <span className="edu-cell__label">Casos</span>
                <span className="edu-cell__value">
                  {p.openCases > 0 ? `${p.openCases} abierto${p.openCases === 1 ? "" : "s"}` : "—"}
                </span>
                {p.totalCases > p.openCases && (
                  <span className="edu-cell__sub">{p.totalCases} en total</span>
                )}
              </div>

              <div className="edu-cell__actions">
                <button
                  type="button"
                  className="edu-btn edu-btn--ghost edu-btn--sm"
                  onClick={() => {
                    setFlash(null);
                    setFicha(p);
                  }}
                >
                  {canManage ? "Ficha" : "Ver"}
                </button>
                {/* Ola 3. El modal de arriba sigue siendo el atajo para
                    corregir un teléfono sin salir de la lista; este enlace
                    abre la ficha COMPLETA, con el expediente, el
                    odontograma y los estudios. Cada pestaña de allá exige
                    su permiso: quien no lo tenga (caja) llega y no ve esas
                    pestañas. */}
                <Link
                  href={`/instituto/pacientes/${p.id}`}
                  className="edu-btn edu-btn--ghost edu-btn--sm"
                >
                  Expediente
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {alta && (
        <AltaPaciente
          students={students}
          canOrigin={canOrigin}
          onClose={() => setAlta(false)}
          onDone={(folio) => {
            setAlta(false);
            recargar(`El paciente quedó registrado con el folio ${folio}.`);
          }}
        />
      )}

      {ficha && (
        <FichaPaciente
          patient={ficha}
          students={students}
          canManage={canManage}
          canContacto={canContacto}
          canOrigin={canOrigin}
          onClose={() => setFicha(null)}
          onDone={(mensaje) => {
            setFicha(null);
            recargar(mensaje);
          }}
        />
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Alta
// ═══════════════════════════════════════════════════════════════════════

function AltaPaciente({
  students,
  canOrigin,
  onClose,
  onDone,
}: {
  students: EduStudentOption[];
  canOrigin: boolean;
  onClose: () => void;
  onDone: (folio: string) => void;
}) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [folio, setFolio] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [sex, setSex] = useState("UNSPECIFIED");
  const [notes, setNotes] = useState("");
  const [origen, setOrigen] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * 🔴 H-05 · EL AVISO DE DUPLICADO. Si el servidor encuentra a alguien con
   * el mismo teléfono, o con el mismo nombre + apellidos + nacimiento,
   * contesta 409 con el folio de a quién se parece. No es un error de la
   * persona: es un alto en el camino, y por eso se pinta en ÁMBAR y no en
   * rojo. Pulsar Registrar otra vez lo da de alta igual (`allowDuplicate`),
   * a propósito y a sabiendas — dos hermanos comparten el teléfono de su
   * madre, y una escuela grande tiene homónimos.
   *
   * ⚠️ No hay FUSIÓN, y por eso este aviso importa tanto: un paciente
   * duplicado no se borra (NOM-004) ni se junta con el otro. Lo único que
   * se puede hacer después es marcarlo INACTIVE, que lo deja en la lista.
   */
  const [duplicado, setDuplicado] = useState<string | null>(null);

  async function guardar(allowDuplicate = false) {
    setError(null);
    if (!allowDuplicate) setDuplicado(null);
    setBusy(true);
    try {
      const res = await eduRequest<{
        ok: boolean;
        folio?: string;
        aviso?: string;
        duplicados?: { folio: string; name: string }[];
      }>("/api/instituto/pacientes", {
        method: "POST",
        body: {
          firstName,
          lastName,
          folio: folio.trim() || undefined,
          phone: phone.trim() || null,
          email: email.trim() || null,
          birthDate: birthDate || null,
          sex,
          notes: notes.trim() || null,
          referredByStudentId: canOrigin && origen ? origen : undefined,
          allowDuplicate,
        },
      });
      // 🔴 El aviso de duplicado NO es un error: viene en el cuerpo, con la
      // lista, y se reconoce por el CAMPO —nunca leyendo la frase en
      // español, que es como un cambio de redacción convertiría este alto
      // ámbar en un error rojo sin que nada falle—.
      if (!res.ok && res.duplicados?.length) {
        setDuplicado(res.aviso ?? "Puede que este paciente ya esté registrado.");
        return;
      }
      if (res.folio) onDone(res.folio);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo registrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <EduModal
      title="Registrar paciente"
      subtitle="Lo mínimo para poder agendarlo. Lo demás se completa en su ficha."
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
            onClick={() => guardar(duplicado !== null)}
            disabled={busy || !firstName.trim() || !lastName.trim()}
          >
            {busy ? "Registrando…" : duplicado ? "Sí, es otra persona: registrar" : "Registrar"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      {duplicado && (
        <div className="edu-banner edu-banner--warn" role="alert">
          <div>
            <p className="edu-banner__title">Puede que ya esté registrado</p>
            <p className="edu-banner__detail">{duplicado}</p>
          </div>
        </div>
      )}

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-p-nombre">
            Nombre
          </label>
          <input
            id="edu-p-nombre"
            className="edu-input"
            value={firstName}
            onChange={(e) => {
              setDuplicado(null);
              setFirstName(e.target.value);
            }}
            autoComplete="off"
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-p-apellido">
            Apellidos
          </label>
          <input
            id="edu-p-apellido"
            className="edu-input"
            value={lastName}
            onChange={(e) => {
              setDuplicado(null);
              setLastName(e.target.value);
            }}
            autoComplete="off"
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-p-folio">
            Folio (opcional)
          </label>
          <input
            id="edu-p-folio"
            className="edu-input"
            value={folio}
            onChange={(e) => setFolio(e.target.value)}
            placeholder="Se asigna solo"
            autoComplete="off"
          />
          <span className="edu-field__hint">
            Si lo dejas vacío, el sistema pone el siguiente (P-0001, P-0002…). Si tu escuela
            ya tiene su numeración, escríbela aquí.
          </span>
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-p-tel">
            Teléfono
          </label>
          <input
            id="edu-p-tel"
            className="edu-input"
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => {
              setDuplicado(null);
              setPhone(e.target.value);
            }}
            autoComplete="off"
          />
          <span className="edu-field__hint">{EDU_PHONE_HELP}</span>
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-p-nac">
            Nacimiento
          </label>
          <input
            id="edu-p-nac"
            className="edu-input"
            type="date"
            value={birthDate}
            onChange={(e) => {
              setDuplicado(null);
              setBirthDate(e.target.value);
            }}
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-p-sexo">
            Sexo
          </label>
          <select
            id="edu-p-sexo"
            className="edu-input"
            value={sex}
            onChange={(e) => setSex(e.target.value)}
          >
            {EDU_SEXES.map((s) => (
              <option key={s} value={s}>
                {EDU_SEX_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-p-correo">
          Correo
        </label>
        <input
          id="edu-p-correo"
          className="edu-input"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="off"
        />
      </div>

      <OrigenField
        value={origen}
        onChange={setOrigen}
        students={students}
        disabled={!canOrigin}
        id="edu-p-origen"
      />

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-p-notas">
          Notas de recepción
        </label>
        <textarea
          id="edu-p-notas"
          className="edu-input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Lo que haya que saber antes de sentarlo. No es historia clínica."
        />
      </div>
    </EduModal>
  );
}

/**
 * El campo del ORIGEN, con su explicación.
 *
 * Se pinta SIEMPRE, deshabilitado para quien no tiene "pacientes.origen".
 * Es un dato con consecuencia económica (decide el precio en la Ola 5) y
 * quien no puede ponerlo tiene igual derecho a verlo.
 */
function OrigenField({
  value,
  onChange,
  students,
  disabled,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  students: EduStudentOption[];
  disabled: boolean;
  id: string;
}) {
  return (
    <div className="edu-field">
      <label className="edu-field__label" htmlFor={id}>
        ¿Lo trajo algún estudiante?
      </label>
      <select
        id={id}
        className="edu-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">Llegó solo a la clínica</option>
        {students.map((s) => (
          <option key={s.id} value={s.id}>
            {s.matricula} · {s.name}
          </option>
        ))}
      </select>
      <span className="edu-field__hint">
        {disabled
          ? "Solo caja y la dirección pueden marcar el origen. Se te muestra porque decide lo que el paciente paga."
          : "Quién trajo al paciente decide su tarifa. Queda registrado que lo marcaste tú y cuándo."}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Ficha
// ═══════════════════════════════════════════════════════════════════════

interface FichaData {
  row: EduPatientRow;
  cases: EduCaseRow[];
  appointments: EduAppointmentRow[];
}

/**
 * El modal FICHA de la lista: el atajo para corregir sin salir de aquí.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 H-10 · EL FORMULARIO NO SE MONTA HASTA QUE LLEGA LA FILA FRESCA, y ése
 * es el arreglo entero. Antes se pedía la ficha al servidor, la respuesta
 * llegaba… y se tiraba: el estado del formulario salía de `patient`, la
 * fila que la LISTA pintó. Escenario real: la lista se pintó a las 9:00; a
 * las 9:20 se cerró el último caso y el paciente pasó a DISCHARGED solo; a
 * las 9:25 recepción abrió este modal para corregir el correo y al guardar
 * mandaba `status: "ACTIVE"` —el valor de las 9:00— resucitando el estado
 * viejo. Lo mismo con el teléfono, el nacimiento y las notas si alguien más
 * los tocó en medio.
 *
 * Se cierra por los dos lados:
 *   · el formulario nace de `data.row` (lo que el servidor acaba de decir);
 *   · y solo viaja el DIFF (`eduPatientFormDiff`), así que dos personas que
 *     corrigen campos distintos ya no se pisan.
 *
 * 🔴 H-01 · LOS NUEVE CAMPOS, y son los MISMOS que la pestaña Datos porque
 * son el MISMO componente (paciente-datos-form.tsx). Hasta esta ola este
 * modal mandaba cinco y cuatro datos del paciente no se corregían desde
 * ninguna pantalla del producto.
 * ═══════════════════════════════════════════════════════════════════════
 */
function FichaPaciente({
  patient,
  students,
  canManage,
  canContacto,
  canOrigin,
  onClose,
  onDone,
}: {
  patient: EduPatientRow;
  students: EduStudentOption[];
  canManage: boolean;
  canContacto: boolean;
  canOrigin: boolean;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [data, setData] = useState<FichaData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Los casos y las citas llegan en UNA sola respuesta: tres viajes para
  // abrir un modal se notan en el teléfono del piso clínico. Y la fila que
  // viene con ellos es la que alimenta el formulario (H-10).
  useEffect(() => {
    let vivo = true;
    eduRequest<FichaData>(`/api/instituto/pacientes/${patient.id}`)
      .then((d) => {
        if (vivo) setData(d);
      })
      .catch((err: unknown) => {
        if (vivo) setError(err instanceof Error ? err.message : "No se pudo abrir la ficha.");
      })
      .finally(() => {
        if (vivo) setCargando(false);
      });
    return () => {
      vivo = false;
    };
  }, [patient.id]);

  return (
    <FichaModal
      patient={patient}
      data={data}
      cargando={cargando}
      errorCarga={error}
      students={students}
      canManage={canManage}
      canContacto={canContacto}
      canOrigin={canOrigin}
      onClose={onClose}
      onDone={onDone}
    />
  );
}

/**
 * El cuerpo del modal. Existe aparte para que NO SE MONTE hasta que la fila
 * fresca llegó: el estado del formulario se inicializa una sola vez
 * (useState con inicializador), así que sembrarlo con la fila que pintó la
 * lista y "arreglarlo" después con un efecto sería volver a tener H-10 por
 * la puerta de atrás. Quien lo monta es el render condicional de arriba —
 * mientras `data` es null, este componente no existe.
 */
function FichaModal({
  patient,
  data,
  cargando,
  errorCarga,
  students,
  canManage,
  canContacto,
  canOrigin,
  onClose,
  onDone,
}: {
  patient: EduPatientRow;
  data: FichaData | null;
  cargando: boolean;
  errorCarga: string | null;
  students: EduStudentOption[];
  canManage: boolean;
  canContacto: boolean;
  canOrigin: boolean;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const soloLectura = !canManage && !canContacto && !canOrigin;
  // El `busy` vive AQUÍ y no en el cuerpo: es lo que impide que Escape o un
  // clic en la cortina cierren el modal a media escritura.
  const [busy, setBusy] = useState(false);

  return (
    <EduModal
      title={
        <EduPersonaLink kind="paciente" id={patient.id}>
          {data?.row.name ?? patient.name}
        </EduPersonaLink>
      }
      subtitle={`Folio ${data?.row.folio ?? patient.folio}`}
      onClose={onClose}
      busy={busy}
      footer={null}
    >
      {errorCarga && (
        <div className="edu-alert" role="alert">
          {errorCarga}
        </div>
      )}

      {cargando || !data ? (
        errorCarga ? (
          // Sin la ficha no hay formulario que pintar, así que el pie que
          // vive dentro del cuerpo tampoco existe: aquí va el único botón
          // de salida que le queda a quien no usa la «×» del encabezado.
          <div className="edu-actions">
            <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose}>
              Cerrar
            </button>
          </div>
        ) : (
          <p className="edu-note">Cargando la ficha…</p>
        )
      ) : (
        <FichaCuerpo
          data={data}
          students={students}
          canManage={canManage}
          canContacto={canContacto}
          canOrigin={canOrigin}
          soloLectura={soloLectura}
          busy={busy}
          setBusy={setBusy}
          onClose={onClose}
          onDone={onDone}
        />
      )}
    </EduModal>
  );
}

function FichaCuerpo({
  data,
  students,
  canManage,
  canContacto,
  canOrigin,
  soloLectura,
  busy,
  setBusy,
  onClose,
  onDone,
}: {
  data: FichaData;
  students: EduStudentOption[];
  canManage: boolean;
  canContacto: boolean;
  canOrigin: boolean;
  soloLectura: boolean;
  busy: boolean;
  setBusy: (v: boolean) => void;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const row = data.row;
  const form = useEduPacienteDatosForm(row);
  const [origen, setOrigen] = useState(row.origin.studentId ?? "");
  const [error, setError] = useState<string | null>(null);

  const origenCambio = canOrigin && origen !== (row.origin.studentId ?? "");
  const hayQueGuardar = origenCambio || (form.hayCambios && canContacto);
  const puedeGuardar = hayQueGuardar && !form.conflictoEstado;

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      // El ORIGEN va por su propio endpoint y su propio permiso: no es un
      // campo más de la ficha, es el que decide el precio.
      if (origenCambio) {
        await eduRequest(`/api/instituto/pacientes/${row.id}/origen`, {
          method: "PATCH",
          body: { referredByStudentId: origen || null },
        });
      }
      // 🔴 SOLO EL DIFF, y solo si hay algo. Un PATCH con los nueve campos
      // siempre es lo que pisaba lo que otro cambió en medio (H-10); un
      // PATCH vacío es un error del servidor ("No mandaste ningún cambio")
      // donde no hubo ninguno.
      if (form.hayCambios) {
        await eduRequest(`/api/instituto/pacientes/${row.id}`, {
          method: "PATCH",
          body: form.diff,
        });
      }
      onDone(`La ficha de ${row.name} quedó guardada.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-kv edu-kv--2">
        <div>
          <span className="edu-kv__k">Edad</span>
          <span className="edu-kv__v">{row.ageYears !== null ? `${row.ageYears} años` : "—"}</span>
        </div>
        <div>
          <span className="edu-kv__k">Registrado</span>
          <span className="edu-kv__v">{formatEduDate(row.createdAt)}</span>
        </div>
        <div>
          <span className="edu-kv__k">Origen actual</span>
          <span className="edu-kv__v">
            {row.origin.studentName ? (
              <EduPersonaLink kind="estudiante" id={row.origin.studentId}>
                {row.origin.studentMatricula} · {row.origin.studentName}
              </EduPersonaLink>
            ) : (
              "Llegó solo"
            )}
            {row.origin.setByName && (
              <span className="edu-cell__sub">
                {" "}
                Lo marcó {row.origin.setByName}
                {row.origin.setAt ? ` el ${formatEduDate(row.origin.setAt)}` : ""}
              </span>
            )}
          </span>
        </div>
        <div>
          <span className="edu-kv__k">Casos abiertos</span>
          <span className="edu-kv__v">{row.openCases > 0 ? row.openCases : "—"}</span>
        </div>
      </div>

      {/* 🔴 EL MISMO componente que monta la pestaña Datos de la ficha. Un
          campo nuevo se agrega ahí y aparece en los dos sitios. */}
      <EduPacienteDatosFields
        form={form}
        canManage={canManage}
        canContacto={canContacto}
        idPrefix="edu-f"
      />

      <OrigenField
        value={origen}
        onChange={setOrigen}
        students={students}
        disabled={!canOrigin}
        id="edu-f-origen"
      />

      <div className="edu-section">
        <div className="edu-section__head">
          <h3 className="edu-section__title">Casos</h3>
          <span className="edu-count">{data.cases.length}</span>
        </div>
        {data.cases.length === 0 ? (
          <p className="edu-note">
            Sin casos. Un caso se abre en la valoración, y es lo que le pone estudiante y
            especialidad al paciente.
          </p>
        ) : (
          <ul className="edu-chiplist">
            {data.cases.map((c) => (
              <li key={c.id} className="edu-assign">
                <span>
                  <strong>{c.programName}</strong> ·{" "}
                  <EduPersonaLink kind="estudiante" id={c.studentId}>
                    {c.studentMatricula}
                  </EduPersonaLink>{" "}
                  · {EDU_CASE_STATUS_LABELS[c.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="edu-section">
        <div className="edu-section__head">
          <h3 className="edu-section__title">Últimas citas</h3>
          <span className="edu-count">{data.appointments.length}</span>
        </div>
        {data.appointments.length === 0 ? (
          <p className="edu-note">Todavía no tiene citas.</p>
        ) : (
          <ul className="edu-chiplist">
            {data.appointments.slice(0, 8).map((a) => (
              <li key={a.id} className="edu-assign">
                <span>
                  {/* El día viene YA calculado en la zona del instituto
                      (row.dayISO). Formatear el instante aquí lo pintaría
                      en la zona del navegador y una cita de las 19:00 en
                      Tijuana saldría al día siguiente. */}
                  {eduFormatDayShort(a.dayISO)} {a.startLabel} · {a.chairName} ·{" "}
                  {EDU_APPOINTMENT_STATUS_LABELS[a.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* El pie va DENTRO del cuerpo y no en `footer` del modal porque los
          botones dependen del formulario, y el formulario no existe hasta
          que llegó la fila fresca. */}
      <div className="edu-actions">
        <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
          {soloLectura ? "Cerrar" : "Cancelar"}
        </button>
        {!soloLectura && (
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={guardar}
            disabled={busy || !puedeGuardar}
          >
            {busy ? "Guardando…" : "Guardar"}
          </button>
        )}
        {!soloLectura && !hayQueGuardar && !busy && (
          <span className="edu-fichaform__motivo">No has cambiado nada todavía.</span>
        )}
      </div>
    </>
  );
}
