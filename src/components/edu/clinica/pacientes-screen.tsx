"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, UserPlus, X } from "lucide-react";
import { EduModal } from "@/components/edu/edu-modal";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_APPOINTMENT_STATUS_LABELS,
  EDU_CASE_STATUS_LABELS,
  EDU_PATIENT_STATUSES,
  EDU_PATIENT_STATUS_DESCRIPTIONS,
  EDU_PATIENT_STATUS_LABELS,
  EDU_SEXES,
  EDU_SEX_LABELS,
  type EduPatientStatus,
} from "@/lib/edu/types";
import { formatEduDate, type EduPatientRow } from "@/lib/edu/pacientes-core";
import { eduDateInputValue } from "@/lib/edu/padron-core";
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
  canOrigin: boolean;
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
  canOrigin,
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
        <div className="edu-empty">
          <p className="edu-empty__title">
            {hayFiltros ? "Ningún paciente coincide" : "Todavía no hay pacientes"}
          </p>
          <p className="edu-empty__detail">
            {hayFiltros
              ? "Prueba con menos filtros o revisa el folio que buscaste."
              : "Aquí aparecen los pacientes que la clínica registra en recepción. Un paciente se ve para un alumno o un docente cuando tiene una cita o un caso con él."}
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
                <span className="edu-cell__value edu-cell__value--strong">{p.name}</span>
                <span className="edu-cell__sub">
                  {p.ageYears !== null ? `${p.ageYears} años` : "Sin fecha de nacimiento"}
                  {p.origin.studentMatricula ? ` · lo trajo ${p.origin.studentMatricula}` : ""}
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

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ folio: string }>("/api/instituto/pacientes", {
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
        },
      });
      onDone(res.folio);
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
            onClick={guardar}
            disabled={busy || !firstName.trim() || !lastName.trim()}
          >
            {busy ? "Registrando…" : "Registrar"}
          </button>
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
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
            onChange={(e) => setFirstName(e.target.value)}
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
            onChange={(e) => setLastName(e.target.value)}
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
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="off"
          />
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
            onChange={(e) => setBirthDate(e.target.value)}
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
        ¿Lo trajo algún alumno?
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

function FichaPaciente({
  patient,
  students,
  canManage,
  canOrigin,
  onClose,
  onDone,
}: {
  patient: EduPatientRow;
  students: EduStudentOption[];
  canManage: boolean;
  canOrigin: boolean;
  onClose: () => void;
  onDone: (mensaje: string) => void;
}) {
  const [data, setData] = useState<FichaData | null>(null);
  const [cargando, setCargando] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState(patient.phone ?? "");
  const [email, setEmail] = useState(patient.email ?? "");
  const [birthDate, setBirthDate] = useState(eduDateInputValue(patient.birthDate));
  const [status, setStatus] = useState<EduPatientStatus>(patient.status);
  const [notes, setNotes] = useState(patient.notes ?? "");
  const [origen, setOrigen] = useState(patient.origin.studentId ?? "");

  // Los casos y las citas llegan en UNA sola respuesta: tres viajes para
  // abrir un modal se notan en el teléfono del piso clínico.
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

  async function guardar() {
    setError(null);
    setBusy(true);
    try {
      // El ORIGEN va por su propio endpoint y su propio permiso: no es un
      // campo más de la ficha, es el que decide el precio.
      if (canOrigin && origen !== (patient.origin.studentId ?? "")) {
        await eduRequest(`/api/instituto/pacientes/${patient.id}/origen`, {
          method: "PATCH",
          body: { referredByStudentId: origen || null },
        });
      }
      if (canManage) {
        await eduRequest(`/api/instituto/pacientes/${patient.id}`, {
          method: "PATCH",
          body: {
            phone: phone.trim() || null,
            email: email.trim() || null,
            birthDate: birthDate || null,
            status,
            notes: notes.trim() || null,
          },
        });
      }
      onDone(`La ficha de ${patient.name} quedó guardada.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  const soloLectura = !canManage && !canOrigin;

  return (
    <EduModal
      title={patient.name}
      subtitle={`Folio ${patient.folio}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button type="button" className="edu-btn edu-btn--ghost" onClick={onClose} disabled={busy}>
            {soloLectura ? "Cerrar" : "Cancelar"}
          </button>
          {!soloLectura && (
            <button type="button" className="edu-btn edu-btn--primary" onClick={guardar} disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </button>
          )}
        </>
      }
    >
      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}

      <div className="edu-kv edu-kv--2">
        <div>
          <span className="edu-kv__k">Sexo</span>
          <span className="edu-kv__v">{EDU_SEX_LABELS[patient.sex]}</span>
        </div>
        <div>
          <span className="edu-kv__k">Edad</span>
          <span className="edu-kv__v">
            {patient.ageYears !== null ? `${patient.ageYears} años` : "—"}
          </span>
        </div>
        <div>
          <span className="edu-kv__k">Registrado</span>
          <span className="edu-kv__v">{formatEduDate(patient.createdAt)}</span>
        </div>
        <div>
          <span className="edu-kv__k">Origen actual</span>
          <span className="edu-kv__v">
            {patient.origin.studentName
              ? `${patient.origin.studentMatricula} · ${patient.origin.studentName}`
              : "Llegó solo"}
            {patient.origin.setByName && (
              <span className="edu-cell__sub">
                {" "}
                Lo marcó {patient.origin.setByName}
                {patient.origin.setAt ? ` el ${formatEduDate(patient.origin.setAt)}` : ""}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-f-tel">
            Teléfono
          </label>
          <input
            id="edu-f-tel"
            className="edu-input"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-f-correo">
            Correo
          </label>
          <input
            id="edu-f-correo"
            className="edu-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-f-nac">
            Nacimiento
          </label>
          <input
            id="edu-f-nac"
            className="edu-input"
            type="date"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            disabled={!canManage}
          />
        </div>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor="edu-f-estado">
            Estado
          </label>
          <select
            id="edu-f-estado"
            className="edu-input"
            value={status}
            onChange={(e) => setStatus(e.target.value as EduPatientStatus)}
            disabled={!canManage}
          >
            {EDU_PATIENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EDU_PATIENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <span className="edu-field__hint">{EDU_PATIENT_STATUS_DESCRIPTIONS[status]}</span>
        </div>
      </div>

      <OrigenField
        value={origen}
        onChange={setOrigen}
        students={students}
        disabled={!canOrigin}
        id="edu-f-origen"
      />

      <div className="edu-field">
        <label className="edu-field__label" htmlFor="edu-f-notas">
          Notas de recepción
        </label>
        <textarea
          id="edu-f-notas"
          className="edu-input"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={!canManage}
        />
      </div>

      <div className="edu-section">
        <div className="edu-section__head">
          <h3 className="edu-section__title">Casos</h3>
          <span className="edu-count">{cargando ? "…" : (data?.cases.length ?? 0)}</span>
        </div>
        {cargando ? (
          <p className="edu-note">Cargando…</p>
        ) : (data?.cases.length ?? 0) === 0 ? (
          <p className="edu-note">
            Sin casos. Un caso se abre en el tamizaje, y es lo que le pone alumno y
            especialidad al paciente.
          </p>
        ) : (
          <ul className="edu-chiplist">
            {data?.cases.map((c) => (
              <li key={c.id} className="edu-assign">
                <span>
                  <strong>{c.programName}</strong> · {c.studentMatricula} ·{" "}
                  {EDU_CASE_STATUS_LABELS[c.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="edu-section">
        <div className="edu-section__head">
          <h3 className="edu-section__title">Últimas citas</h3>
          <span className="edu-count">{cargando ? "…" : (data?.appointments.length ?? 0)}</span>
        </div>
        {cargando ? (
          <p className="edu-note">Cargando…</p>
        ) : (data?.appointments.length ?? 0) === 0 ? (
          <p className="edu-note">Todavía no tiene citas.</p>
        ) : (
          <ul className="edu-chiplist">
            {data?.appointments.slice(0, 8).map((a) => (
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
    </EduModal>
  );
}
