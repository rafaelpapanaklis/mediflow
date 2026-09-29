// Resolución de paciente para el HISTORIAL DE PAGOS MIGRADO (ws1-t6).
//
// Copia deliberada (no import) de la lógica de loadPatientIndex/resolvePatient
// de src/lib/import/entities.ts: ese archivo lo está tocando ws1-t12 en
// paralelo (motor + detección + UI del asistente) y esta tarea construye todo
// en archivos NUEVOS para no pisarle el trabajo. Mismo criterio que
// balancesHandler (STRICT: un pago es dinero — si el teléfono es de la mamá y
// la fila dice "Juanito", es un error, no se le carga a la mamá).
//
// Multi-tenant: clinicId SIEMPRE de la sesión (nunca del cliente).

import { prisma } from "@/lib/prisma";
import { canSeePatient, type VisibilityViewer } from "@/lib/patient-visibility";
import { normName } from "../engine";
import { phoneKey } from "../valores";
import { cargarExternos, limpiarId } from "../externos";
import { agregarFicha, resolverConIdDesconocido, type FichaPaciente } from "../dentalink/paciente-seguro";

export interface PatientIndex {
  byPhone: Map<string, string[]>;
  byEmail: Map<string, string[]>;
  byName: Map<string, string[]>;
  /** ID del sistema de origen → paciente (import_external_ids). Vacío si el SQL aún no se aplicó. */
  byExternal: Map<string, string>;
  nameById: Map<string, string>;
  /** CURP/cédula → pacientes y datos fuertes de cada ficha (desempate cuando el ID no alcanza: dentalink/paciente-seguro.ts). */
  byDoc: Map<string, string[]>;
  fichas: Map<string, FichaPaciente>;
}

function pushKey(m: Map<string, string[]>, k: string, id: string) {
  if (!k) return;
  const arr = m.get(k);
  if (arr) arr.push(id);
  else m.set(k, [id]);
}

export async function loadPatientIndex(
  clinicId: string,
  viewer?: { userId: string; role: string; originId?: string },
): Promise<PatientIndex> {
  const patients = await prisma.patient.findMany({
    where: { clinicId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, email: true, phone: true, dob: true, curp: true, visibleUserIds: true },
  });
  const idx: PatientIndex = { byPhone: new Map(), byEmail: new Map(), byName: new Map(), byExternal: new Map(), nameById: new Map(), byDoc: new Map(), fichas: new Map() };
  const quien: VisibilityViewer = { userId: viewer?.userId ?? "", role: viewer?.role ?? "", clinicId };
  for (const p of patients) {
    if (!canSeePatient(quien, p.visibleUserIds)) continue;
    idx.nameById.set(p.id, `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim());
    agregarFicha(idx, p);
    if (p.phone) pushKey(idx.byPhone, phoneKey(p.phone), p.id);
    if (p.email) pushKey(idx.byEmail, p.email.toLowerCase(), p.id);
    pushKey(idx.byName, normName(`${p.firstName} ${p.lastName}`), p.id);
  }
  if (viewer?.originId) {
    const { mapa } = await cargarExternos(clinicId, viewer.originId, "patient");
    for (const [ext, id] of Array.from(mapa.entries())) if (idx.nameById.has(id)) idx.byExternal.set(ext, id);
  }
  return idx;
}

/** Palabras de un nombre, sin acentos ni honoríficos. */
function nameTokens(s: string): string[] {
  const fuera = new Set(["dr", "dra", "doctor", "doctora", "lic", "sr", "sra", "srita"]);
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t && !fuera.has(t));
}

/** ¿Dos nombres pueden ser la misma persona? Uno contiene todas las palabras del otro. */
export function sameName(a: string, b: string): boolean {
  const x = nameTokens(a);
  const y = new Set(nameTokens(b));
  if (x.length === 0 || y.size === 0) return true;
  if (x.every((t) => y.has(t))) return true;
  const xs = new Set(x);
  return Array.from(y).every((t) => xs.has(t));
}

function resolverSinId(
  mapped: Record<string, any>,
  idx: PatientIndex,
  externo: string,
): { id?: string; error?: string; warning?: string; via?: string } {
  const sets: string[][] = [];
  const vias: string[] = [];
  if (mapped.phone) { const ids = idx.byPhone.get(phoneKey(mapped.phone)); if (ids) { sets.push(ids); vias.push("teléfono"); } }
  if (mapped.email) { const ids = idx.byEmail.get(String(mapped.email).toLowerCase()); if (ids) { sets.push(ids); vias.push("correo"); } }
  if (mapped.name)  { const ids = idx.byName.get(normName(mapped.name)); if (ids) { sets.push(ids); vias.push("nombre"); } }
  const nombre = mapped.name ? String(mapped.name) : "";
  let dudoso: { id: string; via: string } | undefined;
  for (let i = 0; i < sets.length; i++) {
    const ids = sets[i];
    let hit = ids;
    if (hit.length > 1 && nombre) hit = hit.filter((id) => sameName(nombre, idx.nameById.get(id) ?? ""));
    if (hit.length === 1) {
      if (nombre && !sameName(nombre, idx.nameById.get(hit[0]) ?? "")) { dudoso ??= { id: hit[0], via: vias[i] }; continue; }
      return { id: hit[0], via: vias[i] };
    }
    if (hit.length > 1) return { error: "Coincide con varios pacientes; identifica por teléfono o correo único" };
  }
  if (dudoso) return { id: dudoso.id, via: dudoso.via };
  if (externo && sets.length === 0) {
    return { error: `Paciente con ID ${externo} no encontrado: importa antes los pacientes de ese sistema` };
  }
  return { error: sets.length > 0 ? "El teléfono o correo es de otro paciente: revisa el nombre" : "Paciente no encontrado en la clínica" };
}

function resolvePatient(mapped: Record<string, any>, idx: PatientIndex): { id?: string; error?: string; warning?: string } {
  const externo = limpiarId(mapped.patientExternalId);
  if (externo) {
    const id = idx.byExternal.get(externo);
    if (id) return { id };
  }
  // ID del sistema de origen que no está entre los importados: se desempata con todos los datos de la fila y solo se
  // asigna con 2 datos fuertes de UN candidato; si no, «a revisar» (dentalink/paciente-seguro.ts).
  if (externo) return resolverConIdDesconocido(mapped, idx, externo, "el sistema de origen");
  return resolverSinId(mapped, idx, externo);
}

/**
 * Resuelve el paciente de una fila de pago. STRICT: si la fila trae un
 * nombre y el teléfono/correo que la encontró es de OTRA persona, es un
 * error — es dinero, no se le carga el pago de Juanito a su mamá.
 */
export function resolvePaymentPatient(
  mapped: Record<string, any>,
  idx: PatientIndex,
): { id?: string; error?: string; warning?: string; fullName: string } {
  const fullName = [mapped.name, mapped.lastName]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean)
    .join(" ");
  const res = resolvePatient(fullName ? { ...mapped, name: fullName } : mapped, idx);
  if (res.id && fullName) {
    const enFicha = idx.nameById.get(res.id) ?? "";
    if (enFicha && !sameName(fullName, enFicha)) {
      return { error: `El teléfono o correo es de «${enFicha}», no de «${fullName}»: revisa la fila`, fullName };
    }
  }
  return { ...res, fullName };
}
