"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_PATIENT_STATUSES,
  EDU_PATIENT_STATUS_DESCRIPTIONS,
  EDU_PATIENT_STATUS_LABELS,
  EDU_SEXES,
  EDU_SEX_LABELS,
  type EduPatientStatus,
} from "@/lib/edu/types";
import {
  EDU_PHONE_HELP,
  eduPatientFormDiff,
  eduPatientFormHasChanges,
  eduPatientFormValues,
  eduPatientStatusConflict,
  eduPhoneWaWarning,
  type EduPatientFormField,
  type EduPatientFormValues,
  type EduPatientRow,
} from "@/lib/edu/pacientes-core";

/**
 * ═══════════════════════════════════════════════════════════════════════
 * EL FORMULARIO DE LA FICHA DEL PACIENTE — UNO SOLO, MONTADO EN DOS SITIOS
 *
 * 🔴 QUÉ ARREGLA (H-01, H-03). Cuatro datos del paciente —nombre,
 * apellidos, folio y sexo— se capturaban en el alta y NO se corregían nunca
 * desde ninguna pantalla. El servidor sabía editarlos desde la Ola 2; no
 * había un solo formulario que se los mandara. Una «Maria Lopes» mal
 * tecleada quedaba impresa para siempre en el expediente, en las cartas
 * NOM-004, en las recetas y en los recibos. Y la pestaña *Datos*, que es
 * adonde va quien quiere corregir, tenía un único botón que llevaba a la
 * LISTA COMPLETA de pacientes, sin folio y sin búsqueda: recepción, que
 * venía de la ficha de P-0412, tenía que volver a teclear el nombre.
 *
 * 🔴 POR QUÉ UN COMPONENTE Y NO DOS FORMULARIOS. La razón por la que la
 * pestaña Datos era de solo lectura estaba escrita y era BUENA: dos
 * formularios para la misma ficha es cómo uno de los dos se queda sin el
 * campo nuevo. Lo que estaba mal no era la decisión, era que el formulario
 * único al que remitía no tenía los nueve campos. Así que la respuesta no
 * es duplicar: es tener una sola DEFINICIÓN —ésta— montada en los dos
 * sitios donde hace falta, el modal de /instituto/pacientes y la pestaña
 * Datos de la ficha. La lista de campos vive todavía un piso más abajo, en
 * `EDU_PATIENT_FORM_FIELDS` (pacientes-core, puro y probado).
 *
 * 🔴 DOS PERMISOS, UN FORMULARIO (H-02). `canManage` abre los nueve campos;
 * `canContacto` abre solo teléfono y correo. Lo que no se puede editar se
 * pinta DESHABILITADO CON EL MOTIVO ESCRITO, nunca escondido — es el patrón
 * del vertical (paciente-whatsapp.tsx): un campo que no está no se puede
 * preguntar por qué no está, y el alumno tiene derecho a ver el folio de su
 * paciente aunque no lo pueda cambiar.
 *
 * 🔴 SOLO VIAJA LO QUE CAMBIÓ (H-10). El PATCH lleva el diff contra la fila
 * que se está editando, no los nueve campos siempre. Sin esto, corregir el
 * correo a las 9:25 reescribía el `status` que la lista pintó a las 9:00 y
 * resucitaba a un paciente que un caso cerrado ya había dado de alta.
 *
 * ⚠️ Esconder un campo NO cierra nada: el PATCH vuelve a exigir las dos
 * llaves en el servidor y `updateEduPatient` rechaza con su motivo un campo
 * que quien manda no puede tocar. Esto es cortesía; el guard es el muro.
 *
 * ⚠️ El ORIGEN no está aquí y no es un olvido: tiene su propio endpoint y
 * su propio permiso (`pacientes.origen`) porque decide el precio. Lo monta
 * quien quiera al lado de este formulario, como hace el modal de la lista.
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface EduPacienteDatosFormProps {
  /** La fila GUARDADA. Es la base del diff: tiene que venir fresca. */
  row: EduPatientRow;
  canManage: boolean;
  canContacto: boolean;
  /** Prefijo de los `id` de los campos: dos montajes en la misma página no
   *  pueden repetir el id de un <label for>. */
  idPrefix: string;
}

/** El estado del formulario, para quien necesita el diff desde fuera (el
 *  modal de la lista, que guarda el contacto y el origen en un solo acto). */
export interface EduPacienteDatosFormState {
  values: EduPatientFormValues;
  set: (campo: EduPatientFormField, valor: string) => void;
  /** SOLO lo que cambió respecto a `row`. Vacío = no hay nada que mandar. */
  diff: Partial<Record<EduPatientFormField, string | null>>;
  hayCambios: boolean;
  /** El motivo por el que el estado elegido choca con los casos, o null. */
  conflictoEstado: string | null;
  /** ¿Se puede pulsar Guardar? */
  puedeGuardar: boolean;
  /** Vuelve a sembrar el formulario con la fila guardada. Lo llama quien
   *  acaba de guardar: es lo que hace que «Guardar cambios» se apague. */
  resembrar: () => void;
}

export function useEduPacienteDatosForm(row: EduPatientRow): EduPacienteDatosFormState {
  // El estado arranca de la fila GUARDADA: el diff se calcula siempre contra
  // la base con la que se pintó, así que no hay forma de mandar un valor
  // "sin cambios" por accidente.
  const [values, setValues] = useState<EduPatientFormValues>(() => eduPatientFormValues(row));
  // ¿La persona tocó algo desde la última siembra? Decide si una fila nueva
  // puede pisar el formulario o no (ver abajo).
  const [sucio, setSucio] = useState(false);

  // 🔴 LA RESIEMBRA, Y SUS DOS CAMINOS. El formulario tiene que acabar
  // enseñando lo que el servidor GUARDÓ, no lo que se tecleó: el teléfono
  // se guarda en diez dígitos y el folio en mayúsculas, así que dejar
  // "55 4433 2211" en la caja contra "5544332211" en la fila dejaría
  // «Guardar cambios» encendido para siempre sobre un cambio que ya
  // ocurrió, con el "Listo" verde al lado.
  //
  //   1. AL GUARDAR — `resembrar()`, explícito, lo llama quien guardó. Es el
  //      que cierra el caso en el que el saneo del servidor NO cambia la
  //      fila (teclear "55 4433 2211" sobre un "5544332211" ya guardado):
  //      ahí la huella de abajo no se entera de nada, porque no hay nada de
  //      qué enterarse.
  //   2. CUANDO LA FILA CAMBIA SOLA — la huella. Después del `router.refresh()`
  //      baja la fila nueva; también baja si otra persona corrigió al
  //      paciente o si un caso cerrado le movió el estado.
  //
  // 🔴 Y el camino 2 NO pisa lo que se está escribiendo. Sin el `sucio`,
  // cualquier repintado —la tarjeta de antecedentes de al lado hace su
  // propio refresh— borraría a media frase la corrección que alguien está
  // tecleando, en silencio. Con él, la fila nueva solo entra en un
  // formulario que nadie ha tocado.
  //
  // Se compara por CONTENIDO y no por referencia: cada repintado del
  // servidor trae un objeto nuevo. Es el patrón de "ajustar el estado
  // cuando cambian las props" durante el render, sin efecto.
  const huella = JSON.stringify(eduPatientFormValues(row));
  const [huellaBase, setHuellaBase] = useState(huella);
  if (huella !== huellaBase) {
    setHuellaBase(huella);
    if (!sucio) setValues(eduPatientFormValues(row));
  }

  const diff = useMemo(() => eduPatientFormDiff(row, values), [row, values]);
  const hayCambios = eduPatientFormHasChanges(diff);

  // 🔴 El choque de estado se comprueba SOLO si el estado está cambiando.
  // Un paciente que ya venía DISCHARGED con casos abiertos (por un dato
  // viejo) no puede quedar atrapado sin poder corregirse el teléfono.
  const conflictoEstado =
    diff.status !== undefined
      ? eduPatientStatusConflict(values.status as EduPatientStatus, row.openCases)
      : null;

  return {
    values,
    set: (campo, valor) => {
      setSucio(true);
      setValues((v) => ({ ...v, [campo]: valor }));
    },
    diff,
    hayCambios,
    conflictoEstado,
    puedeGuardar: hayCambios && !conflictoEstado,
    resembrar: () => {
      setValues(eduPatientFormValues(row));
      setSucio(false);
    },
  };
}

/**
 * Los nueve campos. No trae botón de guardar: lo pone quien lo monta, que
 * es quien sabe si el guardado es de un modal (con su pie) o de una tarjeta
 * dentro de la ficha.
 */
export function EduPacienteDatosFields({
  form,
  canManage,
  canContacto,
  idPrefix,
}: Omit<EduPacienteDatosFormProps, "row"> & { form: EduPacienteDatosFormState }) {
  const { values, set } = form;

  // El motivo, una sola vez y escrito para una persona. Es lo que se pinta
  // debajo del bloque bloqueado en vez de dejar campos grises y mudos.
  const motivoIdentidad = canContacto
    ? "Estos datos los corrige recepción (permiso «pacientes.manage»). Tú puedes corregir el teléfono y el correo, que es lo que se usa para avisarle al paciente."
    : "Tu cuenta no puede corregir la ficha del paciente. Se hace desde recepción.";

  const avisoTelefono = eduPhoneWaWarning(values.phone);

  return (
    <>
      {/* ── Identidad: pacientes.manage ─────────────────────────────── */}
      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor={`${idPrefix}-nombre`}>
            Nombre
          </label>
          <input
            id={`${idPrefix}-nombre`}
            className="edu-input"
            value={values.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            disabled={!canManage}
            autoComplete="off"
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor={`${idPrefix}-apellidos`}>
            Apellidos
          </label>
          <input
            id={`${idPrefix}-apellidos`}
            className="edu-input"
            value={values.lastName}
            onChange={(e) => set("lastName", e.target.value)}
            disabled={!canManage}
            autoComplete="off"
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor={`${idPrefix}-folio`}>
            Folio
          </label>
          <input
            id={`${idPrefix}-folio`}
            className="edu-input"
            value={values.folio}
            onChange={(e) => set("folio", e.target.value)}
            disabled={!canManage}
            autoComplete="off"
          />
          {canManage && (
            <span className="edu-field__hint">
              Es el número con el que este paciente aparece en el expediente de papel. Cambiarlo
              lo cambia en toda la clínica; dos pacientes no pueden llevar el mismo.
            </span>
          )}
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor={`${idPrefix}-sexo`}>
            Sexo
          </label>
          <select
            id={`${idPrefix}-sexo`}
            className="edu-input"
            value={values.sex}
            onChange={(e) => set("sex", e.target.value)}
            disabled={!canManage}
          >
            {EDU_SEXES.map((s) => (
              <option key={s} value={s}>
                {EDU_SEX_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor={`${idPrefix}-nac`}>
            Nacimiento
          </label>
          <input
            id={`${idPrefix}-nac`}
            className="edu-input"
            type="date"
            value={values.birthDate}
            onChange={(e) => set("birthDate", e.target.value)}
            disabled={!canManage}
          />
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor={`${idPrefix}-estado`}>
            Estado
          </label>
          <select
            id={`${idPrefix}-estado`}
            className="edu-input"
            value={values.status}
            onChange={(e) => set("status", e.target.value)}
            disabled={!canManage}
          >
            {EDU_PATIENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {EDU_PATIENT_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <span className="edu-field__hint">
            {EDU_PATIENT_STATUS_DESCRIPTIONS[values.status as EduPatientStatus]}
          </span>
        </div>
      </div>

      {/* 🔴 H-28 · el estado no puede contradecir los casos, y se dice AQUÍ,
          debajo del campo, en cuanto se elige — no al pulsar Guardar. El
          servidor lo vuelve a comprobar al guardar con esta misma frase. */}
      {form.conflictoEstado && (
        <p className="edu-fichaform__motivo edu-fichaform__motivo--alto" role="alert">
          {form.conflictoEstado}
        </p>
      )}

      {!canManage && <p className="edu-fichaform__motivo">{motivoIdentidad}</p>}

      {/* ── Contacto: pacientes.manage O expediente.write ───────────── */}
      <div className="edu-formgrid edu-formgrid--2">
        <div className="edu-field">
          <label className="edu-field__label" htmlFor={`${idPrefix}-tel`}>
            Teléfono
          </label>
          <input
            id={`${idPrefix}-tel`}
            className="edu-input"
            type="tel"
            inputMode="tel"
            value={values.phone}
            onChange={(e) => set("phone", e.target.value)}
            disabled={!canContacto}
            autoComplete="off"
          />
          {/* 🔴 H-09 · el aviso se pinta DONDE SE EDITA, no en la pestaña
              WhatsApp (que es adonde se llega cuando ya es tarde). El
              criterio es `eduWaPhone`, el mismo que decide si Meta puede
              entregar: no hay dos reglas del teléfono en este vertical. */}
          {avisoTelefono ? (
            <span className="edu-fichaform__chip" role="status">
              {avisoTelefono}
            </span>
          ) : (
            canContacto && <span className="edu-field__hint">{EDU_PHONE_HELP}</span>
          )}
        </div>

        <div className="edu-field">
          <label className="edu-field__label" htmlFor={`${idPrefix}-correo`}>
            Correo
          </label>
          <input
            id={`${idPrefix}-correo`}
            className="edu-input"
            type="email"
            value={values.email}
            onChange={(e) => set("email", e.target.value)}
            disabled={!canContacto}
            autoComplete="off"
          />
        </div>
      </div>

      {!canContacto && (
        <p className="edu-fichaform__motivo">
          Tu cuenta no puede corregir el contacto del paciente. Lo hace recepción, o quien tenga
          al paciente en el sillón.
        </p>
      )}

      {/* ── Notas de recepción: pacientes.manage ────────────────────── */}
      <div className="edu-field">
        <label className="edu-field__label" htmlFor={`${idPrefix}-notas`}>
          Notas de recepción
        </label>
        <textarea
          id={`${idPrefix}-notas`}
          className="edu-input"
          rows={3}
          value={values.notes}
          onChange={(e) => set("notes", e.target.value)}
          disabled={!canManage}
          placeholder="Lo que haya que saber antes de sentarlo. No es historia clínica."
        />
        <span className="edu-field__hint">
          No son notas clínicas: ésas van al Expediente, con autor, estado y firma.
        </span>
      </div>
    </>
  );
}

/**
 * El formulario COMPLETO con su propio botón de guardar, para montarlo
 * dentro de una página (la pestaña *Datos*).
 *
 * El modal de la lista NO usa esta envoltura: tiene su propio pie y guarda
 * el origen en el mismo acto, así que monta el hook y los campos por
 * separado. Los campos, y por tanto la lista de los nueve, son los mismos.
 */
export function EduPacienteDatosCard({
  row,
  canManage,
  canContacto,
  idPrefix,
}: EduPacienteDatosFormProps) {
  const router = useRouter();
  const form = useEduPacienteDatosForm(row);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const soloLectura = !canManage && !canContacto;

  async function guardar() {
    setError(null);
    setFlash(null);
    setBusy(true);
    try {
      await eduRequest(`/api/instituto/pacientes/${row.id}`, {
        method: "PATCH",
        body: form.diff,
      });
      setFlash("Listo: la ficha quedó corregida.");
      // Lo tecleado se reemplaza por lo GUARDADO. Va antes del refresh y no
      // después: el refresh es asíncrono, y sin esto el formulario se queda
      // con el texto crudo y «Guardar cambios» encendido cuando el saneo del
      // servidor no cambió la fila (teclear un teléfono con espacios sobre
      // el mismo teléfono ya guardado).
      form.resembrar();
      // La página es de servidor: el refresh es lo que vuelve a pintar el
      // encabezado de la ficha (nombre, folio, edad) con lo recién guardado.
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="edu-section">
      <div className="edu-section__head">
        <div>
          <h2 className="edu-section__title">Datos del paciente</h2>
          <p className="edu-section__lead">
            {soloLectura
              ? "Así quedó capturado. Corregirlo lo hace recepción."
              : "Se corrige aquí mismo. Solo se guarda lo que cambies."}
          </p>
        </div>
      </div>

      {error && (
        <div className="edu-alert" role="alert">
          {error}
        </div>
      )}
      {flash && (
        <div className="edu-alert edu-alert--ok" role="status">
          {flash}
        </div>
      )}

      <EduPacienteDatosFields
        form={form}
        canManage={canManage}
        canContacto={canContacto}
        idPrefix={idPrefix}
      />

      {!soloLectura && (
        <div className="edu-actions">
          <button
            type="button"
            className="edu-btn edu-btn--primary"
            onClick={guardar}
            disabled={busy || !form.puedeGuardar}
          >
            {busy ? "Guardando…" : "Guardar cambios"}
          </button>
          {/* El botón deshabilitado dice POR QUÉ. Un "Guardar" gris sin
              motivo se lee como una pantalla rota. */}
          {!form.hayCambios && !busy && (
            <span className="edu-fichaform__motivo">No has cambiado nada todavía.</span>
          )}
        </div>
      )}
    </section>
  );
}
