/**
 * Las tres herramientas de CLÍNICO (ws1-t4): `recetas`, `estudios_del_paciente`,
 * `analisis_y_notas_de_estudio`. Todas de solo lectura.
 *
 * Run: npm run test:sabina-clinico
 *
 * Lo que se prueba y por qué:
 *  · N4 — el servidor calcula la vigencia legal con el `cofeprisGroup` que
 *    manda el NAVEGADOR, no el del catálogo. `rx-mentirosa` reproduce eso:
 *    morfina (grupo I real) con `expiresAt` guardado a 700 días. La prueba
 *    exige que `recetas` NUNCA repita esa fecha como vigente.
 *  · N16 — recepción tiene `xrays.view` y no `medicalRecord.view`; aquí eso
 *    tiene que bastar para `estudios_del_paciente` y NO bastar para
 *    `analisis_y_notas_de_estudio`.
 *  · N19 — un paciente archivado (ARCO) o restringido no debe filtrar nada,
 *    ni siquiera al admin en el caso archivado.
 *  · Aislamiento — CL_SUR nunca aparece en una consulta de CL_NORTE.
 */

import "./preparar";
import { test } from "node:test";
import assert from "node:assert/strict";

import { correrHerramienta } from "../base";
import { recetas } from "../recetas";
import { estudiosDelPaciente } from "../estudios-del-paciente";
import { analisisYNotasDeEstudio } from "../analisis-y-notas-de-estudio";
import {
  CL_NORTE,
  CL_SUR,
  U_ADMIN_N,
  U_ADMIN_S,
  U_DOC_N,
  adminNorte,
  adminSur,
  conPermisos,
  datosDePrueba,
  doctorNorte,
  recepcionNorte,
} from "./siembra";
import { crearBase, type Fila } from "./doble-base";

// 🔴 Estas tres no viven en `CATALOGO_SABINA` ("las diez") sino en `CONSULTAS`
// de `engine-catalog.ts` (MAPA-engranaje.md §1.4: "las consultas de las áreas
// nuevas, en CONSULTAS y con su propio archivo de prueba"), así que
// `ejecutarHerramienta` de `tools/index.ts` no las conoce. Se llaman con el
// mismo runner que usa el motor, `correrHerramienta`, pasándole la herramienta
// directamente — el mismo patrón que `agenda-acciones.test.ts` usa para
// `proponer_horarios`.

const DIA_MS = 86_400_000;
function haceDias(n: number): Date {
  return new Date(Date.now() - n * DIA_MS);
}
function masDias(base: Date, n: number): Date {
  return new Date(base.getTime() + n * DIA_MS);
}

/* ── catálogo CUMS (global, sin clinicId) ──────────────────────────────── */

const CUMS: Fila[] = [
  { clave: "MX-AMOX", descripcion: "Amoxicilina 500mg", presentacion: "Caja 12 cápsulas", formaFarmaceutica: "Cápsula", grupoTerapeutico: "Antibiótico", cofeprisGroup: null },
  // Grupo I real del catálogo — el que el navegador NO manda en rx-mentirosa.
  { clave: "MX-MORF", descripcion: "Morfina 10mg", presentacion: "Ampolleta", formaFarmaceutica: "Solución inyectable", grupoTerapeutico: "Analgésico opioide", cofeprisGroup: "I" },
  { clave: "MX-CLONA", descripcion: "Clonazepam 2mg", presentacion: "Caja 30 tabletas", formaFarmaceutica: "Tableta", grupoTerapeutico: "Benzodiacepina", cofeprisGroup: "II" },
  { clave: "MX-TRAM", descripcion: "SUR Tramadol 50mg", presentacion: "Caja 10 cápsulas", formaFarmaceutica: "Cápsula", grupoTerapeutico: "Analgésico opioide", cofeprisGroup: "III" },
];
// 60 medicamentos con el mismo texto: la prueba del tope de 50 en el catálogo.
for (let i = 0; i < 60; i++) {
  CUMS.push({
    clave: `MX-MASIVO-${i}`,
    descripcion: `Medicamento Masivo ${i}`,
    presentacion: "Caja",
    formaFarmaceutica: "Tableta",
    grupoTerapeutico: "Prueba",
    cofeprisGroup: null,
  });
}

/* ── recetas ────────────────────────────────────────────────────────────── */

const ISSUED_VIGENTE = haceDias(2);
const ISSUED_VENCIDA = haceDias(200);
const ISSUED_ANULADA = haceDias(30);
const ISSUED_MENTIROSA = haceDias(10); // morfina hace 10 días: el máximo legal (24h) ya pasó

const PRESCRIPTIONS: Fila[] = [
  { id: "rx-vigente", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, status: "ACTIVE", issuedAt: ISSUED_VIGENTE, expiresAt: masDias(ISSUED_VIGENTE, 178), qrCode: "qr-vigente", verifyUrl: "" },
  { id: "rx-vencida", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, status: "ACTIVE", issuedAt: ISSUED_VENCIDA, expiresAt: masDias(ISSUED_VENCIDA, 180), qrCode: "qr-vencida", verifyUrl: "" },
  { id: "rx-anulada", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, status: "VOIDED", issuedAt: ISSUED_ANULADA, expiresAt: masDias(ISSUED_ANULADA, 180), voidedAt: haceDias(29), voidedBy: U_DOC_N, voidReason: "error de captura", qrCode: "qr-anulada", verifyUrl: "" },
  // 🔴 N4 reproducido: morfina real (grupo I), pero `expiresAt` guardado a 700
  // días — como si alguien hubiera mandado un `cofeprisGroup` distinto (o
  // ninguno) al crearla. `recetas` NO debe decir que esto sigue vigente.
  { id: "rx-mentirosa", clinicId: CL_NORTE, patientId: "p-ana", doctorId: U_DOC_N, status: "ACTIVE", issuedAt: ISSUED_MENTIROSA, expiresAt: masDias(ISSUED_MENTIROSA, 700), qrCode: "qr-mentirosa", verifyUrl: "" },
  // Paciente restringida: solo el admin la ve (siembra.ts: visibleUserIds: [U_ADMIN_N]).
  { id: "rx-priv", clinicId: CL_NORTE, patientId: "p-priv", doctorId: U_ADMIN_N, status: "ACTIVE", issuedAt: haceDias(1), expiresAt: masDias(haceDias(1), 180), qrCode: "qr-priv", verifyUrl: "" },
  // Paciente archivada por ARCO: no debe salir NI PARA EL ADMIN (N19).
  { id: "rx-borrado", clinicId: CL_NORTE, patientId: "p-borrado", doctorId: U_DOC_N, status: "ACTIVE", issuedAt: haceDias(1), expiresAt: masDias(haceDias(1), 180), qrCode: "qr-borrado", verifyUrl: "" },
  // La del sur: nunca debe verse desde el norte, y viceversa.
  { id: "rx-sur", clinicId: CL_SUR, patientId: "p-sur-1", doctorId: U_ADMIN_S, status: "ACTIVE", issuedAt: haceDias(1), expiresAt: masDias(haceDias(1), 180), qrCode: "qr-sur", verifyUrl: "" },
];

const PRESCRIPTION_ITEMS: Fila[] = [
  { id: "it-vigente", prescriptionId: "rx-vigente", cumsKey: "MX-AMOX", dosage: "cada 8h por 7 días" },
  { id: "it-vencida", prescriptionId: "rx-vencida", cumsKey: "MX-AMOX", dosage: "cada 8h por 7 días" },
  { id: "it-anulada", prescriptionId: "rx-anulada", cumsKey: "MX-AMOX", dosage: "cada 12h por 5 días" },
  { id: "it-mentirosa", prescriptionId: "rx-mentirosa", cumsKey: "MX-MORF", dosage: "1 ampolleta cada 12h" },
  { id: "it-priv", prescriptionId: "rx-priv", cumsKey: "MX-AMOX", dosage: "cada 8h" },
  { id: "it-borrado", prescriptionId: "rx-borrado", cumsKey: "MX-AMOX", dosage: "cada 8h" },
  { id: "it-sur", prescriptionId: "rx-sur", cumsKey: "MX-TRAM", dosage: "SUR SUR SUR" },
];

/* ── estudios y análisis ────────────────────────────────────────────────── */

const PATIENT_FILES: Fila[] = [
  { id: "file-ana-1", clinicId: CL_NORTE, patientId: "p-ana", name: "panoramica-marzo.jpg", url: "x", category: "XRAY_PANORAMIC", toothNumber: null, takenAt: null, createdAt: haceDias(5), doctorNotes: null, deletedAt: null },
  {
    id: "file-ana-2", clinicId: CL_NORTE, patientId: "p-ana", name: "periapical-36.jpg", url: "x", category: "XRAY_PERIAPICAL", toothNumber: 36, takenAt: null, createdAt: haceDias(1),
    doctorNotes: "Se ve pérdida ósea leve en el 36; vigilar en la próxima cita.", deletedAt: null,
  },
  // Borrada lógicamente: no debe aparecer en NINGÚN listado.
  { id: "file-ana-borrada", clinicId: CL_NORTE, patientId: "p-ana", name: "bitewing-vieja.jpg", url: "x", category: "XRAY_BITEWING", toothNumber: null, takenAt: null, createdAt: haceDias(50), doctorNotes: "no debería verse jamás", deletedAt: haceDias(10), deletedBy: U_DOC_N },
  { id: "file-priv-1", clinicId: CL_NORTE, patientId: "p-priv", name: "intraoral-confidencial.jpg", url: "x", category: "PHOTO_INTRAORAL", toothNumber: null, takenAt: null, createdAt: haceDias(3), doctorNotes: "nota confidencial de Paula", deletedAt: null },
  { id: "file-borrado-1", clinicId: CL_NORTE, patientId: "p-borrado", name: "panoramica-arco.jpg", url: "x", category: "XRAY_PANORAMIC", toothNumber: null, takenAt: null, createdAt: haceDias(2), doctorNotes: null, deletedAt: null },
  { id: "file-sur-1", clinicId: CL_SUR, patientId: "p-sur-1", name: "SUR-panoramica.jpg", url: "x", category: "XRAY_PANORAMIC", toothNumber: null, takenAt: null, createdAt: haceDias(1), doctorNotes: "SUR SUR SUR", deletedAt: null },
];

const XRAY_ANALYSES: Fila[] = [
  { id: "an-ana-2", fileId: "file-ana-2", clinicId: CL_NORTE, patientId: "p-ana", mode: "GENERAL", summary: "Posible caries interproximal en el 36, severidad media.", findings: [], recommendations: [], severity: "media", confidence: 82, createdAt: haceDias(1) },
  { id: "an-sur-1", fileId: "file-sur-1", clinicId: CL_SUR, patientId: "p-sur-1", mode: "GENERAL", summary: "SUR SUR SUR — esto no debe verse desde el norte.", findings: [], recommendations: [], severity: "alta", confidence: 99, createdAt: haceDias(1) },
];

function base() {
  return crearBase({
    ...datosDePrueba(),
    cumsItems: CUMS,
    prescriptions: PRESCRIPTIONS,
    prescriptionItems: PRESCRIPTION_ITEMS,
    patientFiles: PATIENT_FILES,
    xrayAnalyses: XRAY_ANALYSES,
  });
}

/** Un override no vacío y sin ninguna key relevante — la única forma de forzar
 * "cero permisos": un override VACÍO cae a los defaults del rol (siembra.ts). */
function sinPermisos(db: ReturnType<typeof base>) {
  return conPermisos(db, ["today.view"]);
}

/* ══════════════════════════════════════════════════════════════════════
 * recetas
 * ══════════════════════════════════════════════════════════════════════ */

test("recetas: sin prescription.view -> sin_permiso, no una lista vacía", async () => {
  const r = await correrHerramienta(recetas, sinPermisos(base()), { patientId: "p-ana" });
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.equal(r.motivo, "sin_permiso");
  assert.equal((r as any).permiso, "prescription.view");
});

test("recetas: mandar los dos parámetros o ninguno es un error explicado, no una consulta a ciegas", async () => {
  const ninguno = await correrHerramienta(recetas, doctorNorte(base()), {});
  assert.equal(ninguno.ok, false);
  if (!ninguno.ok) assert.equal(ninguno.motivo, "error");

  const db = base();
  const ambos = await correrHerramienta(recetas, doctorNorte(db), { patientId: "p-ana", buscarMedicamento: "amox" });
  assert.equal(ambos.ok, false);
  if (!ambos.ok) assert.equal(ambos.motivo, "error");
});

test("🔴 recetas: distingue vigente/vencida/anulada, y NO repite la vigencia falsa de un controlado (N4)", async () => {
  const r = await correrHerramienta(recetas, doctorNorte(base()), { patientId: "p-ana" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.modo, "paciente");
  const filas = r.datos.recetas!.filas;
  assert.equal(filas.length, 4, "las cuatro de p-ana; priv/borrado/sur quedan fuera");

  const vigentes = filas.filter((f) => f.estado === "vigente");
  const vencidas = filas.filter((f) => f.estado === "vencida");
  const anuladas = filas.filter((f) => f.estado === "anulada");
  assert.equal(vigentes.length, 1);
  assert.equal(anuladas.length, 1);
  assert.equal(vencidas.length, 2, "la vencida real Y la mentirosa, que se trata como vencida de verdad");

  const mentirosa = filas.find((f) => f.controlado);
  assert.ok(mentirosa, "la de morfina debe marcarse controlada según el CATÁLOGO, no según el campo guardado");
  assert.equal(mentirosa!.estado, "vencida", "el máximo legal (24h) manda sobre los 700 días guardados");
  assert.equal(mentirosa!.vigenciaConfiable, false);
  assert.ok(mentirosa!.aviso?.includes("grupo I"), "el aviso debe explicar el grupo real y el máximo legal");

  assert.equal(r.resumen.includes("Ojo"), true, "el resumen debe avisar de la discrepancia, no callarla");
});

test("recetas: busca en el catálogo CUMS y marca el grupo COFEPRIS real", async () => {
  const r = await correrHerramienta(recetas, doctorNorte(base()), { buscarMedicamento: "clona" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.modo, "catalogo");
  assert.equal(r.datos.medicamentos!.filas.length, 1);
  assert.equal(r.datos.medicamentos!.filas[0].cofeprisGroup, "II");
  assert.equal(r.datos.medicamentos!.filas[0].controlado, true);
});

test("recetas: catálogo — más de 50 coincidencias se recorta a 50 y dice el total real", async () => {
  const r = await correrHerramienta(recetas, doctorNorte(base()), { buscarMedicamento: "Medicamento Masivo" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.medicamentos!.total, 60);
  assert.equal(r.datos.medicamentos!.filas.length, 50);
  assert.equal(r.datos.medicamentos!.truncado, true);
});

test("🔴 recetas: aislamiento — CL_SUR nunca sale en una consulta de CL_NORTE, ni viceversa", async () => {
  const db = base();
  const rNorte = await correrHerramienta(recetas, adminNorte(db), { patientId: "p-ana" });
  assert.equal(rNorte.ok, true);
  if (rNorte.ok) assert.equal(JSON.stringify(rNorte.datos).includes("SUR"), false);

  // p-sur-1 no existe en CL_NORTE: sin_datos, nunca sus recetas.
  const cruzado = await correrHerramienta(recetas, adminNorte(db), { patientId: "p-sur-1" });
  assert.equal(cruzado.ok, false);
  if (!cruzado.ok) assert.equal(cruzado.motivo, "sin_datos");

  const rSur = await correrHerramienta(recetas, adminSur(db), { patientId: "p-sur-1" });
  assert.equal(rSur.ok, true);
  if (rSur.ok) assert.equal(JSON.stringify(rSur.datos).includes("Amoxicilina"), false);
});

test("🔴 recetas: paciente archivado (ARCO) -> sin_datos, ni para el admin (N19)", async () => {
  const r = await correrHerramienta(recetas, adminNorte(base()), { patientId: "p-borrado" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "sin_datos");
});

test("recetas: paciente restringido — el admin lo ve, un doctor fuera de la lista no", async () => {
  const db = base();
  const comoAdmin = await correrHerramienta(recetas, adminNorte(db), { patientId: "p-priv" });
  assert.equal(comoAdmin.ok, true);

  const comoOtroDoctor = await correrHerramienta(recetas, doctorNorte(db), { patientId: "p-priv" });
  assert.equal(comoOtroDoctor.ok, false);
  if (!comoOtroDoctor.ok) assert.equal(comoOtroDoctor.motivo, "sin_datos");
});

/* ══════════════════════════════════════════════════════════════════════
 * estudios_del_paciente
 * ══════════════════════════════════════════════════════════════════════ */

test("estudios_del_paciente: sin xrays.view -> sin_permiso", async () => {
  const r = await correrHerramienta(estudiosDelPaciente, sinPermisos(base()), { patientId: "p-ana" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "sin_permiso");
});

test("estudios_del_paciente: recepción (tiene xrays.view por default) lista, oculta lo borrado y marca el análisis", async () => {
  const r = await correrHerramienta(estudiosDelPaciente, recepcionNorte(base()), { patientId: "p-ana" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.estudios.total, 2, "solo los dos activos; el borrado no cuenta");
  assert.equal(JSON.stringify(r.datos.estudios.filas).includes("no debería verse"), false);
  const conAnalisis = r.datos.estudios.filas.find((f) => f.tieneAnalisis);
  assert.ok(conAnalisis);
  assert.equal(conAnalisis!.diente, 36);
  assert.equal(r.datos.enlace, "/dashboard/xrays/p-ana");
});

test("🔴 estudios_del_paciente: aislamiento, archivado y restringido", async () => {
  const db = base();
  const cruzado = await correrHerramienta(estudiosDelPaciente, adminNorte(db), { patientId: "p-sur-1" });
  assert.equal(cruzado.ok, false);

  const archivado = await correrHerramienta(estudiosDelPaciente, adminNorte(db), { patientId: "p-borrado" });
  assert.equal(archivado.ok, false, "N19: un paciente archivado no debe mostrar sus estudios");

  const restringido = await correrHerramienta(estudiosDelPaciente, doctorNorte(db), { patientId: "p-priv" });
  assert.equal(restringido.ok, false);

  const rSur = await correrHerramienta(estudiosDelPaciente, adminSur(db), { patientId: "p-sur-1" });
  assert.equal(rSur.ok, true);
  if (rSur.ok) assert.equal(JSON.stringify(rSur.datos).includes("panoramica-marzo"), false);
});

/* ══════════════════════════════════════════════════════════════════════
 * analisis_y_notas_de_estudio
 * ══════════════════════════════════════════════════════════════════════ */

test("🔴 analisis_y_notas_de_estudio: recepción tiene xrays.view pero NO medicalRecord.view -> sin_permiso (no repite N16)", async () => {
  const r = await correrHerramienta(analisisYNotasDeEstudio, recepcionNorte(base()), { patientId: "p-ana" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.motivo, "sin_permiso");
});

test("analisis_y_notas_de_estudio: sin archivoId, solo lista los que YA tienen notas o análisis", async () => {
  const r = await correrHerramienta(analisisYNotasDeEstudio, doctorNorte(base()), { patientId: "p-ana" });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.estudios.total, 1, "file-ana-1 no tiene notas ni análisis; no debe aparecer");
  const f = r.datos.estudios.filas[0];
  assert.equal(f.archivoId, "file-ana-2");
  assert.ok(f.notasDelDoctor?.includes("pérdida ósea"));
  assert.equal(f.analisis?.severidad, "media");
  assert.equal(JSON.stringify(r.datos).includes("SUR"), false);
});

test("analisis_y_notas_de_estudio: con archivoId trae ese archivo aunque no tenga nada todavía", async () => {
  const r = await correrHerramienta(analisisYNotasDeEstudio, doctorNorte(base()), {
    patientId: "p-ana",
    archivoId: "file-ana-1",
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.datos.estudios.total, 1);
  assert.equal(r.datos.estudios.filas[0].notasDelDoctor, null);
  assert.equal(r.datos.estudios.filas[0].analisis, null);
});

test("🔴 analisis_y_notas_de_estudio: aislamiento, archivado y restringido", async () => {
  const db = base();
  const cruzado = await correrHerramienta(analisisYNotasDeEstudio, adminNorte(db), { patientId: "p-sur-1" });
  assert.equal(cruzado.ok, false);

  const archivado = await correrHerramienta(analisisYNotasDeEstudio, adminNorte(db), { patientId: "p-borrado" });
  assert.equal(archivado.ok, false, "N19: no debe leer notas/análisis de un archivado");

  const restringido = await correrHerramienta(analisisYNotasDeEstudio, doctorNorte(db), { patientId: "p-priv" });
  assert.equal(restringido.ok, false);

  const comoAdmin = await correrHerramienta(analisisYNotasDeEstudio, adminNorte(db), { patientId: "p-priv" });
  assert.equal(comoAdmin.ok, true, "el admin sí ve al paciente restringido");

  const rSur = await correrHerramienta(analisisYNotasDeEstudio, adminSur(db), { patientId: "p-sur-1" });
  assert.equal(rSur.ok, true);
  if (rSur.ok) assert.equal(JSON.stringify(rSur.datos).includes("esto no debe verse desde el norte"), true);
});
