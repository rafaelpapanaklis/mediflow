/**
 * ws1-t10 — 05_Citas (futuras + historial completo) y 04_Saldos de Dentalink.
 *
 * Run: TZ=UTC npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/citas-dentalink.test.ts
 *
 * Se conduce el motor DE VERDAD (runImport + los handlers) con Prisma sustituido por el doble en memoria, con los
 * encabezados reales de BEVADENT y el perfil «dentalink». Lo que prueban:
 *   · el estado de Dentalink (20 textos distintos) se lee bien: nada se descarta por raro;
 *   · una cita ligada por «# Tratamiento» a un CASO de ortodoncia ya importado es su «Control de ortodoncia», con el
 *     doctor tratante del caso y la duración de Hora Fin − Hora Inicio; sin caso, como siempre;
 *   · sillón → consultorio; «Sobre Agendamiento» → nota; comentario/observaciones/agendado por → nota legible;
 *   · el historial trae TODAS las pasadas; el control atendido de un caso cuenta como control (cita COMPLETADA) sin
 *     duplicar el que 06 ya registró ese día (y en el otro orden también);
 *   · una mora de un tratamiento ya importado NO crea otra deuda: se anota en él.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const OTRA = "cli_B";
const IMPORTA = "u_admin";
const FUENTE = "dentalink";

function semilla() {
  return {
    clinic: [{ id: CLINICA, name: "Clínica Sonrisa", timezone: "America/Mexico_City" }],
    patient: [
      { id: "p1", clinicId: CLINICA, patientNumber: "P-0001", firstName: "María", lastName: "Hernández", phone: "5551234567", email: null, deletedAt: null, visibleUserIds: [] },
      { id: "p2", clinicId: CLINICA, patientNumber: "P-0002", firstName: "Luis", lastName: "Pérez", phone: "5557654321", email: null, deletedAt: null, visibleUserIds: [] },
      { id: "p3", clinicId: CLINICA, patientNumber: "P-0003", firstName: "Ana", lastName: "Soto", phone: "5550001111", email: null, deletedAt: null, visibleUserIds: [] },
    ],
    user: [
      { id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true, role: "SUPER_ADMIN" },
      { id: "doc1", clinicId: CLINICA, firstName: "Carlos", lastName: "Nuñez", isActive: true, role: "DOCTOR" },
      { id: "doc2", clinicId: CLINICA, firstName: "Elena", lastName: "Rivas", isActive: true, role: "DOCTOR" },
    ],
    importExternalIds: [
      // Los pacientes ya importados (ID de Dentalink → paciente).
      { id: "e1", clinicId: CLINICA, source: FUENTE, entity: "patient", externalId: "202", localId: "p1" },
      { id: "e2", clinicId: CLINICA, source: FUENTE, entity: "patient", externalId: "203", localId: "p2" },
      { id: "e3", clinicId: CLINICA, source: FUENTE, entity: "patient", externalId: "204", localId: "p3" },
      // El tratamiento #16 es un CASO de ortodoncia de p1 (doctor tratante: Carlos).
      { id: "e4", clinicId: CLINICA, source: FUENTE, entity: "ortho_case", externalId: "16", localId: "plan1" },
      // Otra clínica con el mismo #16: jamás debe verse.
      { id: "e5", clinicId: OTRA, source: FUENTE, entity: "ortho_case", externalId: "16", localId: "plan_otra" },
    ],
    orthodonticTreatmentPlan: [
      { id: "plan1", clinicId: CLINICA, patientId: "p1", treatingDoctorId: "doc1", deletedAt: null, prescriptionNotes: "Migrado de Dentalink · # Tratamiento 16" },
    ],
    // El tratamiento #291 de p2 es un tratamiento NORMAL ya importado.
    quote: [
      { id: "q291", clinicId: CLINICA, patientId: "p2", status: "ACCEPTED", treatmentPlanId: "tp291", total: 14400, notes: "Tratamiento activo migrado de Dentalink el 01/09/2026. Continúa.\nFolio original (tratamiento activo): 291" },
    ],
    resource: [{ id: "res1", clinicId: CLINICA, name: "Sillon 1", kind: "SILLA_DENTAL", isActive: true, orderIndex: 0 }],
    appointment: [],
    migratedVisit: [],
    orthoTreatmentCard: [],
    whatsAppReminder: [],
    invoice: [],
  };
}

let base: Base = crearBase(semilla());
mock.module("@/lib/prisma", { namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) } });
mock.module("@/lib/audit", { namedExports: { logAudit: async () => {} } });
mock.module("@/lib/invoices/next-invoice-number", { namedExports: { lastInvoiceFolio: async () => 0 } });
// El cupo del plan importa "server-only", que no resuelve bajo tsx --test.
mock.module("@/lib/patient-quota", {
  namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) },
});
mock.module("@/lib/patients/next-patient-number", { namedExports: { lastPatientFolio: async () => 100 } });

const engine = () => import("../engine");
const entidades = () => import("../entities");
const historial = () => import("../citas-historial/handler");
const citas = () => import("../dentalink/citas");

function reiniciar(cambios: (s: ReturnType<typeof semilla>) => void = () => {}) {
  const s = semilla();
  cambios(s);
  base = crearBase(s);
}

const csv = (texto: string) => new File([texto], "05_Citas.csv", { type: "text/csv" });
const tabla = (m: string) => base.tablas[m] ?? [];
const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);

type Manejador = "appointments" | "appointmentHistory" | "balances";
async function correr(cual: Manejador, file: File, opts: { dryRun?: boolean; valueMapping?: any } = { dryRun: true }): Promise<any> {
  const { runImport } = await engine();
  const handler = cual === "appointmentHistory" ? (await historial()).appointmentHistoryHandler : (await entidades()).HANDLERS[cual];
  return runImport(handler, {
    file, clinicId: CLINICA, userId: IMPORTA, role: "SUPER_ADMIN",
    dryRun: opts.dryRun ?? true, skipDuplicates: true,
    columnMapping: null, origin: FUENTE, valueMapping: opts.valueMapping ?? null, sheet: null,
  });
}

// Los encabezados REALES de BEVADENT (05_Citas), los que el perfil «dentalink» reconoce.
const CAB =
  "# Cita,Estado Cita,Fecha Cita,Hora Inicio Cita,Hora Fin Cita,Comentario Cita,Sillón (Recurso),# Tratamiento," +
  "Nombre Profesional Cita,Apellidos Profesional Cita,# Paciente,Nombre Paciente,Apellidos Paciente,Agendado por,Fecha de creación de cita,Observaciones,Motivo de Atención";

interface Cita {
  estado: string; fecha: string; ini: string; fin: string; sillon?: string; trat: string; pac: string;
  doc?: [string, string]; motivo?: string; comentario?: string; obs?: string; por?: string; creada?: string;
}
const NOMBRE: Record<string, [string, string]> = { "202": ["María", "Hernández"], "203": ["Luis", "Pérez"], "204": ["Ana", "Soto"] };
const linea = (c: Cita) =>
  [
    "1", c.estado, c.fecha, c.ini, c.fin, c.comentario ?? "", c.sillon ?? "Sillon 1", c.trat,
    c.doc?.[0] ?? "Elena", c.doc?.[1] ?? "Rivas", c.pac, NOMBRE[c.pac][0], NOMBRE[c.pac][1], c.por ?? "", c.creada ?? "", c.obs ?? "", c.motivo ?? "",
  ].join(",");
const archivo = (...cs: Cita[]) => csv([CAB, ...cs.map(linea)].join("\n"));

// ─────────────────────────── piezas puras ───────────────────────────

test("los 20 estados de Dentalink se leen en su grupo (nada se descarta por raro)", async () => {
  const { grupoDeEstado } = await citas();
  const esperado: Record<string, string> = {
    "Atendido": "atendida",
    "Cambio de fecha": "reagendada",
    "Confirmado por pcte. vía WhatsApp": "confirmada",
    "No asiste": "no_asistio",
    "No confirmado": "vigente",
    "Cancelado": "cancelada",
    "Anulado por pcte. via Whatsapp": "cancelada",
    "Notif. automática vía WhatsApp": "vigente",
    "Notificado via email": "vigente",
    "Notif. WhatsApp fallida": "vigente",
    "Recordado por IA": "vigente",
    "Paciente Deshabilitado": "vigente",
    "En sala de espera": "vigente",
    "Confirmado por email": "confirmada",
    "Notificado por IA": "vigente",
    "Cancelado por pcte. via email": "cancelada",
    "Atendiéndose": "vigente",
    "Notificado por WhatsApp": "vigente",
    "Confirmado por teléfono": "confirmada",
    "Anulado por IA": "cancelada",
    "": "vigente",
  };
  for (const [texto, grupo] of Object.entries(esperado)) assert.equal(grupoDeEstado(texto), grupo, texto);
});

test("visitaDeEstado: cada grupo tiene su resultado; las que no dicen si vino son «sin registro de asistencia»", async () => {
  const { visitaDeEstado, etiquetaDeVisita } = await citas();
  assert.deepEqual([visitaDeEstado("Atendido").status, visitaDeEstado("Atendido").resultado], ["COMPLETED", "Atendida"]);
  assert.deepEqual([visitaDeEstado("No asiste").status, visitaDeEstado("No asiste").resultado], ["NO_SHOW", "No asistió"]);
  assert.equal(visitaDeEstado("Anulado por IA").resultado, "Cancelada");
  assert.equal(visitaDeEstado("Cambio de fecha").resultado, "Reagendada (cambió de fecha)");
  for (const t of ["Confirmado por email", "No confirmado", "Notificado via email", "Recordado por IA", "Paciente Deshabilitado", "En sala de espera"]) {
    assert.equal(visitaDeEstado(t).resultado, "Sin registro de asistencia", t);
  }
  // La ficha lee la etiqueta de la primera línea de la nota; sin ella, del estado.
  assert.equal(etiquetaDeVisita("PENDING", "Resultado: Sin registro de asistencia\nEstado en Dentalink: No confirmado"), "Sin registro de asistencia");
  assert.equal(etiquetaDeVisita("COMPLETED", null), "Atendida");
  assert.equal(etiquetaDeVisita("PENDING", null), "Sin registro de asistencia");
});

test("tipoParaCaso: sin motivo o «control mensual…» es el Control de ortodoncia; un motivo que es otra cosa se respeta", async () => {
  const { tipoParaCaso } = await citas();
  assert.deepEqual(tipoParaCaso(""), { tipo: "Control de ortodoncia", esControl: true, cambio: false });
  assert.equal(tipoParaCaso("control mensual de ortodoncia").tipo, "Control de ortodoncia");
  assert.equal(tipoParaCaso("control mensual de ortodoncia").cambio, true);
  assert.equal(tipoParaCaso("control mensual de ortodoncia Damon ").esControl, true);
  assert.equal(tipoParaCaso("Revisión o seguimiento").esControl, true);
  assert.deepEqual([tipoParaCaso("VALORACION").tipo, tipoParaCaso("VALORACION").esControl], ["Valoración de ortodoncia", false]);
  assert.equal(tipoParaCaso("colocacion").tipo, "Colocación de aparatología");
  assert.equal(tipoParaCaso("Emergencia ortodóntica").tipo, "Urgencia de ortodoncia");
  assert.equal(tipoParaCaso("Revisión de retención").tipo, "Control de retención");
  assert.deepEqual([tipoParaCaso("Limpieza dental").tipo, tipoParaCaso("Limpieza dental").esControl], ["Limpieza dental", false]);
});

test("elegirRecurso: por nombre; «Sobre Agendamiento» no es un sillón; el único consultorio; con varios no se adivina", async () => {
  const { elegirRecurso } = await citas();
  const uno = [{ id: "r1", name: "Consultorio A", kind: "CONSULTORIO_DENTAL" }];
  assert.deepEqual(elegirRecurso("Sillon 1", [{ id: "r1", name: "Sillón 1", kind: "SILLA_DENTAL" }]), { id: "r1", sobreagendada: false });
  assert.deepEqual(elegirRecurso("Sobre Agendamiento", uno), { id: null, sobreagendada: true });
  assert.equal(elegirRecurso("Sillon 1", uno).id, "r1");
  assert.equal(elegirRecurso("Sillon 1", [...uno, { id: "r2", name: "Consultorio B", kind: "CONSULTORIO_DENTAL" }]).id, null);
  assert.equal(elegirRecurso("Sillon 1", [{ id: "r9", name: "Rayos X", kind: "RADIOGRAFIA" }]).id, null);
  assert.equal(elegirRecurso("Sillon 1", []).id, null);
  assert.equal(elegirRecurso("", uno).id, null);
});

test("notasDeCita: una línea por dato, con etiqueta", async () => {
  const { notasDeCita } = await citas();
  const n = notasDeCita({
    resultado: "Atendida", comentario: "Trae radiografía", observaciones: "Llegó tarde", motivoOriginal: "control mensual de ortodoncia",
    estadoOrigen: "Atendido", agendadoPor: "Administrador", creadaEl: "06/12/2025 12:50", sobreagendada: true,
    enlace: { tipo: "caso", ref: "16" },
  })!;
  assert.deepEqual(n.split("\n"), [
    "Resultado: Atendida",
    "Comentario: Trae radiografía",
    "Observaciones: Llegó tarde",
    "Motivo en Dentalink: control mensual de ortodoncia",
    "Estado en Dentalink: Atendido",
    "Agendada por Administrador el 06/12/2025 12:50",
    "Sobreagendada: en Dentalink entró como «Sobre Agendamiento», encima de otra cita",
    "Del tratamiento #16 de Dentalink (caso de ortodoncia migrado)",
  ]);
  assert.equal(notasDeCita({}), null);
});

// ─────────────────────────── citas vivas (futuras) ───────────────────────────

test("cita futura de un CASO de ortodoncia: Control de ortodoncia, doctor tratante, duración por hora de fin, consultorio y notas", async () => {
  reiniciar();
  const f = archivo({
    estado: "Confirmado por pcte. vía WhatsApp", fecha: "2030-05-06", ini: "18:00:00", fin: "19:00:00", trat: "16", pac: "202",
    motivo: "control mensual de ortodoncia", comentario: "Trae elásticos", obs: "Paga en efectivo", por: "Administrador", creada: "2026-04-01",
  });
  const prev = await correr("appointments", f);
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev.mappingError));
  const r = fila(prev, 2);
  assert.equal(r.status, "ok", JSON.stringify(r));
  assert.equal(r.data.type, "Control de ortodoncia");
  assert.equal(r.data.doctorId, "doc1", "el doctor del CASO, no el del archivo (Elena)");
  assert.equal(r.data.durationMin, 60);
  assert.equal(r.data.resourceId, "res1");

  await correr("appointments", f, { dryRun: false });
  const [a] = tabla("appointment");
  assert.equal(a.type, "Control de ortodoncia");
  assert.equal(a.doctorId, "doc1");
  assert.equal(a.status, "CONFIRMED");
  assert.equal(a.resourceId, "res1");
  assert.equal(a.endsAt.getTime() - a.startsAt.getTime(), 60 * 60_000);
  for (const l of ["Comentario: Trae elásticos", "Observaciones: Paga en efectivo", "Motivo en Dentalink: control mensual de ortodoncia", "Agendada por Administrador", "Cita #1 de Dentalink", "Del tratamiento #16 de Dentalink (caso de ortodoncia migrado)"]) {
    assert.match(a.notes, new RegExp(l.replace(/[()]/g, "\\$&")), l);
  }
});

test("cita futura SIN caso: como siempre (motivo, doctor del archivo); ligada a un tratamiento normal lo dice en la nota", async () => {
  reiniciar();
  const f = archivo(
    { estado: "No confirmado", fecha: "2030-05-06", ini: "10:00:00", fin: "10:30:00", trat: "999", pac: "202", motivo: "VALORACION", doc: ["Carlos", "Nuñez"] },
    { estado: "No confirmado", fecha: "2030-05-07", ini: "10:00:00", fin: "10:30:00", trat: "291", pac: "203", doc: ["Carlos", "Nuñez"] },
  );
  const prev = await correr("appointments", f);
  const suelta = fila(prev, 2);
  assert.equal(suelta.status, "ok");
  assert.equal(suelta.data.type, "VALORACION");
  assert.equal(suelta.data.doctorId, "doc1");
  assert.match(suelta.data.notes, /Tratamiento #999 de Dentalink \(no está entre los tratamientos migrados\)/);
  const normal = fila(prev, 3);
  assert.equal(normal.data.type, "Consulta");
  assert.match(normal.data.notes, /Del tratamiento #291 de Dentalink \(ya migrado\)/);
  assert.equal(prev.warnings, undefined);
});

test("estados en citas futuras: «Notif…»/«Recordado por IA» entran pendientes sin aviso; «Cambio de fecha» y las canceladas no se agendan", async () => {
  reiniciar();
  const base1 = { fecha: "2030-05-06", ini: "10:00:00", fin: "10:30:00", trat: "999", pac: "202", doc: ["Carlos", "Nuñez"] as [string, string] };
  const f = archivo(
    { ...base1, estado: "Notif. automática vía WhatsApp" },
    { ...base1, estado: "Recordado por IA", fecha: "2030-05-07" },
    { ...base1, estado: "Cambio de fecha", fecha: "2030-05-08" },
    { ...base1, estado: "Anulado por pcte. via Whatsapp", fecha: "2030-05-09" },
  );
  const prev = await correr("appointments", f);
  assert.equal(fila(prev, 2).status, "ok");
  assert.equal(fila(prev, 2).data.status, "SCHEDULED");
  assert.deepEqual(fila(prev, 2).warnings, []);
  assert.equal(fila(prev, 3).status, "ok");
  assert.equal(fila(prev, 4).status, "skipped");
  assert.match(fila(prev, 4).warnings.join(" "), /reagendada/);
  assert.equal(fila(prev, 5).status, "skipped");
});

test("«Sobre Agendamiento»: no es un sillón, es una nota; si el consultorio ya está ocupado a esa hora entra sin él y sin mover el horario", async () => {
  reiniciar((s) => {
    (s.appointment as any[]).push({
      id: "a_ocupa", clinicId: CLINICA, patientId: "p3", doctorId: "doc2", resourceId: "res1", type: "Consulta",
      startsAt: new Date("2030-05-06T16:00:00Z"), endsAt: new Date("2030-05-06T17:00:00Z"), status: "SCHEDULED", holdExpiresAt: null,
    });
  });
  const f = archivo(
    { estado: "No confirmado", fecha: "2030-05-07", ini: "10:00:00", fin: "10:30:00", trat: "999", pac: "202", doc: ["Carlos", "Nuñez"], sillon: "Sobre Agendamiento" },
    // 10:00–10:30 en México = 16:00–16:30Z: el consultorio ya lo ocupa a_ocupa (otro doctor).
    { estado: "No confirmado", fecha: "2030-05-06", ini: "10:00:00", fin: "10:30:00", trat: "999", pac: "203", doc: ["Carlos", "Nuñez"] },
  );
  const prev = await correr("appointments", f);
  const sobre = fila(prev, 2);
  assert.equal(sobre.data.resourceId, null);
  assert.match(sobre.data.notes, /Sobreagendada/);
  const choca = fila(prev, 3);
  assert.equal(choca.status, "ok");
  assert.equal(choca.data.resourceId, null);
  assert.match(choca.warnings.join(" "), /consultorio está ocupado/);
  assert.match(choca.data.notes, /Sillón en Dentalink: Sillon 1 \(no se asignó consultorio/);
  assert.equal(choca.data.startsLocal.startsWith("06/05/2030 10:00"), true, "el horario no se movió");
});

// ─────────────────────────── historial ───────────────────────────

const PASADA = { fecha: "2026-03-04", ini: "17:00:00", fin: "17:30:00", trat: "16", pac: "202", doc: ["Carlos", "Nuñez"] as [string, string] };

test("historial: entran TODAS las pasadas — ninguna se descarta por su estado", async () => {
  reiniciar();
  const estados = [
    "Atendido", "No asiste", "Cancelado", "Anulado por IA", "Cambio de fecha", "Confirmado por pcte. vía WhatsApp", "No confirmado",
    "Notif. automática vía WhatsApp", "Notificado via email", "Recordado por IA", "Paciente Deshabilitado",
  ];
  const f = archivo(...estados.map((e, i) => ({ ...PASADA, trat: "999", estado: e, fecha: `2026-03-${String(10 + i).padStart(2, "0")}` })));
  const prev = await correr("appointmentHistory", f);
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev.mappingError));
  assert.deepEqual([prev.total, prev.validos, prev.invalidos], [11, 11, 0]);
  await correr("appointmentHistory", f, { dryRun: false });
  const visitas = tabla("migratedVisit");
  assert.equal(visitas.length, 11);
  assert.equal(tabla("appointment").length, 0, "nada de esto es agenda");
  const porResultado: Record<string, number> = {};
  for (const v of visitas) {
    const r = /^Resultado: (.*)$/m.exec(v.notes)![1];
    porResultado[r] = (porResultado[r] ?? 0) + 1;
    assert.match(v.notes, /Estado en Dentalink: /, "el estado original se conserva");
  }
  assert.deepEqual(porResultado, { "Atendida": 1, "No asistió": 1, "Cancelada": 2, "Reagendada (cambió de fecha)": 1, "Sin registro de asistencia": 6 });
});

test("historial: el control ATENDIDO de un caso cuenta como control — cita COMPLETADA con el doctor del caso, y no repite el mismo día", async () => {
  reiniciar();
  const f = archivo(
    { ...PASADA, estado: "Atendido", motivo: "control mensual de ortodoncia" },
    { ...PASADA, estado: "Atendido", ini: "18:00:00", fin: "18:30:00", motivo: "control mensual de ortodoncia" }, // mismo caso, mismo día
    { ...PASADA, estado: "No asiste", fecha: "2026-04-04", motivo: "control mensual de ortodoncia" },
    { ...PASADA, estado: "Atendido", fecha: "2026-05-04", motivo: "VALORACION" },
  );
  const prev = await correr("appointmentHistory", f);
  assert.equal(fila(prev, 2).data.comoControl, true);
  assert.equal(fila(prev, 3).data.comoControl, undefined, "el segundo control del mismo día no crea otra cita");
  assert.match(fila(prev, 3).warnings.join(" "), /Otro control del mismo caso ese día/);
  assert.equal(fila(prev, 4).data.comoControl, undefined, "una falta no es un control hecho");
  assert.equal(fila(prev, 5).data.comoControl, undefined, "una valoración no es el control mensual");

  await correr("appointmentHistory", f, { dryRun: false });
  const citasCreadas = tabla("appointment");
  assert.equal(citasCreadas.length, 1);
  const [c] = citasCreadas;
  assert.deepEqual([c.type, c.status, c.doctorId, c.patientId], ["Control de ortodoncia", "COMPLETED", "doc1", "p1"]);
  assert.equal(c.resourceId, "res1");
  assert.equal(tabla("migratedVisit").length, 3, "lo demás queda como historia migrada");
  // Recuerda «este control de este caso ese día».
  const marca = tabla("importExternalIds").find((r: any) => r.entity === "ortho_control");
  assert.deepEqual([marca.externalId, marca.localId, marca.source], ["16|2026-03-04", c.id, FUENTE]);

  // Reimportar no repite nada.
  const otra = await correr("appointmentHistory", f, { dryRun: true });
  assert.equal(fila(otra, 2).status, "skipped");
  const rehecho = await correr("appointmentHistory", f, { dryRun: false });
  assert.equal(rehecho.created, 0);
  assert.equal(tabla("appointment").length, 1);
  assert.equal(tabla("migratedVisit").length, 3);
});

test("historial: si 06 ya registró la hoja de ese control ese día, la cita se ENLAZA a ella (no hay otro control)", async () => {
  reiniciar((s) => {
    (s.importExternalIds as any[]).push({ id: "e9", clinicId: CLINICA, source: FUENTE, entity: "ortho_control", externalId: "16|2026-03-04", localId: "hoja1" });
    (s.orthoTreatmentCard as any[]).push({ id: "hoja1", clinicId: CLINICA, appointmentId: null });
  });
  const f = archivo({ ...PASADA, estado: "Atendido", motivo: "control mensual de ortodoncia" });
  await correr("appointmentHistory", f, { dryRun: false });
  const [c] = tabla("appointment");
  assert.equal(tabla("appointment").length, 1);
  assert.equal(tabla("orthoTreatmentCard")[0].appointmentId, c.id);
  // La marca de 06 se respeta (ON CONFLICT DO NOTHING).
  assert.equal(tabla("importExternalIds").filter((r: any) => r.entity === "ortho_control").length, 1);
  assert.equal(tabla("importExternalIds").find((r: any) => r.entity === "ortho_control").localId, "hoja1");
});

test("historial: si el control choca con otra cita del doctor, NO se mueve el horario: queda como historia y se dice", async () => {
  reiniciar((s) => {
    (s.appointment as any[]).push({
      id: "a_ocupa", clinicId: CLINICA, patientId: "p3", doctorId: "doc1", resourceId: null, type: "Consulta",
      startsAt: new Date("2026-03-04T23:00:00Z"), endsAt: new Date("2026-03-05T00:00:00Z"), status: "COMPLETED", holdExpiresAt: null,
    });
  });
  // 17:00–17:30 México = 23:00–23:30Z: choca con a_ocupa (doc1).
  const f = archivo({ ...PASADA, estado: "Atendido", motivo: "control mensual de ortodoncia" });
  const prev = await correr("appointmentHistory", f);
  assert.equal(fila(prev, 2).status, "ok");
  assert.equal(fila(prev, 2).data.comoControl, undefined);
  assert.match(fila(prev, 2).warnings.join(" "), /Choca con otra cita del doctor/);
  await correr("appointmentHistory", f, { dryRun: false });
  assert.equal(tabla("appointment").length, 1, "solo la que ya estaba");
  assert.equal(tabla("migratedVisit").length, 1);
});

test("historial: una cita vigente de fecha futura NO es historia (la trae el archivo de citas); cancelada futura sí; atendida futura es incoherente", async () => {
  reiniciar();
  const fut = { ...PASADA, trat: "999", fecha: "2030-05-06" };
  const f = archivo(
    { ...fut, estado: "Confirmado por pcte. vía WhatsApp" },
    { ...fut, estado: "Anulado por IA", fecha: "2030-05-07" },
    { ...fut, estado: "Atendido", fecha: "2030-05-08" },
  );
  const prev = await correr("appointmentHistory", f);
  assert.equal(fila(prev, 2).status, "skipped");
  assert.equal(fila(prev, 3).status, "ok");
  assert.equal(fila(prev, 4).status, "error");
});

test("historial: el doctor del archivo sin equivalente se ELIGE, salvo en lo que pertenece a un caso (ese ya sabe su doctor)", async () => {
  reiniciar();
  const f = archivo(
    { ...PASADA, estado: "Atendido", trat: "999", doc: ["Fantasma", "Nadie"] },
    { ...PASADA, estado: "No asiste", doc: ["Fantasma", "Nadie"], fecha: "2026-06-04" }, // del caso #16 → doctor tratante
  );
  const prev = await correr("appointmentHistory", f);
  assert.equal(fila(prev, 2).unresolved?.[0]?.field, "doctor");
  assert.equal(fila(prev, 3).unresolved, undefined);
  assert.equal(fila(prev, 3).data.doctorId, "doc1");
  assert.deepEqual((prev.unresolved ?? []).map((u: any) => u.rows), [1]);
});

test("un caso de OTRA clínica con el mismo # de tratamiento jamás se liga", async () => {
  reiniciar((s) => {
    (s.importExternalIds as any[]).splice(3, 1); // p1 no tiene caso en la clínica A
  });
  const f = archivo({ ...PASADA, estado: "Atendido", motivo: "control mensual de ortodoncia" });
  const prev = await correr("appointmentHistory", f);
  assert.equal(fila(prev, 2).data.comoControl, undefined);
  assert.match(fila(prev, 2).data.notes, /Tratamiento #16 de Dentalink \(no está entre los tratamientos migrados\)/);
});

// ─────────────────────────── saldos (04) ───────────────────────────

const SALDOS = (...filas: Array<[trat: string, pac: string, mora: number]>) =>
  new File(
    [["Nombre Sucursal,# Tratamiento,Paciente,Nombre Paciente,Apellidos Paciente,Mora", ...filas.map(([t, p, m]) => `Bevadent,${t},${p},${NOMBRE[p][0]},${NOMBRE[p][1]},${m}`)].join("\n")],
    "04_Saldos.csv",
    { type: "text/csv" },
  );

test("saldos: la mora de un tratamiento NORMAL ya importado no crea deuda: se anota en él; la de uno que no está entra como siempre", async () => {
  reiniciar();
  const f = SALDOS(["291", "203", 600], ["56", "204", 600]);
  const prev = await correr("balances", f);
  assert.equal(prev.mappingError, undefined, JSON.stringify(prev.mappingError));
  assert.deepEqual([prev.total, prev.validos, prev.invalidos], [2, 2, 0]);
  assert.match(fila(prev, 2).warnings.join(" "), /Ya incluido en el tratamiento #291/);
  assert.equal(fila(prev, 3).data.ligadoA, undefined);

  const hecho = await correr("balances", f, { dryRun: false });
  assert.equal(hecho.created, 1, "solo la que no está en ningún tratamiento");
  assert.equal(tabla("invoice").length, 1);
  assert.equal(tabla("invoice")[0].patientId, "p3");
  assert.equal(tabla("invoice")[0].total, 600);
  const q = tabla("quote")[0];
  assert.match(q.notes, /Mora en Dentalink: \$600\.00 \(saldo ya incluido en este tratamiento #291/);
  assert.match(q.notes, /Folio original \(tratamiento activo\): 291/, "el marcador del folio sigue igual");

  // Reintento: ni otra factura ni otra nota.
  const otra = await correr("balances", f, { dryRun: false });
  assert.equal(otra.created, 0);
  assert.equal(tabla("invoice").length, 1);
  assert.equal(tabla("quote")[0].notes.match(/Mora en Dentalink/g)!.length, 1);
});

test("saldos: la mora de un CASO de ortodoncia se anota al final de las notas de su plan, sin pisarlas", async () => {
  reiniciar();
  const f = SALDOS(["16", "202", 600]);
  const hecho = await correr("balances", f, { dryRun: false });
  assert.equal(hecho.created, 0);
  assert.equal(tabla("invoice").length, 0, "esa mora ya está en los cargos pendientes del caso");
  const notas = tabla("orthodonticTreatmentPlan")[0].prescriptionNotes as string;
  assert.equal(notas.split("\n")[0], "Migrado de Dentalink · # Tratamiento 16");
  assert.match(notas, /\nMora en Dentalink: \$600\.00 \(saldo ya incluido en este tratamiento #16/);
});

test("saldos: si el # de tratamiento es de OTRO paciente, no se liga y la mora entra como saldo aparte", async () => {
  reiniciar();
  // #291 es de p2 y #16 (caso de ortodoncia) es de p1; las dos filas dicen p3.
  const f = SALDOS(["291", "204", 600], ["16", "204", 600]);
  const prev = await correr("balances", f);
  assert.equal(fila(prev, 2).data.ligadoA, undefined);
  assert.equal(fila(prev, 3).data.ligadoA, undefined);
  assert.match(fila(prev, 3).warnings.join(" "), /pertenece a otro paciente/);
  const hecho = await correr("balances", f, { dryRun: false });
  assert.equal(hecho.created, 2);
  assert.equal(tabla("invoice").length, 2);
  assert.equal(tabla("quote")[0].notes.includes("Mora en Dentalink"), false, "no se anota en un tratamiento ajeno");
});

test("saldos: dos moras de tratamientos distintos del mismo paciente son dos movimientos", async () => {
  reiniciar();
  const f = SALDOS(["56", "204", 600], ["57", "204", 600]);
  const prev = await correr("balances", f);
  assert.deepEqual([prev.validos, prev.duplicados], [2, 0]);
});
