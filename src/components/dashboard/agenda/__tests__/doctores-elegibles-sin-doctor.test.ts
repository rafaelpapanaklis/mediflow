/**
 * ws1-t11 · P2 v3 — a quién se le puede dar una cita desde la pantalla, y «Sin doctor» en el idioma de quien mira.
 *
 * Run: npm run test:cita-sin-doctor-panel
 *
 *  · m1 (revisión de la v2): «¿Quién lo atiende?» de la lista vieja «Citas» solo ofrece a quien recibe citas
 *    (`puedeRecibirCitas`, la regla de `RECIBE_CITAS_WHERE`): ni recepción ni solo lectura ni quien tiene «Aparece
 *    en la agenda» apagada.
 *  · m2: en «Editar cita» (la ventana del expediente), un DOCTOR con una «Sin doctor» solo puede tomarla: el
 *    selector trae solo a él y abre consigo mismo; sin «Sin doctor». Los demás, y su propia cita, como siempre.
 *  · m6: el modelo de vista nombra «Sin doctor» con el texto del diccionario que le pasa la pantalla.
 * Con el código de f63681a44 no carga (el módulo `doctores-elegibles` no existe) y el nombre sale siempre en español.
 * Ids cuid, de siembra y una cita importada de Dentalink (id no uuid).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { doctoresQueRecibenCitas, opcionesDeDoctorAlEditar } from "@/components/dashboard/agenda/doctores-elegibles";
import { aCitaVista } from "@/lib/agenda-nueva/vista-modelo";
import type { AgendaAppointmentDTO } from "@/lib/agenda/types";

const DRA = "cmabc123xyz0000def456ghi"; // cuid
const DR_SIEMBRA = "seed-doctor-1"; // siembra
const DUENO = "cmdueno0000000000000000001";

test("m1: «¿Quién lo atiende?» solo con quien recibe citas", () => {
  const usuarios = [
    { id: DRA, firstName: "Laura", lastName: "Ruiz", role: "DOCTOR", agendaActive: true },
    { id: DR_SIEMBRA, firstName: "Mario", lastName: "Paz", role: "ADMIN", agendaActive: null }, // ausente = encendida
    { id: DUENO, firstName: "Dueño", lastName: "Sin agenda", role: "SUPER_ADMIN", agendaActive: false },
    { id: "cmrecep00000000000000001", firstName: "Rita", lastName: "Recepción", role: "RECEPTIONIST", agendaActive: true },
    { id: "cmlectura0000000000000001", firstName: "Lalo", lastName: "Lectura", role: "READONLY" },
  ];
  assert.deepEqual(
    doctoresQueRecibenCitas(usuarios, (d) => `${d.firstName} ${d.lastName}`),
    [
      { id: DRA, nombre: "Laura Ruiz" },
      { id: DR_SIEMBRA, nombre: "Mario Paz" },
    ],
  );
});

test("m2: un DOCTOR con una «Sin doctor» solo puede tomarla (solo él, abre consigo mismo, sin «Sin doctor»)", () => {
  const doctores = [{ id: DRA }, { id: DR_SIEMBRA }];
  assert.deepEqual(
    opcionesDeDoctorAlEditar({ rol: "DOCTOR", userId: DRA, citaDoctorId: null, doctores, ofreceSinDoctor: true }),
    { doctores: [{ id: DRA }], sinDoctor: false, inicial: DRA },
  );
  // Un DOCTOR que no recibe citas (no está en la lista) no puede tomarla: selector vacío, sin inicial.
  assert.deepEqual(
    opcionesDeDoctorAlEditar({ rol: "DOCTOR", userId: "cmotro000000000000000001", citaDoctorId: null, doctores, ofreceSinDoctor: true }),
    { doctores: [], sinDoctor: false, inicial: null },
  );
  // Su propia cita y los demás roles: la lista entera y «Sin doctor» según lo de siempre.
  assert.deepEqual(
    opcionesDeDoctorAlEditar({ rol: "DOCTOR", userId: DRA, citaDoctorId: DRA, doctores, ofreceSinDoctor: false }),
    { doctores, sinDoctor: false, inicial: null },
  );
  assert.deepEqual(
    opcionesDeDoctorAlEditar({ rol: "RECEPTIONIST", userId: "u", citaDoctorId: null, doctores, ofreceSinDoctor: true }),
    { doctores, sinDoctor: true, inicial: null },
  );
});

test("m6: «Sin doctor» en el idioma de quien mira (y en español si la pantalla no lo pasa)", () => {
  const dto = {
    id: "dentalink-appt-88231",
    startsAt: "2026-11-10T16:00:00.000Z",
    endsAt: "2026-11-10T16:30:00.000Z",
    status: "SCHEDULED",
    patient: { id: "p1", name: "Ana García" },
    reason: "Limpieza",
    resourceId: null,
  } as unknown as AgendaAppointmentDTO;
  const ctx = { timezone: "America/Mexico_City", doctores: [], unidades: [], ahora: new Date("2026-11-04T12:00:00Z") };
  assert.equal(aCitaVista(dto, { ...ctx, nombreSinDoctor: "No doctor" }).responsableNombre, "No doctor");
  assert.equal(aCitaVista(dto, ctx).responsableNombre, "Sin doctor");
});
