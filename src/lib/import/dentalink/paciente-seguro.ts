// ¿A QUÉ paciente va una fila cuyo ID del sistema de origen no está entre los importados? (ws1-t12)
// Puro: sin Prisma ni Next. Lo usan el resolvedor de pacientes de entities.ts (tratamientos, saldos, citas vivas) y el
// de pagos-historial/paciente.ts (historial de citas, pagos, cuotas).
//
// Regla de Rafael (desempate con TODOS los datos de la fila contra la ficha):
//   · Los datos fuertes son cinco: nombre completo, teléfono, correo, fecha de nacimiento y cédula/CURP.
//   · Se asigna SOLO si UN candidato coincide en al menos 2 datos fuertes y ningún otro llega a 2.
//   · Solo el nombre, solo el teléfono (compartido por una familia) o solo el correo NO bastan: la fila se queda «a
//     revisar», con sus candidatos, para que la persona elija. Un empate entre dos candidatos también.
//   · Una contradicción descarta al candidato: dos fechas de nacimiento distintas o dos cédulas/CURP distintas son
//     personas distintas aunque compartan nombre y teléfono (gemelos, homónimos, padre e hijo con el mismo nombre).
// Con esto un homónimo, un teléfono de familia o un correo compartido nunca reciben en silencio el dinero, la cita o el
// tratamiento de otra persona, y cada emparejamiento dice POR QUÉ se hizo («por nombre + teléfono»).

import { normName, parseDate } from "../engine";
import { phoneKey } from "../valores";

export type Dato = "nombre" | "teléfono" | "correo" | "fecha de nacimiento" | "cédula/CURP";

/** Lo que la ficha del paciente sabe de sí (todo ya normalizado por quien construye el índice). */
export interface FichaPaciente {
  id: string;
  /** Nombre completo tal como está en la ficha. */
  nombre: string;
  /** phoneKey del teléfono, o "". */
  tel: string;
  /** Correo en minúsculas, o "". */
  email: string;
  /** Día de nacimiento «AAAA-M-D» (local), o "". */
  dob: string;
  /** CURP / cédula en mayúsculas y sin espacios, o "". */
  doc: string;
}

/** Lo que la fila del archivo trae de la persona (normalizado igual). */
export interface DatosDeFila {
  nombre: string;
  tel: string;
  email: string;
  dob: string;
  doc: string;
}

export type Emparejo =
  | { tipo: "seguro"; id: string; por: Dato[] }
  | { tipo: "revisar"; motivo: string; candidatos: Array<{ id: string; por: Dato[] }> }
  | { tipo: "ninguno" };

function tokens(s: string): string[] {
  const fuera = new Set(["dr", "dra", "doctor", "doctora", "lic", "sr", "sra", "srita"]);
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t && !fuera.has(t));
}

/**
 * ¿Es el mismo nombre completo? Las palabras de uno están en el otro y comparten al menos DOS («Guadalupe Ortiz» ≈
 * «María Guadalupe Ortiz Villagómez»). Un solo nombre de pila («Guadalupe») no es un nombre completo: no cuenta.
 */
export function mismoNombreCompleto(a: string, b: string): boolean {
  const x = new Set(tokens(a));
  const y = new Set(tokens(b));
  if (x.size === 0 || y.size === 0) return false;
  let comunes = 0;
  x.forEach((t) => { if (y.has(t)) comunes++; });
  if (comunes < 2) return false;
  return comunes === x.size || comunes === y.size;
}

/** Datos fuertes en los que la fila coincide con esta ficha, o null si hay una contradicción (fecha o cédula distintas). */
export function coincidencias(fila: DatosDeFila, f: FichaPaciente): Dato[] | null {
  if (fila.dob && f.dob && fila.dob !== f.dob) return null;
  if (fila.doc && f.doc && fila.doc !== f.doc) return null;
  const por: Dato[] = [];
  if (fila.nombre && f.nombre && mismoNombreCompleto(fila.nombre, f.nombre)) por.push("nombre");
  if (fila.tel && f.tel && fila.tel === f.tel) por.push("teléfono");
  if (fila.email && f.email && fila.email === f.email) por.push("correo");
  if (fila.dob && f.dob && fila.dob === f.dob) por.push("fecha de nacimiento");
  if (fila.doc && f.doc && fila.doc === f.doc) por.push("cédula/CURP");
  return por;
}

/** «nombre + teléfono». */
export const textoDeDatos = (por: readonly Dato[]) => por.join(" + ");

/** Decide con los candidatos que las búsquedas (teléfono, correo, nombre, cédula) encontraron. */
export function emparejarPorDatos(fila: DatosDeFila, candidatos: readonly FichaPaciente[]): Emparejo {
  const vistos = new Set<string>();
  const evaluados: Array<{ id: string; por: Dato[] }> = [];
  for (const f of candidatos) {
    if (vistos.has(f.id)) continue;
    vistos.add(f.id);
    const por = coincidencias(fila, f);
    if (por === null) continue; // contradicción: es otra persona
    evaluados.push({ id: f.id, por });
  }
  if (evaluados.length === 0) return { tipo: "ninguno" };
  const claros = evaluados.filter((c) => c.por.length >= 2);
  if (claros.length === 1) return { tipo: "seguro", id: claros[0].id, por: claros[0].por };
  if (claros.length > 1) {
    return { tipo: "revisar", motivo: "dos o más pacientes coinciden igual de bien (empate)", candidatos: claros };
  }
  const conAlgo = evaluados.filter((c) => c.por.length >= 1);
  if (conAlgo.length === 0) return { tipo: "ninguno" };
  const soloUno = conAlgo.every((c) => c.por.length === 1 && c.por[0] === conAlgo[0].por[0]) ? conAlgo[0].por[0] : null;
  return {
    tipo: "revisar",
    motivo: soloUno
      ? `solo coincide ${soloUno === "nombre" ? "el nombre" : soloUno === "teléfono" ? "el teléfono" : soloUno === "correo" ? "el correo" : soloUno === "fecha de nacimiento" ? "la fecha de nacimiento" : "la cédula/CURP"}${conAlgo.length > 1 ? ` (${conAlgo.length} pacientes)` : ""}: hacen falta al menos 2 datos`
      : "ningún paciente coincide en al menos 2 datos",
    candidatos: conAlgo,
  };
}

// ---------------------------------------------------------------------------
// Pegamento con los índices de pacientes de los resolvedores (entities.ts y pagos-historial/paciente.ts)
// ---------------------------------------------------------------------------


/** Lo mínimo que hace falta del índice de pacientes (los dos resolvedores lo cumplen). */
export interface IndiceSeguro {
  byPhone: Map<string, string[]>;
  byEmail: Map<string, string[]>;
  byName: Map<string, string[]>;
  /** CURP/cédula → pacientes. */
  byDoc: Map<string, string[]>;
  fichas: Map<string, FichaPaciente>;
  nameById: Map<string, string>;
}

/** Día «AAAA-M-D» en hora local (misma convención con la que se guardó el `dob` al importar pacientes). */
export const diaDeNacimiento = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

const CURP_RE = /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/;
/** Solo un CURP con forma de CURP es un dato de identidad comparable (un DNI cualquiera no se compara con el CURP de la ficha). */
const docDe = (v: unknown) => {
  const c = String(v ?? "").toUpperCase().replace(/[\s-]/g, "");
  return CURP_RE.test(c) ? c : "";
};

function push(m: Map<string, string[]>, k: string, id: string) {
  if (!k) return;
  const a = m.get(k);
  if (a) a.push(id); else m.set(k, [id]);
}

/** Registra la ficha de un paciente (datos fuertes normalizados) en el índice. */
export function agregarFicha(
  idx: Pick<IndiceSeguro, "byDoc" | "fichas">,
  p: { id: string; firstName: string | null; lastName: string | null; phone: string | null; email: string | null; dob: Date | null; curp?: string | null },
): void {
  const ficha: FichaPaciente = {
    id: p.id,
    nombre: `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim(),
    tel: p.phone ? phoneKey(p.phone) : "",
    email: p.email ? p.email.toLowerCase() : "",
    dob: p.dob ? diaDeNacimiento(p.dob) : "",
    doc: docDe(p.curp),
  };
  idx.fichas.set(p.id, ficha);
  push(idx.byDoc, ficha.doc, p.id);
}

/** Los datos fuertes que trae la fila (ya con nombre y apellidos juntos en `name`). */
export function datosDeFila(mapped: Record<string, any>): DatosDeFila {
  const f = mapped.dob ? parseDate(mapped.dob) : null;
  return {
    nombre: mapped.name ? String(mapped.name).trim() : "",
    tel: mapped.phone ? phoneKey(mapped.phone) : "",
    email: mapped.email ? String(mapped.email).toLowerCase().trim() : "",
    dob: f ? diaDeNacimiento(f) : "",
    doc: docDe(mapped.nationalId ?? mapped.curp),
  };
}

/**
 * La fila trae un ID del sistema de origen que NO está entre los pacientes importados. Nunca se adivina: se busca con
 * todos sus datos y solo se asigna con 2 datos fuertes de UN candidato (ver arriba). Devuelve el resultado listo para
 * el resolvedor: el paciente y por qué, o un error que dice a quién podría ser y por qué no se asigna solo.
 */
export function resolverConIdDesconocido(
  mapped: Record<string, any>,
  idx: IndiceSeguro,
  externo: string,
  sistema: string,
): { id?: string; error?: string; warning?: string; via?: string } {
  const fila = datosDeFila(mapped);
  const ids = new Set<string>();
  const suma = (l: string[] | undefined) => l?.forEach((id) => ids.add(id));
  if (fila.tel) suma(idx.byPhone.get(fila.tel));
  if (fila.email) suma(idx.byEmail.get(fila.email));
  if (fila.nombre) suma(idx.byName.get(normName(fila.nombre)));
  if (fila.doc) suma(idx.byDoc.get(fila.doc));
  const candidatos = Array.from(ids).map((id) => idx.fichas.get(id)).filter((f): f is FichaPaciente => !!f);
  const r = emparejarPorDatos(fila, candidatos);
  if (r.tipo === "seguro") {
    const por = textoDeDatos(r.por);
    return {
      id: r.id,
      via: por,
      warning: `El ID ${externo} no existe entre los pacientes importados de este sistema: se emparejó por ${por} con «${idx.nameById.get(r.id) ?? ""}». Revisa que sea la misma persona`,
    };
  }
  if (r.tipo === "revisar") {
    const quienes = r.candidatos.slice(0, 4).map((c) => `«${idx.nameById.get(c.id) ?? ""}» (${textoDeDatos(c.por)})`).join(", ");
    return { error: `A revisar: el ID ${externo} de ${sistema} no está entre los pacientes importados y ${r.motivo}. Podría ser: ${quienes}. No se asigna solo` };
  }
  return { error: `Paciente con ID ${externo} no encontrado: importa antes los pacientes de ese sistema` };
}
