/**
 * Agendar con un clic y mover arrastrando en la agenda nueva: las cuentas de
 * pantalla y los avisos (`interacciones.ts`).
 *
 * Run: npm run test:agenda-nueva-interacciones
 *
 * Lo que vigila:
 *  - La hora que propone un clic sale REDONDA y con el mismo criterio que la
 *    agenda de siempre (hacia abajo, al paso de la clínica), y cae en la misma
 *    función que ya usa `AgendaColumn` (`slotFromOffsetY`).
 *  - La franja rayada (antes de abrir, desde el cierre, día cerrado) no acepta
 *    clics.
 *  - Quien no puede editar no arrastra, y las citas cerradas tampoco.
 *  - Cuando el servidor rechaza un movimiento, el aviso dice POR QUÉ, y un 403
 *    se cuenta como falta de permiso y no como error técnico.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  aceptaClic,
  altoDeHueco,
  carrilDeClic,
  citaArrastrable,
  inicioDeClic,
  mensajeDeRechazo,
  rangoDePlan,
  rechazoIncierto,
} from "../interacciones";
import { slotFromOffsetY } from "@/lib/agenda/hover-slot";
import type { ReschedulePlan } from "@/lib/agenda/reschedule-flow";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";

const TZ = "America/Mexico_City";

function hora(hhmm: string, dia = "2026-09-24"): string {
  const [h, m] = hhmm.split(":").map(Number);
  const [y, mo, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(y!, mo! - 1, d!, h! + 6, m!)).toISOString();
}

const ORIGINAL: AgendaAppointmentDTO = {
  id: "c1",
  startsAt: hora("10:00"),
  endsAt: hora("10:45"),
  status: "CONFIRMED",
  patient: { id: "p1", name: "Zutanita Pruebas" },
  doctor: { id: "doc-a", shortName: "Dra. Díaz" },
  reason: "Resina",
  resourceId: "u1",
  source: "STAFF",
  requiresValidation: false,
  overrideReason: null,
};

const PLAN: ReschedulePlan = {
  original: ORIGINAL,
  newStartsAt: hora("11:00"),
  newEndsAt: hora("11:45"),
  newDoctorId: "doc-b",
  newResourceId: "u1",
  toDayISO: "2026-09-24",
};

/* ── La hora del clic ───────────────────────────────────────────────────── */

test("112 px por hora: un hueco de 15 min mide 28 px, uno de 30 mide 56", () => {
  assert.equal(altoDeHueco(15), 28);
  assert.equal(altoDeHueco(30), 56);
  assert.equal(altoDeHueco(60), 112);
});

test("un clic a las 10:07 propone las 10:00, no las 10:07 (huecos de 15)", () => {
  const minutoInicio = 8 * 60;
  // 10:07 son 127 min desde las 8:00 → 127/60·112 px.
  const y = (127 / 60) * 112;
  assert.equal(inicioDeClic({ y, altoLienzo: 1352, slotMinutes: 15, minutoInicio }), 10 * 60);
  // 10:16 → 10:15
  assert.equal(
    inicioDeClic({ y: (136 / 60) * 112, altoLienzo: 1352, slotMinutes: 15, minutoInicio }),
    10 * 60 + 15,
  );
});

test("con huecos de 30, un clic a las 10:29 propone las 10:00 y a las 10:30, las 10:30", () => {
  const minutoInicio = 8 * 60;
  assert.equal(inicioDeClic({ y: (149 / 60) * 112, altoLienzo: 1352, slotMinutes: 30, minutoInicio }), 600);
  assert.equal(inicioDeClic({ y: (150 / 60) * 112, altoLienzo: 1352, slotMinutes: 30, minutoInicio }), 630);
});

test("el clic usa la MISMA cuenta que la agenda de siempre (slotFromOffsetY)", () => {
  const paso = 15;
  const minutoInicio = 7 * 60;
  for (const y of [0, 27.9, 28, 300, 1000, 1343]) {
    const esperado = minutoInicio + slotFromOffsetY(y, altoDeHueco(paso), 1352) * paso;
    assert.equal(inicioDeClic({ y, altoLienzo: 1352, slotMinutes: paso, minutoInicio }), esperado);
  }
});

test("la rejilla no empieza siempre a las 8: el origen manda", () => {
  assert.equal(inicioDeClic({ y: 0, altoLienzo: 1464, slotMinutes: 15, minutoInicio: 7 * 60 }), 7 * 60);
});

/* ── Dónde se acepta ────────────────────────────────────────────────────── */

test("la franja de cierre no acepta clics: desde la hora de cierre en adelante", () => {
  const franjas = { aperturaHastaMin: 9 * 60, cierreDesdeMin: 18 * 60 };
  assert.equal(aceptaClic(17 * 60 + 45, franjas), true, "el último hueco antes del cierre vale");
  assert.equal(aceptaClic(18 * 60, franjas), false);
  assert.equal(aceptaClic(19 * 60, franjas), false);
});

test("antes de abrir tampoco", () => {
  const franjas = { aperturaHastaMin: 9 * 60, cierreDesdeMin: 18 * 60 };
  assert.equal(aceptaClic(8 * 60 + 45, franjas), false);
  assert.equal(aceptaClic(9 * 60, franjas), true);
});

test("un día cerrado no acepta ningún clic", () => {
  assert.equal(aceptaClic(10 * 60, { cerrada: true }), false);
});

test("sin horario configurado se acepta todo (igual que la agenda de siempre)", () => {
  assert.equal(aceptaClic(6 * 60, {}), true);
  assert.equal(aceptaClic(10 * 60, { aperturaHastaMin: null, cierreDesdeMin: null }), true);
});

test("en Semana, el carril del clic sale de dónde cayó en el ancho del día", () => {
  assert.equal(carrilDeClic(0, 3), 0);
  assert.equal(carrilDeClic(0.34, 3), 1);
  assert.equal(carrilDeClic(0.99, 3), 2);
  assert.equal(carrilDeClic(1, 3), 2, "el borde derecho sigue siendo el último carril");
  assert.equal(carrilDeClic(0.5, 0), 0);
});

/* ── Quién arrastra ─────────────────────────────────────────────────────── */

test("sin permiso de editar, ninguna cita se arrastra", () => {
  assert.equal(citaArrastrable({ status: "CONFIRMED" }, false), false);
  assert.equal(citaArrastrable({ status: "CONFIRMED" }, true), true);
});

test("cancelada, completada y no asistió no se arrastran (los mismos que rechaza el servidor)", () => {
  for (const status of ["CANCELLED", "COMPLETED", "NO_SHOW"] as const) {
    assert.equal(citaArrastrable({ status }, true), false, status);
  }
  for (const status of ["SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS", "CHECKED_OUT"] as const) {
    assert.equal(citaArrastrable({ status }, true), true, status);
  }
});

/* ── Lo que se lee ──────────────────────────────────────────────────────── */

test("la hora de destino se lee en la zona de la clínica", () => {
  assert.equal(rangoDePlan(PLAN, TZ), "11:00–11:45");
});

test("🔴 un 403 dice que falta permiso, no un error técnico", () => {
  const texto = mensajeDeRechazo({ status: 403, error: "Permiso requerido: agenda.edit" }, { plan: PLAN });
  assert.match(texto, /No tienes permiso para mover citas/);
  assert.doesNotMatch(texto, /403|agenda\.edit|forbidden/i);

  const deOtro = mensajeDeRechazo({ status: 403, error: "not_your_appointment" }, { plan: PLAN });
  assert.match(deOtro, /Solo puedes mover tus propias citas/);

  const porRol = mensajeDeRechazo({ status: 403, error: "forbidden" }, { plan: PLAN });
  assert.match(porRol, /No tienes permiso/);
});

test("un choque dice con quién, con el mismo texto de siempre", () => {
  const texto = mensajeDeRechazo(
    {
      status: 409,
      error: "appointment_overlap",
      conflictingAppointment: {
        id: "c9",
        patientName: "Mengano",
        doctorId: "doc-b",
        resourceId: "u7",
        startsAt: hora("11:00"),
        endsAt: hora("11:30"),
        status: "CONFIRMED",
      },
    },
    { plan: PLAN },
  );
  assert.equal(texto, "El doctor ya tiene una cita con Mengano a esa hora.");
});

test("las reglas de agenda del servidor llegan con su frase", () => {
  const texto = mensajeDeRechazo(
    { status: 422, error: "appointment_in_past", reason: "No se puede mover una cita al pasado." },
    { plan: PLAN },
  );
  assert.equal(texto, "No se puede mover una cita al pasado.");
});

test("una unidad cerrada a esa hora lo dice con su nombre", () => {
  const texto = mensajeDeRechazo(
    { status: 422, error: "resource_unavailable", reason: "resource_closed_this_day" },
    { plan: PLAN, nombreUnidad: "Unidad 1" },
  );
  assert.equal(texto, "Unidad 1 no atiende ese día.");
});

test("🔴 sin conexión NO se afirma dónde quedó: pudo guardarse y perderse la respuesta", () => {
  const error = new TypeError("Failed to fetch");
  assert.equal(rechazoIncierto(error), true, "hay que volver a leer la agenda");
  const texto = mensajeDeRechazo(error, { plan: PLAN });
  assert.match(texto, /No se pudo confirmar si la cita se movió/);
  assert.doesNotMatch(texto, /sigue en su hora de antes/);
});

test("un 5xx también es incierto (puede saltar después de guardar), y no enseña el código", () => {
  const error = { status: 500, error: "internal_error" };
  assert.equal(rechazoIncierto(error), true);
  const texto = mensajeDeRechazo(error, { plan: PLAN });
  assert.doesNotMatch(texto, /internal_error|500/);
  assert.match(texto, /No se pudo confirmar/);
});

test("un 4xx es un «no» del servidor: la cita sigue donde estaba y no hace falta recargar", () => {
  for (const error of [
    { status: 403, error: "forbidden" },
    { status: 409, error: "appointment_overlap" },
    { status: 422, error: "appointment_in_past", reason: "x" },
    { status: 404, error: "not_found" },
  ]) {
    assert.equal(rechazoIncierto(error), false, JSON.stringify(error));
  }
  const texto = mensajeDeRechazo({ status: 400, error: "invalid_duration" }, { plan: PLAN });
  assert.doesNotMatch(texto, /invalid_duration|400/);
  assert.match(texto, /No se pudo mover la cita. La cita sigue en su hora de antes/);
});

/* ── El cableado: quién agenda y quién arrastra ──────────────────────────
   Estas cuatro condiciones viven en los componentes, no en funciones puras.
   Si alguien las quita, un recepcionista sin permiso vería un botón o una
   cita arrastrable que el servidor le va a rechazar. Se fijan leyendo el
   código, como `interruptor-agenda.test.ts`. */

function fuente(ruta: string): string {
  return readFileSync(join(process.cwd(), ruta), "utf8");
}

test("sin agenda.create no hay botón «Nueva cita» ni clic en hueco (Día y Semana)", () => {
  const barra = fuente("src/components/dashboard/agenda-nueva/barra-herramientas.tsx");
  assert.match(barra, /\{permissions\.canCreate && \(\s*<button[\s\S]{0,200}botonNuevaCita/);
  for (const vista of ["vista-dia.tsx", "vista-semana.tsx"]) {
    const src = fuente(`src/components/dashboard/agenda-nueva/${vista}`);
    assert.match(src, /alPulsarHueco: permissions\.canCreate\s*\?/, `${vista}: el clic cuelga de agenda.create`);
  }
});

test("sin agenda.edit ninguna tarjeta se arrastra (Día y Semana)", () => {
  assert.match(
    fuente("src/components/dashboard/agenda-nueva/vista-dia.tsx"),
    /arrastrable=\{citaArrastrable\(cita\.dto, permissions\.canEdit\)\}/,
  );
  const semana = fuente("src/components/dashboard/agenda-nueva/vista-semana.tsx");
  assert.match(semana, /puedeEditar=\{permissions\.canEdit\}/);
  assert.match(semana, /arrastrable=\{citaArrastrable\(cita\.dto, props\.puedeEditar\)\}/);
});

test("el arrastre de la agenda nueva mide con la rejilla que dibuja (112 px/h desde horaInicio)", () => {
  const src = fuente("src/components/dashboard/agenda-nueva/arrastre-citas.tsx");
  assert.match(src, /slotHpx: altoDeHueco\(state\.slotMinutes\)/);
  assert.match(src, /dayStart: ventana\.horaInicio/);
  assert.match(src, /dayEnd: ventana\.horaFin/);
  // Y guarda con la lógica compartida, no con una copia. Desde WS1-T3 la
  // llamada lleva además `bloqueoConfirmado` (la persona aceptó soltar la cita
  // sobre un día bloqueado), así que se comprueba el `dispatch` compartido en
  // vez del objeto literal entero: lo que defiende esta prueba es que no haya
  // una segunda implementación de mover, no cuántas claves lleva el objeto.
  assert.match(src, /commitReschedule\(plan, \{/);
  assert.match(src, /\bdispatch,?\s*$/m);
  assert.match(src, /planReschedule\(\{/);
  // Si no se sabe qué quedó, relee la VISTA (no `router.refresh()`, que en
  // Semana rehidrata con un solo día).
  assert.match(src, /if \(rechazoIncierto\(r\.error\)\) refetchView\(\);/);
  assert.doesNotMatch(src, /useRouter|router\.refresh\(\);/);
});
