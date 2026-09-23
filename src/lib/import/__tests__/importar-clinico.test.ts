/**
 * ws1-t4 — los tres importadores clínicos: EXPEDIENTES, NOTAS DE EVOLUCIÓN y
 * PRESUPUESTOS, más lo que el motor tuvo que aprender para que sirvan.
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/import/__tests__/importar-clinico.test.ts
 *
 * Se conduce el motor DE VERDAD: `runImport` + los handlers de entities.ts +
 * parseo con exceljs de archivos reales (fixtures/*.csv y la plantilla .xlsx que
 * sirve GET /api/patients/import/template). Solo se sustituyen Prisma (doble en
 * memoria que aplica los `where` y la unicidad, ver doble-prisma.ts), el audit y
 * el cupo del plan (que importa "server-only"). La inmutabilidad de una nota
 * migrada se prueba con el SERVICIO real de patient-documents, no con un espejo.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import path from "path";
import ExcelJS from "exceljs";
import { crearBase, type Base } from "./doble-prisma";

const CLINICA = "cli_A";
const OTRA = "cli_B";
const IMPORTA = "u_admin";
const FIX = path.join(__dirname, "fixtures");

// ── La base de cada prueba ─────────────────────────────────────────────────
function semilla() {
  const antes = new Date("2026-09-01T10:00:00.000Z");
  const paciente = (o: Record<string, any>) => ({
    clinicId: CLINICA, email: null, phone: null, deletedAt: null, allergies: [], chronicConditions: [],
    currentMedications: [], familyHistory: null, personalNonPathologicalHistory: null, curp: null,
    curpStatus: "PENDING", updatedAt: antes, ...o,
  });
  return {
    clinic: [
      { id: CLINICA, name: "Clínica Sonrisa", logoUrl: null, timezone: "America/Mexico_City", city: "CDMX", address: "Av. Reforma 1", state: "CDMX", phone: "5550001111" },
      { id: OTRA, name: "Otra clínica", logoUrl: null, timezone: "America/Mexico_City", city: null, address: null, state: null, phone: null },
    ],
    patient: [
      paciente({ id: "p1", patientNumber: "P-0001", firstName: "María", lastName: "Hernández", email: "maria.h@example.com", phone: "5551234567", allergies: ["Penicilina"], familyHistory: "Madre con diabetes tipo 2" }),
      paciente({ id: "p2", patientNumber: "P-0002", firstName: "Jorge", lastName: "López", phone: "5559876543" }),
      paciente({ id: "p3", patientNumber: "P-0003", firstName: "Ana", lastName: "Ruiz", email: "ana.ruiz@example.com" }),
      // La MISMA María, con el mismo teléfono, en OTRA clínica: si el índice la
      // viera, la de cli_A saldría «coincide con varios pacientes».
      paciente({ id: "pB1", clinicId: OTRA, patientNumber: "P-0001", firstName: "María", lastName: "Hernández", phone: "5551234567" }),
    ],
    user: [
      { id: IMPORTA, clinicId: CLINICA, firstName: "Rafael", lastName: "Admin", isActive: true },
      { id: "u_ana", clinicId: CLINICA, firstName: "Ana", lastName: "López", isActive: true },
      // «Dr. Juan Viejo» existe… pero en la otra clínica.
      { id: "u_juan", clinicId: OTRA, firstName: "Juan", lastName: "Viejo", isActive: true },
    ],
    procedureCatalog: [
      { id: "pc1", clinicId: CLINICA, name: "Profilaxis", isActive: true },
      { id: "pc2", clinicId: CLINICA, name: "Restauración con resina una superficie", isActive: true },
      { id: "pc3", clinicId: CLINICA, name: "Extracción simple", isActive: false },
      { id: "pcB1", clinicId: OTRA, name: "Resina simple", isActive: true },
    ],
    quote: [
      { id: "q_nativo", clinicId: CLINICA, patientId: "p1", folio: "P-0007", status: "ACCEPTED", total: 500, notes: null, createdAt: new Date("2026-01-10T12:00:00Z") },
    ],
    quoteItem: [],
    patientDocument: [],
    invoice: [],
    patientCredit: [],
  };
}

let base: Base = crearBase(semilla());
const auditorias: any[] = [];

mock.module("@/lib/prisma", {
  namedExports: { prisma: new Proxy({}, { get: (_t, k: string) => base.prisma[k] }) },
});
mock.module("@/lib/audit", { namedExports: { logAudit: async (o: any) => { auditorias.push(o); } } });
mock.module("@/lib/patient-quota", {
  namedExports: { getPatientQuota: async () => ({ unlimited: true, used: 0, max: null, remaining: null }) },
});

const engine = () => import("../engine");
const entidades = () => import("../entities");

function reiniciar() {
  base = crearBase(semilla());
  auditorias.length = 0;
}

function archivo(nombre: string): File {
  return new File([readFileSync(path.join(FIX, nombre))], nombre);
}

async function correr(
  entidad: string,
  file: File,
  opts: {
    dryRun: boolean; columnMapping?: Record<string, string>; origin?: string; valueMapping?: any;
    skipDuplicates?: boolean; clinicId?: string; userId?: string; role?: string;
  },
): Promise<any> {
  const { runImport } = await engine();
  const { HANDLERS } = await entidades();
  return runImport(HANDLERS[entidad], {
    file,
    clinicId: opts.clinicId ?? CLINICA,
    userId: opts.userId ?? IMPORTA,
    role: opts.role ?? "ADMIN",
    dryRun: opts.dryRun,
    skipDuplicates: opts.skipDuplicates ?? true,
    columnMapping: opts.columnMapping ?? null,
    origin: opts.origin ?? null,
    valueMapping: opts.valueMapping ?? null,
  });
}

const fila = (res: any, n: number) => res.preview.find((r: any) => r.row === n);
const tabla = (m: string) => base.tablas[m] ?? [];

// ═══ EXPEDIENTES ═══════════════════════════════════════════════════════════

test("expedientes: suma a la ficha sin pisar ni repetir, y el mismo archivo dos veces no cambia nada", async () => {
  reiniciar();
  const prev = await correr("medicalHistory", archivo("expedientes.csv"), { dryRun: true });
  assert.equal(prev.mappingError, undefined);
  assert.deepEqual([prev.total, prev.validos, prev.invalidos, prev.duplicados], [5, 2, 2, 1]);
  assert.deepEqual(fila(prev, 4).errors, ["Paciente no encontrado en la clínica"]); // Pedro Inventado
  assert.deepEqual(fila(prev, 5).errors, ["La fila no trae antecedentes"]);
  assert.equal(fila(prev, 6).status, "duplicate"); // «penicilina» ya la tiene (sin distinguir mayúsculas)
  // «Ninguna» no es una alergia: Jorge no suma ninguna.
  assert.equal(fila(prev, 3).data.added.allergies, undefined);
  // La vista previa no lleva el estado completo de la ficha.
  assert.equal(fila(prev, 2).data.next, undefined);

  const hecho = await correr("medicalHistory", archivo("expedientes.csv"), { dryRun: false });
  assert.equal(hecho.created, 2); // dos pacientes
  const maria = tabla("patient").find((p) => p.id === "p1")!;
  assert.deepEqual(maria.allergies, ["Penicilina", "Látex"]);
  assert.deepEqual(maria.chronicConditions, ["Hipertensión"]);
  assert.deepEqual(maria.currentMedications, ["Losartán 50 mg"]);
  assert.equal(maria.familyHistory, "Madre con diabetes tipo 2"); // ya lo decía: no se duplica
  assert.equal(maria.personalNonPathologicalHistory, "No fuma");
  const jorge = tabla("patient").find((p) => p.id === "p2")!;
  assert.deepEqual(jorge.chronicConditions, ["Diabetes tipo 2", "Asma"]);
  assert.deepEqual(jorge.allergies, []);
  // La María de la otra clínica, intacta.
  assert.deepEqual(tabla("patient").find((p) => p.id === "pB1")!.allergies, []);
  // Una sola escritura para los dos pacientes.
  assert.equal(base.llamadas["$queryRaw.patientsUpdate"], 1);
  assert.equal(auditorias[0].action, "update");

  const otraVez = await correr("medicalHistory", archivo("expedientes.csv"), { dryRun: false });
  assert.equal(otraVez.created, 0);
  assert.deepEqual(tabla("patient").find((p) => p.id === "p1")!.allergies, ["Penicilina", "Látex"]);
});

test("expedientes: si alguien editó al paciente mientras se importaba, no se pisa su cambio", async () => {
  reiniciar();
  // Otra pestaña guarda a María justo antes de la escritura del import.
  base.ganchos["$queryRaw.patientsUpdate"] = () => {
    const p = tabla("patient").find((x) => x.id === "p1")!;
    p.allergies = ["Penicilina", "Sulfas"];
    p.updatedAt = new Date("2026-09-22T09:00:00.000Z");
  };
  const hecho = await correr("medicalHistory", archivo("expedientes.csv"), { dryRun: false });
  assert.equal(hecho.created, 1); // solo Jorge
  assert.deepEqual(tabla("patient").find((p) => p.id === "p1")!.allergies, ["Penicilina", "Sulfas"]);
  const err = hecho.errors.find((e: any) => e.row === 2);
  assert.match(err.errors[0], /cambió mientras se importaba/);
});

// ═══ NOTAS DE EVOLUCIÓN ════════════════════════════════════════════════════

test("notas: entran MIGRADAS, con su fecha y su autor originales, y no se pueden firmar ni editar aquí", async () => {
  reiniciar();
  const prev = await correr("clinicalNotes", archivo("notas.csv"), { dryRun: true, origin: "dentalink" });
  assert.equal(prev.mappingError, undefined);
  assert.deepEqual([prev.total, prev.validos, prev.invalidos, prev.duplicados], [8, 3, 4, 1]);
  assert.match(fila(prev, 4).errors[0], /Fecha inválida "pendiente"/);
  assert.deepEqual(fila(prev, 5).errors, ["Paciente no encontrado en la clínica"]);
  assert.match(fila(prev, 6).errors[0], /posterior a hoy/);
  assert.equal(fila(prev, 7).status, "duplicate"); // la misma nota dos veces en el archivo
  assert.match(fila(prev, 9).errors[0], /Fecha inválida "31\/02\/2024"/); // ya no se vuelve 2 de marzo
  // Autor que no es usuario (el de la OTRA clínica tampoco cuenta): aviso, no error.
  assert.match(fila(prev, 3).warnings[0], /Doctor "Dr\. Juan Viejo" no encontrado en la clínica/);
  // El texto va recortado en la vista previa.
  assert.ok(fila(prev, 2).data.text.length <= 161);

  const hecho = await correr("clinicalNotes", archivo("notas.csv"), { dryRun: false, origin: "dentalink" });
  assert.equal(hecho.created, 3);
  const notas = tabla("patientDocument");
  assert.equal(notas.length, 3);
  for (const n of notas) {
    assert.equal(n.clinicId, CLINICA);
    assert.equal(n.kind, "NOTA_EVOLUCION");
    assert.equal(n.status, "MIGRATED"); // ni DRAFT ni SIGNED
    assert.equal(n.signedAt, null);
    assert.equal(n.modoFirma, null);
    assert.match(n.body, /^<p><b>Nota migrada de Dentalink\.<\/b>/);
    assert.match(n.body, /No se firmó en esta clínica/);
    assert.equal(n.encabezado.cedula, null);
    assert.equal(n.encabezado.migracion.origen, "Dentalink");
    assert.equal(n.encabezado.migracion.importadoPor, IMPORTA);
    assert.equal(n.encabezado.migracion.archivo, "notas.csv");
  }
  const resina = notas.find((n) => n.patientId === "p1")!;
  assert.equal(resina.title, "Resina en 16 · migrada de Dentalink");
  assert.equal(resina.doctorId, "u_ana"); // «Dra. Ana López» es usuaria de la clínica
  assert.equal(resina.encabezado.doctorNombre, "Ana López");
  // Fecha ORIGINAL, el mismo día en México aunque el servidor corra en otro huso.
  assert.equal(resina.createdAt.toISOString(), "2024-03-12T12:00:00.000Z");
  assert.equal(resina.encabezado.fecha, "12 de marzo de 2024");
  assert.equal(resina.encabezado.migracion.fechaOriginal, "2024-03-12");
  // El HTML del otro sistema entra como TEXTO, y el salto de línea se respeta.
  assert.match(resina.body, /&lt;b&gt;Sin&lt;\/b&gt;/);
  assert.match(resina.body, /frío\.<br>Se coloca/);

  const jorge = notas.find((n) => n.patientId === "p2")!;
  assert.equal(jorge.createdAt.toISOString(), "2023-11-05T12:00:00.000Z"); // "2023-11-05" no cae el día 4
  assert.equal(jorge.doctorId, IMPORTA); // queda a cargo de quien importa…
  assert.equal(jorge.encabezado.doctorNombre, "Dr. Juan Viejo"); // …con el autor original a la vista
  assert.equal(jorge.title, "Nota de evolución · migrada de Dentalink");

  // La inmutabilidad NO se afirma: se prueba contra el servicio real de notas.
  const svc = await import("@/app/api/patient-documents/_lib/service");
  const ahora = new Date("2026-09-22T15:00:00Z");
  const editar = await svc.updateNotaDraft(base.prisma, CLINICA, resina.id, "u_ana", "<p>otra cosa</p>", ahora);
  assert.equal(editar.ok, false);
  assert.equal((editar as any).code, "ALREADY_SIGNED");
  const firmar = await svc.signNota(base.prisma, CLINICA, resina.id, "u_ana", undefined, ahora);
  assert.equal(firmar.ok, false);
  assert.equal(tabla("patientDocument").find((n) => n.id === resina.id)!.status, "MIGRATED");
  const lista = await svc.listNotas(base.prisma, CLINICA, "p1");
  assert.equal(lista[0].fecha, "12 de marzo de 2024");
  assert.equal(lista[0].doctorNombre, "Ana López");

  // El mismo archivo otra vez: nada nuevo.
  const otraVez = await correr("clinicalNotes", archivo("notas.csv"), { dryRun: false, origin: "dentalink" });
  assert.equal(otraVez.created, 0);
  assert.equal(tabla("patientDocument").length, 3);
});

test("notas: sin origen elegido, la marca dice «otro sistema» y no inventa uno", async () => {
  reiniciar();
  await correr("clinicalNotes", archivo("notas.csv"), { dryRun: false, origin: "excel" });
  const n = tabla("patientDocument")[0];
  assert.match(n.body, /^<p><b>Nota migrada de otro sistema\.<\/b>/);
  assert.equal(n.encabezado.migracion.origen, "otro sistema");
});

test("notas: 5 000 filas no hacen 5 000 consultas", async () => {
  reiniciar();
  const lineas = ["paciente,telefono,fecha,doctor,nota"];
  const pacientes = [["María Hernández", "5551234567"], ["Jorge López", "5559876543"], ["Ana Ruiz", ""]];
  for (let i = 0; i < 5000; i++) {
    const [n, t] = pacientes[i % 3];
    const dia = String((i % 28) + 1).padStart(2, "0");
    const mes = String((Math.floor(i / 28) % 12) + 1).padStart(2, "0");
    lineas.push(`${n},${t},${dia}/${mes}/2021,Dra. Ana López,Nota número ${i}`);
  }
  const f = new File([lineas.join("\n")], "muchas.csv");
  const hecho = await correr("clinicalNotes", f, { dryRun: false });
  assert.equal(hecho.created, 5000);
  const l = base.llamadas;
  assert.equal(l["patient.findMany"], 2); // el índice (process) + la foto de la cabecera (commit)
  assert.equal(l["user.findMany"], 1);
  assert.equal(l["patientDocument.findMany"], 1);
  assert.equal(l["patientDocument.createMany"], 25); // lotes de 200
});

// ═══ PRESUPUESTOS ══════════════════════════════════════════════════════════

test("presupuestos: agrupa líneas, casa el tarifario y lo que no casa entra sin ligar; nada de dinero", async () => {
  reiniciar();
  const prev = await correr("quotes", archivo("presupuestos.csv"), { dryRun: true, origin: "dentalink" });
  assert.equal(prev.mappingError, undefined);
  assert.deepEqual([prev.total, prev.validos, prev.invalidos, prev.duplicados], [7, 4, 3, 0]);
  assert.match(fila(prev, 4).errors[0], /Precio inválido "abc"/);
  // Su compañera del presupuesto 2001 cae con ella: un presupuesto entra completo o no entra.
  assert.match(fila(prev, 5).errors[0], /La fila 4 de este presupuesto tiene error/);
  assert.deepEqual(fila(prev, 6).errors, ["Paciente no encontrado en la clínica"]);
  // «Resina simple» no está en el tarifario de ESTA clínica (sí en el de la otra): aviso y fila OK.
  assert.equal(fila(prev, 2).status, "ok");
  assert.match(fila(prev, 2).warnings[0], /Procedimiento "Resina simple" no encontrado.*sin ligar/);
  assert.deepEqual(prev.unresolved, [{ field: "procedure", key: "resinasimple", value: "Resina simple", rows: 2 }]);
  assert.deepEqual(
    prev.options.procedure.map((o: any) => o.label),
    ["Profilaxis", "Restauración con resina una superficie", "Extracción simple (inactivo)"],
  );

  const hecho = await correr("quotes", archivo("presupuestos.csv"), { dryRun: false, origin: "dentalink" });
  assert.equal(hecho.created, 2); // dos presupuestos (María 1043 y Ana sin folio)
  const migrados = tabla("quote").filter((q) => q.status === "MIGRATED");
  assert.equal(migrados.length, 2);
  const maria = migrados.find((q) => q.patientId === "p1")!;
  const ana = migrados.find((q) => q.patientId === "p3")!;
  // La secuencia de folios de la clínica sigue: había P-0007.
  assert.deepEqual([maria.folio, ana.folio].sort(), ["P-0008", "P-0009"]);
  assert.equal(maria.createdAt.toISOString(), "2024-02-05T12:00:00.000Z");
  assert.equal(maria.createdById, IMPORTA);
  assert.equal(maria.validUntil, null);
  assert.equal(maria.title, "Rehabilitación · migrado de Dentalink");
  assert.equal(maria.total, 1350); // 850 + (600 − 100), con computeTotals
  assert.match(maria.notes, /^Presupuesto migrado de Dentalink el .*no genera factura, cobro ni movimiento de caja/);
  assert.match(maria.notes, /\nFolio original: 1043\n/);
  assert.match(maria.notes, /Estado en el sistema anterior: Aprobado/);
  const itemsMaria = tabla("quoteItem").filter((i) => i.quoteId === maria.id).sort((a, b) => a.sortOrder - b.sortOrder);
  assert.deepEqual(itemsMaria.map((i) => [i.name, i.procedureId, i.toothFdi, i.lineTotal]), [
    ["Resina simple", null, "16", 850],
    ["PROFILAXIS", "pc1", null, 500],
  ]);
  const itemsAna = tabla("quoteItem").filter((i) => i.quoteId === ana.id);
  assert.deepEqual(itemsAna.map((i) => [i.name, i.procedureId, i.quantity, i.lineTotal]).sort(), [
    ["Extracción simple", "pc3", 2, 1400],
    ["Resina simple", null, 1, 850],
  ]);
  // 🔴 Historia, no venta: ni una factura, ni un crédito, y el presupuesto de verdad intacto.
  assert.equal(tabla("invoice").length, 0);
  assert.equal(tabla("patientCredit").length, 0);
  assert.equal(tabla("quote").find((q) => q.id === "q_nativo")!.status, "ACCEPTED");
  // Nada de la otra clínica se ligó.
  assert.ok(!tabla("quoteItem").some((i) => i.procedureId === "pcB1"));

  // El mismo archivo otra vez: duplicados, nada nuevo.
  const prev2 = await correr("quotes", archivo("presupuestos.csv"), { dryRun: true, origin: "dentalink" });
  assert.equal(prev2.duplicados, 4);
  const otraVez = await correr("quotes", archivo("presupuestos.csv"), { dryRun: false, origin: "dentalink" });
  assert.equal(otraVez.created, 0);
  assert.equal(tabla("quote").length, 3);
});

test("presupuestos: el equivalente elegido se liga; un id de otra clínica no", async () => {
  reiniciar();
  const hecho = await correr("quotes", archivo("presupuestos.csv"), {
    dryRun: false,
    valueMapping: { procedure: { resinasimple: "pc2" } },
  });
  assert.equal(hecho.created, 2);
  const resinas = tabla("quoteItem").filter((i) => i.name === "Resina simple");
  assert.equal(resinas.length, 2);
  assert.ok(resinas.every((i) => i.procedureId === "pc2"));

  reiniciar();
  const prev = await correr("quotes", archivo("presupuestos.csv"), {
    dryRun: true,
    valueMapping: { procedure: { resinasimple: "pcB1" } }, // de la OTRA clínica
  });
  assert.match(fila(prev, 2).warnings[0], /ya no está en tu catálogo/);
  await correr("quotes", archivo("presupuestos.csv"), { dryRun: false, valueMapping: { procedure: { resinasimple: "pcB1" } } });
  assert.ok(tabla("quoteItem").filter((i) => i.name === "Resina simple").every((i) => i.procedureId === null));
});

test("presupuestos: si otro folio se adelanta, se renumera y no quedan líneas huérfanas", async () => {
  reiniciar();
  let una = true;
  // Corre al ABRIR la transacción, ya leído el folio: lo que mete no lo deshace
  // nuestro rollback, igual que el INSERT de otra conexión.
  base.ganchos["$transaction"] = () => {
    if (!una) return;
    una = false;
    // Alguien crea el P-0008 a mano entre la lectura del folio y la escritura.
    tabla("quote").push({ id: "q_carrera", clinicId: CLINICA, patientId: "p2", folio: "P-0008", status: "DRAFT", total: 0, notes: null, createdAt: new Date() });
  };
  const hecho = await correr("quotes", archivo("presupuestos.csv"), { dryRun: false });
  assert.equal(hecho.created, 2);
  const folios = tabla("quote").filter((q) => q.status === "MIGRATED").map((q) => q.folio).sort();
  assert.deepEqual(folios, ["P-0009", "P-0010"]);
  const ids = new Set(tabla("quote").map((q) => q.id));
  assert.ok(tabla("quoteItem").every((i) => ids.has(i.quoteId)));
  assert.equal(tabla("quoteItem").length, 4);
});

// ═══ COLUMNAS DESCONOCIDAS, PERFIL Y PLANTILLA ═════════════════════════════

test("columnas que no reconocemos: la vista previa pide ayuda en vez de fallar, y con el mapeo manual entra", async () => {
  reiniciar();
  const prev = await correr("clinicalNotes", archivo("columnas-desconocidas.csv"), { dryRun: true });
  assert.equal(prev.mappingError, "Falta una columna para identificar al paciente (teléfono, correo o nombre)");
  assert.deepEqual(prev.columns, ["Cliente ID", "Fecha visita", "Observación clínica", "Atendido por"]);
  assert.equal(prev.total, 2);
  assert.deepEqual(prev.preview, []);

  // Importar de verdad sin mapeo sí se corta (400), como siempre.
  const { ImportError } = await engine();
  await assert.rejects(
    correr("clinicalNotes", archivo("columnas-desconocidas.csv"), { dryRun: false }),
    (e: any) => e instanceof ImportError && e.status === 400,
  );

  const manual = {
    "Cliente ID": "name",
    "Fecha visita": "date",
    "Observación clínica": "text",
    "Atendido por": "doctor",
  };
  const ok = await correr("clinicalNotes", archivo("columnas-desconocidas.csv"), { dryRun: true, columnMapping: manual });
  assert.equal(ok.mappingError, undefined);
  assert.equal(ok.validos, 2);
  const hecho = await correr("clinicalNotes", archivo("columnas-desconocidas.csv"), { dryRun: false, columnMapping: manual });
  assert.equal(hecho.created, 2);
});

test("perfil de Dentalink: reconoce columnas que la autodetección genérica no, y solo si se eligió Dentalink", async () => {
  reiniciar();
  const sinPerfil = await correr("clinicalNotes", archivo("dentalink-evoluciones.csv"), { dryRun: true });
  assert.equal(sinPerfil.mappingError, "Falta la columna con el texto de la nota");
  const conPerfil = await correr("clinicalNotes", archivo("dentalink-evoluciones.csv"), { dryRun: true, origin: "dentalink" });
  assert.equal(conPerfil.mappingError, undefined);
  assert.equal(conPerfil.suggestedMapping["Detalle evolución"], "text");
  assert.equal(conPerfil.suggestedMapping["Nombre paciente"], "name");
  assert.equal(conPerfil.validos, 1);
  // Un origen inventado no rompe nada: es "sin perfil".
  const raro = await correr("clinicalNotes", archivo("dentalink-evoluciones.csv"), { dryRun: true, origin: "../../etc" });
  assert.equal(raro.mappingError, "Falta la columna con el texto de la nota");
  // Sigue sin estar verificado: nadie lo ha probado con un export real.
  const { getOriginProfile } = await import("../profiles");
  assert.equal(getOriginProfile("dentalink")!.verified, false);
});

test("plantilla: trae una pestaña por entidad y cada importador lee la suya y reconoce sus encabezados", async () => {
  reiniciar();
  const { GET } = await import("@/app/api/patients/import/template/route");
  const res = await GET();
  const ab = await res.arrayBuffer();
  const bytes = Buffer.from(ab);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ab); // ArrayBuffer, igual que el motor
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Pacientes", "Saldos", "Citas", "Expedientes", "Notas", "Presupuestos"]);

  const plantilla = () => new File([bytes], "plantilla-dalecontrol.xlsx");
  for (const [entidad, hoja] of [
    ["patients", "Pacientes"], ["balances", "Saldos"], ["appointments", "Citas"],
    ["medicalHistory", "Expedientes"], ["clinicalNotes", "Notas"], ["quotes", "Presupuestos"],
  ] as const) {
    const prev = await correr(entidad, plantilla(), { dryRun: true });
    const cabeceras: string[] = [];
    wb.getWorksheet(hoja)!.getRow(1).eachCell((c) => { cabeceras.push(String(c.value)); });
    assert.deepEqual(prev.columns, cabeceras, `${entidad} leyó la pestaña equivocada`);
    assert.equal(prev.mappingError, undefined, `${entidad}: ${prev.mappingError}`);
    // Cada encabezado de la plantilla se reconoce solo (nada queda «sin mapear»).
    assert.deepEqual(Object.keys(prev.suggestedMapping).sort(), [...cabeceras].sort(), `${entidad}: encabezado sin reconocer`);
  }
  // Las filas de muestra de las entidades nuevas son de María, que existe: válidas.
  assert.equal((await correr("medicalHistory", plantilla(), { dryRun: true })).validos, 1);
  assert.equal((await correr("clinicalNotes", plantilla(), { dryRun: true })).validos, 1);
  assert.equal((await correr("quotes", plantilla(), { dryRun: true })).validos, 2);
});

// ═══ TENANT, FECHAS Y PIEZAS SUELTAS ═══════════════════════════════════════

test("sin clínica en la sesión se corta antes de tocar la base", async () => {
  reiniciar();
  const { ImportError } = await engine();
  await assert.rejects(
    correr("clinicalNotes", archivo("notas.csv"), { dryRun: true, clinicId: "" }),
    (e: any) => e instanceof ImportError && e.status === 401,
  );
  assert.deepEqual(base.llamadas, {});
});

test("parseDate: una fecha imposible es inválida, no otra fecha", async () => {
  const { parseDate } = await engine();
  assert.equal(parseDate("31/02/2024"), null);
  assert.equal(parseDate("00/01/2024"), null);
  assert.equal(parseDate("29/02/2024")!.getDate(), 29); // bisiesto: sí existe
  assert.equal(parseDate("29/02/2023"), null);
});

test("piezas puras: listas, textos, títulos y folio original", async () => {
  const m = await import("../migrado");
  assert.deepEqual(m.splitList("Penicilina; látex, Nueces | penicilina"), ["Penicilina", "látex", "Nueces"]);
  assert.deepEqual(m.splitList("Ninguna"), []);
  assert.deepEqual(m.splitList("N/A"), []);
  assert.deepEqual(m.mergeList(["Penicilina"], ["PENICILINA", "Látex"]), { merged: ["Penicilina", "Látex"], added: ["Látex"] });
  assert.deepEqual(m.mergeText("Madre con Diabetes", "madre con diabetes"), { value: "Madre con Diabetes", changed: false });
  assert.deepEqual(m.mergeText("Madre con diabetes", "Padre hipertenso"), { value: "Madre con diabetes\n\nPadre hipertenso", changed: true });
  assert.equal(m.textToNoteHtml("uno\n\ndos\ntres <script>x</script>"), "<p>uno</p><p>dos<br>tres &lt;script&gt;x&lt;/script&gt;</p>");
  const largo = m.migratedTitle("x".repeat(200), "Dentalink", 120, "a");
  assert.equal(largo.length, 120);
  assert.ok(largo.endsWith(" · migrada de Dentalink"));
  assert.equal(m.folioDeNotas("Presupuesto migrado…\nFolio original: A-17\nDoctor: X"), "A-17");
  assert.equal(m.folioDeNotas("sin folio"), null);
  assert.equal(m.sanitizeFdi("11, 12 y 21"), "11,12,21");
  assert.match(m.newId(), /^c[0-9a-z]{24}$/);
});

// ═══ LO QUE ENCONTRÓ LA REVISIÓN ═══════════════════════════════════════════

test("visibilidad: recepción no empareja (ni escribe, ni ve) a un paciente restringido; el admin sí", async () => {
  reiniciar();
  const maria = tabla("patient").find((p) => p.id === "p1")!;
  maria.visibleUserIds = ["u_ana"]; // solo la Dra. López (y los admins)
  const recep = await correr("medicalHistory", archivo("expedientes.csv"), { dryRun: true, userId: "u_recep", role: "RECEPTIONIST" });
  assert.deepEqual(fila(recep, 2).errors, ["Paciente no encontrado en la clínica"]);
  assert.equal(fila(recep, 2).data.added, undefined); // la vista previa no delata qué alergias tiene
  assert.equal(fila(recep, 3).status, "ok"); // Jorge no está restringido
  const admin = await correr("medicalHistory", archivo("expedientes.csv"), { dryRun: true, role: "ADMIN" });
  assert.equal(fila(admin, 2).status, "ok");
  const ana = await correr("medicalHistory", archivo("expedientes.csv"), { dryRun: true, userId: "u_ana", role: "DOCTOR" });
  assert.equal(fila(ana, 2).status, "ok");
});

test("paciente equivocado: el teléfono de la mamá con el nombre del hijo es un error, no una nota en su expediente", async () => {
  reiniciar();
  const csv = "paciente,telefono,fecha,nota\nJuanito Pérez,5551234567,01/02/2024,Caries en 55\nMaría Hernández López,5551234567,02/02/2024,Control\n";
  const prev = await correr("clinicalNotes", new File([csv], "familia.csv"), { dryRun: true });
  assert.deepEqual(fila(prev, 2).errors, ["El teléfono o correo es de «María Hernández», no de «Juanito Pérez»: revisa la fila"]);
  // Un apellido de más en el archivo SÍ es la misma persona.
  assert.equal(fila(prev, 3).status, "ok");
  assert.equal(fila(prev, 3).data.name, "María Hernández"); // la revisión enseña a quién va, según la ficha
});

test("presupuestos: las líneas sin paciente heredan el de su folio; un folio con pacientes distintos o sin paciente no entra", async () => {
  reiniciar();
  const prev = await correr("quotes", archivo("presupuestos-continuacion.csv"), { dryRun: true });
  assert.deepEqual([prev.total, prev.validos, prev.invalidos], [7, 3, 4]);
  assert.equal(fila(prev, 3).data.patientId, "p1"); // heredado
  assert.equal(fila(prev, 3).data.date, "2024-02-05"); // heredada
  assert.match(fila(prev, 5).errors[0], /El folio 502 trae líneas de pacientes distintos/);
  assert.match(fila(prev, 6).errors[0], /El folio 502 trae líneas de pacientes distintos/);
  assert.deepEqual(fila(prev, 7).errors, ["Paciente no encontrado en la clínica"]);
  assert.match(fila(prev, 8).errors[0], /Ninguna línea del folio 503 identifica al paciente/);
  const hecho = await correr("quotes", archivo("presupuestos-continuacion.csv"), { dryRun: false });
  assert.equal(hecho.created, 1);
  const q = tabla("quote").find((x) => x.status === "MIGRATED")!;
  assert.equal(q.total, 2150); // 600 + 850 + 700: completo
  assert.equal(tabla("quoteItem").filter((i) => i.quoteId === q.id).length, 3);
});

test("lo clínico no reimporta duplicados aunque se apague «Omitir duplicados»", async () => {
  reiniciar();
  await correr("clinicalNotes", archivo("notas.csv"), { dryRun: false });
  const n = tabla("patientDocument").length;
  const otra = await correr("clinicalNotes", archivo("notas.csv"), { dryRun: false, skipDuplicates: false });
  assert.equal(otra.created, 0);
  assert.equal(tabla("patientDocument").length, n);
  await correr("quotes", archivo("presupuestos.csv"), { dryRun: false });
  const q = tabla("quote").length;
  await correr("quotes", archivo("presupuestos.csv"), { dryRun: false, skipDuplicates: false });
  assert.equal(tabla("quote").length, q);
});

test("listas: una negación no es un antecedente, y la coma decimal no parte un medicamento", async () => {
  const { splitList } = await import("../migrado");
  for (const nada of ["Niega alergias", "Sin alergias", "Negadas", "Ninguna conocida", "No refiere", "Negativo"]) {
    assert.deepEqual(splitList(nada), [], nada);
  }
  assert.deepEqual(splitList("Losartán 0,5 mg, Metformina 850 mg"), ["Losartán 0,5 mg", "Metformina 850 mg"]);
  assert.deepEqual(splitList("Diabetes tipo 2, Asma"), ["Diabetes tipo 2", "Asma"]);
  assert.deepEqual(splitList("Sinusitis crónica"), ["Sinusitis crónica"]); // «sin» solo como palabra
});

test("parseDate: año de dos dígitos y puntos se leen día/mes, no al estilo EE. UU.", async () => {
  const { parseDate } = await engine();
  const d = parseDate("05/03/21")!;
  assert.deepEqual([d.getFullYear(), d.getMonth() + 1, d.getDate()], [2021, 3, 5]);
  const n = parseDate("15.08.85")!;
  assert.deepEqual([n.getFullYear(), n.getMonth() + 1, n.getDate()], [1985, 8, 15]);
  const p = parseDate("05.03.2021")!;
  assert.deepEqual([p.getFullYear(), p.getMonth() + 1, p.getDate()], [2021, 3, 5]);
});
