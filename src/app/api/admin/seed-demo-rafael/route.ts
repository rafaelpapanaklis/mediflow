import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/admin/seed-demo-rafael — sembrar datos demo en Rafael Clinica.
 * DELETE /api/admin/seed-demo-rafael — wipe demo (con header X-Confirm-Delete-Demo: yes).
 *
 * Multi-tenant strict: clinicId hardcodeado a Rafael Clinica. NO permite
 * sembrar otra clínica desde body.
 *
 * Solo SUPER_ADMIN. Pacientes seedeados llevan tag "demo" para borrarlos
 * en bulk con DELETE.
 *
 * MediFlow es DENTAL — todos los tratamientos, dx CIE-10 y recetas son
 * de odontología.
 */

const RAFAEL_CLINIC_ID = "cmn6soeaw0000t17xgljxc2iq";
const DEMO_TAG = "demo";

// ── Pool de nombres mexicanos ────────────────────────────────────────────
const NAMES_M = [
  "José", "Juan", "Luis", "Carlos", "Miguel", "Pedro", "Alejandro", "Fernando",
  "Roberto", "Eduardo", "Daniel", "Manuel", "Jorge", "Antonio", "Francisco",
  "Ricardo", "Andrés", "Diego", "Mario", "Ramón", "Sergio", "Arturo", "Raúl",
  "Héctor", "Javier",
];
const NAMES_F = [
  "María", "Guadalupe", "Ana", "Laura", "Rosa", "Carmen", "Elena", "Patricia",
  "Sofía", "Valeria", "Ximena", "Fernanda", "Daniela", "Andrea", "Mariana",
  "Adriana", "Lucía", "Paola", "Karla", "Isabel", "Verónica", "Beatriz",
  "Alejandra", "Mónica", "Gabriela",
];
const LASTNAMES = [
  "García", "Martínez", "López", "Rodríguez", "Hernández", "González", "Pérez",
  "Sánchez", "Ramírez", "Torres", "Flores", "Rivera", "Gómez", "Díaz", "Reyes",
  "Cruz", "Morales", "Ortiz", "Gutiérrez", "Castillo", "Jiménez", "Romero",
  "Mendoza", "Vargas", "Aguilar",
];

const CITIES = [
  "Ciudad de México, CDMX", "Guadalajara, JAL", "Monterrey, NL", "Mérida, YUC",
  "Puebla, PUE", "Tijuana, BC", "León, GTO", "Querétaro, QRO", "Cancún, QROO",
  "Hermosillo, SON", "Toluca, MEX", "Aguascalientes, AGS",
];
const COLONIAS = [
  "Centro", "Roma Norte", "Polanco", "Del Valle", "Condesa", "Reforma",
  "Insurgentes", "Coyoacán", "Lomas", "Anáhuac", "Las Lomas", "Mitras",
];
const STREETS = [
  "Av. Reforma", "Calle Hidalgo", "Av. Juárez", "Calle Madero", "Calle Morelos",
  "Av. Insurgentes", "Calle Allende", "Av. Universidad", "Calle Independencia",
  "Av. Constitución",
];

const EMAIL_DOMAINS = ["gmail.com", "hotmail.com", "yahoo.com", "outlook.com"];
const BLOOD_TYPES = ["O+", "A+", "B+", "O-", "A-", "B-", "AB+", "AB-"];
const ALLERGIES_POOL = ["Penicilina", "Látex", "Ibuprofeno", "Aspirina", "Frutos secos"];
const CHRONIC_POOL = ["Diabetes tipo 2", "Hipertensión", "Asma", "Hipotiroidismo"];
const MEDS_POOL = ["Metformina 850mg", "Losartán 50mg", "Atorvastatina 20mg", "Levotiroxina 100mcg", "Salbutamol inhalado"];
const FAMILY_HX_POOL = [
  "Padre con diabetes tipo 2 controlada", "Madre con hipertensión arterial",
  "Abuela paterna fallecida por infarto", "Hermano con asma alérgica",
  "Antecedentes oncológicos negados", "Padres aparentemente sanos",
];
const PNP_POOL = [
  "Tabaquismo positivo, 5 cigarros/día desde hace 8 años",
  "Higiene dental adecuada, cepilla 2 veces al día",
  "Bruxismo nocturno reportado, sin guarda oclusal",
  "Alcoholismo social ocasional", "Niega toxicomanías",
  "Higiene dental irregular, refiere sangrado al cepillado",
  "Refiere consumo elevado de bebidas azucaradas",
];
const INSURANCE_PROVIDERS = ["GNP", "AXA", "MetLife", "Mapfre", "Banorte Seguros", "Inbursa", "Particular"];
const PATIENT_NOTES_POOL = [
  "Paciente regular, puntual a citas.",
  "Refiere ansiedad odontológica, requiere paciencia.",
  "Tiene seguimiento por ortodoncista externo.",
  "Llamar 1 día antes para confirmar cita.",
  "Prefiere citas matutinas.",
];

// ── Pool de tratamientos dentales ────────────────────────────────────────
interface Treatment {
  type: string;
  durMin: [number, number]; // min..max minutos
  price: [number, number];  // $ MXN min..max
}
const TREATMENTS: Treatment[] = [
  { type: "Limpieza dental",                durMin: [30, 45],   price: [700, 1200] },
  { type: "Profilaxis",                     durMin: [30, 30],   price: [600, 900] },
  { type: "Consulta general",               durMin: [30, 30],   price: [500, 800] },
  { type: "Extracción simple",              durMin: [30, 60],   price: [800, 1500] },
  { type: "Extracción de cordal",           durMin: [60, 90],   price: [2500, 4500] },
  { type: "Endodoncia unirradicular",       durMin: [60, 90],   price: [2500, 4000] },
  { type: "Endodoncia birradicular",        durMin: [90, 90],   price: [3500, 5500] },
  { type: "Endodoncia multirradicular",     durMin: [90, 120],  price: [4500, 7500] },
  { type: "Restauración resina",            durMin: [30, 60],   price: [800, 2000] },
  { type: "Restauración amalgama",          durMin: [30, 45],   price: [600, 1200] },
  { type: "Corona porcelana",               durMin: [90, 90],   price: [4500, 8500] },
  { type: "Blanqueamiento dental",          durMin: [60, 90],   price: [3000, 5500] },
  { type: "Ortodoncia consulta inicial",    durMin: [45, 45],   price: [700, 1500] },
  { type: "Ortodoncia ajuste",              durMin: [30, 30],   price: [500, 1000] },
  { type: "Ortodoncia colocación brackets", durMin: [90, 120],  price: [8000, 15000] },
  { type: "Profilaxis pediátrica",          durMin: [30, 30],   price: [400, 700] },
  { type: "Aplicación de flúor",            durMin: [15, 15],   price: [300, 500] },
  { type: "Selladores dentales",            durMin: [30, 30],   price: [400, 800] },
  { type: "Implante dental",                durMin: [90, 120],  price: [15000, 30000] },
  { type: "Cirugía periodontal",            durMin: [60, 90],   price: [3500, 7000] },
  { type: "Curetaje",                       durMin: [30, 45],   price: [1000, 2000] },
  { type: "Urgencia dolor",                 durMin: [30, 60],   price: [800, 1800] },
];

// CIE-10 dental usados para diagnósticos estructurados (cap K00–K14).
const DX_CODES = ["K02.1", "K02.2", "K02.5", "K02.9", "K04.0", "K04.1", "K04.4", "K04.7", "K05.0", "K05.1", "K05.3", "K07.0", "K08.1", "K12.2", "K00.6", "K01.1"];

// ── Plantillas SOAP por tratamiento ──────────────────────────────────────
function soapTemplate(type: string): { subjective: string; objective: string; assessment: string; plan: string } {
  if (type.startsWith("Endodoncia") || type === "Urgencia dolor") {
    return {
      subjective: "Paciente refiere dolor agudo espontáneo, sensibilidad al frío y al calor que persiste varios minutos. Dolor irradiado al masticar.",
      objective: "Caries profunda con exposición pulpar. Dolor a la percusión vertical. Pruebas térmicas positivas prolongadas. Radiografía periapical: ensanchamiento del ligamento periodontal.",
      assessment: "Pulpitis irreversible sintomática. Indicación de tratamiento de conductos.",
      plan: "Apertura cameral, instrumentación rotatoria, irrigación con hipoclorito de sodio. Sellado provisional. Cita en 1 semana para obturación definitiva. Receta analgésica.",
    };
  }
  if (type.startsWith("Restauración")) {
    return {
      subjective: "Paciente acude por sensibilidad ocasional a alimentos dulces. Sin dolor espontáneo.",
      objective: "Caries oclusal de mediana profundidad sin compromiso pulpar evidente. Tejidos blandos sanos.",
      assessment: "Caries de la dentina (K02.1). Sin compromiso pulpar.",
      plan: "Aislamiento absoluto, eliminación de tejido cariado, restauración con resina compuesta capa por capa. Indicaciones de higiene posterior.",
    };
  }
  if (type.includes("Extracción")) {
    return {
      subjective: "Paciente refiere movilidad dental progresiva, dolor leve al masticar. Sin trauma.",
      objective: "Movilidad grado II-III. Pérdida ósea radiográfica visible. Sangrado al sondaje.",
      assessment: "Periodontitis crónica avanzada con pérdida ósea irrecuperable. Indicación de extracción.",
      plan: "Extracción atraumática bajo anestesia local. Curetaje del alvéolo. Sutura simple. Indicaciones postoperatorias por escrito. Control en 7 días.",
    };
  }
  if (type === "Limpieza dental" || type === "Profilaxis" || type === "Profilaxis pediátrica") {
    return {
      subjective: "Acude a su cita semestral de control. Sin sintomatología actual.",
      objective: "Acumulación moderada de cálculo supragingival en sextantes inferiores. Encías levemente inflamadas en sector anteroinferior. Sin caries activas.",
      assessment: "Gingivitis crónica leve asociada a placa.",
      plan: "Profilaxis con ultrasonido. Pulido con copa y pasta. Aplicación tópica de flúor. Indicaciones reforzadas de técnica de cepillado y uso de hilo dental.",
    };
  }
  if (type.startsWith("Ortodoncia")) {
    return {
      subjective: "Acude a control de tratamiento ortodóncico. Refiere molestia leve esperada tras último ajuste.",
      objective: "Brackets y ligas en buen estado. Avance ortodóncico según plan. Higiene aceptable.",
      assessment: "Tratamiento ortodóncico en curso, evolución favorable.",
      plan: "Ajuste de arcos. Cambio de ligas. Reforzar higiene. Próximo control en 4 semanas.",
    };
  }
  if (type === "Corona porcelana" || type === "Implante dental") {
    return {
      subjective: "Continúa tratamiento protésico previamente planeado. Sin complicaciones.",
      objective: "Tejidos periimplantarios o muñón en buen estado. Sin signos de infección.",
      assessment: "Continuidad de plan rehabilitador.",
      plan: "Continuar fase prevista. Indicaciones específicas según etapa. Cita de control programada.",
    };
  }
  return {
    subjective: "Paciente acude a control. Sin molestias significativas reportadas.",
    objective: "Examen clínico dentro de parámetros esperados. Sin hallazgos patológicos relevantes.",
    assessment: "Paciente clínicamente estable.",
    plan: "Continuar manejo preventivo. Reforzar higiene. Cita de control en 6 meses.",
  };
}

// ── Random helpers ───────────────────────────────────────────────────────
function pick<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number): number { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min: number, max: number, decimals = 0): number {
  const f = Math.random() * (max - min) + min;
  const m = 10 ** decimals;
  return Math.round(f * m) / m;
}
function chance(p: number): boolean { return Math.random() < p; }
function pickN<T>(arr: readonly T[], n: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(Math.random() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}
function slugAscii(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}
function randomCURP(gender: "M" | "F"): string {
  const letters = () => Array.from({ length: 4 }, () => String.fromCharCode(65 + randInt(0, 25))).join("");
  const digits = (n: number) => Array.from({ length: n }, () => randInt(0, 9)).join("");
  const consonants = () => Array.from({ length: 5 }, () => "BCDFGHJKLMNPQRSTVWXYZ"[randInt(0, 19)]).join("");
  const last = () => `${randInt(0, 9) < 6 ? String.fromCharCode(65 + randInt(0, 25)) : randInt(0, 9)}${randInt(0, 9)}`;
  return `${letters()}${digits(6)}${gender === "M" ? "H" : "M"}${consonants()}${last()}`;
}
function randomRFC(): string {
  const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randInt(0, 25))).join("");
  const digits = (n: number) => Array.from({ length: n }, () => randInt(0, 9)).join("");
  return `${letters(4)}${digits(6)}${letters(3)}`;
}

// Genera fecha de nacimiento según distribución solicitada (15% < 18, 65% 18-60, 20% > 60).
function randomDob(): Date {
  const r = Math.random();
  let yearsAgo: number;
  if (r < 0.15) yearsAgo = randInt(5, 17);
  else if (r < 0.80) yearsAgo = randInt(18, 60);
  else yearsAgo = randInt(61, 80);
  const today = new Date();
  const dob = new Date(today.getFullYear() - yearsAgo, randInt(0, 11), randInt(1, 28));
  return dob;
}

function buildPatientData(opts: {
  clinicId: string;
  patientNumber: string;
  doctorIds: string[];
}): Prisma.PatientCreateManyInput {
  const isFemale = chance(0.48);
  const isMale = !isFemale && chance(0.48 / 0.52);
  const gender: "M" | "F" | "OTHER" = isFemale ? "F" : isMale ? "M" : "OTHER";
  const firstName = gender === "F" ? pick(NAMES_F) : gender === "M" ? pick(NAMES_M) : pick([...NAMES_F, ...NAMES_M]);
  const lastName = `${pick(LASTNAMES)} ${pick(LASTNAMES)}`;
  const dob = randomDob();
  const ageYears = (Date.now() - dob.getTime()) / (365.25 * 24 * 3600 * 1000);
  const isChild = ageYears < 18;

  const phone = `+52 ${randInt(2, 9)}${randInt(10, 99)} ${randInt(100, 999)} ${randInt(1000, 9999)}`;
  const email = `${slugAscii(firstName)}.${slugAscii(lastName.split(" ")[0])}${randInt(1, 999)}@${pick(EMAIL_DOMAINS)}`;
  const address = chance(0.6)
    ? `${pick(STREETS)} ${randInt(1, 999)}, Col. ${pick(COLONIAS)}, ${pick(CITIES)}`
    : null;

  const curpStatus = chance(0.7) ? "COMPLETE" : chance(0.83) ? "PENDING" : "FOREIGN";
  const curp = curpStatus === "COMPLETE" && (gender === "M" || gender === "F") ? randomCURP(gender) : null;
  const passportNo = curpStatus === "FOREIGN" ? `${String.fromCharCode(65 + randInt(0, 25))}${randInt(10000000, 99999999)}` : null;

  const allergies = chance(0.25) ? pickN(ALLERGIES_POOL, randInt(1, 2)) : [];
  const chronic = chance(0.20) ? pickN(CHRONIC_POOL, randInt(1, 2)) : [];
  const meds = chance(0.15) ? pickN(MEDS_POOL, randInt(1, 2)) : [];
  const familyHistory = chance(0.30) ? pick(FAMILY_HX_POOL) : null;
  const pnp = chance(0.40) ? pick(PNP_POOL) : null;
  const insuranceProvider = chance(0.7) ? pick(INSURANCE_PROVIDERS) : null;
  const insurancePolicy = insuranceProvider && insuranceProvider !== "Particular" ? String(randInt(10000000, 999999999999)) : null;
  const bloodType = chance(0.7) ? pick(BLOOD_TYPES) : null;
  const rfcPaciente = chance(0.6) ? randomRFC() : null;
  const status: "ACTIVE" | "INACTIVE" = chance(0.95) ? "ACTIVE" : "INACTIVE";
  const notes = chance(0.20) ? pick(PATIENT_NOTES_POOL) : null;
  const primaryDoctorId = opts.doctorIds.length > 0 ? pick(opts.doctorIds) : null;

  return {
    clinicId: opts.clinicId,
    patientNumber: opts.patientNumber,
    firstName,
    lastName,
    email,
    phone,
    dob,
    gender,
    bloodType,
    address,
    insuranceProvider,
    insurancePolicy,
    allergies,
    chronicConditions: chronic,
    currentMedications: meds,
    tags: [DEMO_TAG],
    notes,
    status,
    isChild,
    primaryDoctorId,
    curp,
    curpStatus,
    passportNo,
    familyHistory,
    personalNonPathologicalHistory: pnp,
    rfcPaciente,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// POST handler
// ─────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden_super_admin_only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({})) as {
    dryRun?: boolean;
    patientCount?: number;
    fromDate?: string;
    toDate?: string;
  };

  const dryRun = !!body.dryRun;
  const patientCount = Math.max(1, Math.min(500, body.patientCount ?? 100));
  const fromDate = new Date(body.fromDate ?? "2026-04-27");
  const toDate = new Date(body.toDate ?? "2026-05-27");
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate >= toDate) {
    return NextResponse.json({ error: "invalid_date_range" }, { status: 400 });
  }

  // Multi-tenant guard: clínica hardcodeada.
  const clinic = await prisma.clinic.findUnique({
    where: { id: RAFAEL_CLINIC_ID },
    select: { id: true, name: true },
  });
  if (!clinic) {
    return NextResponse.json({ error: "rafael_clinic_not_found" }, { status: 404 });
  }

  // Doctores y resources de la clínica.
  const [doctors, resources, cumsAll, cieAll, lastPatient, lastInvoice] = await Promise.all([
    prisma.user.findMany({
      where: { clinicId: clinic.id, role: { in: ["DOCTOR", "ADMIN", "SUPER_ADMIN"] }, isActive: true },
      select: { id: true, firstName: true, lastName: true },
    }),
    prisma.resource.findMany({
      where: { clinicId: clinic.id, kind: "CHAIR", isActive: true },
      select: { id: true },
    }),
    prisma.cumsItem.findMany({
      where: { grupoTerapeutico: { in: ["Analgésicos / AINEs", "Antibióticos sistémicos"] } },
      select: { clave: true, cofeprisGroup: true },
      take: 80,
    }),
    prisma.cie10Code.findMany({
      where: { code: { in: DX_CODES } },
      select: { code: true },
    }),
    prisma.patient.findFirst({
      where: { clinicId: clinic.id },
      orderBy: { patientNumber: "desc" },
      select: { patientNumber: true },
    }),
    prisma.invoice.findFirst({
      where: { clinicId: clinic.id },
      orderBy: { invoiceNumber: "desc" },
      select: { invoiceNumber: true },
    }),
  ]);

  if (doctors.length === 0) {
    return NextResponse.json({ error: "no_doctors_in_clinic", hint: "Crea al menos un User con role DOCTOR/ADMIN antes de seedear." }, { status: 400 });
  }

  // Patient numbering: continúa desde el último.
  const lastNum = lastPatient?.patientNumber ? parseInt(lastPatient.patientNumber, 10) : 0;
  const patientNumStart = Number.isFinite(lastNum) ? lastNum + 1 : 1;

  // Invoice numbering: continúa desde el último.
  const lastInvNum = lastInvoice?.invoiceNumber ? parseInt(lastInvoice.invoiceNumber.replace(/\D/g, ""), 10) : 0;
  const invoiceNumStart = Number.isFinite(lastInvNum) ? lastInvNum + 1 : 1;

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      clinic: clinic.name,
      doctors: doctors.length,
      resources: resources.length,
      cumsAvailable: cumsAll.length,
      cieAvailable: cieAll.length,
      wouldCreate: {
        patients: patientCount,
        appointmentsApprox: Math.round(patientCount * 1.15),
        soapNotes: 30,
        prescriptions: 20,
        invoicesApprox: Math.round(patientCount * 0.7),
        treatmentPlans: 15,
      },
      patientNumStart,
      invoiceNumStart,
    });
  }

  // ── 1. Patients ──────────────────────────────────────────────────────
  const doctorIds = doctors.map((d) => d.id);
  const patientsData: Prisma.PatientCreateManyInput[] = Array.from({ length: patientCount }, (_, i) =>
    buildPatientData({
      clinicId: clinic.id,
      patientNumber: String(patientNumStart + i).padStart(5, "0"),
      doctorIds,
    }),
  );
  await prisma.patient.createMany({ data: patientsData });
  const patients = await prisma.patient.findMany({
    where: { clinicId: clinic.id, tags: { has: DEMO_TAG } },
    select: { id: true, isChild: true, firstName: true, lastName: true },
    orderBy: { patientNumber: "desc" },
    take: patientCount,
  });

  // ── 2. Appointments ──────────────────────────────────────────────────
  // Generamos slots de 30 min en horario laboral 9–19 lun–sáb. Para cada
  // doctor + resource llevamos un Set para no violar EXCLUDE constraints.
  const doctorBusy = new Map<string, Set<number>>();
  const resourceBusy = new Map<string, Set<number>>();
  doctorIds.forEach((d) => doctorBusy.set(d, new Set()));
  resources.forEach((r) => resourceBusy.set(r.id, new Set()));

  function reserveSlot(doctorId: string, resourceId: string | null, startMs: number, endMs: number): boolean {
    // Cubrimos el rango en pasos de 30 minutos (en epoch).
    const STEP = 30 * 60 * 1000;
    const slots: number[] = [];
    for (let t = startMs; t < endMs; t += STEP) slots.push(t);
    const dBusy = doctorBusy.get(doctorId);
    if (!dBusy) return false;
    const rBusy = resourceId ? resourceBusy.get(resourceId) : null;
    if (resourceId && !rBusy) return false;
    if (slots.some((s) => dBusy.has(s) || (rBusy && rBusy.has(s)))) return false;
    slots.forEach((s) => { dBusy.add(s); if (rBusy) rBusy.add(s); });
    return true;
  }

  function pickAppointmentStart(): { startMs: number; isPast: boolean } {
    const fromMs = fromDate.getTime();
    const toMs = toDate.getTime();
    let attempts = 0;
    while (attempts++ < 30) {
      const ms = randInt(fromMs, toMs);
      const d = new Date(ms);
      const day = d.getDay(); // 0 = sun, 6 = sat
      if (day === 0) continue; // skip sunday
      const hour = randInt(9, 18);
      const minute = chance(0.5) ? 0 : 30;
      d.setHours(hour, minute, 0, 0);
      const startMs = d.getTime();
      const isPast = startMs < Date.now();
      return { startMs, isPast };
    }
    const fallback = new Date(fromMs);
    fallback.setHours(10, 0, 0, 0);
    return { startMs: fallback.getTime(), isPast: fallback.getTime() < Date.now() };
  }

  const apptCount = Math.round(patientCount * 1.15);
  const apptsCreated: Array<{ id: string; patientId: string; doctorId: string; type: string; status: string; startsAt: Date; endsAt: Date; isPast: boolean; price: number }> = [];

  for (let i = 0; i < apptCount; i++) {
    const tx = pick(TREATMENTS);
    const durMin = randInt(tx.durMin[0], tx.durMin[1]);
    const price = randInt(tx.price[0], tx.price[1]);
    const patient = pick(patients);
    const doctorId = pick(doctorIds);
    const resourceId = resources.length > 0 ? pick(resources).id : null;

    let placed = false;
    let pickedStart = 0;
    let pickedIsPast = false;
    for (let retry = 0; retry < 6 && !placed; retry++) {
      const { startMs, isPast } = pickAppointmentStart();
      const endMs = startMs + durMin * 60 * 1000;
      if (reserveSlot(doctorId, resourceId, startMs, endMs)) {
        placed = true;
        pickedStart = startMs;
        pickedIsPast = isPast;
        break;
      }
    }
    if (!placed) continue;

    const startsAt = new Date(pickedStart);
    const endsAt = new Date(pickedStart + durMin * 60 * 1000);

    let status: "COMPLETED" | "CHECKED_OUT" | "CHECKED_IN" | "IN_PROGRESS" | "NO_SHOW" | "CANCELLED" | "SCHEDULED" | "CONFIRMED";
    if (pickedIsPast) {
      const r = Math.random();
      status = r < 0.5 ? "COMPLETED"
             : r < 0.65 ? "CHECKED_OUT"
             : r < 0.75 ? "CHECKED_IN"
             : r < 0.90 ? "NO_SHOW"
             : "CANCELLED";
    } else {
      const r = Math.random();
      status = r < 0.6 ? "SCHEDULED" : r < 0.9 ? "CONFIRMED" : "CANCELLED";
    }

    const appt = await prisma.appointment.create({
      data: {
        clinicId: clinic.id,
        patientId: patient.id,
        doctorId,
        resourceId,
        type: tx.type,
        startsAt,
        endsAt,
        status,
        notes: chance(0.30) ? `Motivo: ${tx.type.toLowerCase()}.` : null,
        price,
        ...(status === "COMPLETED" || status === "CHECKED_OUT"
          ? { completedAt: endsAt, isPaid: false }
          : {}),
        ...(status === "CHECKED_IN" ? { checkedInAt: startsAt } : {}),
        ...(status === "CONFIRMED" ? { confirmedAt: new Date(pickedStart - 24 * 3600 * 1000) } : {}),
        ...(status === "CANCELLED" ? { cancelledAt: new Date(pickedStart - 12 * 3600 * 1000), cancelReason: "Reprogramación del paciente" } : {}),
      },
      select: { id: true },
    });
    apptsCreated.push({ id: appt.id, patientId: patient.id, doctorId, type: tx.type, status, startsAt, endsAt, isPast: pickedIsPast, price });
  }

  // ── 3. SOAP notes (para 30 citas COMPLETED random) ───────────────────
  const completedAppts = apptsCreated.filter((a) => a.status === "COMPLETED" || a.status === "CHECKED_OUT");
  const soapTargets = pickN(completedAppts, Math.min(30, completedAppts.length));
  const recordsCreated: Array<{ id: string; appointmentId: string; type: string }> = [];
  const dxPool = cieAll.map((c) => c.code);

  for (const a of soapTargets) {
    const tpl = soapTemplate(a.type);
    const dxCount = chance(0.5) ? 1 : 2;
    const dxPicked = pickN(dxPool, dxCount);
    const vitalsJson = chance(0.20) ? { bp: `${randInt(110, 140)}/${randInt(70, 90)}`, hr: randInt(60, 100) } : undefined;

    const record = await prisma.medicalRecord.create({
      data: {
        clinicId: clinic.id,
        patientId: a.patientId,
        doctorId: a.doctorId,
        visitDate: a.endsAt,
        subjective: tpl.subjective,
        objective: tpl.objective,
        assessment: tpl.assessment,
        plan: tpl.plan,
        diagnoses: dxPicked.length > 0 ? dxPicked.map((c) => ({ code: c })) : Prisma.JsonNull,
        vitals: vitalsJson ?? Prisma.JsonNull,
        specialtyData: { type: "dental", procedures: [a.type] },
      },
      select: { id: true },
    });
    recordsCreated.push({ id: record.id, appointmentId: a.id, type: a.type });
  }

  // 15 de las 30 con dx CIE-10 estructurados (medical_record_diagnoses).
  const structuredDxTargets = pickN(recordsCreated, Math.min(15, recordsCreated.length));
  for (const r of structuredDxTargets) {
    const codes = pickN(dxPool, randInt(1, 2));
    if (codes.length === 0) continue;
    await prisma.medicalRecordDiagnosis.createMany({
      data: codes.map((code, idx) => ({
        medicalRecordId: r.id,
        cie10Code: code,
        isPrimary: idx === 0,
        note: idx === 0 ? "Diagnóstico principal" : "Diagnóstico secundario",
      })),
      skipDuplicates: true,
    });
  }

  // ── 4. Prescriptions (20 de las SOAP) ────────────────────────────────
  const rxTargets = pickN(recordsCreated, Math.min(20, recordsCreated.length));
  let rxCount = 0;
  if (cumsAll.length > 0) {
    for (const r of rxTargets) {
      const itemCount = randInt(1, 3);
      const items = pickN(cumsAll, itemCount);
      const appt = apptsCreated.find((a) => a.id === r.appointmentId);
      const issuedAt = appt ? appt.endsAt : new Date();
      const qrCode = `RX-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${rxCount}`;
      const verifyUrl = `https://mediflow.app/portal/prescription/${qrCode}/verify`;
      // cofeprisGroup vigencia: I/II/III = 30 días, otros = 90 días.
      const primaryGroup = items[0]?.cofeprisGroup ?? null;
      const expiryDays = primaryGroup && ["I", "II", "III"].includes(primaryGroup) ? 30 : 90;
      const expiresAt = new Date(issuedAt.getTime() + expiryDays * 86400000);

      await prisma.prescription.create({
        data: {
          clinicId: clinic.id,
          patientId: appt?.patientId ?? "",
          doctorId: appt?.doctorId ?? doctorIds[0],
          medicalRecordId: r.id,
          medications: items.map((i) => ({ clave: i.clave })),
          indications: "Tomar con alimentos. Suspender si hay reacción adversa.",
          qrCode,
          verifyUrl,
          issuedAt,
          expiresAt,
          cofeprisGroup: primaryGroup,
          items: {
            create: items.map((i) => ({
              cumsKey: i.clave,
              dosage: i.cofeprisGroup && ["IV", "V"].includes(i.cofeprisGroup) ? "1 tableta cada 8 horas" : "1 tableta cada 12 horas",
              duration: chance(0.5) ? "5 días" : "7 días",
              quantity: chance(0.5) ? "15 tabletas" : "21 cápsulas",
            })),
          },
        },
      });
      rxCount++;
    }
  }

  // ── 5. Invoices + Payments según distribución por status ─────────────
  let invoiceSeq = invoiceNumStart;
  let invoicesCreated = 0;
  let paymentsCreated = 0;

  for (const a of apptsCreated) {
    let probTiene = 0;
    let payProfile: "PAID" | "PARTIAL" | "PENDING" | null = null;
    if (a.status === "COMPLETED" || a.status === "CHECKED_OUT") {
      probTiene = 0.7;
      const r = Math.random();
      payProfile = r < 0.65 ? "PAID" : r < 0.90 ? "PARTIAL" : "PENDING";
    } else if (a.status === "NO_SHOW") {
      probTiene = 0.3;
      payProfile = "PENDING";
    } else if (a.status === "SCHEDULED" || a.status === "CONFIRMED") {
      probTiene = 0.4;
      payProfile = "PENDING";
    } else if (a.status === "CHECKED_IN") {
      probTiene = 1.0;
      payProfile = "PENDING";
    }

    if (!payProfile || !chance(probTiene)) continue;

    const total = a.status === "NO_SHOW" ? randInt(200, 500) : a.price;
    const subtotal = total;
    let paid = 0;
    if (payProfile === "PAID") paid = total;
    else if (payProfile === "PARTIAL") paid = Math.round(total * randFloat(0.30, 0.70, 2));
    const balance = total - paid;
    const status: "PAID" | "PARTIAL" | "PENDING" = paid >= total ? "PAID" : paid > 0 ? "PARTIAL" : "PENDING";

    const invoiceNumber = `F-${String(invoiceSeq++).padStart(6, "0")}`;
    const invoice = await prisma.invoice.create({
      data: {
        clinicId: clinic.id,
        patientId: a.patientId,
        appointmentId: a.id,
        invoiceNumber,
        items: [{ description: a.type, quantity: 1, unitPrice: total, total }],
        subtotal,
        discount: 0,
        total,
        paid,
        balance,
        status,
        paidAt: status === "PAID" ? new Date(a.endsAt.getTime() + randInt(0, 6) * 3600000) : null,
        notes: a.status === "NO_SHOW" ? "Cargo por no presentarse a la cita." : null,
      },
      select: { id: true },
    });
    invoicesCreated++;

    if (paid > 0) {
      const paymentCount = chance(0.3) ? 2 : 1;
      let remaining = paid;
      for (let p = 0; p < paymentCount && remaining > 0; p++) {
        const amount = p === paymentCount - 1 ? remaining : Math.round(remaining / 2);
        remaining -= amount;
        await prisma.payment.create({
          data: {
            invoiceId: invoice.id,
            amount,
            method: pick(["cash", "debit_card", "credit_card", "transfer", "check"]),
            paidAt: new Date(a.endsAt.getTime() + (p + 1) * 3600000),
          },
        });
        paymentsCreated++;
      }
    }
  }

  // ── 6. Treatment Plans (15 pacientes) ────────────────────────────────
  const planPatients = pickN(patients, Math.min(15, patients.length));
  const TREATMENT_PLAN_TYPES = [
    { key: "ortodoncia", count: 6, name: "Ortodoncia 12-18 meses", sessions: [12, 18], totalRange: [20000, 45000] as [number, number] },
    { key: "endo_corona", count: 5, name: "Endodoncia + corona porcelana", sessions: [3, 3], totalRange: [8000, 14000] as [number, number] },
    { key: "implante", count: 4, name: "Implante dental + corona", sessions: [4, 4], totalRange: [25000, 40000] as [number, number] },
  ];

  let planIdx = 0;
  let plansCreated = 0;
  let sessionsCreated = 0;
  for (const planType of TREATMENT_PLAN_TYPES) {
    for (let k = 0; k < planType.count; k++) {
      if (planIdx >= planPatients.length) break;
      const patient = planPatients[planIdx++];
      const totalSessions = randInt(planType.sessions[0], planType.sessions[1]);
      const sessionInterval = planType.key === "ortodoncia" ? 30 : 14;
      const totalCost = randInt(planType.totalRange[0], planType.totalRange[1]);
      const startDate = new Date(fromDate.getTime() + randInt(0, 5) * 86400000);
      const expectedEnd = new Date(startDate.getTime() + totalSessions * sessionInterval * 86400000);
      const doctorId = pick(doctorIds);

      const plan = await prisma.treatmentPlan.create({
        data: {
          clinicId: clinic.id,
          patientId: patient.id,
          doctorId,
          name: `${planType.name} — ${patient.firstName} ${patient.lastName.split(" ")[0]}`,
          description: `Plan multi-sesión ${planType.key.replace("_", " + ")}.`,
          totalSessions,
          sessionIntervalDays: sessionInterval,
          totalCost,
          status: "ACTIVE",
          startDate,
          endDate: expectedEnd,
          nextExpectedDate: expectedEnd,
        },
        select: { id: true },
      });
      plansCreated++;

      // Sessions: ~30% completed, resto futuras.
      const completedTo = Math.floor(totalSessions * randFloat(0.20, 0.40, 2));
      for (let s = 0; s < totalSessions; s++) {
        const isCompleted = s < completedTo;
        const sessionDate = new Date(startDate.getTime() + s * sessionInterval * 86400000);
        await prisma.treatmentSession.create({
          data: {
            treatmentId: plan.id,
            sessionNumber: s + 1,
            notes: `Sesión ${s + 1}/${totalSessions} — ${planType.key === "ortodoncia" ? "ajuste mensual" : planType.key === "endo_corona" ? (s === 0 ? "endodoncia" : s === 1 ? "preparación corona" : "colocación corona") : (s === 0 ? "cirugía colocación implante" : s === 1 ? "cicatrización" : s === 2 ? "preparación pilar" : "colocación corona sobre implante")}`,
            completedAt: isCompleted ? sessionDate : null,
          },
        });
        sessionsCreated++;

        // Generar factura escalonada para cada sesión.
        const sessionCost =
          planType.key === "ortodoncia" && s === 0 ? randInt(8000, 15000) :
          planType.key === "ortodoncia" ? randInt(500, 1500) :
          planType.key === "endo_corona" && s === 0 ? randInt(2500, 4500) :
          planType.key === "endo_corona" && s === 1 ? randInt(1500, 2500) :
          planType.key === "endo_corona" ? randInt(4500, 8500) :
          planType.key === "implante" && s === 0 ? randInt(15000, 25000) :
          planType.key === "implante" && s === 1 ? 0 :
          planType.key === "implante" && s === 2 ? randInt(2000, 3500) :
          randInt(4500, 7500);
        if (sessionCost === 0) continue;

        const invoiceNumber = `F-${String(invoiceSeq++).padStart(6, "0")}`;
        const isPaidSession = isCompleted && chance(0.5);
        const paid = isPaidSession ? sessionCost : (isCompleted && chance(0.3) ? Math.round(sessionCost * randFloat(0.4, 0.7, 2)) : 0);
        const status: "PAID" | "PARTIAL" | "PENDING" = paid >= sessionCost ? "PAID" : paid > 0 ? "PARTIAL" : "PENDING";

        const inv = await prisma.invoice.create({
          data: {
            clinicId: clinic.id,
            patientId: patient.id,
            invoiceNumber,
            items: [{ description: `${planType.name} · sesión ${s + 1}`, quantity: 1, unitPrice: sessionCost, total: sessionCost }],
            subtotal: sessionCost,
            discount: 0,
            total: sessionCost,
            paid,
            balance: sessionCost - paid,
            status,
            paidAt: status === "PAID" ? sessionDate : null,
            notes: `Plan: ${planType.name} (${s + 1}/${totalSessions})`,
          },
          select: { id: true },
        });
        invoicesCreated++;
        if (paid > 0) {
          await prisma.payment.create({
            data: {
              invoiceId: inv.id,
              amount: paid,
              method: pick(["cash", "debit_card", "credit_card", "transfer"]),
              paidAt: sessionDate,
            },
          });
          paymentsCreated++;
        }
      }
    }
  }

  return NextResponse.json({
    success: true,
    clinic: clinic.name,
    summary: {
      patients: patients.length,
      appointments: apptsCreated.length,
      soapNotes: recordsCreated.length,
      structuredDx: structuredDxTargets.length,
      prescriptions: rxCount,
      invoices: invoicesCreated,
      payments: paymentsCreated,
      treatmentPlans: plansCreated,
      treatmentSessions: sessionsCreated,
    },
    range: { from: fromDate.toISOString(), to: toDate.toISOString() },
  });
}

// ─────────────────────────────────────────────────────────────────────────
// DELETE handler — wipe demo data (cascade vía FK)
// ─────────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const user = await getCurrentUser();
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "forbidden_super_admin_only" }, { status: 403 });
  }

  // Confirm header obligatorio para evitar accidentes.
  const confirm = req.headers.get("x-confirm-delete-demo");
  if (confirm !== "yes") {
    return NextResponse.json(
      { error: "missing_confirm_header", hint: "Set header X-Confirm-Delete-Demo: yes" },
      { status: 400 },
    );
  }

  // Multi-tenant guard.
  const clinic = await prisma.clinic.findUnique({
    where: { id: RAFAEL_CLINIC_ID },
    select: { id: true, name: true },
  });
  if (!clinic) {
    return NextResponse.json({ error: "rafael_clinic_not_found" }, { status: 404 });
  }

  const before = await prisma.patient.count({
    where: { clinicId: clinic.id, tags: { has: DEMO_TAG } },
  });

  // Cascade onDelete CASCADE en FKs (Appointment, MedicalRecord, Invoice,
  // TreatmentPlan, Prescription, etc.) borra todo lo derivado al borrar
  // los Patient demo.
  const result = await prisma.patient.deleteMany({
    where: { clinicId: clinic.id, tags: { has: DEMO_TAG } },
  });

  return NextResponse.json({
    success: true,
    clinic: clinic.name,
    patientsDeleted: result.count,
    patientsBefore: before,
  });
}
