/**
 * EL HORARIO PROPIO DEL DOCTOR — la lógica pura. WS1-T2 · horario.
 *
 * Lo que estas pruebas defienden, por orden de importancia:
 *  1. **Un doctor SIN horario propio no cambia nada.** El día que esto se
 *     despliegue, ninguna agenda de las 15 clínicas puede moverse: para él
 *     `doctorNoAtiende` es `null` en CUALQUIER hueco de la semana y la ventana
 *     del día es la de la clínica tal cual.
 *  2. **La intersección con la clínica**: el horario del doctor no se sale del
 *     de la clínica; se agenda la parte común, y la API avisa de lo recortado.
 *  3. **Los bordes**: una cita que empieza justo al salir el doctor está
 *     fuera; una que termina justo a esa hora, dentro.
 *  4. **La zona de la clínica** decide el día de la semana, no UTC.
 *  5. **El alcance por rol**, y la puerta estrecha de Configuración.
 *
 * Run: npx tsx --test src/lib/horario-doctor/__tests__/core.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { tzLocalToUtc } from "@/lib/agenda/time-utils";
import {
  HorarioError,
  SIN_HORARIOS,
  alcanceDelHorario,
  avisoDeHorarioDoctor,
  avisosDeRecorte,
  doctorNoAtiende,
  doctorNoAtiendeSlot,
  horarioPropio,
  horariosDesdeObjeto,
  parseSemana,
  semanaCompleta,
  semanaHeredada,
  ventanaDeLaClinica,
  ventanaDelDoctor,
  type DiaHorario,
} from "../core";
import {
  PESTANA_HORARIOS,
  accesoAAjustes,
  pestanaInicial,
  rutaDeRebote,
} from "../acceso-ajustes";

// México quitó el horario de verano en 2022: UTC-6 todo el año.
const TZ = "America/Mexico_City";
const en = (dia: string, h: number, m = 0) => tzLocalToUtc(dia, h, m, TZ);

// Semana de referencia: lunes 9 a domingo 15 de noviembre de 2026.
const LUNES = "2026-11-09";
const MIERCOLES = "2026-11-11";
const JUEVES = "2026-11-12";
const SEMANA = ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];

function dia(dayOfWeek: number, enabled: boolean, openTime = "09:00", closeTime = "14:00"): DiaHorario {
  return { dayOfWeek, enabled, openTime, closeTime };
}

/** «Nunca trabajo los miércoles»: L-V de 9 a 14, miércoles y fin de semana libres. */
const SIN_MIERCOLES: DiaHorario[] = [
  dia(0, true), dia(1, true), dia(2, false), dia(3, true), dia(4, true), dia(5, false), dia(6, false),
];
const HORARIOS = new Map([["doc-a", SIN_MIERCOLES]]);

/** La clínica: L-V 9–18, sábado 9–14, domingo cerrado. */
const CLINICA: DiaHorario[] = [
  dia(0, true, "09:00", "18:00"), dia(1, true, "09:00", "18:00"), dia(2, true, "09:00", "18:00"),
  dia(3, true, "09:00", "18:00"), dia(4, true, "09:00", "18:00"), dia(5, true, "09:00", "14:00"),
  dia(6, false, "09:00", "18:00"),
];
const VENTANA_HISTORICA = { agendaDayStart: 8, agendaDayEnd: 20 };

// ═══════════════════════════════════════════════════════════════════════
// 1 · REGLA 1: sin horario propio, NADA cambia
// ═══════════════════════════════════════════════════════════════════════

test("doctor SIN horario propio → doctorNoAtiende es null en TODOS los huecos de la semana (la disponibilidad es idéntica a la de antes)", () => {
  // Otro doctor SÍ tiene horario: no se le puede pegar a éste.
  const conOtro = new Map([["doc-otro", SIN_MIERCOLES]]);
  let revisados = 0;
  for (const d of SEMANA) {
    for (let min = 0; min < 24 * 60; min += 15) {
      for (const dur of [15, 30, 45, 60, 90, 120]) {
        const inicio = en(d, Math.floor(min / 60), min % 60);
        for (const mapa of [SIN_HORARIOS, conOtro, null, undefined]) {
          assert.equal(doctorNoAtiendeSlot(mapa, inicio, dur, "doc-sin-horario", TZ), null);
        }
        revisados++;
      }
    }
  }
  assert.equal(revisados, 7 * 96 * 6);
});

test("doctor SIN horario propio → la ventana del día es la de la clínica, idéntica, los 7 días", () => {
  for (let d = 0; d <= 6; d++) {
    const clinica = ventanaDeLaClinica(VENTANA_HISTORICA, CLINICA, d);
    assert.deepEqual(ventanaDelDoctor(clinica, null, d), clinica);
    assert.deepEqual(ventanaDelDoctor(clinica, undefined, d), clinica);
    assert.deepEqual(ventanaDelDoctor(clinica, [], d), clinica);
    assert.deepEqual(ventanaDelDoctor(clinica, horarioPropio(HORARIOS, "doc-sin-horario"), d), clinica);
  }
});

test("hueco sin doctor concreto (null) → el horario personal de nadie se aplica", () => {
  assert.equal(doctorNoAtiende(HORARIOS, en(MIERCOLES, 10), en(MIERCOLES, 11), null, TZ), null);
  assert.equal(horarioPropio(HORARIOS, null), null);
});

// ═══════════════════════════════════════════════════════════════════════
// 2 · EL HORARIO PROPIO: días libres y bordes
// ═══════════════════════════════════════════════════════════════════════

test("«nunca trabajo los miércoles» → cualquier hueco del miércoles es día libre", () => {
  for (const h of [9, 10, 13]) {
    const r = doctorNoAtiendeSlot(HORARIOS, en(MIERCOLES, h), 30, "doc-a", TZ);
    assert.ok(r);
    assert.equal(r!.motivo, "dia_libre");
    assert.equal(r!.dayOfWeek, 2);
    assert.equal(r!.openTime, null);
  }
});

test("el lunes atiende de 9 a 14: dentro sí, fuera no", () => {
  assert.equal(doctorNoAtiendeSlot(HORARIOS, en(LUNES, 10), 30, "doc-a", TZ), null);
  const tarde = doctorNoAtiendeSlot(HORARIOS, en(LUNES, 16), 30, "doc-a", TZ);
  assert.equal(tarde?.motivo, "despues");
  assert.equal(tarde?.openTime, "09:00");
  assert.equal(tarde?.closeTime, "14:00");
  assert.equal(doctorNoAtiendeSlot(HORARIOS, en(LUNES, 8), 30, "doc-a", TZ)?.motivo, "antes");
});

test("BORDES — semiabierto [inicio, fin): la cita que empieza justo al salir está FUERA", () => {
  // Termina justo a la salida (13:30–14:00): cabe.
  assert.equal(doctorNoAtiende(HORARIOS, en(LUNES, 13, 30), en(LUNES, 14), "doc-a", TZ), null);
  // Empieza justo a la salida (14:00–14:30): fuera.
  assert.equal(doctorNoAtiende(HORARIOS, en(LUNES, 14), en(LUNES, 14, 30), "doc-a", TZ)?.motivo, "despues");
  // Se pasa un minuto (13:45–14:01): fuera.
  assert.equal(doctorNoAtiende(HORARIOS, en(LUNES, 13, 45), en(LUNES, 14, 1), "doc-a", TZ)?.motivo, "despues");
  // Empieza justo a la entrada (9:00–9:30): cabe.
  assert.equal(doctorNoAtiende(HORARIOS, en(LUNES, 9), en(LUNES, 9, 30), "doc-a", TZ), null);
  // Termina justo a la entrada (8:30–9:00): fuera, empieza antes.
  assert.equal(doctorNoAtiende(HORARIOS, en(LUNES, 8, 30), en(LUNES, 9), "doc-a", TZ)?.motivo, "antes");
});

test("una cita que cruza la medianoche se sale de cualquier horario", () => {
  const noche = new Map([["doc-n", [dia(0, true, "18:00", "23:59")]]]);
  assert.equal(doctorNoAtiende(noche, en(LUNES, 23), en(LUNES, 23, 30), "doc-n", TZ), null);
  assert.equal(doctorNoAtiende(noche, en(LUNES, 23, 30), en("2026-11-10", 0, 30), "doc-n", TZ)?.motivo, "despues");
  assert.equal(doctorNoAtiende(noche, en(LUNES, 23, 30), en("2026-11-10", 0, 0), "doc-n", TZ)?.motivo, "despues");
});

test("el día de la semana es el de la CLÍNICA: miércoles 23:00 en México es jueves en UTC", () => {
  const jueves = new Map([["doc-j", [dia(2, false), dia(3, true, "00:00", "23:59")]]]);
  const inicio = en(MIERCOLES, 23);
  assert.equal(inicio.toISOString(), "2026-11-12T05:00:00.000Z"); // jueves en UTC
  const r = doctorNoAtiende(jueves, inicio, en(MIERCOLES, 23, 30), "doc-j", TZ);
  assert.equal(r?.motivo, "dia_libre");
  assert.equal(r?.dayOfWeek, 2); // miércoles
  // Y el jueves de verdad sí atiende.
  assert.equal(doctorNoAtiende(jueves, en(JUEVES, 10), en(JUEVES, 11), "doc-j", TZ), null);
});

test("un día sin fila o con horas rotas no abre nada (prudencia contra sobreagenda)", () => {
  const roto = new Map([["doc-r", [dia(0, true, "14:00", "09:00"), dia(1, true, "xx", "18:00")]]]);
  assert.equal(doctorNoAtiende(roto, en(LUNES, 10), en(LUNES, 11), "doc-r", TZ)?.motivo, "dia_libre");
  assert.equal(doctorNoAtiende(roto, en("2026-11-10", 10), en("2026-11-10", 11), "doc-r", TZ)?.motivo, "dia_libre");
  // Jueves no tiene fila: tampoco atiende.
  assert.equal(doctorNoAtiende(roto, en(JUEVES, 10), en(JUEVES, 11), "doc-r", TZ)?.motivo, "dia_libre");
});

// ═══════════════════════════════════════════════════════════════════════
// 3 · LA INTERSECCIÓN CON LA CLÍNICA
// ═══════════════════════════════════════════════════════════════════════

test("intersección: el doctor no se sale del horario de la clínica", () => {
  const clinica = { abre: 9 * 60, cierra: 18 * 60 };
  // Doctor 8–20 en clínica 9–18 → 9–18.
  assert.deepEqual(ventanaDelDoctor(clinica, [dia(0, true, "08:00", "20:00")], 0), clinica);
  // Doctor 10–20 → 10–18.
  assert.deepEqual(ventanaDelDoctor(clinica, [dia(0, true, "10:00", "20:00")], 0), { abre: 600, cierra: 1080 });
  // Doctor 18–20 → no se cruzan (18:00 es el cierre, semiabierto) → nada.
  assert.equal(ventanaDelDoctor(clinica, [dia(0, true, "18:00", "20:00")], 0), null);
  // Clínica cerrada → nada, diga lo que diga el doctor.
  assert.equal(ventanaDelDoctor(null, [dia(0, true, "08:00", "20:00")], 0), null);
  // Doctor libre ese día → nada.
  assert.equal(ventanaDelDoctor(clinica, [dia(0, false)], 0), null);
});

test("la API ACEPTA y AVISA: avisosDeRecorte dice qué parte se agendará de verdad", () => {
  const semana = parseSemana([
    dia(0, true, "08:00", "20:00"), // lunes: se recorta a 9–18
    dia(1, true, "10:00", "14:00"), // martes: cabe entero, sin aviso
    dia(2, false),                  // miércoles: libre, sin aviso
    dia(3, true, "09:00", "18:00"), // jueves: igual que la clínica, sin aviso
    dia(4, true, "07:00", "08:00"), // viernes: no se cruza
    dia(5, true, "15:00", "18:00"), // sábado: la clínica cierra a las 14
    dia(6, true, "10:00", "12:00"), // domingo: la clínica no abre
  ]);
  const avisos = avisosDeRecorte(semana, VENTANA_HISTORICA, CLINICA);
  assert.deepEqual(
    avisos.map((a) => [a.dayOfWeek, a.tipo, a.efectivo]),
    [
      [0, "recortado", { openTime: "09:00", closeTime: "18:00" }],
      [4, "sin_coincidencia", null],
      [5, "sin_coincidencia", null],
      [6, "clinica_cerrada", null],
    ],
  );
  assert.match(avisos[0].message, /se le agendará de 09:00 a 18:00/);
});

test("ventanaDeLaClinica usa el criterio de scheduleViolation (sin Ajustes, la ventana histórica)", () => {
  assert.deepEqual(ventanaDeLaClinica(VENTANA_HISTORICA, CLINICA, 5), { abre: 540, cierra: 840 });
  assert.equal(ventanaDeLaClinica(VENTANA_HISTORICA, CLINICA, 6), null);
  assert.deepEqual(ventanaDeLaClinica(VENTANA_HISTORICA, [], 6), { abre: 480, cierra: 1200 });
});

// ═══════════════════════════════════════════════════════════════════════
// 4 · LA SEMANA QUE ENTRA Y SALE POR LA API
// ═══════════════════════════════════════════════════════════════════════

test("parseSemana exige los 7 días, sin repetir, y los devuelve ordenados", () => {
  const ok = parseSemana([...SIN_MIERCOLES].reverse());
  assert.deepEqual(ok.map((d) => d.dayOfWeek), [0, 1, 2, 3, 4, 5, 6]);

  const codigo = (raw: unknown) => {
    try {
      parseSemana(raw);
      return "OK";
    } catch (e) {
      assert.ok(e instanceof HorarioError);
      assert.equal((e as HorarioError).status, 400);
      return (e as HorarioError).codigo;
    }
  };
  assert.equal(codigo(undefined), "SEMANA_INCOMPLETA");
  assert.equal(codigo(SIN_MIERCOLES.slice(0, 5)), "SEMANA_INCOMPLETA");
  assert.equal(codigo([...SIN_MIERCOLES.slice(0, 6), dia(0, true)]), "DIA_REPETIDO");
  assert.equal(codigo([...SIN_MIERCOLES.slice(0, 6), dia(7, true)]), "DIA_INVALIDO");
  assert.equal(codigo([...SIN_MIERCOLES.slice(0, 6), { ...dia(6, true), enabled: "sí" }]), "ENABLED_INVALIDO");
  assert.equal(codigo([...SIN_MIERCOLES.slice(0, 6), dia(6, true, "9:00", "14:00")]), "HORA_INVALIDA");
  assert.equal(codigo([...SIN_MIERCOLES.slice(0, 6), dia(6, true, "24:00", "23:00")]), "HORA_INVALIDA");
  assert.equal(codigo([...SIN_MIERCOLES.slice(0, 6), dia(6, true, "14:00", "14:00")]), "RANGO_INVERTIDO");
  // Un día que NO atiende puede llevar las horas al revés: no se usan.
  assert.equal(codigo([...SIN_MIERCOLES.slice(0, 6), dia(6, false, "14:00", "09:00")]), "OK");
});

test("semanaCompleta rellena con días libres; semanaHeredada es la de la clínica", () => {
  const dos = semanaCompleta([dia(3, true, "10:00", "12:00"), dia(0, true)]);
  assert.equal(dos.length, 7);
  assert.deepEqual(dos[0], dia(0, true));
  assert.deepEqual(dos[3], dia(3, true, "10:00", "12:00"));
  assert.equal(dos[1].enabled, false);

  const heredada = semanaHeredada(VENTANA_HISTORICA, CLINICA);
  assert.deepEqual(heredada[5], dia(5, true, "09:00", "14:00"));
  assert.equal(heredada[6].enabled, false);
  // Sin Ajustes: la ventana histórica, los siete días.
  const historica = semanaHeredada(VENTANA_HISTORICA, []);
  assert.ok(historica.every((d) => d.enabled && d.openTime === "08:00" && d.closeTime === "20:00"));
});

test("el aviso al staff tiene la forma de scheduleWarning y dice que se guardó", () => {
  const libre = avisoDeHorarioDoctor(doctorNoAtiendeSlot(HORARIOS, en(MIERCOLES, 10), 30, "doc-a", TZ)!);
  assert.equal(libre.reason, "doctor_off");
  assert.match(libre.message, /no atiende los miércoles/);
  assert.match(libre.message, /La cita se guardó de todas formas\.$/);
  const tarde = avisoDeHorarioDoctor(doctorNoAtiendeSlot(HORARIOS, en(LUNES, 16), 30, "doc-a", TZ)!);
  assert.equal(tarde.closeTime, "14:00");
  assert.match(tarde.message, /de 09:00 a 14:00/);
});

test("horariosDesdeObjeto: el JSON de la agenda vuelve a ser el mapa, sin doctores vacíos", () => {
  const mapa = horariosDesdeObjeto({ "doc-a": SIN_MIERCOLES, "doc-vacio": [] });
  assert.equal(mapa.size, 1);
  assert.equal(doctorNoAtiendeSlot(mapa, en(MIERCOLES, 10), 30, "doc-a", TZ)?.motivo, "dia_libre");
  assert.equal(doctorNoAtiendeSlot(mapa, en(MIERCOLES, 10), 30, "doc-vacio", TZ), null);
  assert.equal(horariosDesdeObjeto(null).size, 0);
});

// ═══════════════════════════════════════════════════════════════════════
// 5 · EL ALCANCE POR ROL Y LA PUERTA DE CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════

function status(fn: () => unknown): number | "OK" {
  try {
    fn();
    return "OK";
  } catch (e) {
    assert.ok(e instanceof HorarioError);
    return (e as HorarioError).status;
  }
}

test("alcance: ADMIN y SUPER_ADMIN cualquier doctor; DOCTOR solo el suyo; sin llave, nadie", () => {
  const conLlave = (role: string) => ({ role, userId: "yo", puedeGestionar: true });
  assert.equal(status(() => alcanceDelHorario(conLlave("ADMIN"), "doc-a")), "OK");
  assert.equal(status(() => alcanceDelHorario(conLlave("SUPER_ADMIN"), "doc-a")), "OK");
  assert.equal(status(() => alcanceDelHorario(conLlave("DOCTOR"), "yo")), "OK");
  assert.equal(status(() => alcanceDelHorario(conLlave("DOCTOR"), "doc-a")), 403);
  assert.equal(status(() => alcanceDelHorario(conLlave("READONLY"), "doc-a")), 403);
  assert.equal(status(() => alcanceDelHorario(conLlave("ADMIN"), "")), 400);
  // RECEPTIONIST no tiene la llave por defecto; si el SUPER_ADMIN se la da,
  // trabaja como la administración (mismo criterio que los bloqueos).
  assert.equal(status(() => alcanceDelHorario({ role: "RECEPTIONIST", userId: "r", puedeGestionar: false }, "doc-a")), 403);
  assert.equal(status(() => alcanceDelHorario(conLlave("RECEPTIONIST"), "doc-a")), "OK");
  // Sin la llave, ni siquiera el propio.
  assert.equal(status(() => alcanceDelHorario({ role: "DOCTOR", userId: "yo", puedeGestionar: false }, "yo")), 403);
});

test("Configuración: el DOCTOR entra SOLO a la pestaña de horarios; el resto, como hoy", () => {
  const doctor = accesoAAjustes({ role: "DOCTOR", permissionsOverride: [] });
  assert.deepEqual(doctor, { entra: true, completo: false, pestanas: [PESTANA_HORARIOS], denegadoPor: null });
  // Un ?tab=facturacion en la URL no le abre otra cosa.
  assert.equal(pestanaInicial(doctor, "facturacion"), PESTANA_HORARIOS);
  assert.equal(pestanaInicial(doctor, undefined), PESTANA_HORARIOS);

  const admin = accesoAAjustes({ role: "ADMIN", permissionsOverride: [] });
  assert.deepEqual(admin, { entra: true, completo: true, pestanas: null, denegadoPor: null });
  assert.equal(pestanaInicial(admin, "facturacion"), "facturacion");

  // Recepción no tiene ni settings.view ni la llave: rebota como hoy.
  const recepcion = accesoAAjustes({ role: "RECEPTIONIST", permissionsOverride: [] });
  assert.equal(recepcion.entra, false);
  assert.equal(rutaDeRebote(recepcion), "/dashboard?denied=settings.view");

  // Un doctor al que le quitaron la llave, tampoco entra.
  const sinLlave = accesoAAjustes({ role: "DOCTOR", permissionsOverride: ["agenda.view"] });
  assert.equal(sinLlave.entra, false);
  // Y a recepción con la llave concedida, la puerta estrecha.
  const recepcionConLlave = accesoAAjustes({ role: "RECEPTIONIST", permissionsOverride: ["agenda.view", "agenda.bloqueos"] });
  assert.deepEqual(recepcionConLlave.pestanas, [PESTANA_HORARIOS]);
});
