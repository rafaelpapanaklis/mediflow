/* ═══════════════════════════════════════════════════════════════════════
 * DaleControl INSTITUCIONAL — EL SEMBRADOR DEL INSTITUTO DE DEMO.
 *
 * Llena UN instituto de mentira con el volumen del cliente que viene: 3
 * sedes, 32 sillones, 120 estudiantes en 2 generaciones y 3 especialidades,
 * ~12 docentes, ~600 pacientes, ~400 casos y ~15 000 citas (3 semanas atrás
 * y 2 adelante, con la de HOY llena), más el dinero, las notas clínicas y
 * las calificaciones que van con eso.
 *
 * Uso:
 *   DATABASE_URL=... npm run seed:edu-demo             # siembra
 *   DATABASE_URL=... npm run seed:edu-demo -- --medir  # mide las pantallas
 *   npm run seed:edu-demo -- --sql-borrado             # imprime el DELETE
 *
 *   # y para PODER ENTRAR al demo con una cuenta de verdad:
 *   DATABASE_URL=... npm run seed:edu-demo -- --direccion=<uuid-de-supabase>
 *   DATABASE_URL=... npm run seed:edu-demo -- --direccion=persona@correo.com
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 LAS TRES COSAS QUE ESTE ARCHIVO NO PUEDE HACER, Y CÓMO SE IMPIDEN
 *
 * 1. NO TOCAR EL INSTITUTO REAL. En producción vive "Instituto Odontológico
 *    de Especialidades" con datos de QA de verdad. Este script CREA SU
 *    PROPIO instituto (slug `demo-volumen`, nombre con prefijo `DEMO · `) y
 *    escribe SIEMPRE con ese institutionId. Antes de la primera escritura
 *    comprueba que el destino es el suyo (`guardaDestino`) y al terminar
 *    compara el conteo de filas AJENAS de las 42 tablas del vertical contra
 *    la foto que tomó al empezar (`fotoAjenas`): si una sola fila de otro
 *    instituto cambió, sale con código 1 y lo dice. No es un comentario
 *    pidiendo cuidado — es una comprobación que corre.
 *
 * 2. NO MANDAR NADA AL MUNDO. Crear citas y usuarios puede disparar
 *    WhatsApp o invitaciones. Aquí:
 *      · NO se crea `EduWhatsappConfig`. El barrido de recordatorios
 *        (src/lib/edu/recordatorios.ts:116) arranca de
 *        `eduWhatsappConfig.findMany({ where: { remindersEnabled: true } })`
 *        — SIN FILA, el instituto de demo no existe para el cron. Es más
 *        fuerte que poner `remindersEnabled: false`, porque no depende de
 *        que nadie lo encienda por curiosidad.
 *      · CERO filas en `EduWhatsappMessage`: la cola no lleva nada.
 *      · Los correos son todos `@demo.local` — TLD reservado por el RFC
 *        2606: no resuelve y no se puede entregar a nadie.
 *      · Los teléfonos son del bloque de ficción 55 5501 xxxx.
 *      · Los `supabaseId` son `demoseed-<n>`, que nunca es un UUID de
 *        Supabase Auth: no se crea ninguna cuenta y por tanto no sale
 *        ninguna invitación. Consecuencia deliberada: con las 135 personas
 *        sembradas, a este instituto NO SE PUEDE ENTRAR por el login. Se
 *        prefirió eso a que un seed mandara 135 correos de invitación.
 *
 *        🔴 `--direccion=` ES LA PUERTA, Y NO ROMPE ESTA REGLA. Cuelga
 *        UNA cuenta que YA EXISTE en Supabase Auth como DIRECCIÓN del
 *        instituto de demo. Sigue sin crearse ninguna cuenta y sigue sin
 *        salir ningún correo: lo único que se escribe es una fila más en
 *        `edu_users` DEL INSTITUTO DE DEMO, con el `supabaseId` que la
 *        persona ya tiene. Es exactamente el "copiar el UUID a mano" que
 *        antes pedía este comentario, hecho por el script y con guardias
 *        (ver `resolverDireccionReal`).
 *
 * 3. TODO BORRABLE. Prefijo `DEMO · ` en el nombre, slug `demo-volumen`, e
 *    ids con prefijo `dsd`. El bloque SQL de borrado lo imprime el propio
 *    script (`--sql-borrado`), en el orden correcto de llaves foráneas, y
 *    también vive en ORQUESTA.md.
 *
 * ── 🔴 LOS ESTUDIOS NO TIENEN ARCHIVO, Y POR ESO LO DICEN ──────────────
 * `EduStudy.sizeBytes` alimenta el tamaño que se pinta al lado de cada
 * estudio y la decisión "este CBCT no cabe en un móvil" del visor
 * (cbct-viewer.tsx:442). Una fila con 412 MB y ningún binario en el bucket
 * es una fila que MIENTE. Las dos salidas honestas eran subir archivos
 * chicos de verdad o marcar la fila; se eligió MARCAR, por tres razones:
 *   · el bucket `edu-files` es de Supabase, o sea del mundo. Subirle 800
 *     archivos desde un seed es exactamente el "no mandes nada afuera" que
 *     esta tarea prohíbe, y además dejaría basura que el DELETE de SQL no
 *     limpia: el objeto de Storage sobrevive a la fila.
 *   · subir "archivos chicos de verdad" tampoco arregla la mentira: un PNG
 *     de 2 KB con `sizeBytes` de 412 MB miente igual, y poniendo el tamaño
 *     real el medidor no mediría nada.
 *   · el nombre se lee en TODAS las pantallas donde se lee el tamaño, así
 *     que el aviso viaja pegado al dato que engaña.
 * Por eso cada estudio se llama `… · DEMO SIN ARCHIVO` y su `storagePath`
 * empieza por `demo-seed/`. El tamaño es verosímil (una periapical ~700 KB,
 * una pano ~4 MB, un CBCT ~300-600 MB) para que haya algo que medir; el
 * nombre avisa, en la misma línea, de que detrás no hay binario.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import Module from "node:module";
import { PrismaClient } from "@prisma/client";
import type {
  Prisma,
  EduAppointmentStatus,
  EduApprovalStage,
  EduCaseStatus,
  EduRole,
  EduStudentStatus,
  EduStudyKind,
} from "@prisma/client";
import { eduZonedToUtc, eduShiftDayISO, eduWeekdayOf, eduTodayISO } from "@/lib/edu/agenda-core";
import { eduUserSearchIndex, eduStudentSearchIndex, eduPatientSearchIndex } from "@/lib/edu/search";
import type { EduClinicaContext } from "@/lib/edu/visibility";

// ═══════════════════════════════════════════════════════════════════════
// 0 · IDENTIDAD DEL DEMO
// ═══════════════════════════════════════════════════════════════════════

const DEMO_SLUG = "demo-volumen";
const DEMO_NAME_PREFIX = "DEMO · ";
const DEMO_NAME = `${DEMO_NAME_PREFIX}Instituto de Especialidades DaleControl`;
const DEMO_ID_PREFIX = "dsd";
const DEMO_MAIL = "demo.local";
const DEMO_STORAGE_PREFIX = "demo-seed/";
const DEMO_STUDY_SUFFIX = " · DEMO SIN ARCHIVO";
const TZ = "America/Mexico_City";

// ═══════════════════════════════════════════════════════════════════════
// 1 · IDS DETERMINISTAS (la idempotencia entera cuelga de aquí)
// ═══════════════════════════════════════════════════════════════════════
//
// Correrlo dos veces no duplica porque cada fila lleva SU id calculado de
// una llave estable, y todas las inserciones son
// `createMany({ skipDuplicates: true })`: en la segunda pasada la fila
// choca contra la clave primaria y Postgres se la salta. No hay
// `deleteMany` previo — un seed que borra para volver a escribir es un seed
// que un día borra lo que no era suyo.
//
// `eduCleanId` (agenda-core.ts:640) solo admite [A-Za-z0-9_-] y 40
// caracteres: por eso base64url y el recorte.
function did(kind: string, ...parts: (string | number)[]): string {
  const h = createHash("sha1").update(`${kind}|${parts.join("|")}`).digest("base64url");
  return `${DEMO_ID_PREFIX}${kind}${h}`.replace(/[^A-Za-z0-9_-]/g, "0").slice(0, 40);
}

/** PRNG determinista (mulberry32). Sin esto, dos corridas repartirían
 *  distinto y la segunda dejaría de ser idempotente en todo lo que no es
 *  la llave. */
function rng(seed: string): () => number {
  let a = 0;
  for (let i = 0; i < seed.length; i++) a = (a * 31 + seed.charCodeAt(i)) >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.min(xs.length - 1, Math.floor(r() * xs.length))];
}
function int(r: () => number, lo: number, hi: number): number {
  return lo + Math.floor(r() * (hi - lo + 1));
}

// ═══════════════════════════════════════════════════════════════════════
// 2 · NOMBRES MEXICANOS
// ═══════════════════════════════════════════════════════════════════════

const NOMBRES_F = ["María", "Guadalupe", "Fernanda", "Ximena", "Regina", "Valeria", "Andrea", "Paulina", "Mariana", "Karla", "Diana", "Alejandra", "Itzel", "Citlali", "Renata", "Daniela", "Brenda", "Jimena", "Adriana", "Lucía", "Sofía", "Elena", "Rocío", "Norma", "Verónica", "Claudia", "Gabriela", "Perla", "Marisol", "Anahí"];
const NOMBRES_M = ["José", "Luis", "Miguel", "Ángel", "Carlos", "Jorge", "Ricardo", "Emiliano", "Santiago", "Diego", "Rodrigo", "Héctor", "Gerardo", "Alfonso", "Iván", "Ulises", "Arturo", "Sergio", "Óscar", "Rafael", "Fernando", "Javier", "Alberto", "Efraín", "Cuauhtémoc", "Salvador", "Ramiro", "Vicente", "Isaac", "Bruno"];
const APELLIDOS = ["Hernández", "García", "Martínez", "López", "González", "Pérez", "Rodríguez", "Sánchez", "Ramírez", "Cruz", "Flores", "Gómez", "Morales", "Vázquez", "Reyes", "Jiménez", "Torres", "Díaz", "Gutiérrez", "Ruiz", "Mendoza", "Aguilar", "Ortiz", "Castillo", "Romero", "Álvarez", "Chávez", "Ramos", "Domínguez", "Herrera", "Medina", "Guzmán", "Juárez", "Rojas", "Contreras", "Espinoza", "Salazar", "Navarro", "Delgado", "Cortés", "Bautista", "Ibarra", "Zamora", "Lara", "Cervantes", "Solís", "Peña", "Escobar", "Villanueva"];

interface Persona {
  firstName: string;
  lastName: string;
  sexo: "F" | "M";
}

function persona(r: () => number): Persona {
  const sexo: "F" | "M" = r() < 0.58 ? "F" : "M";
  const pila = sexo === "F" ? pick(r, NOMBRES_F) : pick(r, NOMBRES_M);
  const segundo = r() < 0.35 ? ` ${sexo === "F" ? pick(r, NOMBRES_F) : pick(r, NOMBRES_M)}` : "";
  return { firstName: `${pila}${segundo}`, lastName: `${pick(r, APELLIDOS)} ${pick(r, APELLIDOS)}`, sexo };
}

/** Teléfono de ficción: lada 55 de CDMX + bloque 5501, que no está
 *  asignado a nadie. */
function telefono(r: () => number): string {
  return `55 5501 ${String(int(r, 1000, 9999))}`;
}

function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

/** Correo `@demo.local` único: el par (supabaseId, institutionId) es único
 *  pero el correo no, y aun así dos personas con el mismo correo serían un
 *  padrón que no se puede leer. El índice de orden lo desempata. */
function correo(p: Persona, i: number): string {
  return `${slugify(p.firstName).split(".")[0]}.${slugify(p.lastName).split(".")[0]}${i}@${DEMO_MAIL}`;
}

// ═══════════════════════════════════════════════════════════════════════
// 3 · CATÁLOGOS
// ═══════════════════════════════════════════════════════════════════════

const SEDES = [
  { code: "NORTE", name: "Sede Norte", city: "Naucalpan", state: "Estado de México", address: "Blvd. Manuel Ávila Camacho 2900, Ciudad Satélite", sillones: 12 },
  { code: "CENTRO", name: "Sede Centro", city: "Ciudad de México", state: "Ciudad de México", address: "Av. Álvaro Obregón 121, Roma Norte", sillones: 10 },
  { code: "SUR", name: "Sede Sur", city: "Ciudad de México", state: "Ciudad de México", address: "Av. Universidad 1855, Coyoacán", sillones: 10 },
];

const PROGRAMAS = [
  { code: "ENDO", name: "Endodoncia", semestres: 6 },
  { code: "ORTO", name: "Ortodoncia", semestres: 8 },
  { code: "PERIO", name: "Periodoncia", semestres: 6 },
];

/** Dos generaciones VIVAS. La primera lleva año y medio dentro — que es lo
 *  que hace que la pantalla de evaluación tenga historia que leer. */
const GENERACIONES = [
  { name: "2025-A", start: "2025-02-03", end: "2027-12-10", semestre: 4, mat: "25" },
  { name: "2026-A", start: "2026-02-02", end: "2028-12-08", semestre: 2, mat: "26" },
];

const PROCEDIMIENTOS = [
  { code: "END-01", name: "Tratamiento de conductos unirradicular", cat: "Endodoncia", min: 90, publico: 180000, alumno: 90000, prog: "ENDO" },
  { code: "END-02", name: "Tratamiento de conductos multirradicular", cat: "Endodoncia", min: 120, publico: 250000, alumno: 125000, prog: "ENDO" },
  { code: "END-03", name: "Retratamiento de conductos", cat: "Endodoncia", min: 120, publico: 300000, alumno: 150000, prog: "ENDO" },
  { code: "END-04", name: "Apicectomía", cat: "Endodoncia", min: 90, publico: 320000, alumno: 160000, prog: "ENDO" },
  { code: "ORT-01", name: "Colocación de aparatología fija", cat: "Ortodoncia", min: 120, publico: 450000, alumno: 250000, prog: "ORTO" },
  { code: "ORT-02", name: "Control de ortodoncia", cat: "Ortodoncia", min: 40, publico: 60000, alumno: 30000, prog: "ORTO" },
  { code: "ORT-03", name: "Retiro de aparatología y retenedores", cat: "Ortodoncia", min: 90, publico: 220000, alumno: 110000, prog: "ORTO" },
  { code: "ORT-04", name: "Estudio de modelos y cefalometría", cat: "Ortodoncia", min: 60, publico: 150000, alumno: 75000, prog: "ORTO" },
  { code: "PER-01", name: "Raspado y alisado radicular por cuadrante", cat: "Periodoncia", min: 60, publico: 110000, alumno: 55000, prog: "PERIO" },
  { code: "PER-02", name: "Cirugía periodontal de acceso", cat: "Periodoncia", min: 120, publico: 380000, alumno: 190000, prog: "PERIO" },
  { code: "PER-03", name: "Injerto de tejido conectivo", cat: "Periodoncia", min: 120, publico: 420000, alumno: 210000, prog: "PERIO" },
  { code: "PER-04", name: "Mantenimiento periodontal", cat: "Periodoncia", min: 45, publico: 90000, alumno: 45000, prog: "PERIO" },
  { code: "GEN-01", name: "Valoración y tamizaje", cat: "General", min: 30, publico: 0, alumno: 0, prog: "" },
  { code: "GEN-02", name: "Radiografía periapical", cat: "Diagnóstico", min: 15, publico: 25000, alumno: 12000, prog: "" },
  { code: "GEN-03", name: "Ortopantomografía", cat: "Diagnóstico", min: 20, publico: 55000, alumno: 27000, prog: "" },
  { code: "GEN-04", name: "Tomografía de haz cónico (CBCT)", cat: "Diagnóstico", min: 30, publico: 190000, alumno: 95000, prog: "" },
];

/** Franjas del día en minutos desde medianoche. La clínica abre a las 9:00
 *  y cierra a las 19:00; bloques de hora y media con media hora de
 *  desinfección entre paciente y paciente. */
const FRANJAS = [540, 630, 720, 810, 900, 990, 1080];
const APERTURA = 540;
const CIERRE = 1140;

const DIAGNOSTICOS = ["Pulpitis irreversible sintomática", "Necrosis pulpar con periodontitis apical asintomática", "Periodontitis crónica generalizada moderada", "Maloclusión clase II división 1", "Recesión gingival Miller clase II", "Absceso apical crónico", "Caries profunda con exposición pulpar", "Periodontitis estadio III grado B", "Apiñamiento severo anteroinferior", "Fractura coronaria complicada"];
const ALERGIAS = ["Penicilina", "Sulfas", "Látex", "Ibuprofeno", "Anestésico con epinefrina", "Yodo"];
const CRONICOS = ["Diabetes mellitus tipo 2", "Hipertensión arterial", "Hipotiroidismo", "Asma", "Artritis reumatoide"];
const MEDICAMENTOS = ["Metformina 850 mg", "Losartán 50 mg", "Levotiroxina 100 mcg", "Salbutamol inhalado", "Enalapril 10 mg"];
const PARENTESCO = ["Cónyuge", "Madre", "Padre", "Hermano", "Hermana", "Hijo", "Hija"];
const SANGRE = ["O+", "O-", "A+", "A-", "B+", "AB+"];
const DIENTES = [11, 12, 13, 14, 15, 16, 17, 21, 22, 23, 24, 25, 26, 27, 31, 32, 33, 34, 35, 36, 37, 41, 42, 43, 44, 45, 46, 47];
const CONDICIONES = ["caries", "obturado", "corona", "ausente", "endodoncia", "fractura", "sellante", "implante"];
const SUPERFICIES = ["", "O", "M", "D", "V", "L", "MO", "OD"];
const MEDICINAS = [
  { drug: "Amoxicilina 500 mg", pres: "Cápsulas", dose: "1 cápsula", route: "Vía oral", freq: "Cada 8 horas", dur: "7 días", qty: "21 cápsulas" },
  { drug: "Ibuprofeno 400 mg", pres: "Tabletas", dose: "1 tableta", route: "Vía oral", freq: "Cada 8 horas", dur: "5 días", qty: "15 tabletas" },
  { drug: "Paracetamol 500 mg", pres: "Tabletas", dose: "1 tableta", route: "Vía oral", freq: "Cada 6 horas", dur: "3 días", qty: "12 tabletas" },
  { drug: "Clorhexidina 0.12 %", pres: "Enjuague", dose: "15 ml", route: "Enjuague bucal", freq: "Cada 12 horas", dur: "14 días", qty: "1 frasco 250 ml" },
  { drug: "Ketorolaco 10 mg", pres: "Tabletas", dose: "1 tableta", route: "Vía sublingual", freq: "Cada 8 horas", dur: "3 días", qty: "9 tabletas" },
];

// ═══════════════════════════════════════════════════════════════════════
// 4 · FECHAS
// ═══════════════════════════════════════════════════════════════════════

function esHabil(dayISO: string): boolean {
  const w = eduWeekdayOf(dayISO);
  return w >= 1 && w <= 5;
}

function instante(dayISO: string, minuto: number): Date {
  const d = eduZonedToUtc(dayISO, minuto, TZ);
  if (!d) throw new Error(`Fecha imposible: ${dayISO} ${minuto}`);
  return d;
}

/** Día de CALENDARIO a medianoche UTC — para las columnas que son fecha y
 *  no instante (generaciones, vencimientos de mensualidad). Ver
 *  formatEduContractDate: si se guardara con la hora local, el 31 de
 *  diciembre se pintaría "30 de diciembre" en cualquier zona UTC−. */
function diaUtc(dayISO: string): Date {
  return new Date(`${dayISO}T00:00:00.000Z`);
}

function dias(desdeISO: string, hastaISO: string): string[] {
  const out: string[] = [];
  let cur = desdeISO;
  let guard = 0;
  while (cur <= hastaISO && guard++ < 4000) {
    out.push(cur);
    cur = eduShiftDayISO(cur, 1);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════
// 5 · LAS GUARDIAS
// ═══════════════════════════════════════════════════════════════════════

/** Las tablas del vertical que llevan `institutionId`, para la foto de
 *  filas AJENAS. `edu_ai_prices` queda fuera a propósito: es un catálogo
 *  global sin institutionId, y este seed no lo toca. */
const TABLAS = [
  "edu_users", "edu_programs", "edu_cohorts", "edu_students", "edu_supervisor_assignments",
  "edu_patients", "edu_campuses", "edu_user_campus_access", "edu_chairs", "edu_chair_schedules",
  "edu_cases", "edu_appointments", "edu_records", "edu_odontogram_entries", "edu_studies",
  "edu_study_analyses", "edu_consents", "edu_procedures", "edu_fee_schedules",
  "edu_fee_schedule_items", "edu_charges", "edu_charge_items", "edu_payments",
  "edu_cash_sessions", "edu_case_approvals", "edu_rubrics", "edu_rubric_criteria",
  "edu_case_grades", "edu_case_grade_items", "edu_requirements", "edu_ai_quotas",
  "edu_ai_usage", "edu_whatsapp_configs", "edu_whatsapp_messages", "edu_fiscal_configs",
  "edu_patient_tax_profiles", "edu_invoices", "edu_prescriptions", "edu_prescription_items",
  "edu_payment_plans", "edu_installments",
];

async function fotoAjenas(db: PrismaClient, institutionId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of TABLAS) {
    const r = await db.$queryRawUnsafe<{ n: bigint }[]>(
      `select count(*)::bigint as n from "${t}" where "institutionId" <> $1`,
      institutionId,
    );
    out[t] = Number(r[0]?.n ?? 0);
  }
  const inst = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `select count(*)::bigint as n from "edu_institutions" where "id" <> $1`,
    institutionId,
  );
  out["edu_institutions"] = Number(inst[0]?.n ?? 0);
  return out;
}

function compararAjenas(antes: Record<string, number>, ahora: Record<string, number>): string[] {
  const males: string[] = [];
  for (const k of Object.keys(antes)) {
    if (antes[k] !== ahora[k]) males.push(`${k}: ${antes[k]} → ${ahora[k]}`);
  }
  return males;
}

/**
 * ¿El instituto de destino es EL NUESTRO? Corre antes de escribir nada y
 * también antes de medir. Rebota en dos casos que parecen el mismo y no lo
 * son:
 *   · hay una fila con nuestro slug cuyo nombre NO lleva el prefijo DEMO →
 *     alguien renombró el instituto de demo o, peor, le puso nuestro slug a
 *     uno de verdad;
 *   · hay una fila con nuestro slug y otro id → la creó otra cosa.
 * En los dos casos no se escribe una sola fila.
 */
async function guardaDestino(db: PrismaClient): Promise<{ id: string; existe: boolean }> {
  const id = did("inst", DEMO_SLUG);
  const porSlug = await db.eduInstitution.findUnique({
    where: { slug: DEMO_SLUG },
    select: { id: true, name: true },
  });
  if (!porSlug) return { id, existe: false };
  if (!porSlug.name.startsWith(DEMO_NAME_PREFIX)) {
    throw new Error(
      `GUARDIA: existe un instituto con slug "${DEMO_SLUG}" cuyo nombre NO empieza con "${DEMO_NAME_PREFIX}" ` +
        `(es "${porSlug.name}"). No se escribe nada: este seed solo toca SU instituto.`,
    );
  }
  if (porSlug.id !== id) {
    throw new Error(
      `GUARDIA: el instituto con slug "${DEMO_SLUG}" tiene id "${porSlug.id}" y este seed solo sabe escribir en ` +
        `"${id}". Lo creó otra cosa. Bórralo (--sql-borrado) o cámbiale el slug antes de sembrar.`,
    );
  }
  return { id, existe: true };
}

// ── La cuenta REAL que entra al demo ───────────────────────────

/** Id determinista de la fila de dirección real. Uno por supabaseId, así
 *  que correr el seed dos veces con la misma cuenta no duplica. */
function idDireccionReal(supabaseId: string): string {
  return did("dirreal", supabaseId);
}

/** ¿Esto parece un UUID de Supabase Auth? */
function pareceUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.trim());
}

interface DireccionReal {
  supabaseId: string;
  email: string;
  firstName: string;
  lastName: string;
  /** El instituto al que esta cuenta YA entra, si entra a alguno. */
  yaEntraA: { institutionId: string; nombre: string } | null;
}

/**
 * De lo que se tecleó en `--direccion=` a una identidad que se puede
 * escribir.
 *
 * 🔴 NO CREA NADA EN SUPABASE AUTH, y no puede: este script habla con
 * Postgres, no con el proveedor de identidad. Por eso el argumento tiene
 * que ser de una cuenta que YA EXISTE:
 *
 *   · un UUID  → se usa tal cual. Es lo que Supabase enseña en su tabla de
 *     usuarios, y es lo único que `getEduContext` mira para resolver una
 *     sesión (`edu-auth.ts`: findFirst por `supabaseId`).
 *   · un CORREO → se busca una fila de `edu_users` que ya lo tenga y que
 *     lleve un supabaseId de verdad (no `demoseed-`), y se copia ESE. Es
 *     el caso real: "la cuenta con la que ya entro al instituto de QA".
 *
 * Si el correo no aparece por ningún lado se REBOTA en vez de inventar un
 * supabaseId. Una fila con un supabaseId inventado no es un acceso: es una
 * cuenta muerta que mañana parece un bug del login.
 */
async function resolverDireccionReal(db: PrismaClient, arg: string): Promise<DireccionReal> {
  const valor = arg.trim();
  if (!valor) {
    throw new Error("GUARDIA: --direccion= necesita un UUID de Supabase o un correo.");
  }

  let supabaseId: string;
  let email: string;
  let firstName = "Dirección";
  let lastName = "de la demo";

  if (pareceUuid(valor)) {
    supabaseId = valor.toLowerCase();
    // Si esa cuenta ya es EduUser en algún lado, se le copian nombre y
    // correo: el panel saluda con el nombre de la persona y no con
    // "Dirección de la demo".
    const previo = await db.eduUser.findFirst({
      where: { supabaseId },
      select: { email: true, firstName: true, lastName: true },
      orderBy: { createdAt: "asc" },
    });
    email = previo?.email ?? `direccion.${supabaseId.slice(0, 8)}@${DEMO_MAIL}`;
    if (previo) {
      firstName = previo.firstName;
      lastName = previo.lastName;
    }
  } else if (valor.includes("@")) {
    email = valor.toLowerCase();
    const previo = await db.eduUser.findFirst({
      where: { email, NOT: { supabaseId: { startsWith: "demoseed-" } } },
      select: { supabaseId: true, firstName: true, lastName: true },
      orderBy: { createdAt: "asc" },
    });
    if (!previo) {
      throw new Error(
        `GUARDIA: no hay ninguna cuenta de instituto con el correo "${email}" y un supabaseId real, ` +
          "así que no se puede saber con qué identidad entraría. Pasa el UUID de Supabase Auth: " +
          "--direccion=<uuid>.",
      );
    }
    supabaseId = previo.supabaseId;
    firstName = previo.firstName;
    lastName = previo.lastName;
  } else {
    throw new Error(
      `GUARDIA: "${valor}" no es un UUID de Supabase ni un correo. --direccion= admite esas dos cosas.`,
    );
  }

  // ⚠️ ¿ESTA CUENTA YA ENTRA A OTRO INSTITUTO? `getEduContext` resuelve
  // la sesión con `findFirst(... orderBy createdAt asc)`: se queda con la
  // fila MÁS VIEJA. O sea que si esta persona ya es EduUser activo en otro
  // instituto, el login la seguirá mandando ALLÍ y la fila de demo no se
  // usará nunca. Se detecta para poder DECIRLO — no se toca esa otra fila
  // ni de lejos: es de otro instituto, y la regla número uno de este
  // archivo es no escribir fuera del demo.
  const otro = await db.eduUser.findFirst({
    where: { supabaseId, isActive: true },
    select: { institutionId: true, institution: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const idDemo = did("inst", DEMO_SLUG);

  return {
    supabaseId,
    email,
    firstName,
    lastName,
    yaEntraA:
      otro && otro.institutionId !== idDemo
        ? { institutionId: otro.institutionId, nombre: otro.institution.name }
        : null,
  };
}

/**
 * Escribe (o completa) la fila de DIRECCIÓN real del instituto de demo.
 *
 * Idempotente: el id sale de `did("dirreal", supabaseId)`, así que correrlo
 * dos veces con la misma cuenta actualiza la misma fila.
 *
 * ⚠️ NO se le da acceso a ninguna sede. En este vertical, un usuario SIN
 * filas en `edu_user_campus_access` ve las TRES sedes (eduResolveCampusScope
 * degrada a "sin recorte"), que es justo lo que una dirección necesita para
 * pasear el demo. La única cuenta sembrada con acceso acotado es una caja,
 * a propósito.
 */
async function colgarDireccionReal(
  db: PrismaClient,
  inst: string,
  quien: DireccionReal,
): Promise<string> {
  const id = idDireccionReal(quien.supabaseId);
  const searchIndex = eduUserSearchIndex({
    firstName: quien.firstName,
    lastName: quien.lastName,
    email: quien.email,
    phone: null,
  });

  await db.eduUser.upsert({
    where: { id },
    // 🔴 El `create` y el `update` llevan los dos el institutionId del
    // DEMO. Un upsert cuyo update no fija el instituto es como una fila de
    // demo termina apuntando a otro sitio después de un dedazo.
    create: {
      id,
      institutionId: inst,
      supabaseId: quien.supabaseId,
      email: quien.email,
      firstName: quien.firstName,
      lastName: quien.lastName,
      role: "DIRECCION",
      isActive: true,
      searchIndex,
    },
    update: {
      institutionId: inst,
      email: quien.email,
      firstName: quien.firstName,
      lastName: quien.lastName,
      role: "DIRECCION",
      isActive: true,
      searchIndex,
    },
    select: { id: true },
  });
  return id;
}

/** La base de destino. Local sin ceremonia; remota SOLO si quien corre
 *  escribe el host exacto — teclear un host es una decisión, teclear `--si`
 *  es un reflejo. */
function guardaBase(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("GUARDIA: falta DATABASE_URL.");
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error("GUARDIA: DATABASE_URL no es una URL válida.");
  }
  const local = ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(host);
  if (local) return host;
  if ((process.env.EDU_SEED_HOST_REMOTO || "").trim() === host) return host;
  throw new Error(
    `GUARDIA: DATABASE_URL apunta a "${host}", que no es local. Si de verdad quieres sembrar ahí, declara el ` +
      `host EXACTO: EDU_SEED_HOST_REMOTO="${host}" npm run seed:edu-demo`,
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 6 · INSERTAR EN LOTES
// ═══════════════════════════════════════════════════════════════════════

// 🔴 CADA LOTE VA TIPADO CONTRA PRISMA, NO CONTRA `any[]`.
//
// La primera version declaraba las filas como `any[]` y el build la cazo
// igual —pero en UN solo sitio, el unico donde el `any` no llegaba a tapar
// el error—. Un seed de 20 000 filas con arrays `any` es un seed que
// escribe un enum mal en la fila 12 000 y lo descubre Postgres, no el
// compilador. Cuatro tablas ademas se LEEN despues de armarlas (casos,
// citas, estudios, pacientes), y de esas se intersecta el tipo de Prisma
// con lo que este script necesita leer: asi `openedAt` es `Date` y no
// `Date | string`, sin un solo `as`.
type CasoSembrado = Prisma.EduCaseCreateManyInput & {
  id: string;
  patientId: string;
  studentId: string;
  procedureId: string;
  status: EduCaseStatus;
  openedAt: Date;
  closedAt: Date | null;
};
type CitaSembrada = Prisma.EduAppointmentCreateManyInput & {
  id: string;
  patientId: string;
  caseId: string | null;
  status: EduAppointmentStatus;
  completedAt: Date | null;
};
type PacienteSembrado = Prisma.EduPatientCreateManyInput & {
  id: string;
  referredByStudentId: string | null;
};
type EstudioSembrado = Prisma.EduStudyCreateManyInput & {
  id: string;
  name: string;
  caseId: string;
  uploadedById: string;
  createdAt: Date;
};

const LOTE = 1000;
const conteos: Record<string, number> = {};

async function meter<T>(
  nombre: string,
  filas: T[],
  fn: (chunk: T[]) => Promise<{ count: number }>,
): Promise<void> {
  let nuevas = 0;
  for (let i = 0; i < filas.length; i += LOTE) {
    nuevas += (await fn(filas.slice(i, i + LOTE))).count;
  }
  conteos[nombre] = filas.length;
  const nota = nuevas === filas.length ? "" : `  (${filas.length - nuevas} ya estaban)`;
  console.log(`  · ${nombre.padEnd(24)} ${String(filas.length).padStart(6)}${nota}`);
}

// ═══════════════════════════════════════════════════════════════════════
// 7 · EL SEMBRADO
// ═══════════════════════════════════════════════════════════════════════

interface Alumno {
  studentId: string;
  userId: string;
  matricula: string;
  programCode: string;
  programId: string;
  cohortId: string;
  gen: number;
  desdeISO: string;
  hastaISO: string | null;
  status: EduStudentStatus;
  nombre: string;
  pacientes: string[];
  casos: { id: string; desdeISO: string; hastaISO: string | null; procedureId: string; patientId: string }[];
  docenteUserId: string;
}

async function sembrar(db: PrismaClient, inst: string): Promise<void> {
  const hoy = eduTodayISO(TZ);
  const ahora = new Date();
  const finVivo = eduShiftDayISO(hoy, 14);

  // ── 7.1 · El instituto ────────────────────────────────────────────────
  await db.eduInstitution.upsert({
    where: { id: inst },
    update: { name: DEMO_NAME, isActive: true },
    create: {
      id: inst,
      name: DEMO_NAME,
      slug: DEMO_SLUG,
      legalName: "Instituto de Especialidades DaleControl, A.C. (DEMO)",
      rfc: "IED250101DM0",
      city: "Ciudad de México",
      state: "Ciudad de México",
      phone: "55 5501 0000",
      email: `direccion@${DEMO_MAIL}`,
      timezone: TZ,
      isActive: true,
      contractStartsAt: diaUtc("2025-01-15"),
      contractEndsAt: diaUtc("2027-01-14"),
    },
  });
  console.log(`  · instituto                    1  (${DEMO_NAME})`);

  // ── 7.2 · Sedes y sillones ────────────────────────────────────────────
  // La numeración de sillones REEMPIEZA en cada sede (el índice único es
  // (institutionId, campusId, number)): la Sede Norte tiene un sillón 1 y
  // la Sede Sur tiene otro. Eso es justo lo que hay que poder ver lleno.
  const sedes = SEDES.map((s, i) => ({
    id: did("camp", s.code),
    institutionId: inst,
    name: s.name,
    code: s.code,
    address: s.address,
    city: s.city,
    state: s.state,
    phone: `55 5501 ${1000 + i}`,
    timezone: TZ,
    isActive: true,
    orderIndex: i,
  }));
  await meter("sedes", sedes, (c) => db.eduCampus.createMany({ data: c, skipDuplicates: true }));

  interface Sillon { id: string; campusIdx: number; sabado: boolean }
  const sillones: Sillon[] = [];
  const sillonRows: Prisma.EduChairCreateManyInput[] = [];
  const horarioRows: Prisma.EduChairScheduleCreateManyInput[] = [];
  let orden = 0;
  SEDES.forEach((s, si) => {
    for (let n = 1; n <= s.sillones; n++) {
      const id = did("chair", s.code, n);
      const sabado = s.code === "SUR";
      sillones.push({ id, campusIdx: si, sabado });
      sillonRows.push({
        id,
        institutionId: inst,
        campusId: sedes[si].id,
        name: `Sillón ${n}`,
        number: n,
        isActive: true,
        orderIndex: orden++,
      });
      for (const wd of [1, 2, 3, 4, 5]) {
        horarioRows.push({
          id: did("chsch", s.code, n, wd),
          institutionId: inst,
          chairId: id,
          weekday: wd,
          startMinute: APERTURA,
          endMinute: CIERRE,
        });
      }
      if (sabado) {
        horarioRows.push({
          id: did("chsch", s.code, n, 6),
          institutionId: inst,
          chairId: id,
          weekday: 6,
          startMinute: APERTURA,
          endMinute: 840,
        });
      }
    }
  });
  await meter("sillones", sillonRows, (c) => db.eduChair.createMany({ data: c, skipDuplicates: true }));
  await meter("horarios de sillón", horarioRows, (c) => db.eduChairSchedule.createMany({ data: c, skipDuplicates: true }));

  // ── 7.3 · Especialidades y generaciones ───────────────────────────────
  const programas = PROGRAMAS.map((p, i) => ({
    id: did("prog", p.code),
    institutionId: inst,
    name: p.name,
    code: p.code,
    durationSemesters: p.semestres,
    isActive: true,
  }));
  await meter("especialidades", programas, (c) => db.eduProgram.createMany({ data: c, skipDuplicates: true }));

  const cohortes: Prisma.EduCohortCreateManyInput[] = [];
  PROGRAMAS.forEach((p, pi) => {
    GENERACIONES.forEach((g) => {
      cohortes.push({
        id: did("coh", p.code, g.name),
        institutionId: inst,
        programId: programas[pi].id,
        name: g.name,
        startDate: diaUtc(g.start),
        endDate: diaUtc(g.end),
        isActive: true,
      });
    });
  });
  await meter("generaciones", cohortes, (c) => db.eduCohort.createMany({ data: c, skipDuplicates: true }));

  // ── 7.4 · Las personas ────────────────────────────────────────────────
  const rp = rng("personas");
  const userRows: Prisma.EduUserCreateManyInput[] = [];
  let supa = 0;
  function nuevoUser(
    role: EduRole,
    p: Persona,
    i: number,
    extra: Partial<Prisma.EduUserCreateManyInput> = {},
  ) {
    const id = did("user", role, i);
    const email = correo(p, i);
    const phone = telefono(rp);
    userRows.push({
      id,
      institutionId: inst,
      // 🔴 NUNCA un UUID: sin cuenta en Supabase Auth no hay invitación
      // que mandar y nadie puede entrar con esta identidad.
      supabaseId: `demoseed-${String(++supa).padStart(4, "0")}`,
      email,
      firstName: p.firstName,
      lastName: p.lastName,
      role,
      phone,
      isActive: true,
      searchIndex: eduUserSearchIndex({ firstName: p.firstName, lastName: p.lastName, email, phone }),
      ...extra,
    });
    return { id, nombre: `${p.firstName} ${p.lastName}` };
  }

  const direccion = nuevoUser("DIRECCION", persona(rp), 0);
  const cajas = [nuevoUser("CAJA", persona(rp), 0), nuevoUser("CAJA", persona(rp), 1)];
  const docentes = Array.from({ length: 12 }, (_, i) =>
    nuevoUser("DOCENTE", persona(rp), i, { cedulaProfesional: String(4000000 + i * 7331) }),
  );

  const alumnos: Alumno[] = [];
  let ai = 0;
  PROGRAMAS.forEach((p, pi) => {
    GENERACIONES.forEach((g, gi) => {
      for (let k = 1; k <= 20; k++) {
        const per = persona(rp);
        const matricula = `${p.code}${g.mat}-${String(k).padStart(3, "0")}`;
        const u = nuevoUser("ALUMNO", per, ai);
        // Un padrón real no es 120 ACTIVE: hay bajas temporales y
        // definitivas, y la pantalla de evaluación las ordena distinto.
        const estado = ai % 20 === 7 ? "ON_LEAVE" : ai % 40 === 13 ? "WITHDRAWN" : "ACTIVE";
        alumnos.push({
          studentId: did("stu", matricula),
          userId: u.id,
          matricula,
          programCode: p.code,
          programId: programas[pi].id,
          cohortId: did("coh", p.code, g.name),
          gen: gi,
          desdeISO: g.start,
          hastaISO: estado === "WITHDRAWN" ? eduShiftDayISO(hoy, -120) : null,
          status: estado,
          nombre: u.nombre,
          pacientes: [],
          casos: [],
          docenteUserId: docentes[(pi * 4 + (k % 4)) % 12].id,
        });
        ai++;
      }
    });
  });
  await meter("personas (login)", userRows, (c) => db.eduUser.createMany({ data: c, skipDuplicates: true }));

  await meter(
    "fichas de estudiante",
    alumnos.map((a) => ({
      id: a.studentId,
      institutionId: inst,
      userId: a.userId,
      programId: a.programId,
      cohortId: a.cohortId,
      matricula: a.matricula,
      searchIndex: eduStudentSearchIndex({ matricula: a.matricula }),
      semester: GENERACIONES[a.gen].semestre,
      status: a.status,
      enrolledAt: diaUtc(a.desdeISO),
    })),
    (c) => db.eduStudent.createMany({ data: c, skipDuplicates: true }),
  );

  // Asignación alumno↔docente CON VIGENCIA. La generación vieja lleva una
  // rotación: la primera asignación se CERRÓ y hay otra abierta — que es lo
  // único que permite contestar "¿quién lo supervisaba el día que pasó
  // esto?" (y lo que hace que el recorte del docente sea interesante).
  const asignaciones: Prisma.EduSupervisorAssignmentCreateManyInput[] = [];
  alumnos.forEach((a, i) => {
    const rota = a.gen === 0;
    if (rota) {
      const previo = docentes[(i + 5) % 12].id;
      asignaciones.push({
        id: did("asg", a.matricula, "0"),
        institutionId: inst,
        studentId: a.studentId,
        supervisorUserId: previo,
        isPrimary: true,
        startsAt: diaUtc(a.desdeISO),
        endsAt: diaUtc("2026-02-13"),
      });
    }
    asignaciones.push({
      id: did("asg", a.matricula, "1"),
      institutionId: inst,
      studentId: a.studentId,
      supervisorUserId: a.docenteUserId,
      isPrimary: true,
      startsAt: diaUtc(rota ? "2026-02-16" : a.desdeISO),
      endsAt: null,
    });
  });
  await meter("asignaciones docente", asignaciones, (c) =>
    db.eduSupervisorAssignment.createMany({ data: c, skipDuplicates: true }),
  );

  // Acceso por sede: la dirección y una caja entran a TODAS (sin filas), la
  // otra caja solo a la Sede Norte. Sin esto la Ola 11 no se ve.
  await meter(
    "accesos por sede",
    [{ id: did("uca", "caja1", "NORTE"), institutionId: inst, userId: cajas[1].id, campusId: sedes[0].id }],
    (c) => db.eduUserCampusAccess.createMany({ data: c, skipDuplicates: true }),
  );

  // ── 7.5 · Procedimientos y tarifarios ─────────────────────────────────
  const procs = PROCEDIMIENTOS.map((p, i) => ({
    id: did("proc", p.code),
    institutionId: inst,
    name: p.name,
    code: p.code,
    category: p.cat,
    durationMinutes: p.min,
    isActive: true,
    orderIndex: i,
  }));
  await meter("procedimientos", procs, (c) => db.eduProcedure.createMany({ data: c, skipDuplicates: true }));

  const tarifarios: (Prisma.EduFeeScheduleCreateManyInput & { id: string; name: string })[] = [
    { id: did("fee", "PUBLICO"), institutionId: inst, name: "Público general", key: "PUBLICO", rule: "MANUAL", isDefault: true, isActive: true, orderIndex: 0 },
    { id: did("fee", "REFERIDO"), institutionId: inst, name: "Paciente traído por estudiante", key: "REFERIDO", rule: "REFERRED_BY_STUDENT", isDefault: false, isActive: true, orderIndex: 1 },
  ];
  await meter("tarifarios", tarifarios, (c) => db.eduFeeSchedule.createMany({ data: c, skipDuplicates: true }));

  const feeItems: Prisma.EduFeeScheduleItemCreateManyInput[] = [];
  PROCEDIMIENTOS.forEach((p) => {
    feeItems.push({ id: did("fitem", "PUBLICO", p.code), institutionId: inst, feeScheduleId: tarifarios[0].id, procedureId: did("proc", p.code), priceCents: p.publico });
    feeItems.push({ id: did("fitem", "REFERIDO", p.code), institutionId: inst, feeScheduleId: tarifarios[1].id, procedureId: did("proc", p.code), priceCents: p.alumno });
  });
  await meter("precios", feeItems, (c) => db.eduFeeScheduleItem.createMany({ data: c, skipDuplicates: true }));

  // ── 7.6 · Plan de estudios: requisitos y rúbricas ─────────────────────
  const requisitos: Prisma.EduRequirementCreateManyInput[] = [];
  PROGRAMAS.forEach((p, pi) => {
    const suyos = PROCEDIMIENTOS.filter((x) => x.prog === p.code);
    suyos.forEach((proc, k) => {
      requisitos.push({
        id: did("req", p.code, proc.code),
        institutionId: inst,
        name: `${proc.name} (mínimo de la especialidad)`,
        programId: programas[pi].id,
        semesterFrom: k < 2 ? 1 : 3,
        semesterTo: null,
        procedureId: did("proc", proc.code),
        category: null,
        requiredCount: [12, 10, 6, 4][k] ?? 6,
        onlyCompleted: true,
        isActive: true,
        orderIndex: k,
      });
    });
    requisitos.push({
      id: did("req", p.code, "CAT"),
      institutionId: inst,
      name: "Casos de diagnóstico por imagen",
      programId: programas[pi].id,
      semesterFrom: 1,
      semesterTo: null,
      procedureId: null,
      category: "Diagnóstico",
      requiredCount: 8,
      onlyCompleted: false,
      isActive: true,
      orderIndex: 9,
    });
  });
  await meter("requisitos", requisitos, (c) => db.eduRequirement.createMany({ data: c, skipDuplicates: true }));

  const CRITERIOS = [
    { name: "Diagnóstico y plan de tratamiento", peso: 30 },
    { name: "Ejecución clínica", peso: 35 },
    { name: "Manejo del paciente y bioseguridad", peso: 20 },
    { name: "Expediente y evidencia", peso: 15 },
  ];
  const rubricas: Prisma.EduRubricCreateManyInput[] = [];
  const criterios: Prisma.EduRubricCriterionCreateManyInput[] = [];
  PROGRAMAS.forEach((p, pi) => {
    const id = did("rub", p.code);
    rubricas.push({
      id,
      institutionId: inst,
      name: `Rúbrica clínica de ${p.name}`,
      programId: programas[pi].id,
      procedureId: null,
      scaleMin: 0,
      scaleMax: 100,
      isActive: true,
      orderIndex: pi,
    });
    CRITERIOS.forEach((cr, ci) => {
      criterios.push({
        id: did("crit", p.code, ci),
        institutionId: inst,
        rubricId: id,
        name: cr.name,
        weightPercent: cr.peso,
        orderIndex: ci,
      });
    });
  });
  await meter("rúbricas", rubricas, (c) => db.eduRubric.createMany({ data: c, skipDuplicates: true }));
  await meter("criterios", criterios, (c) => db.eduRubricCriterion.createMany({ data: c, skipDuplicates: true }));

  // ── 7.7 · Los pacientes ───────────────────────────────────────────────
  // Cada paciente cuelga de un alumno "de cabecera" para que las citas y
  // los casos que vienen después sean coherentes: el alumno que lo trajo es
  // el que lo atiende.
  const rpx = rng("pacientes");
  const N_PACIENTES = 600;
  const pacientes: { id: string; folio: string; alumnoIdx: number; nombre: string }[] = [];
  const pacienteRows: PacienteSembrado[] = [];
  // Cinco fichas GORDAS: la pantalla del expediente con muchas notas y
  // muchos estudios es una de las que hay que medir, y con 3 notas por
  // paciente no se mide nada.
  // Los indices NO son al azar: el caso i toma el paciente
  // `alumnos[i % 120].pacientes[floor(i / 120) % 5]`, asi que la posicion 4
  // de cada alumno (indices >= 480) nunca recibe caso — y un paciente sin
  // caso no tiene donde colgar notas ni estudios. Los cinco de abajo caen
  // en posiciones 0-3. El primero es ademas el EXTREMO: cruza los topes de
  // 200 de EDU_STUDY_MAX_ROWS y EDU_RECORD_MAX_ROWS, que es la unica forma
  // de comprobar si la ficha corta o se traga todo.
  const GORDOS = new Set([3, 77, 201, 355, 379]);
  const EXTREMO = 3;
  for (let i = 0; i < N_PACIENTES; i++) {
    const per = persona(rpx);
    const folio = `P-${String(i + 1).padStart(4, "0")}`;
    const id = did("pat", folio);
    const alumnoIdx = i % alumnos.length;
    const phone = telefono(rpx);
    const email = rpx() < 0.7 ? correo(per, 1000 + i) : null;
    const trajo = rpx() < 0.6;
    // Antecedentes con TRI-ESTADO (ver #150): "sin registrar" no es lo
    // mismo que "sin alergias". Un 22 % de las fichas se queda SIN
    // historyRecordedAt a propósito, para que la pantalla tenga los tres
    // estados que sabe pintar.
    const conHistoria = rpx() < 0.78;
    const conAlergias = conHistoria && rpx() < 0.3;
    const nacimiento = `${int(rpx, 1948, 2016)}-${String(int(rpx, 1, 12)).padStart(2, "0")}-${String(int(rpx, 1, 28)).padStart(2, "0")}`;
    const estado = GORDOS.has(i) ? "ACTIVE" : rpx() < 0.06 ? "NEW" : rpx() < 0.16 ? "DISCHARGED" : rpx() < 0.24 ? "INACTIVE" : "ACTIVE";
    pacientes.push({ id, folio, alumnoIdx, nombre: `${per.firstName} ${per.lastName}` });
    alumnos[alumnoIdx].pacientes.push(id);
    pacienteRows.push({
      id,
      institutionId: inst,
      folio,
      firstName: per.firstName,
      lastName: per.lastName,
      phone,
      email,
      birthDate: diaUtc(nacimiento),
      sex: per.sexo === "F" ? "FEMALE" : "MALE",
      status: estado,
      searchIndex: eduPatientSearchIndex({ folio, firstName: per.firstName, lastName: per.lastName, phone, email }),
      referredByStudentId: trajo ? alumnos[alumnoIdx].studentId : null,
      originSetById: trajo ? cajas[i % 2].id : null,
      originSetAt: trajo ? diaUtc(eduShiftDayISO(hoy, -int(rpx, 30, 500))) : null,
      bloodType: conHistoria ? pick(rpx, SANGRE) : null,
      allergies: conHistoria ? (conAlergias ? [pick(rpx, ALERGIAS)] : []) : [],
      chronicConditions: conHistoria && rpx() < 0.35 ? [pick(rpx, CRONICOS)] : [],
      currentMedications: conHistoria && rpx() < 0.3 ? [pick(rpx, MEDICAMENTOS)] : [],
      emergencyContactName: conHistoria ? `${pick(rpx, NOMBRES_F)} ${pick(rpx, APELLIDOS)}` : null,
      emergencyContactPhone: conHistoria ? telefono(rpx) : null,
      emergencyContactRelation: conHistoria ? pick(rpx, PARENTESCO) : null,
      historyRecordedAt: conHistoria ? diaUtc(eduShiftDayISO(hoy, -int(rpx, 5, 400))) : null,
      historyRecordedById: conHistoria ? alumnos[alumnoIdx].userId : null,
    });
  }
  await meter("pacientes", pacienteRows, (c) => db.eduPatient.createMany({ data: c, skipDuplicates: true }));

  // ── 7.8 · Los casos ───────────────────────────────────────────────────
  const rc = rng("casos");
  const N_CASOS = 400;
  const ESTADOS_CASO = [
    ...Array(40).fill("SCREENING"), ...Array(60).fill("ASSIGNED"),
    ...Array(150).fill("IN_TREATMENT"), ...Array(30).fill("ON_HOLD"),
    ...Array(90).fill("COMPLETED"), ...Array(20).fill("TRANSFERRED"),
    ...Array(10).fill("ABANDONED"),
  ];
  const casoRows: CasoSembrado[] = [];
  for (let i = 0; i < N_CASOS; i++) {
    const a = alumnos[i % alumnos.length];
    const pacienteId = a.pacientes[Math.floor(i / alumnos.length) % a.pacientes.length];
    const propios = PROCEDIMIENTOS.filter((p) => p.prog === a.programCode);
    const proc = propios[i % propios.length];
    const status = ESTADOS_CASO[i % ESTADOS_CASO.length];
    // Un caso no puede abrirse antes de que el alumno entrara: la ventana
    // arranca un mes después del inicio de su generación.
    const arranque = eduShiftDayISO(a.desdeISO, 30);
    const margen = dias(arranque, eduShiftDayISO(hoy, -3)).length;
    const abiertoISO = eduShiftDayISO(arranque, int(rc, 0, Math.max(1, margen - 1)));
    const cerrado = ["COMPLETED", "TRANSFERRED", "ABANDONED"].includes(status);
    const cerradoISO = cerrado ? eduShiftDayISO(abiertoISO, int(rc, 30, 220)) : null;
    const id = did("case", a.matricula, i);
    a.casos.push({
      id,
      desdeISO: abiertoISO,
      hastaISO: cerradoISO && cerradoISO < hoy ? cerradoISO : null,
      procedureId: did("proc", proc.code),
      patientId: pacienteId,
    });
    casoRows.push({
      id,
      institutionId: inst,
      patientId: pacienteId,
      studentId: a.studentId,
      programId: a.programId,
      supervisorUserId: a.docenteUserId,
      status,
      openedAt: instante(abiertoISO, 600),
      closedAt: cerradoISO && cerradoISO < hoy ? instante(cerradoISO, 1000) : null,
      procedureId: did("proc", proc.code),
      notes: rc() < 0.4 ? `Caso de ${proc.name.toLowerCase()}. Paciente referido por el propio estudiante.` : null,
    });
  }
  await meter("casos", casoRows, (c) => db.eduCase.createMany({ data: c, skipDuplicates: true }));

  // ── 7.9 · LA AGENDA ───────────────────────────────────────────────────
  //
  // Se recorre DÍA por DÍA (y no caso por caso) por una razón concreta: el
  // reparto de sillón y franja tiene que ser sin choques, y "sin choques"
  // es una propiedad DEL DÍA. Recorriendo casos habría que llevar un libro
  // de huecos ocupados y probar contra él; recorriendo días, los huecos del
  // día se barajan UNA vez y se reparten sin repetir, y no hay nada que
  // comprobar.
  //
  // Densidad: la historia va floja (la escuela no llenó 32 sillones en
  // 2025), las últimas tres semanas apretadas, HOY casi lleno y el futuro a
  // media máquina — que es como se ve una agenda de verdad.
  const ra = rng("agenda");
  // EL ANCLA DE LA FOTO EN VIVO. Los estados IN_CHAIR / IN_PROGRESS se
  // deciden contra el reloj, y si el seed corre a las 2 de la manana NO HAY
  // ninguna cita que contenga ese instante: la pantalla de clinica en vivo
  // -que es justo la que hay que poder ensenar- nace vacia. Cuando `now`
  // cae fuera del horario de la clinica, el ancla se mueve a las 12:30 de
  // HOY. No es maquillaje: es la unica forma de que un instituto de DEMO
  // tenga gente en el sillon a cualquier hora a la que se siembre, y queda
  // dicho aqui y en el reporte.
  const minutoAhora = Math.round((ahora.getTime() - instante(hoy, 0).getTime()) / 60000);
  const dentroDeHorario = minutoAhora >= APERTURA + 60 && minutoAhora <= CIERRE - 60;
  const ancla = dentroDeHorario ? ahora : instante(hoy, 750);
  if (!dentroDeHorario) {
    console.log(`    (en la clinica son las ${Math.floor(minutoAhora / 60)}:00 — la foto en vivo se ancla a las 12:30 de hoy)`);
  }
  const inicioHistoria = eduShiftDayISO(GENERACIONES[0].start, 30);
  const citaRows: CitaSembrada[] = [];
  const citasDeHoy: CitaSembrada[] = [];
  const citasPorCaso = new Map<string, number>();

  const activosEn = (dayISO: string) =>
    alumnos.filter(
      (a) =>
        dayISO >= eduShiftDayISO(a.desdeISO, 20) &&
        (a.hastaISO === null || dayISO <= a.hastaISO) &&
        a.status !== "WITHDRAWN",
    );

  let cursor = 0;
  for (const dia of dias(inicioHistoria, finVivo)) {
    const wd = eduWeekdayOf(dia);
    if (wd === 0) continue;
    const habil = esHabil(dia);
    const disponibles = sillones.filter((s) => (habil ? true : s.sabado));
    const franjas = habil ? FRANJAS : FRANJAS.slice(0, 4);
    const pool = activosEn(dia);
    if (pool.length === 0) continue;

    const distancia = dias(dia < hoy ? dia : hoy, dia < hoy ? hoy : dia).length - 1;
    const factor =
      dia === hoy ? 0.85 : dia > hoy ? 0.45 : distancia <= 21 ? 0.55 : 0.2;
    const huecos: { chairId: string; franja: number }[] = [];
    for (const s of disponibles) for (const f of franjas) huecos.push({ chairId: s.id, franja: f });
    // BARAJAR, no ir saltando de N en N. El primer intento repartia
    // `huecos[(k * 7) % huecos.length]` y con 32 sillones x 7 franjas = 224
    // huecos eso solo visita 224/mcd(7,224) = 32 posiciones distintas: el
    // dia "lleno" se llenaba 32 veces con el MISMO sillon y las 160 filas
    // restantes chocaban contra la clave primaria y se descartaban en
    // silencio. Un Fisher-Yates con el PRNG sembrado da huecos distintos y
    // repartidos, y sigue siendo determinista.
    for (let i = huecos.length - 1; i > 0; i--) {
      const j = Math.floor(ra() * (i + 1));
      [huecos[i], huecos[j]] = [huecos[j], huecos[i]];
    }
    const cuantas = Math.round(huecos.length * factor);

    for (let k = 0; k < cuantas; k++) {
      const hueco = huecos[k];
      const a = pool[cursor++ % pool.length];
      const vivos = a.casos.filter((c) => c.desdeISO <= dia && (c.hastaISO === null || c.hastaISO >= dia));
      const caso = vivos.length > 0 ? vivos[k % vivos.length] : null;
      const pacienteId = caso ? caso.patientId : a.pacientes[k % a.pacientes.length];
      const dur = caso ? 90 : 30;
      const inicio = instante(dia, hueco.franja);
      const fin = new Date(inicio.getTime() + dur * 60_000);
      const tipo = caso ? (k % 5 === 0 ? "CONTROL" : "TRATAMIENTO") : "TAMIZAJE";

      // El ESTADO es lo que le da de comer a la pantalla de clínica en
      // vivo, así que se decide contra el reloj y no al azar: lo que ya
      // pasó está cerrado, lo que está pasando AHORA está en el sillón, y
      // lo que viene sigue agendado.
      const reloj = dia === hoy ? ancla : ahora;
      let status: EduAppointmentStatus;
      if (fin <= reloj) status = ra() < 0.84 ? "COMPLETED" : ra() < 0.5 ? "NO_SHOW" : "CANCELLED";
      else if (inicio <= reloj) status = ra() < 0.55 ? "IN_PROGRESS" : "IN_CHAIR";
      else if (dia === hoy && inicio.getTime() - reloj.getTime() < 90 * 60_000) status = "CHECKED_IN";
      else status = ra() < 0.95 ? "SCHEDULED" : "CANCELLED";

      // Las marcas de tiempo siguen la MISMA regla que el producto
      // (eduAppointmentStamps, agenda-core.ts:560): IN_CHAIR ya tiene hora
      // de inicio, COMPLETED tiene las tres. Un demo con las marcas mal
      // puestas produce horas clinicas mal contadas en /instituto/evaluacion,
      // que es justo una de las pantallas a medir.
      const checkedIn = ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED"].includes(status);
      const empezada = ["IN_CHAIR", "IN_PROGRESS", "COMPLETED"].includes(status);
      citaRows.push({
        id: did("appt", dia, hueco.chairId, hueco.franja),
        institutionId: inst,
        patientId: pacienteId,
        studentId: a.studentId,
        chairId: hueco.chairId,
        supervisorUserId: a.docenteUserId,
        caseId: caso ? caso.id : null,
        startsAt: inicio,
        endsAt: fin,
        type: tipo,
        status,
        checkedInAt: checkedIn ? new Date(inicio.getTime() - 8 * 60_000) : null,
        startedAt: empezada ? inicio : null,
        completedAt: status === "COMPLETED" ? fin : null,
        notes: null,
      });
      if (dia === hoy) citasDeHoy.push(citaRows[citaRows.length - 1]);
      if (caso) citasPorCaso.set(caso.id, (citasPorCaso.get(caso.id) ?? 0) + 1);
    }
  }
  await meter("citas", citaRows, (c) => db.eduAppointment.createMany({ data: c, skipDuplicates: true }));

  // LA UNICA ESCRITURA QUE NO ES `create`: la foto de HOY se REFRESCA.
  // `createMany({ skipDuplicates: true })` hace el seed idempotente, y ese
  // mismo skip significa que una segunda corrida NO tocaria los estados de
  // hoy: un instituto sembrado ayer amaneceria con la agenda de hoy entera
  // en SCHEDULED y la pantalla de clinica en vivo vacia. Este UPDATE esta
  // acotado a las citas de HOY del instituto de DEMO -el `institutionId` va
  // en el WHERE, no solo en los ids- y vuelve a poner gente en el sillon.
  // Es lo que hace que la demo se pueda ensenar dos dias seguidos.
  const porEstado = new Map<string, string[]>();
  for (const c of citasDeHoy) {
    const l = porEstado.get(c.status) ?? [];
    l.push(c.id);
    porEstado.set(c.status, l);
  }
  for (const [estado, ids] of Array.from(porEstado.entries())) {
    const checkedIn = ["CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "COMPLETED"].includes(estado);
    const empezada = ["IN_CHAIR", "IN_PROGRESS", "COMPLETED"].includes(estado);
    await db.$executeRawUnsafe(
      `update "edu_appointments" set
         "status" = $1::"EduAppointmentStatus",
         "checkedInAt" = case when $2 then "startsAt" - interval '8 minutes' else null end,
         "startedAt"   = case when $3 then "startsAt" else null end,
         "completedAt" = case when $1 = 'COMPLETED' then "endsAt" else null end,
         "updatedAt"   = now()
       where "institutionId" = $4 and "id" = any($5::text[])`,
      estado,
      checkedIn,
      empezada,
      inst,
      ids,
    );
  }
  const hoyVivas = citasDeHoy.filter((c) => ["IN_CHAIR", "IN_PROGRESS", "CHECKED_IN"].includes(c.status)).length;
  console.log(`    (hoy: ${citasDeHoy.length} citas, ${hoyVivas} vivas ahora mismo — en sillon, en tratamiento o esperando)`);

  // ── 7.10 · Expediente: notas, estudios y odontograma ──────────────────
  const rr = rng("expediente");
  const citasCompletadasPorCaso = new Map<string, CitaSembrada[]>();
  for (const c of citaRows) {
    if (!c.caseId || c.status !== "COMPLETED") continue;
    const l = citasCompletadasPorCaso.get(c.caseId) ?? [];
    l.push(c);
    citasCompletadasPorCaso.set(c.caseId, l);
  }

  const alumnoPorStudentId = new Map(alumnos.map((a) => [a.studentId, a]));
  const pacientePorId = new Map(pacientes.map((p) => [p.id, p]));
  const pacienteRowPorId = new Map(pacienteRows.map((p) => [p.id, p]));
  const docentePorId = new Map(docentes.map((d) => [d.id, d]));
  const procPorId = new Map(PROCEDIMIENTOS.map((p) => [did("proc", p.code), p]));
  const gordosIds = new Set(pacientes.filter((_, i) => GORDOS.has(i)).map((p) => p.id));
  const extremoId = pacientes[EXTREMO].id;

  const notaRows: Prisma.EduRecordCreateManyInput[] = [];
  const estudioRows: EstudioSembrado[] = [];
  for (const caso of casoRows) {
    const alumno = alumnoPorStudentId.get(caso.studentId)!;
    const gordo = gordosIds.has(caso.patientId);
    const extremo = caso.patientId === extremoId;
    const completadas = citasCompletadasPorCaso.get(caso.id) ?? [];
    const cuantas = extremo ? 240 : gordo ? 40 : Math.min(completadas.length, rr() < 0.5 ? 2 : 4);
    for (let k = 0; k < cuantas; k++) {
      // Mas notas que citas completadas: `appointmentId` es opcional, y una
      // nota sin cita es lo que escribe el docente al revisar el caso.
      const cita = completadas[k] ?? null;
      // `completedAt` es `Date | null` en el tipo aunque aqui solo entran
      // COMPLETED: el `??` cubre la rama que TypeScript no puede descartar
      // y de paso la nota sin cita, que es la del docente al revisar.
      const cuando = cita?.completedAt ?? new Date(caso.openedAt.getTime() + k * 86_400_000);
      // El alumno ESCRIBE, el docente FIRMA. Es la mitad del P2-13 que sí
      // se puede sembrar bien: la firma lleva el userId del docente.
      const firmada = rr() < 0.7;
      const enviada = !firmada && rr() < 0.6;
      notaRows.push({
        id: did("rec", caso.id, k),
        institutionId: inst,
        caseId: caso.id,
        patientId: caso.patientId,
        studentId: caso.studentId,
        authorUserId: alumno.userId,
        appointmentId: cita ? cita.id : null,
        subjetivo: "Paciente refiere molestia a la masticación en el cuadrante tratado; niega dolor espontáneo.",
        objetivo: "A la exploración, tejidos periodontales sin signos de inflamación aguda. Percusión vertical negativa.",
        analisis: pick(rr, DIAGNOSTICOS),
        plan: "Continuar con el plan establecido. Cita de control en tres semanas. Se refuerzan indicaciones de higiene.",
        diagnostico: pick(rr, DIAGNOSTICOS),
        status: firmada ? "FIRMADA" : enviada ? "ENVIADA" : "BORRADOR",
        submittedAt: firmada || enviada ? cuando : null,
        signedAt: firmada ? cuando : null,
        signedByUserId: firmada ? alumno.docenteUserId : null,
        createdAt: cuando,
      });
    }

    // Estudios. El tamaño es verosímil; el NOMBRE dice que no hay archivo.
    const nEst = extremo ? 240 : gordo ? 45 : rr() < 0.55 ? 1 : rr() < 0.85 ? 2 : 4;
    for (let k = 0; k < nEst; k++) {
      const dado = rr();
      const clase: { kind: EduStudyKind; nombre: string; mime: string; lo: number; hi: number } =
        dado < 0.55
          ? { kind: "RADIOGRAFIA", nombre: `Periapical ${pick(rr, DIENTES)}`, mime: "image/png", lo: 380_000, hi: 1_400_000 }
          : dado < 0.78
            ? { kind: "RADIOGRAFIA", nombre: "Ortopantomografía", mime: "image/jpeg", lo: 2_400_000, hi: 6_800_000 }
            : dado < 0.9
              ? { kind: "FOTO", nombre: "Serie fotográfica intraoral", mime: "image/jpeg", lo: 1_200_000, hi: 4_000_000 }
              : dado < 0.97
                ? { kind: "TOMOGRAFIA", nombre: "CBCT maxilar (volumen completo)", mime: "application/zip", lo: 290_000_000, hi: 620_000_000 }
                : { kind: "PDF", nombre: "Informe de laboratorio", mime: "application/pdf", lo: 120_000, hi: 900_000 };
      const id = did("std", caso.id, k);
      estudioRows.push({
        id,
        institutionId: inst,
        patientId: caso.patientId,
        caseId: caso.id,
        kind: clase.kind,
        // 🔴 El aviso viaja PEGADO al dato que engañaría: quien lee "412 MB"
        // lee, en el mismo renglón, que detrás no hay binario.
        name: `${clase.nombre}${DEMO_STUDY_SUFFIX}`,
        storagePath: `${DEMO_STORAGE_PREFIX}${inst}/${caso.patientId}/${id}`,
        mimeType: clase.mime,
        sizeBytes: BigInt(int(rr, clase.lo, clase.hi)),
        notes: null,
        uploadedById: alumno.userId,
        createdAt: caso.openedAt,
      });
    }
  }
  await meter("notas clínicas", notaRows, (c) => db.eduRecord.createMany({ data: c, skipDuplicates: true }));
  await meter("estudios", estudioRows, (c) => db.eduStudy.createMany({ data: c, skipDuplicates: true }));

  const odonto: Prisma.EduOdontogramEntryCreateManyInput[] = [];
  pacientes.forEach((p, i) => {
    if (!GORDOS.has(i) && i % 2 === 1) return;
    const n = GORDOS.has(i) ? 26 : int(rr, 3, 9);
    const usados = new Set<string>();
    for (let k = 0; k < n; k++) {
      const tooth = DIENTES[(i * 7 + k * 3) % DIENTES.length];
      const surface = SUPERFICIES[(i + k) % SUPERFICIES.length];
      const condition = CONDICIONES[(i * 3 + k) % CONDICIONES.length];
      const llave = `${tooth}|${surface}|${condition}`;
      if (usados.has(llave)) continue;
      usados.add(llave);
      odonto.push({
        id: did("odo", p.folio, k),
        institutionId: inst,
        patientId: p.id,
        tooth,
        surface,
        condition,
        notes: null,
        recordedById: alumnos[p.alumnoIdx].userId,
        recordedAt: diaUtc(eduShiftDayISO(hoy, -int(rr, 10, 400))),
      });
    }
  });
  await meter("odontograma", odonto, (c) => db.eduOdontogramEntry.createMany({ data: c, skipDuplicates: true }));

  // ── 7.11 · El gate de autorización ────────────────────────────────────
  // Con 400 casos, la bandeja de un docente tiene que tener cola: es la
  // pantalla que decide si el alumno puede seguir.
  const rg = rng("gate");
  const ETAPAS: EduApprovalStage[] = ["PLAN", "PROCEDURE", "SESSION", "DISCHARGE"];
  const aprobaciones: Prisma.EduCaseApprovalCreateManyInput[] = [];
  casoRows.forEach((caso, i) => {
    if (caso.status === "SCREENING") return;
    const alumno = alumnoPorStudentId.get(caso.studentId)!;
    const cuantas = caso.status === "COMPLETED" ? 4 : int(rg, 1, 3);
    for (let k = 0; k < cuantas; k++) {
      const etapa = ETAPAS[k % ETAPAS.length];
      const pendiente = k === cuantas - 1 && rg() < 0.22 && caso.closedAt === null;
      const pedido = new Date(caso.openedAt.getTime() + (k + 1) * 6 * 86_400_000);
      aprobaciones.push({
        id: did("apv", caso.id, k),
        institutionId: inst,
        caseId: caso.id,
        stage: etapa,
        targetType: etapa === "SESSION" ? "EduAppointment" : "EduCase",
        targetId: caso.id,
        contentHash: createHash("sha256").update(`${caso.id}|${etapa}|${k}`).digest("hex"),
        status: pendiente ? "PENDING" : rg() < 0.9 ? "APPROVED" : "CHANGES_REQUESTED",
        requestedById: alumno.userId,
        requestedAt: pedido,
        decidedById: pendiente ? null : alumno.docenteUserId,
        decidedAt: pendiente ? null : new Date(pedido.getTime() + 3 * 3_600_000),
        decisionNote: pendiente ? null : "Autorizado. Continuar según el plan presentado.",
        isEmergency: false,
      });
    }
  });
  await meter("autorizaciones", aprobaciones, (c) => db.eduCaseApproval.createMany({ data: c, skipDuplicates: true }));

  // ── 7.12 · Consentimientos y recetas ──────────────────────────────────
  const consent: Prisma.EduConsentCreateManyInput[] = [];
  casoRows.forEach((caso, i) => {
    if (i % 3 !== 0) return;
    const alumno = alumnoPorStudentId.get(caso.studentId)!;
    const p = procPorId.get(caso.procedureId)!;
    const firmado = rg() < 0.75;
    consent.push({
      id: did("cons", caso.id),
      institutionId: inst,
      patientId: caso.patientId,
      caseId: caso.id,
      procedureKey: p.code,
      procedure: p.name,
      content: `Consentimiento informado para ${p.name.toLowerCase()} en la clínica de ${DEMO_NAME}. Documento de DEMOSTRACIÓN.`,
      contentHash: createHash("sha256").update(`${caso.id}|${p.code}`).digest("hex"),
      token: did("tok", caso.id).slice(0, 40),
      expiresAt: new Date(caso.openedAt.getTime() + 30 * 86_400_000),
      studentUserId: alumno.userId,
      studentName: alumno.nombre,
      studentMatricula: alumno.matricula,
      supervisorUserId: alumno.docenteUserId,
      supervisorName: docentePorId.get(alumno.docenteUserId)!.nombre,
      createdByUserId: alumno.userId,
      createdByName: alumno.nombre,
      signerName: firmado ? pacientePorId.get(caso.patientId)!.nombre : null,
      signerRelation: firmado ? "Titular" : null,
      signedAt: firmado ? new Date(caso.openedAt.getTime() + 86_400_000) : null,
      createdAt: caso.openedAt,
    });
  });
  await meter("consentimientos", consent, (c) => db.eduConsent.createMany({ data: c, skipDuplicates: true }));

  const recetas: Prisma.EduPrescriptionCreateManyInput[] = [];
  const recetaItems: Prisma.EduPrescriptionItemCreateManyInput[] = [];
  casoRows.forEach((caso, i) => {
    if (i % 4 !== 1) return;
    const alumno = alumnoPorStudentId.get(caso.studentId)!;
    const doc = docentePorId.get(alumno.docenteUserId)!;
    const expedida = rg() < 0.7;
    const id = did("rx", caso.id);
    recetas.push({
      id,
      institutionId: inst,
      caseId: caso.id,
      patientId: caso.patientId,
      status: expedida ? "EXPEDIDA" : "PENDIENTE",
      diagnosis: pick(rg, DIAGNOSTICOS),
      indications: "Tomar los medicamentos con alimento. Acudir a urgencias si hay inflamación o fiebre.",
      proposedByUserId: alumno.userId,
      proposedByName: alumno.nombre,
      proposedByMatricula: alumno.matricula,
      issuedByUserId: expedida ? doc.id : null,
      issuedByName: expedida ? doc.nombre : null,
      issuedByCedula: expedida ? String(4000000 + docentes.indexOf(doc) * 7331) : null,
      issuedAt: expedida ? new Date(caso.openedAt.getTime() + 2 * 86_400_000) : null,
      issuedHash: expedida ? createHash("sha256").update(id).digest("hex") : null,
      createdAt: caso.openedAt,
    });
    const cuantos = int(rg, 1, 3);
    for (let k = 0; k < cuantos; k++) {
      const m = MEDICINAS[(i + k) % MEDICINAS.length];
      recetaItems.push({
        id: did("rxi", caso.id, k),
        institutionId: inst,
        prescriptionId: id,
        orden: k,
        drug: m.drug,
        presentation: m.pres,
        dose: m.dose,
        route: m.route,
        frequency: m.freq,
        duration: m.dur,
        quantity: m.qty,
      });
    }
  });
  await meter("recetas", recetas, (c) => db.eduPrescription.createMany({ data: c, skipDuplicates: true }));
  await meter("medicamentos", recetaItems, (c) => db.eduPrescriptionItem.createMany({ data: c, skipDuplicates: true }));

  // ── 7.13 · El dinero: turnos, cobros, pagos y planes a meses ──────────
  const rd = rng("dinero");
  const turnos: (Prisma.EduCashSessionCreateManyInput & { id: string })[] = [];
  const diasCaja = dias(eduShiftDayISO(hoy, -45), hoy).filter(esHabil);
  diasCaja.forEach((d, i) => {
    const abierto = d === hoy;
    turnos.push({
      id: did("cash", d),
      institutionId: inst,
      openedAt: instante(d, 510),
      closedAt: abierto ? null : instante(d, 1170),
      openingCents: 200000,
      countedCents: abierto ? null : int(rd, 200000, 900000),
      expectedCents: abierto ? null : int(rd, 200000, 900000),
      differenceCents: abierto ? null : int(rd, -5000, 5000),
      openedByUserId: cajas[i % 2].id,
      closedByUserId: abierto ? null : cajas[i % 2].id,
    });
  });
  await meter("turnos de caja", turnos, (c) => db.eduCashSession.createMany({ data: c, skipDuplicates: true }));
  const turnoIds = new Set(turnos.map((t) => t.id));

  const cobros: Prisma.EduChargeCreateManyInput[] = [];
  const cobroItems: Prisma.EduChargeItemCreateManyInput[] = [];
  const pagos: Prisma.EduPaymentCreateManyInput[] = [];
  const planes: Prisma.EduPaymentPlanCreateManyInput[] = [];
  const mensualidades: Prisma.EduInstallmentCreateManyInput[] = [];
  let folioCobro = 0;
  const casosCobrables = casoRows.filter((c) => c.status !== "SCREENING");
  casosCobrables.forEach((caso, i) => {
    if (i % 2 === 1) return;
    const p = procPorId.get(caso.procedureId)!;
    const pac = pacienteRowPorId.get(caso.patientId)!;
    const referido = Boolean(pac.referredByStudentId);
    const precio = referido ? p.alumno : p.publico;
    if (precio <= 0) return;
    const cantidad = int(rd, 1, 2);
    const subtotal = precio * cantidad;
    const descuento = rd() < 0.15 ? Math.round(subtotal * 0.1) : 0;
    const total = subtotal - descuento;
    const diaCobroISO = eduShiftDayISO(hoy, -int(rd, 0, 44));
    const dia = esHabil(diaCobroISO) ? diaCobroISO : eduShiftDayISO(diaCobroISO, -1);
    const id = did("chg", caso.id);
    const folio = `C-${String(++folioCobro).padStart(4, "0")}`;
    const aMeses = rd() < 0.1 && total >= 150000;
    const pagado = aMeses ? 0 : rd() < 0.62 ? total : rd() < 0.5 ? Math.round(total / 2) : 0;
    const sesion = turnoIds.has(did("cash", dia)) ? did("cash", dia) : null;
    cobros.push({
      id,
      institutionId: inst,
      folio,
      patientId: caso.patientId,
      caseId: caso.id,
      feeScheduleId: referido ? tarifarios[1].id : tarifarios[0].id,
      feeScheduleLabel: referido ? tarifarios[1].name : tarifarios[0].name,
      subtotalCents: subtotal,
      discountCents: descuento,
      totalCents: total,
      paidCents: pagado,
      balanceCents: total - pagado,
      status: pagado >= total ? "PAID" : pagado > 0 ? "PARTIAL" : "PENDING",
      chargedByUserId: cajas[i % 2].id,
      chargedAt: instante(dia, int(rd, 600, 1100)),
      cashSessionId: sesion,
      campusId: sedes[i % 3].id,
      idempotencyKey: null,
    });
    cobroItems.push({
      id: did("chgi", caso.id, 0),
      institutionId: inst,
      chargeId: id,
      procedureId: caso.procedureId,
      description: p.name,
      quantity: cantidad,
      unitPriceCents: precio,
      discountCents: descuento,
      totalCents: total,
      clientPriceCents: referido ? p.publico * cantidad : null,
    });
    if (pagado > 0) {
      pagos.push({
        id: did("pay", caso.id, 0),
        institutionId: inst,
        chargeId: id,
        method: pick(rd, ["CASH", "CARD", "TRANSFER"] as const),
        amountCents: pagado,
        isRefund: false,
        paidAt: instante(dia, int(rd, 600, 1100)),
        receivedByUserId: cajas[i % 2].id,
        cashSessionId: sesion,
      });
    }
    if (aMeses) {
      // El residuo ENTERO va en la PRIMERA mensualidad (#149): repartirlo
      // al final deja un último recibo de $0.03 que nadie sabe cobrar.
      const meses = pick(rd, [3, 6, 9, 12] as const);
      const base = Math.floor(total / meses);
      const residuo = total - base * meses;
      const planId = did("plan", caso.id);
      const diaVence = int(rd, 1, 28);
      planes.push({
        id: planId,
        institutionId: inst,
        chargeId: id,
        patientId: caso.patientId,
        status: "ACTIVO",
        months: meses,
        installmentCents: base,
        downPaymentCents: 0,
        dueDay: diaVence,
        createdByUserId: cajas[i % 2].id,
        createdAt: instante(dia, 700),
      });
      for (let m = 1; m <= meses; m++) {
        const d = new Date(Date.UTC(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1 + m, diaVence));
        mensualidades.push({
          id: did("inst", caso.id, m),
          institutionId: inst,
          planId,
          number: m,
          amountCents: m === 1 ? base + residuo : base,
          dueDate: d,
          paymentId: null,
        });
      }
    }
  });
  await meter("cobros", cobros, (c) => db.eduCharge.createMany({ data: c, skipDuplicates: true }));
  await meter("conceptos", cobroItems, (c) => db.eduChargeItem.createMany({ data: c, skipDuplicates: true }));
  await meter("pagos", pagos, (c) => db.eduPayment.createMany({ data: c, skipDuplicates: true }));
  await meter("planes a meses", planes, (c) => db.eduPaymentPlan.createMany({ data: c, skipDuplicates: true }));
  await meter("mensualidades", mensualidades, (c) => db.eduInstallment.createMany({ data: c, skipDuplicates: true }));

  // ── 7.14 · Calificaciones ─────────────────────────────────────────────
  const rn = rng("notas");
  const grados: Prisma.EduCaseGradeCreateManyInput[] = [];
  const gradoItems: Prisma.EduCaseGradeItemCreateManyInput[] = [];
  casoRows.forEach((caso) => {
    if (!["COMPLETED", "IN_TREATMENT", "TRANSFERRED"].includes(caso.status)) return;
    if (caso.status !== "COMPLETED" && rn() < 0.5) return;
    const alumno = alumnoPorStudentId.get(caso.studentId)!;
    const rubId = did("rub", alumno.programCode);
    const id = did("grd", caso.id);
    let final = 0;
    CRITERIOS.forEach((cr, ci) => {
      const puntos = int(rn, 6500, 9900);
      final += Math.round((puntos * cr.peso) / 100);
      gradoItems.push({
        id: did("grdi", caso.id, ci),
        institutionId: inst,
        gradeId: id,
        criterionId: did("crit", alumno.programCode, ci),
        criterionName: cr.name,
        weightPercent: cr.peso,
        scoreX100: puntos,
        comment: null,
        orderIndex: ci,
      });
    });
    grados.push({
      id,
      institutionId: inst,
      caseId: caso.id,
      studentId: caso.studentId,
      rubricId: rubId,
      rubricName: `Rúbrica clínica de ${PROGRAMAS.find((p) => p.code === alumno.programCode)!.name}`,
      scaleMin: 0,
      scaleMax: 100,
      gradedById: alumno.docenteUserId,
      gradedAt: caso.closedAt ?? new Date(caso.openedAt.getTime() + 60 * 86_400_000),
      finalScoreX100: final,
      comment: final >= 9000 ? "Excelente manejo del caso." : final >= 8000 ? "Buen desempeño; cuidar el registro del expediente." : "Debe reforzar la fase diagnóstica.",
    });
  });
  await meter("calificaciones", grados, (c) => db.eduCaseGrade.createMany({ data: c, skipDuplicates: true }));
  await meter("criterios calificados", gradoItems, (c) => db.eduCaseGradeItem.createMany({ data: c, skipDuplicates: true }));

  // ── 7.15 · Cupo de IA ─────────────────────────────────────────────────
  // La fila de cupo es el interruptor (schema: `aiQuota` es 1:1 OPCIONAL).
  // Se crea encendida con un tope y SIN sobregiro para que la pantalla de
  // IA tenga cupo, gasto y un techo que enseñar.
  await db.eduAiQuota.upsert({
    where: { institutionId: inst },
    update: {},
    create: {
      id: did("quota", inst),
      institutionId: inst,
      monthlyUsdCents: 25000,
      allowOverage: false,
      hardCapUsdCents: 30000,
      isEnabled: true,
      updatedByName: direccion.nombre,
    },
  });
  const alumnoPorUserId = new Map(alumnos.map((a) => [a.userId, a]));
  const usos: Prisma.EduAiUsageCreateManyInput[] = [];
  const ri = rng("ia");
  estudioRows.slice(0, 220).forEach((e, i) => {
    const alumno = alumnoPorUserId.get(e.uploadedById)!;
    const cuando = new Date(e.createdAt.getTime() + 3600_000);
    usos.push({
      id: did("aiu", e.id),
      institutionId: inst,
      feature: i % 3 === 0 ? "DICTADO" : "ANALISIS",
      userId: alumno.userId,
      userName: alumno.nombre,
      userRole: "ALUMNO",
      studyId: i % 3 === 0 ? null : e.id,
      caseId: e.caseId,
      targetLabel: e.name,
      model: i % 3 === 0 ? "whisper-1" : "claude-sonnet-5",
      unit: i % 3 === 0 ? "SECOND" : "TOKEN",
      inputUnits: i % 3 === 0 ? int(ri, 40, 400) : int(ri, 1200, 9000),
      outputUnits: i % 3 === 0 ? 0 : int(ri, 300, 2400),
      costUsdMicros: int(ri, 800, 42000),
      isEstimated: false,
      periodKey: `${cuando.getUTCFullYear()}-${String(cuando.getUTCMonth() + 1).padStart(2, "0")}`,
      createdAt: cuando,
    });
  });
  await meter("usos de IA", usos, (c) => db.eduAiUsage.createMany({ data: c, skipDuplicates: true }));

  // 🔴 NO se crea EduWhatsappConfig. Ver la cabecera del archivo: el cron de
  // recordatorios arranca de esa tabla, y sin fila el instituto de demo no
  // existe para él. Tampoco se crea ninguna EduWhatsappMessage.
  console.log("  · WhatsApp                     0  (a propósito: sin config no hay cron que lo mire)");
}

// ═══════════════════════════════════════════════════════════════════════
// 8 · EL RECORRIDO CON CRONÓMETRO
//
// No mide "la página": mide LAS CONSULTAS QUE LA PÁGINA HACE, llamando a
// los mismos loaders que llama el server component, con el mismo contexto
// que les llega. Es lo único medible sin una sesión de Supabase, y es
// además lo que interesa: el render de React sobre 300 filas no es lo que
// tarda tres segundos.
//
// De cada pantalla salen tres números:
//   · ms       — cuánto tarda la carga completa (todas sus consultas).
//   · filas    — cuántas filas devuelven los loaders a la página.
//   · leídas   — cuántas filas LEE la base para producir esas (el número
//                que de verdad crece, y el que la paginación no acota
//                cuando no hay paginación).
// ═══════════════════════════════════════════════════════════════════════

interface Medicion {
  pantalla: string;
  ms: number;
  filas: number;
  leidas: number;
  kb: number;
  nota: string;
}

const mediciones: Medicion[] = [];

async function cronometrar<T>(fn: () => Promise<T>): Promise<{ ms: number; out: T }> {
  const t = process.hrtime.bigint();
  const out = await fn();
  return { ms: Number(process.hrtime.bigint() - t) / 1e6, out };
}

function kb(x: unknown): number {
  return Math.round(
    Buffer.byteLength(JSON.stringify(x, (_k, v) => (typeof v === "bigint" ? String(v) : v)) ?? "") / 102.4,
  ) / 10;
}

async function medir(db: PrismaClient, inst: string): Promise<void> {
  // `server-only` no existe en node_modules (lo resuelve el bundler de
  // Next), asi que cargar src/lib/edu/resumen.ts fuera de Next muere con
  // "Cannot find module 'server-only'". Mismo truco que
  // src/lib/clinical-shared/__tests__/_sin-server-only.ts, pero AQUI y no
  // arriba del archivo: los `import` estaticos se izan y este parche
  // correria despues; los `import()` de abajo son dinamicos y se evaluan
  // cuando se llama a esta funcion, o sea ya con el parche puesto.
  const M = Module as unknown as {
    _load: (req: string, parent: unknown, isMain: boolean) => unknown;
    __sinServerOnly?: boolean;
  };
  if (!M.__sinServerOnly) {
    const original = M._load;
    M._load = function (this: unknown, req: string, parent: unknown, isMain: boolean) {
      if (req === "server-only" || req === "client-only") return {};
      return original.call(this, req, parent, isMain);
    };
    M.__sinServerOnly = true;
  }

  const [
    { listEduEvaluacion, listEduRequirements },
    { listEduAgenda, listEduStudentOptions, listEduSupervisorOptions },
    { listEduChairOptions },
    { listEduCasosPanel, listEduCasosParaExport },
    { listEduPatients, listEduPatientOptions, getEduPatient },
    { listEduPrograms, listEduCohorts, listEduCurrentAssignments },
    { getEduDireccionAhora, getEduDireccionPanel, eduDirContextFrom },
    { getEduCampusScope },
    { eduWithCampus },
    { getEduPatientResumen },
    { listEduPatientRecords },
    { EDU_RECORD_MAX_ROWS },
    { listEduPatientStudies },
    { EDU_STUDY_MAX_ROWS },
    { parseEduCasosPanelFilters },
    { parseEduAgendaQuery },
    { buildEduCasosCsv },
  ] = await Promise.all([
    import("@/lib/edu/evaluacion"),
    import("@/lib/edu/agenda"),
    import("@/lib/edu/sillones"),
    import("@/lib/edu/casos"),
    import("@/lib/edu/pacientes"),
    import("@/lib/edu/padron"),
    import("@/lib/edu/direccion"),
    import("@/lib/edu/campus"),
    import("@/lib/edu/campus-core"),
    import("@/lib/edu/resumen"),
    import("@/lib/edu/expediente"),
    import("@/lib/edu/expediente-core"),
    import("@/lib/edu/estudios"),
    import("@/lib/edu/estudios-core"),
    import("@/lib/edu/casos-core"),
    import("@/lib/edu/agenda-core"),
    import("@/lib/edu/casos-core"),
  ]);

  const dir = await db.eduUser.findFirst({ where: { institutionId: inst, role: "DIRECCION" }, select: { id: true } });
  const doc = await db.eduUser.findFirst({ where: { institutionId: inst, role: "DOCENTE" }, select: { id: true } });
  if (!dir || !doc) throw new Error("No hay instituto sembrado que medir. Corre el seed primero.");

  // El MISMO contexto que getEduContext() le entrega a cada pantalla, con
  // su tipo de verdad: si una ola futura le agrega un campo obligatorio al
  // contexto, esto deja de compilar en vez de medir con un contexto viejo.
  const ctx: EduClinicaContext = {
    institutionId: inst,
    role: "DIRECCION",
    eduUserId: dir.id,
    campusIds: null,
  };
  const ctxDocente: EduClinicaContext = { ...ctx, role: "DOCENTE", eduUserId: doc.id };
  const ctxInst = { ...ctx, institution: { name: DEMO_NAME, timezone: TZ } };
  const hoy = eduTodayISO(TZ);
  const now = new Date();

  // Calentar el cliente de `@/lib/prisma` (el que usan los loaders, que NO
  // es el `db` de este script): sin esto la PRIMERA pantalla medida se come
  // el coste de abrir la conexion y sale inflada.
  await listEduPrograms(ctx);

  const anota = (m: Medicion) => {
    mediciones.push(m);
    console.log(
      `  ${m.pantalla.padEnd(46)} ${String(Math.round(m.ms)).padStart(5)} ms ` +
        `${String(m.filas).padStart(5)} filas ${String(m.leidas).padStart(7)} leidas ${String(m.kb).padStart(7)} KB` +
        (m.nota ? `\n      ${m.nota}` : ""),
    );
  };

  // ── /instituto/evaluacion ─────────────────────────────────────────────
  // El sospechoso número uno (P2-6 de docs/audits/EDU_AUDIT.md). Antes de
  // cronometrarlo se cuenta A MANO lo que sus cuatro consultas van a leer,
  // porque el punto del hallazgo NO es lo que devuelve sino lo que arrastra.
  const alumnosVisibles = await db.eduStudent.count({ where: { institutionId: inst } });
  const idsAlumnos = (await db.eduStudent.findMany({ where: { institutionId: inst }, select: { id: true }, take: 300 })).map((s) => s.id);
  const [nCasos, nCitas, nNotas, nReq] = await Promise.all([
    db.eduCase.count({ where: { institutionId: inst, studentId: { in: idsAlumnos } } }),
    db.eduAppointment.count({ where: { institutionId: inst, studentId: { in: idsAlumnos }, status: "COMPLETED" } }),
    db.eduCaseGrade.count({ where: { institutionId: inst, studentId: { in: idsAlumnos } } }),
    db.eduRequirement.count({ where: { institutionId: inst, isActive: true } }),
  ]);
  const evalLeidas = Math.min(alumnosVisibles, 301) + nCasos + nCitas + nNotas + nReq;

  // ANTES del arreglo del P2-6: el padrón entero. Sigue siendo alcanzable
  // (?generacion=todas) porque una acreditación lo pide, y por eso se mide.
  const ev = await cronometrar(() => listEduEvaluacion(ctx, { generacion: "todas" }, now));
  anota({
    pantalla: "/instituto/evaluacion (TODAS las generaciones)",
    ms: ev.ms,
    filas: ev.out.rows.length,
    leidas: evalLeidas,
    kb: kb(ev.out.rows),
    nota: `casos ${nCasos} · citas COMPLETED ${nCitas} · calificaciones ${nNotas}`,
  });

  // DESPUÉS: lo que de verdad se abre al entrar a la pantalla.
  const evVig = await cronometrar(() => listEduEvaluacion(ctx, { generacion: "vigente" }, now));
  const nomVig = evVig.out.generacion.name;
  const idsVig = nomVig
    ? (await db.eduStudent.findMany({
        where: { institutionId: inst, cohort: { name: nomVig } },
        select: { id: true },
      })).map((x) => x.id)
    : [];
  const [vCas, vCit, vNot] = await Promise.all([
    db.eduCase.count({ where: { institutionId: inst, studentId: { in: idsVig } } }),
    db.eduAppointment.count({ where: { institutionId: inst, studentId: { in: idsVig }, status: "COMPLETED" } }),
    db.eduCaseGrade.count({ where: { institutionId: inst, studentId: { in: idsVig } } }),
  ]);
  const vigLeidas = idsVig.length + vCas + vCit + vNot + nReq;
  anota({
    pantalla: `/instituto/evaluacion (DEFAULT: vigente ${nomVig ?? "?"})`,
    ms: evVig.ms,
    filas: evVig.out.rows.length,
    leidas: vigLeidas,
    kb: kb(evVig.out.rows),
    nota:
      `casos ${vCas} · citas COMPLETED ${vCit} · calificaciones ${vNot}` +
      `  → ${(100 - (vigLeidas * 100) / Math.max(1, evalLeidas)).toFixed(0)}% menos filas que "todas"`,
  });

  // Las DOS generaciones por separado: el filtro que el P2-6 propone como
  // arreglo, medido contra la pantalla sin filtro de arriba.
  const cohortes = await listEduCohorts(ctx);
  const vistas = new Set<string>();
  for (const co of cohortes) {
    if (vistas.has(co.name)) continue;
    vistas.add(co.name);
    const evg = await cronometrar(() => listEduEvaluacion(ctx, { cohortId: co.id }, now));
    const idsGen = (await db.eduStudent.findMany({ where: { institutionId: inst, cohortId: co.id }, select: { id: true } })).map((x) => x.id);
    const [gCas, gCit, gNot] = await Promise.all([
      db.eduCase.count({ where: { institutionId: inst, studentId: { in: idsGen } } }),
      db.eduAppointment.count({ where: { institutionId: inst, studentId: { in: idsGen }, status: "COMPLETED" } }),
      db.eduCaseGrade.count({ where: { institutionId: inst, studentId: { in: idsGen } } }),
    ]);
    anota({
      pantalla: `/instituto/evaluacion (1 generacion: ${co.name})`,
      ms: evg.ms,
      filas: evg.out.rows.length,
      leidas: idsGen.length + gCas + gCit + gNot + nReq,
      kb: kb(evg.out.rows),
      nota: `casos ${gCas} · citas COMPLETED ${gCit} · calificaciones ${gNot}`,
    });
  }

  const evReq = await cronometrar(() => listEduRequirements(ctx));
  anota({ pantalla: "/instituto/requisitos", ms: evReq.ms, filas: evReq.out.length, leidas: evReq.out.length, kb: kb(evReq.out), nota: "" });

  // ── /instituto/agenda ─────────────────────────────────────────────────
  const sede = await getEduCampusScope(ctxInst);
  const cctx = eduWithCampus(ctx, sede);
  const q = parseEduAgendaQuery({ dia: hoy }, TZ, now);
  const ag = await cronometrar(async () => {
    const [page, sillones, alumnos, docentes, programas, pacientes] = await Promise.all([
      listEduAgenda(cctx, q, TZ, now),
      listEduChairOptions(cctx),
      listEduStudentOptions(ctx, now),
      listEduSupervisorOptions(ctx),
      listEduPrograms(ctx),
      listEduPatientOptions(ctx, now),
    ]);
    return { page, sillones, alumnos, docentes, programas, pacientes };
  });
  const a = ag.out;
  anota({
    pantalla: "/instituto/agenda · HOY, 3 sedes (32 sillones)",
    ms: ag.ms,
    filas: a.page.rows.length + a.sillones.length + a.alumnos.length + a.docentes.length + a.programas.length + a.pacientes.length,
    leidas: a.page.rows.length + a.sillones.length + a.alumnos.length + a.docentes.length + a.programas.length + a.pacientes.length,
    kb: kb(a),
    nota: `citas ${a.page.rows.length}${a.page.truncated ? " (CORTADA en 500)" : ""} · sillones ${a.sillones.length} · pacientes en el <select> ${a.pacientes.length}`,
  });

  for (const primeraSede of sede.options ?? []) {
    const sctx = eduWithCampus(ctx, { ...sede, active: primeraSede, activeId: primeraSede.id, campusIds: [primeraSede.id] } as any);
    const ag1 = await cronometrar(() => listEduAgenda(sctx, q, TZ, now));
    anota({
      pantalla: `/instituto/agenda · HOY, solo ${primeraSede.name}`,
      ms: ag1.ms,
      filas: ag1.out.rows.length,
      leidas: ag1.out.rows.length,
      kb: kb(ag1.out.rows),
      nota: "elegir sede es lo unico que baja la rejilla de 32 columnas",
    });
  }

  const agSem = await cronometrar(() => listEduAgenda(cctx, parseEduAgendaQuery({ dia: hoy, vista: "semana" }, TZ, now), TZ, now));
  anota({
    pantalla: "/instituto/agenda · SEMANA, 3 sedes",
    ms: agSem.ms,
    filas: agSem.out.rows.length,
    leidas: agSem.out.rows.length,
    kb: kb(agSem.out.rows),
    nota: agSem.out.truncated ? "CORTADA en 500 — la semana no cabe" : "",
  });

  // ── /instituto/casos ──────────────────────────────────────────────────
  const totalCasos = await db.eduCase.count({ where: { institutionId: inst } });
  const cs = await cronometrar(async () => {
    const [page, programas, alumnos, docentes] = await Promise.all([
      listEduCasosPanel(ctx, parseEduCasosPanelFilters({}), TZ, now),
      listEduPrograms(ctx),
      listEduStudentOptions(ctx, now),
      listEduSupervisorOptions(ctx),
    ]);
    return { page, programas, alumnos, docentes };
  });
  anota({
    pantalla: "/instituto/casos (sin filtro)",
    ms: cs.ms,
    filas: cs.out.page.rows.length + cs.out.alumnos.length + cs.out.docentes.length + cs.out.programas.length,
    leidas: totalCasos,
    kb: kb(cs.out),
    nota: cs.out.page.truncated ? `CORTADA en 300 de ${totalCasos}` : `${totalCasos} en la base`,
  });

  const csFil = await cronometrar(() => listEduCasosPanel(ctx, parseEduCasosPanelFilters({ estado: "IN_TREATMENT" }), TZ, now));
  anota({ pantalla: "/instituto/casos (filtro: en tratamiento)", ms: csFil.ms, filas: csFil.out.rows.length, leidas: csFil.out.rows.length, kb: kb(csFil.out.rows), nota: csFil.out.truncated ? "CORTADA en 300" : "" });

  const csTodos = await cronometrar(() => listEduCasosPanel(ctx, parseEduCasosPanelFilters({ cerrados: "1" }), TZ, now));
  anota({
    pantalla: "/instituto/casos (incluyendo cerrados)",
    ms: csTodos.ms,
    filas: csTodos.out.rows.length,
    leidas: totalCasos,
    kb: kb(csTodos.out.rows),
    nota: csTodos.out.truncated ? `CORTADA en 300 de ${totalCasos} — pero el CSV ya no muere` : `${totalCasos} caben`,
  });

  const unApellido = (await db.eduPatient.findFirst({ where: { institutionId: inst }, select: { lastName: true } }))?.lastName?.split(" ")[0] ?? "garcia";
  const csQ = await cronometrar(() => listEduCasosPanel(ctx, parseEduCasosPanelFilters({ q: unApellido }), TZ, now));
  anota({ pantalla: `/instituto/casos (buscador: "${unApellido}")`, ms: csQ.ms, filas: csQ.out.rows.length, leidas: csQ.out.rows.length, kb: kb(csQ.out.rows), nota: "contains sobre searchIndex, sin índice de texto" });

  // El endpoint del CSV lee por SU camino (listEduCasosParaExport), con el
  // tope del export y en lotes. Antes reusaba el de la pantalla y devolvia
  // 413 en cuanto la lista se cortaba: con 400 casos, marcar "incluir
  // cerrados" dejaba a la escuela sin export. Se miden los tres casos.
  const csv = await cronometrar(async () => {
    const page = await listEduCasosParaExport(ctx, parseEduCasosPanelFilters({}), TZ, now);
    return { page, texto: page.truncated ? "" : buildEduCasosCsv(page.rows) };
  });
  anota({
    pantalla: "/api/instituto/casos/export (CSV, sin filtro)",
    ms: csv.ms,
    filas: csv.out.page.truncated ? 0 : csv.out.page.rows.length,
    leidas: csv.out.page.rows.length,
    kb: Math.round(Buffer.byteLength(csv.out.texto) / 102.4) / 10,
    nota: csv.out.page.truncated
      ? "413: sigue negandose (por encima del tope del export)"
      : `${csv.out.page.rows.length} de ${totalCasos}`,
  });

  // EL CASO DEL HALLAZGO: "incluir cerrados" sobre los 400 del seed.
  const csvCerrados = await cronometrar(async () => {
    const page = await listEduCasosParaExport(ctx, parseEduCasosPanelFilters({ cerrados: "1" }), TZ, now);
    return { page, texto: page.truncated ? "" : buildEduCasosCsv(page.rows) };
  });
  anota({
    pantalla: "/api/instituto/casos/export (CSV, INCLUYENDO CERRADOS)",
    ms: csvCerrados.ms,
    filas: csvCerrados.out.page.truncated ? 0 : csvCerrados.out.page.rows.length,
    leidas: csvCerrados.out.page.rows.length,
    kb: Math.round(Buffer.byteLength(csvCerrados.out.texto) / 102.4) / 10,
    nota: csvCerrados.out.page.truncated
      ? "413: sigue negandose"
      : `${csvCerrados.out.page.rows.length} de ${totalCasos} — EXPORTA (la pantalla corta en 300)`,
  });

  const csvFil = await cronometrar(async () => {
    const page = await listEduCasosParaExport(ctx, parseEduCasosPanelFilters({ estado: "COMPLETED" }), TZ, now);
    return { page, texto: page.truncated ? "" : buildEduCasosCsv(page.rows) };
  });
  anota({
    pantalla: "/api/instituto/casos/export (CSV, 1 estado)",
    ms: csvFil.ms,
    filas: csvFil.out.page.rows.length,
    leidas: csvFil.out.page.rows.length,
    kb: Math.round(Buffer.byteLength(csvFil.out.texto) / 102.4) / 10,
    nota: csvFil.out.page.truncated ? "413 tambien" : "acotando si exporta",
  });

  // ── /instituto/pacientes ──────────────────────────────────────────────
  const totalPac = await db.eduPatient.count({ where: { institutionId: inst } });
  const pac = await cronometrar(async () => {
    const [page, alumnos] = await Promise.all([listEduPatients(ctx, {} as any, now), listEduStudentOptions(ctx, now)]);
    return { page, alumnos };
  });
  anota({
    pantalla: "/instituto/pacientes (sin filtro)",
    ms: pac.ms,
    filas: pac.out.page.rows.length + pac.out.alumnos.length,
    leidas: totalPac,
    kb: kb(pac.out),
    nota: pac.out.page.truncated ? `CORTADA en 300 de ${totalPac}` : `${totalPac} en la base`,
  });

  // ── /instituto/direccion ──────────────────────────────────────────────
  const dirCtx = eduDirContextFrom(ctxInst, sede);
  const dAhora = await cronometrar(() => getEduDireccionAhora(dirCtx, {}, now));
  anota({ pantalla: "/instituto/direccion · bloque EN VIVO", ms: dAhora.ms, filas: (dAhora.out as any).sillones?.length ?? 0, leidas: (dAhora.out as any).sillones?.length ?? 0, kb: kb(dAhora.out), nota: "4 consultas" });

  const dPanel = await cronometrar(() => getEduDireccionPanel(dirCtx, {}, now));
  anota({ pantalla: "/instituto/direccion · periodo (30 días)", ms: dPanel.ms, filas: 0, leidas: 0, kb: kb(dPanel.out), nota: `14 consultas · avisos: ${((dPanel.out as any).avisos ?? []).length}` });

  const dPanelAnio = await cronometrar(() => getEduDireccionPanel(dirCtx, { desde: eduShiftDayISO(hoy, -365), hasta: hoy }, now));
  anota({ pantalla: "/instituto/direccion · periodo (365 días)", ms: dPanelAnio.ms, filas: 0, leidas: 0, kb: kb(dPanelAnio.out), nota: ((dPanelAnio.out as any).avisos ?? []).join(" | ").slice(0, 90) });

  // ── La ficha del paciente más cargado ─────────────────────────────────
  const gordo = await db.eduStudy.groupBy({
    by: ["patientId"],
    where: { institutionId: inst },
    _count: { _all: true },
    orderBy: { _count: { patientId: "desc" } },
    take: 1,
  });
  const pid = gordo[0]?.patientId;
  if (pid) {
    const nEst = await db.eduStudy.count({ where: { institutionId: inst, patientId: pid } });
    const nNot = await db.eduRecord.count({ where: { institutionId: inst, patientId: pid } });
    const ficha = await cronometrar(async () => {
      const p = await getEduPatient(ctx, pid);
      const r = await getEduPatientResumen(ctx, pid, TZ);
      return { p, r };
    });
    anota({ pantalla: `Ficha de paciente (${nEst} estudios, ${nNot} notas)`, ms: ficha.ms, filas: 1, leidas: 1, kb: kb(ficha.out), nota: "layout: getEduPatient + getEduPatientResumen" });

    // Las dos devuelven `{ rows, truncated }` desde el arreglo del volumen:
    // sin la bandera, 200 de 200 y 200 de 240 se median exactamente igual.
    const exp = await cronometrar(() => listEduPatientRecords(ctx, pid, TZ));
    anota({
      pantalla: "Ficha · pestaña Expediente",
      ms: exp.ms,
      filas: exp.out.rows.length,
      leidas: Math.min(nNot, EDU_RECORD_MAX_ROWS + 1),
      kb: kb(exp.out.rows),
      nota: exp.out.truncated ? `CORTADA en ${EDU_RECORD_MAX_ROWS} de ${nNot} — y LO DICE` : `${nNot} caben`,
    });

    const est = await cronometrar(() => listEduPatientStudies(ctx, pid, TZ));
    anota({
      pantalla: "Ficha · pestaña Estudios",
      ms: est.ms,
      filas: est.out.rows.length,
      leidas: Math.min(nEst, EDU_STUDY_MAX_ROWS + 1),
      kb: kb(est.out.rows),
      nota: est.out.truncated ? `CORTADA en ${EDU_STUDY_MAX_ROWS} de ${nEst} — y LO DICE` : `${nEst} caben`,
    });
  }

  // ── /instituto/autorizaciones ─────────────────────────────────────────
  const { listEduApprovalInbox } = await import("@/lib/edu/autorizaciones");
  const totalApr = await db.eduCaseApproval.count({ where: { institutionId: inst } });
  const pend = await db.eduCaseApproval.count({ where: { institutionId: inst, status: "PENDING" } });
  const inbox = await cronometrar(() => listEduApprovalInbox(ctx, TZ, now));
  anota({
    pantalla: "/instituto/autorizaciones (bandeja)",
    ms: inbox.ms,
    filas: (inbox.out as any).rows?.length ?? 0,
    leidas: totalApr,
    kb: kb(inbox.out),
    nota: `${pend} pendientes de ${totalApr} autorizaciones en la base`,
  });

  // ── El mismo recorrido con los ojos de un DOCENTE ──────────────────────
  const evDoc = await cronometrar(() => listEduEvaluacion(ctxDocente, { generacion: "vigente" }, now));
  anota({ pantalla: "/instituto/evaluacion (docente: sus alumnos)", ms: evDoc.ms, filas: evDoc.out.rows.length, leidas: evDoc.out.rows.length, kb: kb(evDoc.out.rows), nota: `modo "${evDoc.out.generacion.modo}": el alcance ya acota, el default de generación NO se le aplica` });

  // ── Almacenamiento: lo que sumaría un medidor ─────────────────────────
  const bytes = await db.eduStudy.aggregate({ where: { institutionId: inst }, _sum: { sizeBytes: true }, _count: { _all: true } });
  const gb = Number(bytes._sum.sizeBytes ?? BigInt(0)) / 1024 ** 3;
  console.log(
    `\n  Estudios: ${bytes._count._all} filas, ${gb.toFixed(1)} GB de sizeBytes — y CERO bytes en el bucket.\n` +
      `  Todos se llaman "${DEMO_STUDY_SUFFIX.trim()}" justamente por eso.`,
  );
}

// ═══════════════════════════════════════════════════════════════════════
// 9 · EL BORRADO
//
// Orden: de las hojas hacia la raíz. La mayoría de las llaves son Cascade y
// bastaría con borrar el instituto, PERO el sillón apunta a la sede con
// `onDelete: Restrict` (schema: EduChair.campus) y el borrado se atoraría
// ahí. Este orden funciona con o sin cascada.
// ═══════════════════════════════════════════════════════════════════════

const SQL_BORRADO = `-- ═══════════════════════════════════════════════════════════════════
-- BORRAR EL INSTITUTO DE DEMO. Deja el vertical exactamente como estaba.
-- Todo cuelga de un único id, y ese id sale del slug: si el SELECT no
-- devuelve nada, no se borra nada.
-- ═══════════════════════════════════════════════════════════════════════
BEGIN;

-- Comprobación: si esto no devuelve UNA fila con el prefijo DEMO, PARA.
SELECT id, name, slug FROM edu_institutions WHERE slug = '${DEMO_SLUG}';

WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_installments           WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_payment_plans          WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_prescription_items     WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_prescriptions          WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_invoices               WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_patient_tax_profiles   WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_fiscal_configs         WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_whatsapp_messages      WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_whatsapp_configs       WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_ai_usage               WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_ai_quotas              WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_case_grade_items       WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_case_grades            WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_rubric_criteria        WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_rubrics                WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_requirements           WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_case_approvals         WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_consents               WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_study_analyses         WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_studies                WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_odontogram_entries     WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_records                WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_payments               WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_charge_items           WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_charges                WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_cash_sessions          WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_fee_schedule_items     WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_fee_schedules          WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_appointments           WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_cases                  WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_procedures             WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_patients               WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_chair_schedules        WHERE "institutionId" IN (SELECT id FROM d);
-- El sillón ANTES que la sede: EduChair.campus va con onDelete Restrict.
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_chairs                 WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_user_campus_access     WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_campuses               WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_supervisor_assignments WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_students               WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_cohorts                WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_programs               WHERE "institutionId" IN (SELECT id FROM d);
WITH d AS (SELECT id FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %')
DELETE FROM edu_users                  WHERE "institutionId" IN (SELECT id FROM d);

DELETE FROM edu_institutions WHERE slug = '${DEMO_SLUG}' AND name LIKE 'DEMO · %';

-- Debe devolver 0 en todas.
SELECT (SELECT count(*) FROM edu_institutions WHERE slug = '${DEMO_SLUG}') AS institutos,
       (SELECT count(*) FROM edu_users     WHERE "supabaseId" LIKE 'demoseed-%') AS personas,
       (SELECT count(*) FROM edu_studies   WHERE "storagePath" LIKE '${DEMO_STORAGE_PREFIX}%') AS estudios;

COMMIT;
`;

// ═══════════════════════════════════════════════════════════════════════
// 10 · MAIN
// ═══════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.includes("--sql-borrado")) {
    console.log(SQL_BORRADO);
    return;
  }

  // --direccion=<uuid|correo> — la cuenta REAL que va a poder entrar. Se lee
  // ANTES de conectar para rebotar un argumento vacío sin abrir la base.
  const argDireccion = args.find((a) => a.startsWith("--direccion="));
  const direccionArg = argDireccion ? argDireccion.slice("--direccion=".length).trim() : null;
  if (argDireccion && !direccionArg) {
    throw new Error("GUARDIA: --direccion= necesita un UUID de Supabase o un correo.");
  }

  const host = guardaBase();
  const db = new PrismaClient();
  try {
    const destino = await guardaDestino(db);
    console.log(`\nInstituto de demo: ${DEMO_NAME}`);
    console.log(`  slug ${DEMO_SLUG} · id ${destino.id} · base ${host}\n`);

    const antes = await fotoAjenas(db, destino.id);

    if (!args.includes("--medir")) {
      if (!destino.existe) console.log("Creando el instituto de demo desde cero.\n");
      else console.log("El instituto de demo ya existe: se completa lo que falte (idempotente).\n");
      const t = Date.now();
      await sembrar(db, destino.id);
      console.log(`\nSembrado en ${((Date.now() - t) / 1000).toFixed(1)} s.`);
    }

    // 🔴 LA CUENTA REAL VA DESPUÉS DEL SEMBRADO Y ANTES DE LA GUARDIA.
    // Después, porque necesita que el instituto exista; antes de la
    // comparación de filas ajenas, porque ESCRIBE — y lo que escribe tiene
    // que pasar por esa comprobación como todo lo demás. Si un día esta
    // función tocara una fila de otro instituto, la guardia de abajo la
    // caza y el script sale con código 1.
    if (direccionArg) {
      const quien = await resolverDireccionReal(db, direccionArg);
      const id = await colgarDireccionReal(db, destino.id, quien);
      console.log("\n── CUENTA DE DIRECCIÓN DEL DEMO ─────────────────────────────────\n");
      console.log(`  ${quien.firstName} ${quien.lastName} <${quien.email}>`);
      console.log(`  supabaseId   ${quien.supabaseId}`);
      console.log(`  edu_users.id ${id} · rol DIRECCIÓN · las 3 sedes`);
      console.log("\n  Entra por /instituto/login con ESA cuenta de Supabase.");
      if (quien.yaEntraA) {
        console.log(
          "\n  ⚠️ PERO NO VA A ENTRAR AQUÍ, y hay que decirlo: esa cuenta ya es un\n" +
            `     usuario ACTIVO de "${quien.yaEntraA.nombre}". La sesión se resuelve con la\n` +
            "     fila MÁS VIEJA (edu-auth.ts: findFirst por supabaseId, orderBy createdAt\n" +
            "     asc), así que el login la seguirá mandando allí. Usa una cuenta de\n" +
            "     Supabase que todavía no sea de ningún instituto. La fila del otro\n" +
            "     instituto NO se toca para arreglarlo: es justo lo que este seed tiene\n" +
            "     prohibido, y la guardia de filas ajenas lo comprobaría igual.",
        );
      }
      console.log("");
    }

    if (args.includes("--medir") || args.includes("--con-medicion")) {
      console.log("\n── RECORRIDO CON CRONÓMETRO ─────────────────────────────────────────\n");
      await medir(db, destino.id);
    }

    // 🔴 LA GUARDIA QUE SÍ CORRE: si una sola fila de OTRO instituto cambió,
    // esto sale con código 1 y lo dice con nombre y apellido.
    const males = compararAjenas(antes, await fotoAjenas(db, destino.id));
    if (males.length > 0) {
      console.error("\n⛔ GUARDIA: cambiaron filas que NO son del instituto de demo:");
      for (const m of males) console.error(`   ✗ ${m}`);
      process.exitCode = 1;
      return;
    }
    console.log("\n✅ GUARDIA: ninguna fila fuera del instituto de demo cambió.");
    console.log("   Para borrarlo entero: npm run seed:edu-demo -- --sql-borrado");
    if (!direccionArg) {
      console.log(
        "   Para poder ENTRAR:   npm run seed:edu-demo -- --direccion=<uuid-de-supabase>",
      );
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(`\n${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
