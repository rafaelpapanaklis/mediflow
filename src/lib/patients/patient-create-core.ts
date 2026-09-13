/**
 * El ALTA de un paciente (POST /api/patients): qué cuerpo se acepta y cómo se
 * reparte el aviso de duplicados. LÓGICA PURA, sin Prisma, igual que
 * patient-update-core.ts hace con la edición.
 *
 * ── N7 · EL CUERPO SE VALIDA EN EL SERVIDOR ────────────────────────────
 * El POST leía `body.*` a mano y se lo pasaba a Prisma tal cual. Sin nombre,
 * con una fecha o un género inválidos, Prisma reventaba y la respuesta era un
 * 500 con su mensaje interno; con nombre "" se GUARDABA un paciente sin
 * nombre. El modal lo tapaba exigiendo los campos en el navegador, pero
 * cualquier otro llamador —Sabina, un script— se comía el 500.
 *
 * QUÉ ES OBLIGATORIO DE VERDAD: nombre y apellido, y nada más. Son las dos
 * columnas NOT NULL sin default, y un paciente sin nombre es basura. El modal
 * exige además nacimiento, teléfono, género y alergias, pero eso NO sube al
 * servidor a propósito: los demás caminos que crean pacientes (aceptar una
 * solicitud pública, el bot de WhatsApp, el portal) los crean sin esos datos, y
 * si el alta rápida es válida para Sabina lo decide Rafael, no esta guarda.
 * Lo que sí se exige es que, SI llegan, sean válidos: lo que antes era un 500
 * ahora es un 400 que dice qué campo falló.
 *
 * NO se usa `patientSchema` (validations.ts) aunque exista: es el schema de la
 * EDICIÓN, sin defaults a propósito, con `firstName.min(2)` sin recortar (deja
 * pasar "  "), `dob` como cadena cualquiera (deja pasar "no-es-fecha", que es
 * justo el 500), y rechaza el `null` que este POST siempre ha aceptado en
 * teléfono, dirección o notas. Los criterios de aquí son los del PATCH de
 * /api/patients/[id], la ruta hermana que ya validaba campo a campo.
 */
import {
  isProbablePatientDuplicate,
  parsePatientGender,
  patientPhoneLast10,
  type PatientDuplicateProbe,
  type PatientGender,
} from "./patient-search-core";

export type PatientCreateCheck =
  | {
      ok: true;
      firstName: string;
      lastName: string;
      dob: Date | null;
      gender: PatientGender;
    }
  | { ok: false; field: string; error: string };

/** Campos que van a una columna de texto nullable: `string` o `null`. */
const TEXT_FIELDS = [
  "email", "phone", "bloodType", "address", "notes", "primaryDoctorId",
  "familyHistory", "personalNonPathologicalHistory",
  "emergencyContactName", "emergencyContactPhone", "emergencyContactRelation", "source",
] as const;

/** Columnas `String[]`. */
const LIST_FIELDS = ["allergies", "chronicConditions", "tags"] as const;

/** Tope de las columnas VarChar de identificación (prisma/schema.prisma). */
const MAX_LEN = { curp: 18, passportNo: 20 } as const;

/** Nadie vivo nació antes; una fecha así es un error de captura. */
const DOB_MIN_YEAR = 1900;
/** Holgura para el «nació hoy» de una zona horaria por delante de UTC. */
const DOB_FUTURE_SLACK_MS = 24 * 60 * 60 * 1000;

function fail(field: string, error: string): PatientCreateCheck {
  return { ok: false, field, error };
}

const isBlank = (v: unknown) => v === undefined || v === null || v === "";

/**
 * Valida el cuerpo crudo del alta. Devuelve los cuatro valores que el POST
 * tiene que NORMALIZAR antes de escribir (nombre y apellido recortados, fecha
 * como Date, género en el enum); el resto de campos el POST los sigue leyendo
 * del body como siempre, ya con el tipo garantizado.
 *
 * Falla en el PRIMER campo inválido, con un texto que el modal enseña tal cual
 * en su aviso.
 */
export function validatePatientCreateBody(body: unknown, now: Date = new Date()): PatientCreateCheck {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("body", "Cuerpo inválido: se esperaba un objeto con los datos del paciente.");
  }
  const b = body as Record<string, unknown>;

  const names = { firstName: "El nombre", lastName: "El apellido" } as const;
  for (const k of ["firstName", "lastName"] as const) {
    const v = b[k];
    if (typeof v !== "string" || !v.trim()) return fail(k, `${names[k]} del paciente es obligatorio.`);
  }

  let dob: Date | null = null;
  if (!isBlank(b.dob)) {
    if (typeof b.dob !== "string") return fail("dob", "La fecha de nacimiento no es válida.");
    const raw = b.dob.trim();
    // Solo ISO: AAAA-MM-DD (lo que manda el DateField del modal) o esa fecha
    // con hora. `new Date` se traga "abc 2020" o "1" y los convierte en un 1 de
    // enero cualquiera; y "2023-02-30" no es NaN: lo corre al 2 de marzo. Por
    // eso el día se comprueba contra el calendario ANTES de parsear lo demás.
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(raw);
    const d = new Date(raw);
    const calendario = iso ? new Date(Date.UTC(+iso[1], +iso[2] - 1, +iso[3])) : null;
    if (
      !iso || isNaN(d.getTime()) ||
      calendario!.getUTCFullYear() !== +iso[1] ||
      calendario!.getUTCMonth() !== +iso[2] - 1 ||
      calendario!.getUTCDate() !== +iso[3]
    ) {
      return fail("dob", "La fecha de nacimiento no es válida.");
    }
    if (d.getTime() > now.getTime() + DOB_FUTURE_SLACK_MS) {
      return fail("dob", "La fecha de nacimiento no puede estar en el futuro.");
    }
    if (d.getUTCFullYear() < DOB_MIN_YEAR) {
      return fail("dob", `La fecha de nacimiento no puede ser anterior a ${DOB_MIN_YEAR}.`);
    }
    dob = d;
  }

  // Ausente o vacío = OTHER, el default de siempre. Si llega, con el mismo
  // criterio que el PATCH: se aceptan los alias históricos y se normalizan.
  let gender: PatientGender = "OTHER";
  if (!isBlank(b.gender)) {
    const g = parsePatientGender(b.gender);
    if (!g) return fail("gender", "El género no es válido: usa M, F u OTHER.");
    gender = g;
  }

  for (const k of TEXT_FIELDS) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== "string") {
      return fail(k, `El campo ${k} tiene que ser texto.`);
    }
  }

  for (const k of LIST_FIELDS) {
    const v = b[k];
    if (v === undefined || v === null) continue;
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      return fail(k, `El campo ${k} tiene que ser una lista de textos.`);
    }
  }

  if (b.isChild !== undefined && b.isChild !== null && typeof b.isChild !== "boolean") {
    return fail("isChild", "El campo isChild tiene que ser verdadero o falso.");
  }

  for (const k of ["curp", "passportNo"] as const) {
    const v = b[k];
    if (isBlank(v)) continue;
    if (typeof v !== "string") return fail(k, `El campo ${k} tiene que ser texto.`);
    // Se mide lo que el POST va a GUARDAR: el CURP pasa por `toUpperCase`, que
    // puede alargar la cadena ("ß" → "SS") y reventar el VarChar(18).
    const guardado = k === "curp" ? v.toUpperCase().trim() : v.trim();
    if (guardado.length > MAX_LEN[k]) {
      return fail(k, `El campo ${k} admite como máximo ${MAX_LEN[k]} caracteres.`);
    }
  }

  return {
    ok: true,
    firstName: (b.firstName as string).trim(),
    lastName: (b.lastName as string).trim(),
    dob,
    gender,
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * N8 · EL AVISO DE DUPLICADOS MIRA TODA LA CLÍNICA, SIN FUGAR DATOS
 * ══════════════════════════════════════════════════════════════════════ */

export interface DuplicateCandidate {
  id: string;
  patientNumber: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  visibleUserIds: string[] | null;
}

/**
 * Reparte los homónimos de TODA la clínica entre los que se pueden enseñar y
 * los que solo se pueden contar.
 *
 * Antes los candidatos pasaban por `buildPatientWhere`, que para un DOCTOR es
 * «solo mis pacientes»: el paciente de otro doctor no era candidato, no había
 * 409 y el expediente se partía en dos. Ahora los candidatos salen de toda la
 * clínica y la visibilidad decide QUÉ SE DICE, no SI SE AVISA:
 *
 *  · `enMiAlcance(id)` — el paciente está en lo que este usuario puede listar
 *    (el mismo `buildPatientWhere` de antes). Se devuelve con folio, nombre y
 *    teléfono, exactamente como hasta hoy.
 *  · fuera de su alcance pero SIN restricción (`puedeVer(lista)`, la regla de
 *    visibleUserIds) — es el caso del otro doctor. Solo se CUENTA: el aviso
 *    dice que existe uno en la clínica, sin id, folio ni teléfono.
 *  · RESTRINGIDO a otros — la visibilidad promete que para quien no está en la
 *    lista el paciente no existe (404, nunca 403). Con solo el nombre no se
 *    cuenta: el alta no puede servir para averiguar si «Fulano» es paciente.
 *    Solo cuenta si además coincide el TELÉFONO, que es lo que tiene quien de
 *    verdad está atendiendo a esa persona, y el aviso es el mismo texto que el
 *    del caso anterior: la respuesta no distingue uno de otro.
 */
export function splitPatientDuplicates<T extends DuplicateCandidate>(args: {
  candidatos: T[];
  alta: PatientDuplicateProbe;
  enMiAlcance: (id: string) => boolean;
  puedeVer: (visibleUserIds: string[] | null) => boolean;
}): { visibles: T[]; ocultos: number } {
  const { candidatos, alta, enMiAlcance, puedeVer } = args;
  const telAlta = patientPhoneLast10(alta.phone ?? "");
  const visibles: T[] = [];
  let ocultos = 0;
  for (const c of candidatos) {
    if (!isProbablePatientDuplicate(c, alta)) continue;
    if (enMiAlcance(c.id)) {
      visibles.push(c);
    } else if (puedeVer(c.visibleUserIds)) {
      ocultos++;
    } else if (telAlta.length === 10 && patientPhoneLast10(c.phone ?? "") === telAlta) {
      ocultos++;
    }
  }
  return { visibles, ocultos };
}
