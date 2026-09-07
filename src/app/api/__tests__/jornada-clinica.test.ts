/**
 * LA JORNADA ES LA DE LA CLÍNICA, NO LA DEL SERVIDOR — hallazgo 30 (WS1-T5).
 *
 * Run: npm run test:jornada-clinica
 *
 * El fallo, en una línea: el tablero de la sala de espera y el visor 3D
 * calculaban "hoy" con `new Date(); setHours(0,0,0,0)`, es decir la medianoche
 * del PROCESO. Vercel corre en UTC y el proyecto no fija `TZ`, así que para una
 * clínica mexicana (UTC−6) la ventana "hoy" era [ayer 18:00, hoy 18:00) hora
 * local: a las 18:00 el tablero rodaba de día y el paciente que llevaba en el
 * sillón desde las 17:00 desaparecía de la pantalla de la sala de espera.
 *
 * Sus dos hermanos vivos —`clinic-layout/appointments` y `live/[slug]`— ya
 * llevaban el criterio bueno (zona de la clínica) con el comentario que
 * describe este mismo fallo. Estas rutas se les igualan.
 *
 * Cómo prueba: ejercita los HANDLERS REALES con `mock.module` sobre prisma y
 * auth, y CAPTURA el `where` con el que consultan las citas. Después comprueba
 * propiedades de reloj de pared que no dependen de la hora a la que se corra el
 * test — y que el código viejo NO cumple:
 *
 *   1. el inicio de la ventana es la medianoche EN LA ZONA DE LA CLÍNICA;
 *   2. la ventana dura 24 h y es semiabierta [inicio, fin);
 *   3. las 00:30, las 12:00, las 17:00 y las 23:30 LOCALES de hoy caen dentro.
 *
 * Con `setHours(0,0,0,0)` bajo TZ=UTC, (1) da las 18:00 del día anterior y (3)
 * deja fuera todo lo posterior a las 18:00: son las dos comprobaciones que
 * estaban en rojo antes del arreglo.
 */

// El proceso corre en UTC, como Vercel. Se fija ANTES de importar nada que
// mire el reloj: es la condición que destapa el fallo.
process.env.TZ = "UTC";

import { test, mock } from "node:test";
import assert from "node:assert/strict";

/** Zona sin horario de verano desde 2022 → offset fijo −6, todo el año. */
const TZ = "America/Mexico_City";
const OFFSET_HOURS = -6;

// ── Doble de Prisma ─────────────────────────────────────────────────────────
/** El `where` de la última consulta de citas. Es lo que se audita. */
let lastApptWhere: any = null;

const prismaStub: any = {
  tVDisplay: {
    findUnique: async () => ({
      id: "tv1",
      clinicId: "c1",
      active: true,
      config: {},
      clinic: { timezone: TZ },
    }),
  },
  clinic: {
    findUnique: async () => ({ name: "Clínica QA", category: "DENTAL", timezone: TZ }),
  },
  clinicLayout: { findUnique: async () => null },
  resource: { findMany: async () => [] },
  appointment: {
    findMany: async ({ where }: any = {}) => {
      lastApptWhere = where;
      return [];
    },
  },
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/failban", {
  namedExports: { persistentRateLimit: async () => null },
});
(mock as any).module("@/lib/auth-context", {
  namedExports: {
    getAuthContext: async () => ({
      clinicId: "c1",
      userId: "u1",
      role: "ADMIN",
      user: { id: "u1", role: "ADMIN", clinicId: "c1", permissionsOverride: null },
    }),
  },
});
(mock as any).module("@/lib/patient-visibility", {
  namedExports: {
    assertPatientVisible: async () => null,
    relatedPatientVisibilityAnd: () => [],
  },
});

// ── Herramientas de reloj de pared, independientes de src/lib ───────────────

/** Partes Y-M-D-H-m de un instante, leídas en `tz`. */
function partsIn(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const p: Record<string, string> = {};
  for (const { type, value } of f.formatToParts(d)) p[type] = value;
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${p.hour}:${p.minute}:${p.second}`,
  };
}

/** El instante UTC de "hoy en la clínica, a las HH:MM". Sin usar src/lib. */
function localTodayAt(hour: number, minute: number): Date {
  const today = partsIn(new Date(), TZ).date;
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour - OFFSET_HOURS, minute, 0, 0));
}

test("la zona de prueba sigue sin horario de verano (si esto cambia, el test miente)", () => {
  const { time } = partsIn(new Date(Date.UTC(2026, 0, 1, 6, 0, 0)), TZ);
  assert.equal(time, "00:00:00", "enero: −6");
  const verano = partsIn(new Date(Date.UTC(2026, 6, 1, 6, 0, 0)), TZ);
  assert.equal(verano.time, "00:00:00", "julio: también −6");
});

/** Las tres comprobaciones, contra la ventana que sea que armó el handler. */
function assertJornadaDeLaClinica(where: any, etiqueta: string) {
  assert.ok(where?.startsAt, `${etiqueta}: la consulta debe acotar startsAt`);
  const inicio: Date = where.startsAt.gte;
  const fin: Date = where.startsAt.lt ?? where.startsAt.lte;
  assert.ok(inicio instanceof Date && fin instanceof Date, `${etiqueta}: límites Date`);

  // 1 · el inicio es la medianoche EN LA CLÍNICA (con el código viejo y TZ=UTC
  //     esto salía "18:00:00" del día anterior).
  assert.equal(
    partsIn(inicio, TZ).time,
    "00:00:00",
    `${etiqueta}: la ventana debe empezar a medianoche de la clínica`,
  );
  assert.equal(
    partsIn(inicio, TZ).date,
    partsIn(new Date(), TZ).date,
    `${etiqueta}: y esa medianoche es la de HOY en la clínica`,
  );

  // 2 · dura 24 h y es semiabierta.
  assert.equal(fin.getTime() - inicio.getTime(), 86_400_000, `${etiqueta}: 24 h justas`);
  assert.ok("lt" in where.startsAt, `${etiqueta}: [inicio, fin), no <=`);

  // 3 · el día local entero cae dentro. Las 17:00 y las 23:30 son las que se
  //     caían de la pantalla a partir de las 18:00 locales.
  for (const [h, m] of [[0, 30], [12, 0], [17, 0], [23, 30]] as const) {
    const t = localTodayAt(h, m).getTime();
    assert.ok(
      t >= inicio.getTime() && t < fin.getTime(),
      `${etiqueta}: una cita de las ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} locales de hoy debe caer dentro de la ventana`,
    );
  }
}

test("hallazgo 30 · tablero de sala de espera: la ventana es el día de la clínica", async () => {
  const { GET } = await import("@/app/api/tv/[slug]/operational/route");
  lastApptWhere = null;

  const res = await GET({ url: "http://localhost/api/tv/qa/operational" } as any, {
    params: { slug: "qa" },
  });
  assert.equal(res.status ?? 200, 200);

  assertJornadaDeLaClinica(lastApptWhere, "tv/[slug]/operational");
  assert.equal(lastApptWhere.clinicId, "c1", "sigue acotado al tenant del slug");
});

test("hallazgo 30 · visor 3D: la ventana es el día de la clínica", async () => {
  const { GET } = await import("@/app/api/clinic-layout/3d-state/route");
  lastApptWhere = null;

  const res = await GET();
  assert.equal(res.status ?? 200, 200);

  assertJornadaDeLaClinica(lastApptWhere, "clinic-layout/3d-state");
  assert.equal(lastApptWhere.clinicId, "c1", "sigue acotado al tenant de la sesión");
});
