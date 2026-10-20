/**
 * REABRIR UNA CITA CUYO HUECO YA OCUPA OTRA — WS1-T5 (revisión t8, A3 y N-A1).
 *
 * Run: npm run test:salamanca-agenda
 *
 * Ana estaba sobreagendada encima de Mario. Recepción cancela a Ana por error
 * y el admin pulsa «Reabrir cita». Antes del arreglo: o se reabría encima sin
 * aviso (si su compañera era otra sobreagendada, la base no la ve), o salía un
 * 409 que mandaba a mover a Ana… que, cancelada, no se puede mover.
 *
 * Llama al HANDLER REAL de `PATCH /api/appointments/:id/status` con
 * `mock.module` sobre prisma, la sesión y los efectos (⛔ ni base ni WhatsApp).
 * La última parte corre el flujo de la PANTALLA (`patchAppointmentStatus` +
 * `enviarConAvisoDeSobreagenda`, lo que usa «Reabrir cita» del panel) con
 * `fetch` apuntando a ese mismo handler.
 *
 * N3-A3: los COMPONENTES de la agenda de siempre (la tarjeta, su menú «…» y
 * el panel de detalle) se montan de verdad en Chromium (Playwright de
 * `NAVEGADOR_DIR` o `~/navegador`) y se les hace clic; cada PATCH de la
 * página lo contesta este mismo handler real. Sin Playwright, esas pruebas
 * se SALTAN diciéndolo (no pasan en verde).
 */
import { test, mock, beforeEach, after } from "node:test";
import { cargarChromium, empaquetar } from "@/components/dashboard/agenda/__tests__/empaquetar-para-chromium";
import assert from "node:assert/strict";

const TZ = "America/Mexico_City";
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const MARCA = "Sobreagendada por el equipo";

/** Pasado mañana a las 16:00Z (10:00 en CDMX), al minuto. */
const INICIO = new Date(Math.floor((Date.now() + 2 * DAY) / DAY) * DAY + 16 * 60 * MIN);
const FIN = new Date(INICIO.getTime() + 30 * MIN);

let bandera: boolean;
let existente: any;
/** Las citas vivas de la base (lo que lee `buscarChoqueDeCita`). */
let vivas: any[];
/** Lo que escribió el `updateMany` del cambio de estado (null = nada). */
let escrito: any;
/** La constraint de la base: rechaza si la cita queda SIN overrideReason. */
let constraintChoca: boolean;
let movimientos: any[];
/** Cuántas veces se buscó el choque (`appointment.findMany`). */
let busquedas: number;

const session: any = {
  user: { id: "u-admin", role: "ADMIN", clinicId: "c1", displayName: "Admin", permissionsOverride: [] },
  clinic: { id: "c1", name: "Clínica QA", category: "DENTAL", timezone: TZ, defaultSlotMinutes: 30, schedules: [] },
};

const CLAVE_FLEX = Symbol.for("dalecontrol.agenda.flexible");

beforeEach(() => {
  bandera = true;
  escrito = null;
  constraintChoca = false;
  movimientos = [];
  busquedas = 0;
  (globalThis as any)[CLAVE_FLEX] = undefined;
  existente = {
    id: "a-ana",
    clinicId: "c1",
    patientId: "p-ana",
    doctorId: "d1",
    resourceId: null,
    overrideReason: MARCA,
    overriddenBy: "u-otra-admin",
    overriddenAt: new Date("2026-10-01T15:00:00Z"),
    status: "CANCELLED",
    startsAt: INICIO,
    endsAt: FIN,
  };
  vivas = [cita("a-mario", "Mario", "López", null)];
});

function cita(id: string, nombre: string, apellido: string, overrideReason: string | null) {
  return {
    id,
    clinicId: "c1",
    doctorId: "d1",
    resourceId: null,
    status: "CONFIRMED",
    overrideReason,
    startsAt: INICIO,
    endsAt: FIN,
    patient: { firstName: nombre, lastName: apellido, visibleUserIds: [] },
  };
}

const prismaStub: any = {
  appointmentTimeline: { findUnique: async () => null, upsert: async () => undefined },
  appointment: {
    findFirst: async ({ where }: any) => {
      assert.equal(where.clinicId, "c1", "la cita se lee SIEMPRE con el clinicId de la sesión");
      return existente;
    },
    // buscarChoqueDeCita: las vivas del mismo doctor que pisan el rango.
    findMany: async ({ where }: any) => {
      assert.equal(where.clinicId, "c1");
      busquedas++;
      return vivas.filter(
        (a) =>
          a.id !== where.id?.not &&
          a.startsAt < where.startsAt.lt &&
          a.endsAt > where.endsAt.gt &&
          where.OR.some((o: any) => (o.doctorId && o.doctorId === a.doctorId) || (o.resourceId && o.resourceId === a.resourceId)),
      );
    },
  },
  clinicFeatureFlag: {
    findMany: async ({ where }: any) =>
      bandera && where.clinicId === "c1" ? [{ flag: "agenda-flexible", enabled: true }] : [],
  },
  $queryRaw: async () => [{ existe: true }],
  $transaction: async (fn: any) =>
    fn({
      appointment: {
        updateMany: async ({ where, data }: any) => {
          assert.equal(where.clinicId, "c1");
          const override = data.overrideReason === undefined ? existente.overrideReason : data.overrideReason;
          if (constraintChoca && override == null) {
            throw Object.assign(new Error("exclusion constraint"), { code: "23P01" });
          }
          escrito = data;
          return { count: 1 };
        },
        findFirst: async () => ({
          ...existente,
          ...(escrito ?? {}),
          patient: { id: "p-ana", firstName: "Ana", lastName: "García" },
          doctor: { id: "d1", firstName: "Luis", lastName: "Ruiz" },
        }),
      },
    }),
};

(mock as any).module("@/lib/prisma", { namedExports: { prisma: prismaStub } });
(mock as any).module("@/lib/agenda/api-helpers", {
  namedExports: { loadClinicSession: async () => session, requireRole: () => null },
});
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
/** La cita como la pinta la agenda (la tarjeta necesita paciente y doctor). */
function dtoDeCita(a: any) {
  return {
    id: a.id,
    status: a.status,
    startsAt: new Date(a.startsAt).toISOString(),
    endsAt: new Date(a.endsAt).toISOString(),
    patient: { id: "p-ana", name: "Ana García" },
    doctor: { id: "d1", shortName: "Dr. Ruiz" },
    reason: "Limpieza",
    resourceId: a.resourceId ?? null,
    source: "STAFF",
    requiresValidation: false,
    overrideReason: a.overrideReason ?? null,
  };
}
(mock as any).module("@/lib/agenda/server", { namedExports: { appointmentToDTO: dtoDeCita } });
(mock as any).module("@/lib/patient-visibility", {
  namedExports: { assertPatientVisible: async () => null, canSeePatient: () => true },
});
(mock as any).module("@/lib/reviews/invite", { namedExports: { sendReviewInvitation: async () => undefined } });
(mock as any).module("@/lib/cache/revalidate", {
  namedExports: { revalidateAfter: () => undefined, revalidatePatientProfile: () => undefined },
});
(mock as any).module("@/lib/whatsapp/avisos-cita", {
  namedExports: { avisarCitaPorWhatsApp: async () => ({ enviado: false, motivo: "doble" }) },
});
(mock as any).module("@/lib/anticipos/cita-cancelada.server", {
  namedExports: { decidirDineroDeCitaCancelada: async () => ({ ok: true }), dineroDeLaCita: async () => null },
});
(mock as any).module("@/lib/agenda/google-sync", { namedExports: { sincronizarCitaEnSegundoPlano: async () => undefined } });
(mock as any).module("@/lib/reminders/reschedule.server", {
  namedExports: { cancelPendingRemindersForAppointment: async () => 0 },
});
(mock as any).module("@/lib/walk-in/cerrar-fila-de-la-cita", { namedExports: { cerrarFilaDeLaCita: async () => undefined } });
(mock as any).module("@/lib/movimientos-paciente/registrar", {
  namedExports: {
    registrarMovimientoDelPaciente: async (m: any) => {
      movimientos.push(m);
    },
  },
});
(mock as any).module("@/lib/movimientos-paciente/zona", { namedExports: { zonaDeClinica: async () => TZ } });

const URL_STATUS = "http://localhost/api/appointments/a-ana/status";

async function reabrir(extra: Record<string, unknown> = {}) {
  const { PATCH } = await import("@/app/api/appointments/[id]/status/route");
  const res = await PATCH(
    new Request(URL_STATUS, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "SCHEDULED", ...extra }) }) as any,
    { params: Promise.resolve({ id: "a-ana" }) },
  );
  return { status: res.status, body: await res.json() };
}

// ═══════════════════════════════════════════════════════════════════════
// LA RUTA
// ═══════════════════════════════════════════════════════════════════════

test("N-A1 · con bandera: reabrir a Ana encima de Mario pide el «¿Seguro?» (409 sobreagendable) y no escribe nada", async () => {
  const r = await reabrir();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "appointment_overlap");
  assert.equal(r.body.sobreagendable, true);
  assert.equal(r.body.conflictingAppointment.id, "a-mario");
  assert.equal(r.body.conflictingAppointment.patientName, "Mario López");
  assert.match(r.body.reason, /hazlo desde la Agenda/, "las pantallas que no preguntan dicen dónde hacerlo");
  assert.equal(escrito, null);
});

test("N-A1 · confirmado: se reabre y SIGUE sobreagendada (conserva su marca)", async () => {
  constraintChoca = true; // sin la marca, la base la pararía
  const r = await reabrir({ sobreagendar: true, sobreagendarCita: "a-mario", sobreagendarOtras: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrito.status, "SCHEDULED");
  assert.equal(escrito.overrideReason, MARCA, "conserva su marca");
});

test("N3-A5 · ya sobreagendada (sobre Mario), se reabre con «Sí» encima de EVA: el rastro dice encima de quién y quién confirmó", async () => {
  // Ana estaba sobreagendada sobre Mario (la marcó otra admin el 1-oct). Se
  // cancelan las dos, entra Eva, y este admin reabre a Ana encima de Eva.
  vivas = [cita("a-eva", "Eva", "Paz", null)];
  constraintChoca = true;
  const r = await reabrir({ sobreagendar: true, sobreagendarCita: "a-eva", sobreagendarOtras: 0 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrito.overrideReason, MARCA);
  assert.equal(escrito.overriddenBy, "u-admin", "quien confirmó AHORA, no quien la marcó antes");
  assert.ok(escrito.overriddenAt instanceof Date && escrito.overriddenAt.getTime() > Date.parse("2026-10-02"));
  const mov = movimientos.find((m) => m.campos?.[0] === "status");
  assert.equal(mov.userId, "u-admin");
  assert.deepEqual(mov.cambios.sobreagendada, {
    before: { overriddenBy: "u-otra-admin", overriddenAt: new Date("2026-10-01T15:00:00Z") },
    after: { conCita: "a-eva" },
  });
});

test("N-A1 · una cita normal (sin marca) cancelada, reabierta encima con confirmación: queda con la MARCA y el rastro", async () => {
  existente.overrideReason = null;
  constraintChoca = true;
  const r = await reabrir({ sobreagendar: true, sobreagendarCita: "a-mario" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrito.overrideReason, MARCA);
  assert.equal(escrito.overriddenBy, "u-admin");
  assert.ok(escrito.overriddenAt instanceof Date);
  const mov = movimientos.find((m) => m.campos?.[0] === "status");
  assert.deepEqual(mov.cambios.sobreagendada, { before: null, after: { conCita: "a-mario" } });
});

test("N-A1 · la confirmación vale para la cita que se enseñó: con otra se vuelve a preguntar", async () => {
  const r = await reabrir({ sobreagendar: true, sobreagendarCita: "otra" });
  assert.equal(r.status, 409);
  assert.equal(r.body.sobreagendable, true);
  assert.equal(escrito, null);
});

test("A3 (a) · el hueco lo ocupa OTRA SOBREAGENDADA (la base no la ve): ya no se reabre encima sin aviso", async () => {
  vivas = [cita("a-eva", "Eva", "Paz", MARCA)];
  const r = await reabrir();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.sobreagendable, true);
  assert.equal(r.body.conflictingAppointment.id, "a-eva");
  assert.equal(escrito, null);
});

test("A3 · hueco LIBRE: se reabre y pierde la marca (vuelve a ser una cita normal)", async () => {
  vivas = [];
  const r = await reabrir();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrito.overrideReason, null);
  assert.equal(escrito.overriddenBy, null);
});

test("A3 · bandera APAGADA y el hueco ocupado: 409 que dice qué hacer (agendar una nueva), sin pregunta y sin escribir", async () => {
  bandera = false;
  const r = await reabrir({ sobreagendar: true, sobreagendarCita: "a-mario" });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "invalid_transition");
  assert.equal(r.body.sobreagendable, undefined);
  assert.match(r.body.reason, /Mario López/);
  assert.match(r.body.reason, /agéndale una cita nueva/);
  assert.equal(escrito, null);
});

test("A3 · otra cita entra en el hueco entre la revisión y la escritura: 409 claro, no un 500", async () => {
  vivas = [];
  constraintChoca = true;
  const r = await reabrir();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.reason, /Intenta de nuevo/);
});

// ── N3-A1: SIN la bandera, todas las clínicas como hoy ──────────────────

const SOBRETURNO = "Adelantada a hoy: el paciente llegó antes de su cita del 21 oct 2026, 10:00.";

test("N3-A1 · sin bandera: Ana (cita normal) se reabre aunque «Registrar llegada» adelantó a Mario a su hora (como en ws7)", async () => {
  bandera = false;
  existente.overrideReason = null;
  existente.overriddenBy = null;
  existente.overriddenAt = null;
  vivas = [cita("a-mario", "Mario", "López", SOBRETURNO)];
  const r = await reabrir();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrito.status, "SCHEDULED");
  assert.equal(escrito.overrideReason, undefined, "no se le pone ni se le quita nada");
  assert.equal(busquedas, 0, "sin la bandera no se busca nada: decide la base, como siempre");
  const mov = movimientos.find((m) => m.campos?.[0] === "status");
  assert.equal(mov.cambios.sobreagendada, undefined);
});

test("N3-A1 · sin bandera: también con una cita FORZADA por un admin o una sobreagendada en el hueco (la base las deja)", async () => {
  bandera = false;
  existente.overrideReason = null;
  for (const otra of ["Urgencia autorizada", MARCA]) {
    escrito = null;
    vivas = [cita("a-mario", "Mario", "López", otra)];
    const r = await reabrir();
    assert.equal(r.status, 200, `${otra}: ${JSON.stringify(r.body)}`);
    assert.equal(escrito.status, "SCHEDULED");
  }
});

test("N3-A1 · sin bandera: si la base la para (una cita normal en el hueco) → 409 que dice qué hacer, no un 500", async () => {
  bandera = false;
  existente.overrideReason = null;
  constraintChoca = true;
  const r = await reabrir();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.error, "invalid_transition");
  assert.match(r.body.reason, /agéndale una cita nueva/);
  assert.doesNotMatch(r.body.reason, /Intenta de nuevo/, "no es que «acabe de entrar» otra: ya estaba");
  assert.equal(escrito, null);
});

test("N3-A1 · control: CON la bandera, el sobreturno sí cuenta y se pregunta", async () => {
  existente.overrideReason = null;
  vivas = [cita("a-mario", "Mario", "López", SOBRETURNO)];
  const r = await reabrir();
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.sobreagendable, true);
  assert.equal(escrito, null);
});

test("un motivo de ADMINISTRACIÓN (no la marca) sigue como siempre: se reabre sin preguntar", async () => {
  existente.overrideReason = "Urgencia autorizada";
  const r = await reabrir();
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(escrito.overrideReason, undefined);
});

// ═══════════════════════════════════════════════════════════════════════
// LA PANTALLA: «Reabrir cita» del panel (patchAppointmentStatus +
// enviarConAvisoDeSobreagenda), con fetch apuntando al handler real
// ═══════════════════════════════════════════════════════════════════════

async function conFetchALaRuta<T>(fn: (peticiones: any[]) => Promise<T>): Promise<T> {
  const { PATCH } = await import("@/app/api/appointments/[id]/status/route");
  const peticiones: any[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    peticiones.push(JSON.parse(String(init.body)));
    return PATCH(new Request(new URL(url, "http://localhost"), init) as any, { params: Promise.resolve({ id: "a-ana" }) });
  }) as typeof fetch;
  try {
    return await fn(peticiones);
  } finally {
    globalThis.fetch = original;
  }
}

test("N-A1 · pantalla: Reabrir → «¿Seguro?» con Mario → «Sí» → se reabre sobreagendada (dos peticiones)", async () => {
  const { patchAppointmentStatus } = await import("@/lib/agenda/mutations");
  const { enviarConAvisoDeSobreagenda } = await import("@/lib/agenda/agenda-flexible");
  constraintChoca = true;
  const avisos: any[] = [];
  const { resultado, peticiones } = await conFetchALaRuta(async (peticiones) => ({
    peticiones,
    resultado: await enviarConAvisoDeSobreagenda({
      enviar: (confirmacion) => patchAppointmentStatus("a-ana", "SCHEDULED", confirmacion),
      preguntar: async (aviso) => {
        avisos.push(aviso);
        return true;
      },
      intento: { doctorId: "d1", resourceId: null },
      timeZone: TZ,
    }),
  }));
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].tipo, "doctor");
  assert.equal(avisos[0].paciente, "Mario López");
  assert.equal(avisos[0].hora, "10:00–10:30", "en la zona de la clínica");
  assert.deepEqual(peticiones[1], { status: "SCHEDULED", sobreagendar: true, sobreagendarCita: "a-mario", sobreagendarOtras: 0 });
  assert.equal(resultado?.status, "SCHEDULED");
  assert.equal(escrito.status, "SCHEDULED");
});

test("N-A1 · pantalla: «Cancelar» en el «¿Seguro?» no manda nada más y no cambia la cita", async () => {
  const { patchAppointmentStatus } = await import("@/lib/agenda/mutations");
  const { enviarConAvisoDeSobreagenda } = await import("@/lib/agenda/agenda-flexible");
  const { resultado, peticiones } = await conFetchALaRuta(async (peticiones) => ({
    peticiones,
    resultado: await enviarConAvisoDeSobreagenda({
      enviar: (confirmacion) => patchAppointmentStatus("a-ana", "SCHEDULED", confirmacion),
      preguntar: async () => false,
      intento: { doctorId: "d1", resourceId: null },
      timeZone: TZ,
    }),
  }));
  assert.equal(resultado, null);
  assert.equal(peticiones.length, 1);
  assert.equal(escrito, null);
});

test("pantalla: sin la bandera no hay pregunta; el error sale tal cual (con su frase)", async () => {
  const { patchAppointmentStatus } = await import("@/lib/agenda/mutations");
  const { enviarConAvisoDeSobreagenda } = await import("@/lib/agenda/agenda-flexible");
  bandera = false;
  let preguntas = 0;
  await conFetchALaRuta(async () => {
    await assert.rejects(
      enviarConAvisoDeSobreagenda({
        enviar: (confirmacion) => patchAppointmentStatus("a-ana", "SCHEDULED", confirmacion),
        preguntar: async () => {
          preguntas++;
          return true;
        },
        intento: { doctorId: "d1", resourceId: null },
        timeZone: TZ,
      }),
      (e: any) => e.status === 409 && /agéndale una cita nueva/.test(e.reason),
    );
  });
  assert.equal(preguntas, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// N3-A4 — la pantalla vieja «Citas» (`updateStatus` → `apiErrorMessage`)
// con el 409 REAL de reabrir
// ═══════════════════════════════════════════════════════════════════════

test("N3-A4 · «Citas»: reabrir con choque enseña la frase del servidor, no «Elige otra hora»", async () => {
  const { apiErrorMessage } = await import("@/app/dashboard/appointments/mensaje-error-citas");
  const conBandera = await reabrir();
  const texto = apiErrorMessage(conBandera.status, conBandera.body, "x");
  assert.equal(texto, conBandera.body.reason);
  assert.match(texto, /Mario López.*hazlo desde la Agenda/);
  assert.doesNotMatch(texto, /Elige otra hora/, "una cita cancelada no se puede mover");

  bandera = false;
  (globalThis as any)[CLAVE_FLEX] = undefined;
  const sinBandera = await reabrir();
  assert.match(apiErrorMessage(sinBandera.status, sinBandera.body, "x"), /agéndale una cita nueva/);
});

// ═══════════════════════════════════════════════════════════════════════
// N3-A3 — LOS COMPONENTES de la agenda de siempre, con clics de verdad en
// Chromium: el botón «Re-abrir» de la tarjeta, su menú «…» y el panel
// ═══════════════════════════════════════════════════════════════════════

/** El día de INICIO en la zona de la clínica (YYYY-MM-DD). */
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(INICIO);

let navegador: any = null;
let paquete: string | null = null;
after(async () => {
  await navegador?.close();
});

/**
 * Abre la agenda de siempre con Ana (cancelada) en Chromium. Cada PATCH de
 * estado lo contesta el handler REAL; lo demás, 404. `null` = sin Playwright.
 */
async function abrirAgenda(t: { skip(m: string): void }, opciones: { conPanel?: boolean } = {}) {
  const chromium = await cargarChromium();
  if (!chromium) {
    t.skip("Playwright no está (NAVEGADOR_DIR): la pantalla NO se ejecutó");
    return null;
  }
  paquete ??= await empaquetar("src/components/dashboard/agenda/__tests__/arnes-reabrir.tsx");
  navegador ??= await chromium.launch({ args: ["--no-sandbox"] });
  const { PATCH } = await import("@/app/api/appointments/[id]/status/route");
  const page = await navegador.newPage();
  const errores: string[] = [];
  page.on("pageerror", (e: Error) => errores.push(String(e)));
  const peticiones: any[] = [];
  const payload = {
    range: { from: new Date(INICIO.getTime() - 10 * 60 * MIN).toISOString(), to: new Date(INICIO.getTime() + 10 * 60 * MIN).toISOString() },
    timezone: TZ,
    slotMinutes: 30,
    dayStart: 8,
    dayEnd: 20,
    schedules: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, enabled: true, openTime: "08:00", closeTime: "20:00" })),
    appointments: [dtoDeCita(existente)],
    doctors: [{ id: "d1", displayName: "Dr. Luis Ruiz", shortName: "Dr. Ruiz", color: "#2563eb", activeInAgenda: true }],
    resources: [],
    pendingValidation: [],
    waitlistCount: 0,
    bloqueos: [],
  };
  await page.route("**/*", async (route: any) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.pathname === "/") {
      return route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="raiz"></div><script>window.__PAYLOAD__=${JSON.stringify(payload)};window.__DIA__=${JSON.stringify(DIA)};window.__CON_PANEL__=${opciones.conPanel === true};</script><script src="/arnes.js"></script></body></html>`,
      });
    }
    if (url.pathname === "/arnes.js") return route.fulfill({ contentType: "text/javascript", body: paquete });
    const m = url.pathname.match(/^\/api\/appointments\/([^/]+)\/status$/);
    if (m && req.method() === "PATCH") {
      const cuerpo = req.postData() ?? "";
      peticiones.push(JSON.parse(cuerpo));
      const res = await PATCH(
        new Request(new URL(url.pathname, "http://localhost"), { method: "PATCH", headers: { "content-type": "application/json" }, body: cuerpo }) as any,
        { params: Promise.resolve({ id: m[1]! }) },
      );
      return route.fulfill({ status: res.status, contentType: "application/json", body: await res.text() });
    }
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await page.goto("http://agenda.prueba/");
  await page.waitForSelector('[data-appt-id="a-ana"]', { timeout: 15_000 }).catch((e: Error) => {
    throw new Error(`la agenda no se pintó: ${errores.join(" | ") || e.message}`);
  });
  const tarjeta = page.locator('[data-appt-id="a-ana"]');
  const dialogo = page.getByRole("dialog");
  return { page, tarjeta, dialogo, peticiones, errores };
}

// La tarjeta de una cita cancelada no se arrastra: dnd-kit le pone
// `aria-disabled="true"`, y Playwright da por deshabilitado todo lo que
// cuelga de ella. Una persona sí puede pulsar sus botones: `force` hace el
// mismo clic de ratón en el botón, sin esa comprobación.
const CLIC = { force: true } as const;

test("N3-A3 · TARJETA: «Re-abrir» con Mario en el hueco → «¿Seguro?» → «Sí» → reabierta sobreagendada (y la tarjeta no se selecciona)", async (t) => {
  constraintChoca = true;
  const a = await abrirAgenda(t);
  if (!a) return;
  await a.tarjeta.getByRole("button", { name: "Re-abrir cita de Ana García" }).click(CLIC);
  await a.dialogo.waitFor({ timeout: 5_000 });
  assert.match(await a.dialogo.innerText(), /Mario López/, "el aviso nombra la cita con la que choca");
  await a.dialogo.getByRole("button", { name: "Sí, sobreagendar" }).click();
  await a.page.waitForSelector('[data-appt-id="a-ana"][data-status="SCHEDULED"]', { timeout: 5_000 });
  await a.dialogo.waitFor({ state: "detached", timeout: 5_000 });
  assert.deepEqual(a.peticiones, [
    { status: "SCHEDULED" },
    { status: "SCHEDULED", sobreagendar: true, sobreagendarCita: "a-mario", sobreagendarOtras: 0 },
  ]);
  assert.equal(escrito.status, "SCHEDULED", "el handler real la reabrió");
  assert.equal(await a.tarjeta.getAttribute("data-selected"), null, "el clic de «Sí» no llegó a la tarjeta");
  assert.deepEqual(a.errores, []);
  await a.page.close();
});

test("N3-A3 · TARJETA: «Cancelar» en el «¿Seguro?» → una sola petición y Ana sigue cancelada", async (t) => {
  const a = await abrirAgenda(t);
  if (!a) return;
  await a.tarjeta.getByRole("button", { name: "Re-abrir cita de Ana García" }).click(CLIC);
  await a.dialogo.waitFor({ timeout: 5_000 });
  await a.dialogo.getByRole("button", { name: "Cancelar" }).click();
  await a.page.waitForSelector('[data-appt-id="a-ana"][data-status="CANCELLED"]', { timeout: 5_000 });
  assert.deepEqual(a.peticiones, [{ status: "SCHEDULED" }]);
  assert.equal(escrito, null);
  assert.deepEqual(a.errores, []);
  await a.page.close();
});

test("N3-A3 · MENÚ «…» de la tarjeta: «Re-abrir cita» → «¿Seguro?» → «Sí» → reabierta", async (t) => {
  constraintChoca = true;
  const a = await abrirAgenda(t);
  if (!a) return;
  await a.tarjeta.getByRole("button", { name: "Más acciones de estado" }).click(CLIC);
  await a.page.getByRole("button", { name: "Re-abrir cita", exact: true }).click();
  await a.dialogo.waitFor({ timeout: 5_000 });
  await a.dialogo.getByRole("button", { name: "Sí, sobreagendar" }).click();
  await a.page.waitForSelector('[data-appt-id="a-ana"][data-status="SCHEDULED"]', { timeout: 5_000 });
  assert.equal(a.peticiones.length, 2);
  assert.equal(a.peticiones[1].sobreagendarCita, "a-mario");
  assert.equal(escrito.status, "SCHEDULED");
  assert.deepEqual(a.errores, []);
  await a.page.close();
});

test("N3-A3 · PANEL de detalle (el mismo gancho): «Re-abrir cita» → «¿Seguro?» → «Sí» → reabierta", async (t) => {
  constraintChoca = true;
  const a = await abrirAgenda(t, { conPanel: true });
  if (!a) return;
  await a.tarjeta.click(CLIC); // abre el panel
  const panel = a.page.getByRole("complementary", { name: "Detalle de cita" });
  await panel.waitFor({ timeout: 5_000 });
  await panel.getByRole("button", { name: "Más opciones de estado" }).click();
  await a.page.getByRole("button", { name: "Re-abrir cita", exact: true }).click();
  await a.dialogo.waitFor({ timeout: 5_000 });
  await a.dialogo.getByRole("button", { name: "Sí, sobreagendar" }).click();
  await a.page.waitForSelector('[data-appt-id="a-ana"][data-status="SCHEDULED"]', { timeout: 5_000 });
  assert.equal(a.peticiones.length, 2);
  assert.equal(escrito.status, "SCHEDULED");
  assert.deepEqual(a.errores, []);
  await a.page.close();
});

test("N3-A3 · control: SIN la bandera la tarjeta no pregunta; enseña la frase del servidor", async (t) => {
  bandera = false;
  constraintChoca = true; // la base la para (Mario es una cita normal)
  existente.overrideReason = null;
  const a = await abrirAgenda(t);
  if (!a) return;
  await a.tarjeta.getByRole("button", { name: "Re-abrir cita de Ana García" }).click(CLIC);
  await a.page.getByText(/agéndale una cita nueva/).waitFor({ timeout: 5_000 });
  assert.equal(await a.dialogo.count(), 0, "sin la bandera no hay «¿Seguro?»");
  assert.deepEqual(a.peticiones, [{ status: "SCHEDULED" }]);
  await a.page.waitForSelector('[data-appt-id="a-ana"][data-status="CANCELLED"]', { timeout: 5_000 });
  await a.page.close();
});
