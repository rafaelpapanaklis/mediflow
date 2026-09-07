"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { eduRequest } from "@/components/edu/edu-http";
import {
  EDU_CONTACT_PREFERENCES,
  EDU_CONTACT_PREFERENCE_LABELS,
  EDU_HABIT_LEVELS,
  EDU_HABIT_LEVEL_LABELS,
  EDU_PATIENT_STATUSES,
  EDU_PATIENT_STATUS_DESCRIPTIONS,
  EDU_PATIENT_STATUS_LABELS,
  EDU_PREGNANCY_LABELS,
  EDU_PREGNANCY_VALUES,
  EDU_SEXES,
  EDU_SEX_LABELS,
  type EduPatientStatus,
} from "@/lib/edu/types";
import {
  EDU_CURP_HELP,
  EDU_PHONE_HELP,
  eduCurpWarning,
  eduPatientFormDiff,
  eduPatientFormFieldError,
  eduPatientFormHasChanges,
  eduPatientFormValues,
  eduPatientStatusConflict,
  eduPatientTutorConflictOnSave,
  eduPatientTutorWarning,
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
 * NOM-004, en las recetas y en los recibos.
 *
 * 🔴 Y QUÉ ARREGLA LA OLA B (ws2-t3): «al abrir el perfil del paciente
 * faltan muchos datos y funciones reales que los dentistas necesitan». Los
 * NUEVE campos son 31: el TUTOR del menor (que vivía en cada carta de
 * consentimiento y había que teclear otra vez en cada una), el DOMICILIO,
 * el SEGURO, el SEGUNDO TELÉFONO (que acababa dentro de las notas, donde
 * ningún recordatorio lo ve), el CURP, los dos antecedentes que la NOM-004
 * pide POR SEPARADO —heredofamiliares y personales no patológicos—, los
 * HÁBITOS, el EMBARAZO (la columna que permite alertar antes de una
 * radiografía), la DENTICIÓN TEMPORAL y la fecha del AVISO DE PRIVACIDAD.
 *
 * 🔴 POR QUÉ UN COMPONENTE Y NO DOS FORMULARIOS. La razón por la que la
 * pestaña Datos era de solo lectura estaba escrita y era BUENA: dos
 * formularios para la misma ficha es cómo uno de los dos se queda sin el
 * campo nuevo. Lo que estaba mal no era la decisión, era que el formulario
 * único al que remitía no tenía los campos. Así que la respuesta no es
 * duplicar: es tener una sola DEFINICIÓN —ésta— montada en los dos sitios
 * donde hace falta, el modal de /instituto/pacientes y la pestaña Datos de
 * la ficha. La lista de campos vive todavía un piso más abajo, en
 * `EDU_PATIENT_FORM_FIELDS` (pacientes-core, puro y probado).
 *
 * 🔴 TRES GRUPOS DE PERMISO, UN FORMULARIO (H-02 + Ola B):
 *   · `canManage`  (`pacientes.manage`) → identidad, domicilio, tutor,
 *     seguro, estado, notas y aviso de privacidad.
 *   · `canContacto`(manage o `expediente.write`) → los dos teléfonos, el
 *     correo y la preferencia de contacto.
 *   · `canClinico` (manage o `expediente.write`) → NOM-004, hábitos,
 *     embarazo/lactancia y dentición temporal. La MISMA llave que ya abre
 *     los antecedentes médicos, porque son el mismo bloque de historia
 *     clínica partido por una norma.
 * Lo que no se puede editar se pinta DESHABILITADO CON EL MOTIVO ESCRITO,
 * nunca escondido — es el patrón del vertical (paciente-whatsapp.tsx): un
 * campo que no está no se puede preguntar por qué no está.
 *
 * 🔴 «SIN REGISTRAR» NO ES UNA RESPUESTA. Los cinco desplegables de enum
 * (embarazo, preferencia de contacto y los tres hábitos) tienen una opción
 * vacía que dice «Sin registrar» y ES el `null` de la columna: nadie
 * preguntó. Elegir «No lo sabe» escribe `DESCONOCIDO`, que es otra cosa —
 * alguien preguntó y el paciente no lo sabe— y elegir «No» es una tercera.
 * Aplastar las tres en una pierde justo la distinción que evita el chip
 * verde mentiroso, que es el mismo error que `historyRecordedAt` existe
 * para no cometer con los antecedentes.
 *
 * 🔴 SOLO VIAJA LO QUE CAMBIÓ (H-10). El PATCH lleva el diff contra la fila
 * que se está editando, no los 31 campos siempre. Sin esto, corregir el
 * correo a las 9:25 reescribía el `status` que la lista pintó a las 9:00 y
 * resucitaba a un paciente que un caso cerrado ya había dado de alta. Con
 * 31 campos el riesgo se multiplica: un PATCH completo borraría el embarazo
 * que otra persona acaba de capturar.
 *
 * ⚠️ Esconder un campo NO cierra nada: el PATCH vuelve a exigir las llaves
 * en el servidor y `updateEduPatient` rechaza con su motivo un campo que
 * quien manda no puede tocar. Esto es cortesía; el guard es el muro.
 *
 * ⚠️ El ORIGEN no está aquí y no es un olvido: tiene su propio endpoint y
 * su propio permiso (`pacientes.origen`) porque decide el precio. Lo monta
 * quien quiera al lado de este formulario, como hace el modal de la lista.
 * ═══════════════════════════════════════════════════════════════════════
 */

export interface EduPacienteDatosFormProps {
  /** La fila GUARDADA. Es la base del diff: tiene que venir fresca. */
  row: EduPatientRow;
  /**
   * H-12b · «Última corrección: <quién> · <cuándo>», con el CUÁNDO ya
   * formateado en el servidor con la zona del instituto.
   *
   * 🔴 LLEGA HECHO Y NO SE FORMATEA AQUÍ, por dos razones que van juntas:
   * `updatedAt` es un INSTANTE (no una fecha de calendario), así que
   * necesita hora y zona —dos correcciones de la misma tarde tienen que
   * poder distinguirse, y una de las 19:30 en México no puede salir con la
   * fecha del día siguiente—; y formatearlo en el navegador con la zona
   * local haría que el servidor y el cliente pintaran cadenas distintas, que
   * es un aviso de hidratación de React en la única línea de esta pantalla
   * cuyo trabajo es decir la verdad sobre quién y cuándo.
   */
  rastroLabel?: string;
  canManage: boolean;
  canContacto: boolean;
  /** ¿Puede escribir los antecedentes NOM-004, los hábitos, el embarazo y
   *  la dentición? Es `pacientes.manage` o `expediente.write`, la misma
   *  llave que ya abre los antecedentes médicos. */
  canClinico: boolean;
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
  /** El motivo por el que ESTE guardado deja a un menor sin tutor, o null. */
  conflictoTutor: string | null;
  /**
   * El motivo por el que un campo que VIAJA en este guardado lo haría
   * rebotar entero (CURP, código postal, teléfonos), o null (N-16).
   */
  errorCampo: string | null;
  /** ¿Se puede pulsar Guardar? */
  puedeGuardar: boolean;
  /**
   * Vuelve a sembrar el formulario con la fila GUARDADA. Lo llama quien
   * acaba de guardar: es lo que hace que «Guardar cambios» se apague.
   *
   * 🔴 N-16 · RECIBE LA FILA, y ése es el arreglo. Sin argumento se sembraba
   * con la `row` de las props —la de ANTES de guardar—, así que bajo el
   * «Listo» verde seguían los valores viejos hasta que aterrizaba el
   * `router.refresh()`. Y el saneo del servidor no es cosmético: el
   * teléfono vuelve en diez dígitos, el folio en mayúsculas y el CURP sin
   * espacios. Quien guarda pasa la fila que el servidor acaba de devolver.
   */
  resembrar: (fila?: EduPatientRow) => void;
}

export function useEduPacienteDatosForm(row: EduPatientRow): EduPacienteDatosFormState {
  // El estado arranca de la fila GUARDADA: el diff se calcula siempre contra
  // la base con la que se pintó, así que no hay forma de mandar un valor
  // "sin cambios" por accidente.
  const [values, setValues] = useState<EduPatientFormValues>(() => eduPatientFormValues(row));
  // ¿La persona tocó algo desde la última siembra? Decide si una fila nueva
  // puede pisar el formulario o no (ver abajo).
  const [sucio, setSucio] = useState(false);

  // ═════════════════════════════════════════════════════════════════════
  // 🔴 LA BASE DEL DIFF VIAJA CON LO TECLEADO, Y NO CON LA FILA VIVA.
  //
  // El diff se calcula contra la fila con la que se SEMBRÓ el formulario,
  // no contra la que el servidor acaba de mandar. Sin esta pareja, las dos
  // mitades se desincronizan en cuanto el formulario está sucio y llega una
  // fila nueva —y llega sola: la tarjeta de antecedentes de al lado y la
  // barra de acciones de arriba hacen su propio `router.refresh()`—:
  //
  //   1. recepción abre Datos y empieza a teclear el segundo teléfono;
  //   2. otra persona captura el embarazo y el tutor del paciente;
  //   3. baja la fila nueva; `values` se conserva (bien: no se pisa lo que
  //      alguien está escribiendo), pero si el diff se calculara contra la
  //      fila NUEVA, el embarazo pasaría a ser "antes EMBARAZO, ahora ''"…
  //   4. …y «Guardar» mandaría `pregnancy: null` y `guardianName: null`.
  //      Se borran los dos, sin un error, sin que nadie lo vea.
  //
  // Con la base congelada, esos dos campos valen lo mismo en la base y en
  // lo tecleado, así que NO viajan y lo que la otra persona guardó
  // sobrevive. Es la regla de H-10 llevada hasta el final: solo viaja lo
  // que ESTA persona cambió.
  //
  // ⚠️ Con 31 campos esto dejó de ser teórico. Con nueve, lo peor que se
  // revertía era un teléfono que alguien recordaba; entre los 31 están el
  // embarazo, el tutor, el CURP y el domicilio, que no se reconstruyen de
  // memoria.
  // ═════════════════════════════════════════════════════════════════════
  const [base, setBase] = useState<EduPatientRow>(row);

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
    // La base y lo tecleado se mueven JUNTOS o no se mueven: son las dos
    // mitades del mismo diff.
    if (!sucio) {
      setValues(eduPatientFormValues(row));
      setBase(row);
    }
  }

  const diff = useMemo(() => eduPatientFormDiff(base, values), [base, values]);
  const hayCambios = eduPatientFormHasChanges(diff);

  // 🔴 El choque de estado se comprueba SOLO si el estado está cambiando.
  // Un paciente que ya venía DISCHARGED con casos abiertos (por un dato
  // viejo) no puede quedar atrapado sin poder corregirse el teléfono.
  //
  // Los casos se cuentan sobre la fila VIVA y no sobre la base: si alguien
  // acaba de abrirle un caso al paciente, el aviso tiene que aparecer ya —
  // el servidor lo va a rebotar de todas formas, y enterarse antes de
  // pulsar es mejor que enterarse después.
  const conflictoEstado =
    diff.status !== undefined
      ? eduPatientStatusConflict(values.status as EduPatientStatus, row.openCases)
      : null;

  // 🔴 H-08 · lo mismo con el TUTOR, y por la misma razón. Solo muerde si
  // este guardado toca el nacimiento o borra el tutor: en la base hay
  // menores registrados antes de que existiera la columna, y bloquear
  // cualquier guardado suyo dejaría a recepción sin poder corregirles un
  // apellido. El servidor aplica esta MISMA función al guardar.
  const conflictoTutor = useMemo(
    () => eduPatientTutorConflictOnSave(base, diff),
    [base, diff],
  );

  // 🔴 N-16 · LOS CAMPOS QUE EL SERVIDOR REBOTA PARAN EL GUARDADO AQUÍ.
  // El CURP, el código postal y los dos teléfonos solo avisaban en ámbar y
  // dejaban pulsar Guardar. Y el PATCH es ATÓMICO: un CURP de 17
  // caracteres tumbaba el apellido corregido y el domicilio recién
  // capturado, y el error que subía hablaba solo del CURP. Se mira el DIFF
  // —lo que de verdad viaja—, así que un dato viejo malo que nadie está
  // tocando no atrapa a nadie.
  const errorCampo = useMemo(() => eduPatientFormFieldError(diff), [diff]);

  return {
    values,
    set: (campo, valor) => {
      setSucio(true);
      setValues((v) => ({ ...v, [campo]: valor }));
    },
    diff,
    hayCambios,
    conflictoEstado,
    conflictoTutor,
    errorCampo,
    puedeGuardar: hayCambios && !conflictoEstado && !conflictoTutor && !errorCampo,
    resembrar: (fila?: EduPatientRow) => {
      // La fila que el servidor acaba de guardar si la hay; la de las props
      // si quien llama no la tiene (el `router.refresh()` la traerá).
      const semilla = fila ?? row;
      setValues(eduPatientFormValues(semilla));
      setBase(semilla);
      setSucio(false);
    },
  };
}

/**
 * HOY, en la fecha del RELOJ DE QUIEN ESTÁ CAPTURANDO.
 *
 * 🔴 Y no `new Date().toISOString().slice(0,10)`, que es UTC: a las 19:00
 * en Ciudad de México (UTC−6) eso da MAÑANA, y el aviso de privacidad
 * quedaría fechado un día después de que el paciente lo firmó. El servidor
 * tampoco lo atraparía —su check de "no en el futuro" compara contra el
 * mismo instante UTC—, así que el dato malo se guardaría sin más.
 *
 * Se usa la fecha local del navegador y no la del instituto a propósito:
 * es exactamente la que el `<input type="date">` de al lado enseña y con la
 * que la persona compara, y traerla de la sesión habría exigido bajar la
 * zona horaria hasta aquí para ganar, como mucho, el caso raro de alguien
 * capturando desde otro huso.
 */
function eduHoyLocal(): string {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

// ═══════════════════════════════════════════════════════════════════════
// Las piezas sueltas: un grupo con cabecera, un campo de texto, un enum.
//
// Existen para que los 31 campos no sean 900 líneas de JSX copiado. Cada
// una recibe `disabled` ya resuelto: la decisión de permisos se toma UNA
// vez arriba, y aquí abajo solo se pinta.
// ═══════════════════════════════════════════════════════════════════════

function Grupo({
  titulo,
  lead,
  motivo,
  children,
}: {
  titulo: string;
  lead?: string;
  /** El porqué de que este bloque esté en gris. Null = se puede editar. */
  motivo?: string | null;
  children: React.ReactNode;
}) {
  return (
    <section className="edu-fichab-grupo">
      <h3 className="edu-fichab-grupo__title">{titulo}</h3>
      {lead && <p className="edu-fichab-grupo__lead">{lead}</p>}
      {children}
      {motivo && <p className="edu-fichaform__motivo">{motivo}</p>}
    </section>
  );
}

function Texto({
  id,
  label,
  value,
  onChange,
  disabled,
  hint,
  aviso,
  type = "text",
  inputMode,
  maxLength,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  hint?: string;
  /** Un chip ámbar bajo el campo: lo que YA está guardado y no cuadra. */
  aviso?: string | null;
  type?: string;
  inputMode?: "text" | "tel" | "numeric";
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <div className="edu-field">
      <label className="edu-field__label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="edu-input"
        type={type}
        inputMode={inputMode}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        autoComplete="off"
      />
      {aviso ? (
        <span className="edu-fichaform__chip" role="status">
          {aviso}
        </span>
      ) : (
        hint && !disabled && <span className="edu-field__hint">{hint}</span>
      )}
    </div>
  );
}

function Area({
  id,
  label,
  value,
  onChange,
  disabled,
  hint,
  rows = 3,
  maxLength,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  hint?: string;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <div className="edu-field">
      <label className="edu-field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        id={id}
        className="edu-input"
        rows={rows}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
      {hint && <span className="edu-field__hint">{hint}</span>}
    </div>
  );
}

/**
 * Un desplegable de enum con su opción «Sin registrar».
 *
 * 🔴 LA OPCIÓN VACÍA VA SIEMPRE Y DICE «Sin registrar», no «—» ni
 * «Ninguno». Es el `null` de la columna: *nadie preguntó*. Un «Ninguno»
 * ahí arriba se leería como una respuesta del paciente, que es exactamente
 * la confusión que estas columnas se diseñaron para evitar — y en el caso
 * de la preferencia de contacto hay literalmente un valor `NINGUNO` que
 * SÍ es una respuesta («no quiere que le escriban»), así que llamarlos
 * igual sería garantizar el error.
 */
function Enumo({
  id,
  label,
  value,
  onChange,
  disabled,
  valores,
  etiquetas,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  valores: readonly string[];
  etiquetas: Record<string, string>;
  hint?: string;
}) {
  return (
    <div className="edu-field">
      <label className="edu-field__label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="edu-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      >
        <option value="">Sin registrar</option>
        {valores.map((v) => (
          <option key={v} value={v}>
            {etiquetas[v]}
          </option>
        ))}
      </select>
      {hint && <span className="edu-field__hint">{hint}</span>}
    </div>
  );
}

/**
 * Los 31 campos. No trae botón de guardar: lo pone quien lo monta, que
 * es quien sabe si el guardado es de un modal (con su pie) o de una tarjeta
 * dentro de la ficha.
 */
export function EduPacienteDatosFields({
  form,
  canManage,
  canContacto,
  canClinico,
  idPrefix,
  row,
}: Omit<EduPacienteDatosFormProps, "row"> & {
  form: EduPacienteDatosFormState;
  /** La fila guardada, SOLO para los avisos que dependen de lo que ya está
   *  en la base (menor sin tutor). Lo que se edita sale de `form.values`. */
  row: EduPatientRow;
}) {
  const { values, set } = form;
  const id = (n: string) => `${idPrefix}-${n}`;

  // Los motivos, una sola vez y escritos para una persona. Es lo que se
  // pinta debajo del bloque bloqueado en vez de dejar campos grises y mudos.
  const motivoIdentidad = !canManage
    ? canContacto
      ? "Estos datos los corrige recepción (permiso «pacientes.manage»). Tú puedes corregir el contacto del paciente y sus antecedentes clínicos."
      : "Tu cuenta no puede corregir la ficha del paciente. Se hace desde recepción."
    : null;
  const motivoContacto = !canContacto
    ? "Tu cuenta no puede corregir el contacto del paciente. Lo hace recepción, o quien tenga al paciente en el sillón."
    : null;
  const motivoClinico = !canClinico
    ? "Estos datos los captura quien hace la historia clínica (permiso «expediente.write») o recepción. Es la misma llave que abre los antecedentes médicos."
    : null;

  const avisoTelefono = eduPhoneWaWarning(values.phone);
  const avisoTelefono2 = eduPhoneWaWarning(values.phone2);
  const avisoCurp = eduCurpWarning(values.curp);

  // 🔴 H-08 · el aviso de menor sin tutor se pinta SIEMPRE que lo sea, no
  // solo cuando el guardado lo bloquea. La edad sale de la fila guardada
  // (`row.ageYears`) mezclada con lo que se está escribiendo en el tutor:
  // rellenar el nombre del tutor tiene que apagar el aviso sin recargar.
  const avisoTutor = eduPatientTutorWarning({
    ageYears: row.ageYears,
    guardianName: values.guardianName || null,
  });

  return (
    <>
      {/* ══ IDENTIDAD ═══════════════════════════════════════════════ */}
      <Grupo
        titulo="Identidad"
        lead="Quién es. Es lo que sale impreso en el expediente, en las cartas NOM-004, en las recetas y en los recibos."
        motivo={motivoIdentidad}
      >
        <div className="edu-formgrid edu-formgrid--2">
          <Texto
            id={id("nombre")}
            label="Nombre"
            value={values.firstName}
            onChange={(v) => set("firstName", v)}
            disabled={!canManage}
            maxLength={80}
          />
          <Texto
            id={id("apellidos")}
            label="Apellidos"
            value={values.lastName}
            onChange={(v) => set("lastName", v)}
            disabled={!canManage}
            maxLength={80}
          />
          <Texto
            id={id("folio")}
            label="Folio"
            value={values.folio}
            onChange={(v) => set("folio", v)}
            disabled={!canManage}
            maxLength={30}
            hint="Es el número con el que este paciente aparece en el expediente de papel. Cambiarlo lo cambia en toda la clínica; dos pacientes no pueden llevar el mismo."
          />
          <div className="edu-field">
            <label className="edu-field__label" htmlFor={id("sexo")}>
              Sexo
            </label>
            <select
              id={id("sexo")}
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
          <Texto
            id={id("nac")}
            label="Nacimiento"
            type="date"
            value={values.birthDate}
            onChange={(v) => set("birthDate", v)}
            disabled={!canManage}
            hint="Decide la edad que sale impresa en una carta de consentimiento — y si el sistema exige tutor."
          />
          <Texto
            id={id("curp")}
            label="CURP"
            value={values.curp}
            onChange={(v) => set("curp", v.toUpperCase())}
            disabled={!canManage}
            maxLength={18}
            hint={EDU_CURP_HELP}
            aviso={avisoCurp}
          />
        </div>
      </Grupo>

      {/* ══ CONTACTO ════════════════════════════════════════════════ */}
      <Grupo
        titulo="Contacto"
        lead="Por dónde se le avisa. Un teléfono mal capturado deja muerto el recordatorio de la cita, la carta de consentimiento y el recibo, en silencio."
        motivo={motivoContacto}
      >
        <div className="edu-formgrid edu-formgrid--2">
          <Texto
            id={id("tel")}
            label="Teléfono"
            type="tel"
            inputMode="tel"
            value={values.phone}
            onChange={(v) => set("phone", v)}
            disabled={!canContacto}
            hint={EDU_PHONE_HELP}
            /* 🔴 H-09 · el aviso se pinta DONDE SE EDITA, no en la pestaña
               WhatsApp (que es adonde se llega cuando ya es tarde). El
               criterio es `eduWaPhone`, el mismo que decide si Meta puede
               entregar: no hay dos reglas del teléfono en este vertical. */
            aviso={avisoTelefono}
          />
          <Texto
            id={id("tel2")}
            label="Segundo teléfono"
            type="tel"
            inputMode="tel"
            value={values.phone2}
            onChange={(v) => set("phone2", v)}
            disabled={!canContacto}
            hint="Casa, trabajo o recado. Antes acababa dentro de las notas, donde ningún recordatorio lo ve."
            aviso={avisoTelefono2}
          />
          <Texto
            id={id("correo")}
            label="Correo"
            type="email"
            value={values.email}
            onChange={(v) => set("email", v)}
            disabled={!canContacto}
          />
          <Enumo
            id={id("pref")}
            label="Prefiere que le contacten por"
            value={values.contactPreference}
            onChange={(v) => set("contactPreference", v)}
            disabled={!canContacto}
            valores={EDU_CONTACT_PREFERENCES}
            etiquetas={EDU_CONTACT_PREFERENCE_LABELS}
            hint="«Sin registrar» es que nadie se lo preguntó. «No quiere que le contacten» es una respuesta suya, y se respeta."
          />
        </div>
      </Grupo>

      {/* ══ DOMICILIO ═══════════════════════════════════════════════ */}
      <Grupo
        titulo="Domicilio"
        lead="En cinco campos y no en una línea de texto: la ciudad y el código postal son lo único que una escuela agrupa después."
        motivo={motivoIdentidad}
      >
        <Texto
          id={id("calle")}
          label="Calle y número"
          value={values.addressStreet}
          onChange={(v) => set("addressStreet", v)}
          disabled={!canManage}
          maxLength={200}
        />
        <div className="edu-formgrid edu-formgrid--2">
          <Texto
            id={id("colonia")}
            label="Colonia"
            value={values.addressNeighborhood}
            onChange={(v) => set("addressNeighborhood", v)}
            disabled={!canManage}
            maxLength={120}
          />
          <Texto
            id={id("ciudad")}
            label="Ciudad o municipio"
            value={values.addressCity}
            onChange={(v) => set("addressCity", v)}
            disabled={!canManage}
            maxLength={120}
          />
          <Texto
            id={id("estado-dom")}
            label="Estado"
            value={values.addressState}
            onChange={(v) => set("addressState", v)}
            disabled={!canManage}
            maxLength={120}
          />
          <Texto
            id={id("cp")}
            label="Código postal"
            inputMode="numeric"
            value={values.addressZip}
            onChange={(v) => set("addressZip", v.replace(/\D/g, "").slice(0, 5))}
            disabled={!canManage}
            maxLength={5}
            hint="Cinco dígitos."
          />
        </div>
      </Grupo>

      {/* ══ TUTOR / REPRESENTANTE LEGAL (H-08) ══════════════════════ */}
      <Grupo
        titulo="Tutor o representante legal"
        lead="Quién firma por el paciente cuando no puede hacerlo él. Se precarga solo en cada carta de consentimiento: antes había que teclearlo entero en cada una."
        motivo={motivoIdentidad}
      >
        {/* 🔴 El aviso va ARRIBA del bloque y en rojo: es la diferencia
            entre una carta de consentimiento que vale y una que no. */}
        {avisoTutor && (
          <div className="edu-alert" role="alert">
            {avisoTutor}
          </div>
        )}
        <div className="edu-formgrid edu-formgrid--2">
          <Texto
            id={id("tutor")}
            label="Nombre del tutor"
            value={values.guardianName}
            onChange={(v) => set("guardianName", v)}
            disabled={!canManage}
            maxLength={160}
          />
          <Texto
            id={id("tutor-rel")}
            label="Parentesco"
            value={values.guardianRelation}
            onChange={(v) => set("guardianRelation", v)}
            disabled={!canManage}
            maxLength={60}
            placeholder="Madre, padre, tutor…"
          />
          <Texto
            id={id("tutor-tel")}
            label="Teléfono del tutor"
            type="tel"
            inputMode="tel"
            value={values.guardianPhone}
            onChange={(v) => set("guardianPhone", v)}
            disabled={!canManage}
            hint="Aquí no se piden diez dígitos exactos: al tutor se le LLAMA, y un número de casa o con extensión sirve igual."
          />
        </div>
      </Grupo>

      {/* ══ SEGURO ══════════════════════════════════════════════════ */}
      <Grupo titulo="Seguro o convenio" motivo={motivoIdentidad}>
        <div className="edu-formgrid edu-formgrid--2">
          <Texto
            id={id("seguro")}
            label="Aseguradora o convenio"
            value={values.insuranceProvider}
            onChange={(v) => set("insuranceProvider", v)}
            disabled={!canManage}
            maxLength={120}
          />
          <Texto
            id={id("poliza")}
            label="Número de póliza"
            value={values.insurancePolicy}
            onChange={(v) => set("insurancePolicy", v)}
            disabled={!canManage}
            maxLength={60}
          />
        </div>
      </Grupo>

      {/* ══ ANTECEDENTES NOM-004 ════════════════════════════════════ */}
      <Grupo
        titulo="Antecedentes (NOM-004)"
        lead="Los HEREDOFAMILIARES y los PERSONALES NO PATOLÓGICOS. La norma los pide por separado de los patológicos, que se capturan arriba, en la tarjeta de antecedentes médicos."
        motivo={motivoClinico}
      >
        <Area
          id={id("heredo")}
          label="Heredofamiliares"
          value={values.familyHistory}
          onChange={(v) => set("familyHistory", v)}
          disabled={!canClinico}
          maxLength={2000}
          rows={3}
          placeholder="Diabetes en la línea materna, hipertensión del padre…"
          hint="Lo que hay en la familia y puede explicar lo que ves en la boca."
        />
        <Area
          id={id("nopat")}
          label="Personales no patológicos"
          value={values.personalNonPathologicalHistory}
          onChange={(v) => set("personalNonPathologicalHistory", v)}
          disabled={!canClinico}
          maxLength={2000}
          rows={3}
          placeholder="Higiene bucal, alimentación, vivienda, ocupación…"
        />
      </Grupo>

      {/* ══ HÁBITOS ═════════════════════════════════════════════════ */}
      <Grupo
        titulo="Hábitos"
        lead="Con cuánta frecuencia, no en palabras: lo que se escribe a mano no se puede filtrar ni alertar. El detalle va en la nota de al lado."
        motivo={motivoClinico}
      >
        <div className="edu-formgrid edu-formgrid--2">
          <Enumo
            id={id("tabaco")}
            label="Tabaco"
            value={values.habitsTobacco}
            onChange={(v) => set("habitsTobacco", v)}
            disabled={!canClinico}
            valores={EDU_HABIT_LEVELS}
            etiquetas={EDU_HABIT_LEVEL_LABELS}
          />
          <Enumo
            id={id("alcohol")}
            label="Alcohol"
            value={values.habitsAlcohol}
            onChange={(v) => set("habitsAlcohol", v)}
            disabled={!canClinico}
            valores={EDU_HABIT_LEVELS}
            etiquetas={EDU_HABIT_LEVEL_LABELS}
          />
          <Enumo
            id={id("bruxismo")}
            label="Bruxismo"
            value={values.habitsBruxism}
            onChange={(v) => set("habitsBruxism", v)}
            disabled={!canClinico}
            valores={EDU_HABIT_LEVELS}
            etiquetas={EDU_HABIT_LEVEL_LABELS}
          />
        </div>
        <Area
          id={id("habitos-notas")}
          label="Notas sobre los hábitos"
          value={values.habitsNotes}
          onChange={(v) => set("habitsNotes", v)}
          disabled={!canClinico}
          maxLength={500}
          rows={2}
          placeholder="Cuántos cigarros al día, desde cuándo, si usa guarda…"
        />
      </Grupo>

      {/* ══ EMBARAZO Y DENTICIÓN ════════════════════════════════════ */}
      <Grupo
        titulo="Embarazo, lactancia y dentición"
        lead="El embarazo es la columna que permite avisar ANTES de una radiografía; hasta ahora eso cabía a mano en las notas y nadie lo podía filtrar."
        motivo={motivoClinico}
      >
        <div className="edu-formgrid edu-formgrid--2">
          <Enumo
            id={id("embarazo")}
            label="Embarazo o lactancia"
            value={values.pregnancy}
            onChange={(v) => set("pregnancy", v)}
            disabled={!canClinico}
            valores={EDU_PREGNANCY_VALUES}
            etiquetas={EDU_PREGNANCY_LABELS}
            hint="«Sin registrar» es que nadie preguntó. «No lo sabe» es que se preguntó — y eso hay que resolverlo antes de una placa."
          />
          <div className="edu-field">
            <label className="edu-field__label" htmlFor={id("nino")}>
              Dentición
            </label>
            <select
              id={id("nino")}
              className="edu-input"
              value={values.isChild}
              onChange={(e) => set("isChild", e.target.value)}
              disabled={!canClinico}
            >
              <option value="false">Permanente (adulto)</option>
              <option value="true">Temporal (dentición infantil)</option>
            </select>
            <span className="edu-field__hint">
              Decide qué odontograma se pinta: los dientes 51-85 en vez de los 11-48.
            </span>
          </div>
        </div>
      </Grupo>

      {/* ══ AVISO DE PRIVACIDAD ═════════════════════════════════════ */}
      <Grupo
        titulo="Aviso de privacidad"
        lead="Cuándo lo aceptó (LFPDPPP). Es una fecha y no una casilla porque lo que hay que poder contestar es «¿cuándo?», y un sí sin fecha no es constancia de nada."
        motivo={motivoIdentidad}
      >
        <div className="edu-formgrid edu-formgrid--2">
          <Texto
            id={id("privacidad")}
            label="Fecha en que lo aceptó"
            type="date"
            value={values.privacyNoticeAcceptedAt}
            onChange={(v) => set("privacyNoticeAcceptedAt", v)}
            disabled={!canManage}
            hint="Vacío = no consta. No es lo mismo que «no lo aceptó»."
          />
          {canManage && (
            <div className="edu-field">
              <span className="edu-field__label">&nbsp;</span>
              <button
                type="button"
                className="edu-btn edu-btn--ghost edu-btn--sm"
                onClick={() => set("privacyNoticeAcceptedAt", eduHoyLocal())}
              >
                Lo acepta hoy
              </button>
            </div>
          )}
        </div>
      </Grupo>

      {/* ══ ADMINISTRATIVO ══════════════════════════════════════════ */}
      <Grupo titulo="Estado y notas de recepción" motivo={motivoIdentidad}>
        <div className="edu-field">
          <label className="edu-field__label" htmlFor={id("estado")}>
            Estado
          </label>
          <select
            id={id("estado")}
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

        {/* 🔴 H-28 · el estado no puede contradecir los casos, y se dice AQUÍ,
            debajo del campo, en cuanto se elige — no al pulsar Guardar. El
            servidor lo vuelve a comprobar al guardar con esta misma frase. */}
        {form.conflictoEstado && (
          <p className="edu-fichaform__motivo edu-fichaform__motivo--alto" role="alert">
            {form.conflictoEstado}
          </p>
        )}

        <Area
          id={id("notas")}
          label="Notas de recepción"
          value={values.notes}
          onChange={(v) => set("notes", v)}
          disabled={!canManage}
          maxLength={1000}
          rows={3}
          placeholder="Lo que haya que saber antes de sentarlo. No es historia clínica."
          hint="No son notas clínicas: ésas van al Expediente, con autor, estado y firma."
        />
      </Grupo>

      {/* 🔴 H-08 · el motivo que BLOQUEA el guardado va al final, junto al
          botón, porque es lo último que se lee antes de pulsar. Es el mismo
          texto que el aviso de arriba a propósito: dos redacciones del mismo
          no se leen como dos problemas distintos. */}
      {form.conflictoTutor && (
        <p className="edu-fichaform__motivo edu-fichaform__motivo--alto" role="alert">
          {form.conflictoTutor}
        </p>
      )}

      {/* 🔴 N-16 · y el campo que haría rebotar el guardado ENTERO, al lado
          del mismo botón y nombrándolo. Antes esto era un aviso ámbar bajo
          el campo y el guardado salía igual: el 400 del servidor tumbaba
          los otros treinta campos y hablaba solo del CURP. */}
      {form.errorCampo && (
        <p className="edu-fichaform__motivo edu-fichaform__motivo--alto" role="alert">
          {form.errorCampo}
        </p>
      )}
    </>
  );
}

/**
 * El formulario COMPLETO con su propio botón de guardar, para montarlo
 * dentro de una página (la pestaña *Datos*).
 *
 * El modal de la lista NO usa esta envoltura: tiene su propio pie y guarda
 * el origen en el mismo acto, así que monta el hook y los campos por
 * separado. Los campos, y por tanto la lista de los 31, son los mismos.
 */
export function EduPacienteDatosCard({
  row,
  rastroLabel,
  canManage,
  canContacto,
  canClinico,
  idPrefix,
}: EduPacienteDatosFormProps) {
  const router = useRouter();
  const form = useEduPacienteDatosForm(row);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const soloLectura = !canManage && !canContacto && !canClinico;

  async function guardar() {
    setError(null);
    setFlash(null);
    setBusy(true);
    try {
      const res = await eduRequest<{ row?: EduPatientRow }>(
        `/api/instituto/pacientes/${row.id}`,
        { method: "PATCH", body: form.diff },
      );
      setFlash("Listo: la ficha quedó corregida.");
      // 🔴 N-16 · Lo tecleado se reemplaza por lo que el servidor GUARDÓ, y
      // ahora con la fila que él acaba de devolver. Va antes del refresh y
      // no después: el refresh es asíncrono, y sin esto el formulario se
      // quedaba enseñando los valores VIEJOS debajo del «Listo» verde —el
      // teléfono con espacios, el folio en minúsculas, el CURP sin
      // normalizar— hasta que la página volviera a pintarse.
      form.resembrar(res?.row);
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

      {/* 🔴 H-12b · QUIÉN Y CUÁNDO. `updatedAt` existía en la tabla desde el
          primer día y no se pintaba en ninguna pantalla del paciente: nadie
          sabía quién le había cambiado el teléfono, ni cuándo. Desde la Ola
          B se guarda también el AUTOR, y se lee aquí, encima del formulario
          que lo escribe. */}
      <p className="edu-fichab-rastro">
        Última corrección: {row.updatedByName ?? "no consta quién"}
        {rastroLabel ? ` · ${rastroLabel}` : ""}
      </p>

      <EduPacienteDatosFields
        form={form}
        row={row}
        canManage={canManage}
        canContacto={canContacto}
        canClinico={canClinico}
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
