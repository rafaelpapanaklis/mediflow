/**
 * De la cita real al modelo que pintan las tres vistas.
 *
 * Lo que se vigila: que la hora salga de la zona de la clínica, que los nueve
 * estados produzcan un detalle con sentido (y ninguno una cadena vacía o un
 * «undefined»), que los minutos de espera no sigan corriendo cuando la cita ya
 * terminó, y que un paciente restringido no acabe con un enlace roto.
 *
 * Run: npm run test:agenda-nueva-vista
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  AgendaAppointmentDTO,
  AppointmentStatus,
  DoctorColumnDTO,
  ResourceDTO,
} from "@/lib/agenda/types";
import { aCitaVista, aResponsablesVista, resumenDeColumna } from "../vista-modelo";

const TZ = "America/Mexico_City";
const AHORA = new Date("2026-09-02T17:20:00.000Z"); // 11:20 en México

const DOCTORES: DoctorColumnDTO[] = [
  { id: "d1", displayName: "Dra. Daniela Díaz", shortName: "Dra. Díaz", color: "#7c3aed", activeInAgenda: true },
  { id: "d2", displayName: "Dr. Jorge Ruiz", shortName: "Dr. Jorge", color: null, activeInAgenda: true },
];

const UNIDADES: ResourceDTO[] = [
  { id: "u1", name: "Unidad 1", kind: "SILLA_DENTAL", color: null, orderIndex: 0 },
  { id: "u2", name: "Unidad 2", kind: "SILLA_DENTAL", color: null, orderIndex: 1 },
];

const CTX = { timezone: TZ, doctores: DOCTORES, unidades: UNIDADES, ahora: AHORA };

function cita(over: Partial<AgendaAppointmentDTO> = {}): AgendaAppointmentDTO {
  return {
    id: "c1",
    // 11:00–11:45 hora de México.
    startsAt: "2026-09-02T17:00:00.000Z",
    endsAt: "2026-09-02T17:45:00.000Z",
    status: "CONFIRMED",
    patient: { id: "p1", name: "Valeria Sánchez Ruiz" },
    doctor: { id: "d1", shortName: "Dra. Díaz" },
    reason: "Resina",
    resourceId: "u1",
    source: "STAFF",
    requiresValidation: false,
    overrideReason: null,
    checkedInAt: null,
    startedAt: null,
    completedAt: null,
    cancelReason: null,
    ...over,
  };
}

/* ── Horas y duración ──────────────────────────────────────────────────── */

test("la hora es la de PARED de la clínica, no la del proceso", () => {
  const v = aCitaVista(cita(), CTX);
  assert.equal(v.inicioMin, 11 * 60);
  assert.equal(v.rango, "11:00–11:45");
  assert.equal(v.horaInicio, "11:00");
  assert.equal(v.duracionMin, 45);
});

test("una cita sin fin no sale invisible ni con duración negativa", () => {
  const v = aCitaVista(cita({ endsAt: undefined }), CTX);
  assert.equal(v.duracionMin, 30, "sin endsAt se asume el mismo hueco que assignLanes");

  // Datos rotos: el fin antes del inicio no puede dar un alto negativo.
  const alReves = aCitaVista(
    cita({ startsAt: "2026-09-02T17:45:00.000Z", endsAt: "2026-09-02T17:00:00.000Z" }),
    CTX,
  );
  assert.ok(alReves.duracionMin >= 5, "una cita rota sigue siendo clicable");
});

/* ── Los nueve estados ─────────────────────────────────────────────────── */

const LOS_NUEVE: AppointmentStatus[] = [
  "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_CHAIR", "IN_PROGRESS",
  "COMPLETED", "CHECKED_OUT", "CANCELLED", "NO_SHOW",
];

test("los nueve estados dan un chip y un detalle legibles, nunca vacíos", () => {
  for (const status of LOS_NUEVE) {
    const v = aCitaVista(cita({ status, checkedInAt: "2026-09-02T16:56:00.000Z" }), CTX);
    assert.ok(v.chip.length > 0, `${status} sin chip`);
    assert.ok(v.detalle.length > 0, `${status} sin detalle`);
    assert.ok(!v.detalle.includes("undefined"), `${status} con un undefined en el detalle`);
    assert.ok(!v.detalle.includes("NaN"), `${status} con un NaN en el detalle`);
  }
});

test("el chip de «esperando» lleva los minutos; los demás no", () => {
  // Llegó a las 10:56; son las 11:20 → 24 min.
  const esperando = aCitaVista(
    cita({ status: "CHECKED_IN", checkedInAt: "2026-09-02T16:56:00.000Z" }),
    CTX,
  );
  assert.equal(esperando.minutosEsperando, 24);
  assert.equal(esperando.chip, "Registrado · 24 min");
  assert.equal(esperando.detalle, "llegó 10:56 · espera 24 min");

  const confirmada = aCitaVista(cita({ status: "CONFIRMED" }), CTX);
  assert.equal(confirmada.chip, "Confirmada");
  assert.equal(confirmada.minutosEsperando, null);
});

test("«en consulta» cuenta desde que empezó, no desde que llegó", () => {
  const v = aCitaVista(
    cita({
      status: "IN_PROGRESS",
      checkedInAt: "2026-09-02T16:56:00.000Z",
      startedAt: "2026-09-02T17:04:00.000Z", // 11:04
    }),
    CTX,
  );
  assert.equal(v.minutosEnConsulta, 16);
  assert.equal(v.detalle, "desde 11:04 · 16 min");
  assert.equal(v.minutosEsperando, null, "una vez dentro, ya no «espera»");
});

test("los minutos de espera NO siguen corriendo cuando la cita ya terminó", () => {
  // Llegó hace cuatro horas y la cita está cerrada: decir «espera 240 min»
  // sería ruido, y encima crecería solo con el reloj.
  const v = aCitaVista(
    cita({ status: "COMPLETED", checkedInAt: "2026-09-02T13:20:00.000Z" }),
    CTX,
  );
  assert.equal(v.minutosEsperando, null);
  assert.ok(!v.detalle.includes("240"));
});

test("una cancelada enseña su motivo", () => {
  const v = aCitaVista(
    cita({ status: "CANCELLED", cancelReason: "el paciente pidió reagendar" }),
    CTX,
  );
  assert.equal(v.detalle, "Cancelada · el paciente pidió reagendar");
  assert.equal(v.pinta.tachado, true);
});

test("un reloj adelantado no produce esperas negativas", () => {
  // checkedInAt en el futuro (reloj del servidor descuadrado).
  const v = aCitaVista(
    cita({ status: "CHECKED_IN", checkedInAt: "2026-09-02T18:00:00.000Z" }),
    CTX,
  );
  assert.equal(v.minutosEsperando, 0);
  assert.ok(!v.chip.includes("-"));
});

/* ── Responsables y unidades ───────────────────────────────────────────── */

test("el color del responsable es el de la clínica; sin color, uno estable", () => {
  const conColor = aCitaVista(cita(), CTX);
  assert.equal(conColor.colorResponsable, "#7c3aed");

  const sinColor = aCitaVista(cita({ doctor: { id: "d2", shortName: "Dr. Jorge" } }), CTX);
  assert.ok(sinColor.colorResponsable.length > 0);
  // Estable entre llamadas: el mismo doctor no cambia de color al re-renderizar.
  const otraVez = aCitaVista(cita({ doctor: { id: "d2", shortName: "Dr. Jorge" } }), CTX);
  assert.equal(sinColor.colorResponsable, otraVez.colorResponsable);
});

test("una cita sin responsable no revienta", () => {
  const v = aCitaVista(cita({ doctor: undefined }), CTX);
  assert.equal(v.responsableId, null);
  assert.equal(v.responsableNombre, "Sin responsable");
  assert.ok(v.colorResponsable.length > 0);
});

test("una unidad desconocida no inventa nombre", () => {
  assert.equal(aCitaVista(cita({ resourceId: "fantasma" }), CTX).unidadNombre, null);
  assert.equal(aCitaVista(cita({ resourceId: null }), CTX).unidadNombre, null);
  assert.equal(aCitaVista(cita(), CTX).unidadNombre, "Unidad 1");
});

test("un paciente restringido no deja un enlace roto al expediente", () => {
  // `maskedPatient` devuelve el id vacío cuando el usuario no puede verlo.
  const v = aCitaVista(cita({ patient: { id: "", name: "Paciente privado" } }), CTX);
  assert.equal(v.pacienteId, null);
  assert.equal(v.nombrePaciente, "Paciente privado");
});

test("aResponsablesVista conserva el orden del servidor", () => {
  const rs = aResponsablesVista(DOCTORES);
  assert.deepEqual(rs.map((r) => r.id), ["d1", "d2"]);
  assert.equal(rs[0]!.nombre, "Dra. Daniela Díaz");
  assert.equal(rs[0]!.nombreCorto, "Dra. Díaz");
  assert.ok(rs[0]!.iniciales.length > 0);
});

/* ── El subtítulo de la columna ────────────────────────────────────────── */

test("«N citas» cuenta lo que se dibuja: todo menos las canceladas", () => {
  const vistas = [
    aCitaVista(cita({ id: "a", status: "CONFIRMED" }), CTX),
    aCitaVista(cita({ id: "b", status: "NO_SHOW" }), CTX),
    aCitaVista(cita({ id: "c", status: "CANCELLED" }), CTX),
  ];
  // La cancelada no se dibuja en la cuadrícula, así que tampoco cuenta.
  assert.ok(resumenDeColumna(vistas).startsWith("2 citas"));
  assert.ok(resumenDeColumna([vistas[0]!]).startsWith("1 cita ·"));
  assert.equal(resumenDeColumna([]), "0 citas");
});

test("el subtítulo lista las unidades de verdad y resume si son muchas", () => {
  const una = [aCitaVista(cita({ resourceId: "u1" }), CTX)];
  assert.equal(resumenDeColumna(una), "1 cita · Unidad 1");

  const dos = [
    aCitaVista(cita({ id: "a", resourceId: "u1" }), CTX),
    aCitaVista(cita({ id: "b", resourceId: "u2" }), CTX),
  ];
  assert.equal(resumenDeColumna(dos), "2 citas · Unidad 1 · Unidad 2");

  // Sin unidad asignada no se inventa ninguna.
  assert.equal(resumenDeColumna([aCitaVista(cita({ resourceId: null }), CTX)]), "1 cita");
});

test("con cero minutos no se dice «0 min»: el paciente acaba de llegar", () => {
  // Llegó justo ahora (11:20): «espera 0 min» se lee mal y no aporta nada.
  const reciente = aCitaVista(
    cita({ status: "CHECKED_IN", checkedInAt: "2026-09-02T17:20:00.000Z" }),
    CTX,
  );
  assert.equal(reciente.minutosEsperando, 0);
  assert.equal(reciente.detalle, "llegó 11:20");
  assert.equal(reciente.chip, "Registrado", "el chip tampoco lleva el «· 0 min»");

  const enSillon = aCitaVista(
    cita({ status: "IN_CHAIR", checkedInAt: "2026-09-02T17:20:00.000Z" }),
    CTX,
  );
  assert.equal(enSillon.detalle, "en el sillón · llegó 11:20");

  const empezando = aCitaVista(
    cita({ status: "IN_PROGRESS", startedAt: "2026-09-02T17:20:00.000Z" }),
    CTX,
  );
  assert.equal(empezando.detalle, "desde 11:20");

  // Y en cuanto hay un minuto, sí aparece.
  const unMinuto = aCitaVista(
    cita({ status: "CHECKED_IN", checkedInAt: "2026-09-02T17:19:00.000Z" }),
    CTX,
  );
  assert.equal(unMinuto.detalle, "llegó 11:19 · espera 1 min");
  assert.equal(unMinuto.chip, "Registrado · 1 min");
});

test("ningún detalle sale con un «0 min» pegado", () => {
  for (const status of LOS_NUEVE) {
    const v = aCitaVista(
      cita({
        status,
        checkedInAt: "2026-09-02T17:20:00.000Z",
        startedAt: "2026-09-02T17:20:00.000Z",
      }),
      CTX,
    );
    assert.ok(!/\b0 min\b/.test(v.detalle), `${status}: «${v.detalle}»`);
    assert.ok(!/\b0 min\b/.test(v.chip), `${status}: chip «${v.chip}»`);
  }
});

test("una cita legacy en «PENDING» se pinta, no tumba la pantalla", () => {
  // Reproduce el fallo que encontró el revisor: `PENDING` es el `@default` de
  // la columna `status` y no está en el tipo de TypeScript. Antes, esto
  // lanzaba un TypeError dentro del render y se caía la vista Día entera.
  const v = aCitaVista(cita({ status: "PENDING" as AppointmentStatus }), CTX);
  assert.equal(v.estado, "SCHEDULED", "PENDING se normaliza a agendada");
  assert.equal(v.chip, "Agendada", "el mismo nombre que le da la ficha del paciente");
  assert.equal(v.detalle, "Sin confirmar");
  assert.ok(v.detalle.length > 0);
  assert.equal(v.pinta.estiloBorde, "dashed");
});

test("una cita PENDING que espera validación la sigue marcando", () => {
  const v = aCitaVista(
    cita({ status: "PENDING" as AppointmentStatus, requiresValidation: true }),
    CTX,
  );
  assert.equal(v.esperaValidacion, true, "se normaliza antes de comparar con SCHEDULED");
});
