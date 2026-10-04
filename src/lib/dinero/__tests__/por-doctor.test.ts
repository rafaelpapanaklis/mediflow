/**
 * «Por doctor» completo en Inicio, Analítica › Doctores y el PDF de nómina
 * (ws1-t2, auditoría de uso del 3/4-oct-2026, C-09 y C-10).
 *
 * Run: npm run test:dinero-por-doctor
 *
 *   · C-09: Inicio › «Performance del equipo» tenía INGRESOS fijos en $0
 *     («Invoice no tiene doctorId», ya falso).
 *   · C-10: Analítica › Doctores y la nómina omitían la fila «Sin doctor» (y
 *     a quien cobró sin estar en su lista): sumaban $7,500 contra $9,250 de
 *     Finanzas aunque decían «la misma cifra». Y el PDF traía la fecha del
 *     servidor: «Generado 4 de octubre, 1:23 a.m.» para las 23:23 del 3.
 *
 * Con el código viejo fallan: `por-doctor.ts` y `fechas-de-reporte.ts` no
 * existían, la ruta de Inicio devolvía `revenueMXN: 0` y las de Analítica y
 * nómina no añadían ninguna fila.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { repartirPorDoctor, type MovimientoDeDoctor } from "@/lib/dinero/ingresos";
import {
  ID_SIN_DOCTOR,
  NOMBRE_SIN_DOCTOR,
  idsConIngresoFueraDeLista,
  ingresoSinDoctor,
  sumaDeIngresos,
} from "@/lib/dinero/por-doctor";
import { diaEnZona, etiquetaDePeriodo, fechaLargaEnZona, fechaYHoraEnZona } from "@/lib/dinero/fechas-de-reporte";

const leer = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

const mov = (invoiceId: string, amount: number, facturaDoctorId: string | null, citaDoctorId: string | null = null): MovimientoDeDoctor => ({
  invoiceId,
  amount,
  paidAt: new Date("2026-10-02T18:00:00Z"),
  facturaDoctorId,
  appointmentId: citaDoctorId ? `cita-${invoiceId}` : null,
  citaDoctorId,
});

// La foto de t8 (05:10 UTC): Finanzas «Por doctor» suma $9,250 con «Sin doctor» $1,750.
const reparto = repartirPorDoctor({
  cobros: [
    mov("f1", 3500, "doc-b"),
    mov("f2", 1800, "doc-a"),
    mov("f3", 1000, null, "doc-alejandro"),
    mov("f4", 500, "doc-mariana"),
    mov("f5", 400, "doc-baja"), // doctor dado de baja: no está en la lista de activos
    mov("f6", 300, "recep-1"), // factura a nombre de alguien con otro rol
    mov("f7", 1200, null), // «Cobrar hoy» sin doctor
    mov("f8", 550, null),
  ],
  reembolsos: [],
  casoPorFactura: new Map(),
  doctorActualPorCaso: new Map(),
  cambios: [],
});
const INGRESOS = 9250;

test("C-10: con la fila «Sin doctor» y quien cobró fuera de la lista, las filas suman el ingreso", () => {
  const activos = ["doc-a", "doc-b", "doc-alejandro", "doc-mariana", "doc-sin-cobros"];
  const fuera = idsConIngresoFueraDeLista(activos, reparto);
  assert.deepEqual(fuera, ["doc-baja", "recep-1"]);

  const sin = ingresoSinDoctor(reparto);
  assert.deepEqual(sin, { total: 1750, orto: 0 });

  const filas = [...activos, ...fuera].map((id) => reparto.get(id)?.total ?? 0);
  // Lo que pintaban antes la Analítica y la nómina: solo los activos.
  assert.equal(sumaDeIngresos(activos.map((id) => reparto.get(id)?.total ?? 0)), 6800);
  assert.equal(sumaDeIngresos([...filas, sin!.total]), INGRESOS);
});

test("«Sin doctor» no sale si no hay nada, y sí sale con un neto negativo (reembolso sin doctor)", () => {
  assert.equal(ingresoSinDoctor(new Map([["doc-a", { total: 100, orto: 0 }]])), null);
  assert.equal(ingresoSinDoctor(new Map([[null, { total: 0, orto: 0 }]])), null);
  assert.deepEqual(ingresoSinDoctor(new Map([[null, { total: -300, orto: 0 }]])), { total: -300, orto: 0 });
  // Un doctor fuera de la lista con neto cero no se añade.
  assert.deepEqual(idsConIngresoFueraDeLista([], new Map([["x", { total: 0, orto: 0 }], [null, { total: 5, orto: 0 }]])), []);
});

test("C-10: las fechas del PDF van en la zona de la clínica, no en la del servidor", () => {
  // 23:23 del 3-oct en la Ciudad de México = 05:23 UTC del 4.
  const generado = "2026-10-04T05:23:00.000Z";
  assert.equal(fechaLargaEnZona(generado, "America/Mexico_City"), "3 de octubre de 2026");
  assert.match(fechaYHoraEnZona(generado, "America/Mexico_City"), /^3\/10\/2026, 11:23/);
  assert.equal(diaEnZona(new Date(generado), "America/Mexico_City"), "2026-10-03");
  // Octubre de la clínica: del 1 a las 00:00 (06:00 UTC) a «ahora».
  assert.equal(etiquetaDePeriodo(new Date("2026-10-01T06:00:00Z"), new Date(generado), "America/Mexico_City"), "octubre de 2026");
  // («sep» o «sept» según la versión de ICU de Node.)
  assert.match(
    etiquetaDePeriodo(new Date("2026-09-04T06:00:00Z"), new Date(generado), "America/Mexico_City"),
    /^4 sept?\.? al 3 oct\.? 2026$/,
  );
});

test("C-09: Inicio › Performance del equipo lee los ingresos de la definición única (ya no $0 fijo)", () => {
  const s = leer("src/app/api/dashboard/home/admin/route.ts");
  assert.doesNotMatch(s, /revenueMXN:\s*0\b/);
  assert.match(s, /ingresosPorDoctorDelPeriodo\(clinicId, \{ gte: from, lt: to \}\)/);
  assert.match(s, /idsConIngresoFueraDeLista/);
  assert.match(s, /ingresoSinDoctor\(cobrado\)/);
  for (const f of ["src/components/dashboard/hoy-rediseno/tabla-equipo.tsx", "src/components/dashboard/home/parts/team-performance-table.tsx"]) {
    assert.match(leer(f), /home\.teamPerf\.sinDoctor/, f);
  }
});

test("C-10: Analítica › Doctores y la nómina añaden «Sin doctor» y a quien cobró fuera de la lista", () => {
  // Desde C-11 (segunda vuelta) las dos rutas leen las MISMAS filas de lib/analytics/doctores.server.ts.
  const comun = leer("src/lib/analytics/doctores.server.ts");
  assert.match(comun, /idsConIngresoFueraDeLista\(ids, cobrado\)/);
  assert.match(comun, /id: ID_SIN_DOCTOR/);
  assert.match(comun, /sinDoctor: true/);
  const api = leer("src/app/api/analytics/doctor-performance/route.ts");
  assert.match(api, /filasDeDoctores\(/);
  const pdf = leer("src/app/api/analytics/payroll-pdf/route.ts");
  assert.match(pdf, /filasDeDoctores\(/);
  assert.match(pdf, /f\.sinDoctor \? \{ sinDoctor: true \}/);
  assert.match(pdf, /timezone,\n/);
  assert.doesNotMatch(leer("src/lib/pdf/payroll-document.tsx"), /toLocaleString\("es-MX"\)\s*\}/);
  assert.equal(ID_SIN_DOCTOR, "sin-doctor");
  assert.equal(NOMBRE_SIN_DOCTOR, "Sin doctor");
  // La misma clave que la fila de Finanzas.
  assert.match(leer("src/lib/finanzas-resumen.server.ts"), /doctorId: "sin-doctor"/);
});

test("los textos nuevos existen en es y en", () => {
  const es = JSON.parse(leer("src/i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("src/i18n/dictionaries/en.json"));
  for (const d of [es, en]) {
    assert.equal(typeof d.home.teamPerf.sinDoctor, "string");
    assert.equal(typeof d.home.teamPerf.sinDoctorHint, "string");
    assert.equal(typeof d.analytics.doctors.sinDoctor, "string");
    assert.equal(typeof d.analytics.doctors.sinDoctorHint, "string");
  }
  assert.match(es.analytics.doctors.footerNote, /Sin doctor/);
  assert.match(en.analytics.doctors.footerNote, /No doctor/);
});
