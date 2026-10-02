/**
 * REPORTES: ESTADOS EN ESPAÑOL Y MES CORTADO EN LA ZONA DE LA CLÍNICA
 * (12i y 12h, ticket 3 de BEVADENT).
 *
 * Run: npm run test:reportes-estados-zona
 *
 * 12i — la gráfica «Citas por estado» pintaba «SCHEDULED» y «CHECKED_OUT»
 *       (sin etiqueta) y la tasa de atención no contaba CHECKED_OUT.
 * 12h — el corte de mes usaba el reloj del servidor (UTC en Vercel): un cobro
 *       del último día del mes después de las 18:00 hora del centro contaba
 *       en el mes siguiente.
 */
// Nada de esto toca una base real: Prisma se sustituye (mock.module) y, por si
// alguien rompe eso, la URL no apunta a ninguna parte.
process.env.DATABASE_URL = "postgresql://nadie:nada@127.0.0.1:1/ninguna?connection_limit=1";
process.env.DIRECT_URL = process.env.DATABASE_URL;

import { test, mock, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppointmentStatus } from "@prisma/client";
import { ESTADOS_ATENDIDOS, STATUS_LABEL_KEYS, nombreDeEstado, tasaDeAtendidas } from "../estados-de-cita";
import { ventanasDeReportes } from "../ventanas-de-reportes";

const dicc = (lang: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "src", "i18n", "dictionaries", `${lang}.json`), "utf8"));
const leer = (d: any, ruta: string): string | undefined => ruta.split(".").reduce((o, k) => o?.[k], d);

// ── 12i ─────────────────────────────────────────────────────────────────────

test("cada estado del enum de la base tiene etiqueta, en es y en en (ninguno sale como código)", () => {
  for (const estado of Object.values(AppointmentStatus)) {
    const llave = STATUS_LABEL_KEYS[estado];
    assert.ok(llave, `${estado} no tiene llave en STATUS_LABEL_KEYS`);
    for (const lang of ["es", "en"]) {
      const texto = leer(dicc(lang), llave);
      assert.ok(texto && texto.trim() !== "", `${lang}: falta ${llave}`);
      assert.notEqual(texto, estado, `${lang}: ${estado} se pinta como código`);
      assert.ok(!/^[A-Z_]+$/.test(texto), `${lang}: «${texto}» parece un código`);
    }
  }
});

test("BEVADENT: SCHEDULED y CHECKED_OUT salen en español", () => {
  const es = dicc("es");
  const t = (k: string) => leer(es, k) ?? k;
  assert.equal(nombreDeEstado("SCHEDULED", t), "Agendada");
  assert.equal(nombreDeEstado("CHECKED_OUT", t), "Salió");
  assert.equal(nombreDeEstado("CHECKED_IN", t), "Registrado");
  assert.equal(nombreDeEstado("IN_CHAIR", t), "En sillón");
});

test("un estado que nadie conoce sale «Otro», nunca el código", () => {
  const es = dicc("es");
  assert.equal(nombreDeEstado("ALGO_NUEVO", (k) => leer(es, k) ?? k), "Otro");
});

test("la tasa de atención cuenta CHECKED_OUT (el paciente salió = se atendió)", () => {
  const filas = [
    { status: "COMPLETED", _count: { id: 6 } },
    { status: "CHECKED_OUT", _count: { id: 4 } },
    { status: "SCHEDULED", _count: { id: 10 } },
  ];
  assert.deepEqual(ESTADOS_ATENDIDOS, ["COMPLETED", "CHECKED_OUT"]);
  assert.equal(tasaDeAtendidas(filas), 50, "10 de 20; antes salía 30");
  assert.equal(tasaDeAtendidas([]), 0);
});

// ── 12h ─────────────────────────────────────────────────────────────────────

const MX = "America/Mexico_City";

test("30-sep 21:30 en el centro de México (01-oct 03:30 UTC) sigue siendo SEPTIEMBRE", () => {
  const v = ventanasDeReportes(new Date("2026-10-01T03:30:00Z"), MX);
  assert.equal(v.inicioMes.toISOString(), "2026-09-01T06:00:00.000Z");
  assert.equal(v.meses[5].end.toISOString(), "2026-10-01T06:00:00.000Z");
  assert.match(v.meses[5].label, /sep/i);
  // El cobro del 30-sep a las 20:00 locales cae en septiembre, no en octubre.
  const cobro = new Date("2026-10-01T02:00:00Z");
  assert.ok(cobro >= v.meses[5].start && cobro < v.meses[5].end);
  // Y «hoy» es el 30-sep local, no el 1-oct.
  assert.equal(v.inicioHoy.toISOString(), "2026-09-30T06:00:00.000Z");
});

test("el mismo instante en una zona al ESTE de UTC ya es el mes siguiente", () => {
  // 30-sep 16:00 UTC = 01-oct 01:00 en Tokio.
  const v = ventanasDeReportes(new Date("2026-09-30T16:00:00Z"), "Asia/Tokyo");
  assert.equal(v.inicioMes.toISOString(), "2026-09-30T15:00:00.000Z");
  assert.match(v.meses[5].label, /oct/i);
});

test("seis meses seguidos, sin huecos ni traslapes, también al cruzar de año", () => {
  const v = ventanasDeReportes(new Date("2027-01-15T18:00:00Z"), MX);
  assert.equal(v.meses.length, 6);
  assert.deepEqual(v.meses.map((m) => m.label.slice(0, 3)).map((x) => x.toLowerCase()), ["ago", "sep", "oct", "nov", "dic", "ene"]);
  for (let i = 1; i < 6; i++) assert.equal(v.meses[i].start.getTime(), v.meses[i - 1].end.getTime());
  assert.equal(v.finMesAnterior.getTime(), v.inicioMes.getTime());
  assert.equal(v.inicioMesAnterior.getTime(), v.meses[4].start.getTime());
});

test("hoy y los próximos 7 días son días de calendario de la clínica", () => {
  const v = ventanasDeReportes(new Date("2026-10-02T15:00:00Z"), MX);
  assert.equal(v.inicioHoy.toISOString(), "2026-10-02T06:00:00.000Z");
  assert.equal(v.finHoy.toISOString(), "2026-10-03T06:00:00.000Z");
  assert.equal(v.finSemana.toISOString(), "2026-10-09T06:00:00.000Z");
});

// ── El cargador real, con Prisma de mentira ─────────────────────────────────

type Llamada = { modelo: string; operacion: string; args: any };
const llamadas: Llamada[] = [];
const porDefecto: Record<string, (args: any) => unknown> = {
  count: () => 0,
  aggregate: () => ({ _sum: { amount: 0, balance: 0 } }),
  groupBy: () => [],
  findMany: () => [],
  findUnique: () => ({ timezone: MX }),
};
const prismaFalso = new Proxy({}, {
  get: (_, modelo: string) => new Proxy({}, {
    get: (__, operacion: string) => async (args: any) => {
      llamadas.push({ modelo, operacion, args });
      return (porDefecto[operacion] ?? (() => null))(args);
    },
  }),
});

let cargarReportes: typeof import("../cargar-reportes").cargarReportes;
before(async () => {
  mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });
  mock.module("@/lib/menu-dos-niveles/interruptor", { namedExports: { menuDosNivelesEncendido: async () => false } });
  ({ cargarReportes } = await import("../cargar-reportes"));
});

test("cargarReportes corta cada mes por la zona de la clínica y con fin exclusivo", async () => {
  llamadas.length = 0;
  const t = ((k: string) => k) as any;
  const r = await cargarReportes("c1", t, MX, new Date("2026-10-01T03:30:00Z"));
  const cobros = llamadas.filter((c) => c.modelo === "payment" && c.operacion === "aggregate");
  assert.equal(cobros.length, 6);
  const septiembre = cobros[5].args.where.paidAt;
  assert.equal(septiembre.gte.toISOString(), "2026-09-01T06:00:00.000Z");
  assert.equal(septiembre.lt.toISOString(), "2026-10-01T06:00:00.000Z");
  assert.equal(septiembre.lte, undefined, "ya no hay un 23:59:59 inclusivo que se coma el último segundo");
  assert.match(r.monthlyData[5].label, /sep/i);
  // «Pacientes nuevos este mes»: desde el 1-sep local, no desde octubre.
  const nuevos = llamadas.filter((c) => c.modelo === "patient" && c.operacion === "count" && c.args.where.createdAt?.gte && !c.args.where.createdAt.lt);
  assert.equal(nuevos[0].args.where.createdAt.gte.toISOString(), "2026-09-01T06:00:00.000Z");
});

test("sin zona de la sesión, el cargador la lee de la clínica (por el id de la sesión)", async () => {
  llamadas.length = 0;
  await cargarReportes("c1", ((k: string) => k) as any, undefined, new Date("2026-10-01T03:30:00Z"));
  const lectura = llamadas.find((c) => c.modelo === "clinic" && c.operacion === "findUnique");
  assert.deepEqual(lectura?.args.where, { id: "c1" });
  const cobro = llamadas.find((c) => c.modelo === "payment")!;
  assert.equal(cobro.args.where.paidAt.gte.toISOString(), "2026-04-01T06:00:00.000Z");
});

// ── Otros estados crudos del panel dental (12i, «busca otros lugares») ──────

test("el estado periimplantar y el del plan de pagos de orto tienen etiqueta para TODOS los valores del enum", async () => {
  const { PeriImplantStatus, OrthoPaymentStatus } = await import("@prisma/client");
  const { ETIQUETA_ESTADO_PERIIMPLANTAR } = await import("@/lib/periodontics/estado-periimplantar");
  for (const v of Object.values(PeriImplantStatus)) assert.ok(ETIQUETA_ESTADO_PERIIMPLANTAR[v], `PeriImplantStatus ${v} sin etiqueta`);
  const texto = readFileSync(join(process.cwd(), "src", "components/specialties/orthodontics/payments/PaymentStatusBadge.tsx"), "utf8");
  for (const v of Object.values(OrthoPaymentStatus)) assert.ok(texto.includes(`${v}: "`), `OrthoPaymentStatus ${v} sin etiqueta`);
});

test("los avisos «Status: …» y «evaluación periimplantar: …» ya no pintan el código del enum", () => {
  const leerSrc = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");
  assert.doesNotMatch(leerSrc("components/specialties/orthodontics/OrthodonticsClient.tsx"), /Status: \$\{result\.data\.status\}/);
  assert.doesNotMatch(leerSrc("components/specialties/implants/drawers/MaintenanceDrawer.tsx"), /periimplantar: \$\{assessmentRes\.data\.status\}/);
});
