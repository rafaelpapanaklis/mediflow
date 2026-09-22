/**
 * LOS BLOQUEOS DE AGENDA — la lógica pura. WS1-T2.
 *
 * Lo que estas pruebas defienden, por orden de importancia:
 *  1. Que **tocar el borde NO es solapar**. Un bloqueo de 14:00 a 16:00 no
 *     estorba a una cita que empieza a las 16:00. Si esto se rompe, cerrar la
 *     mañana se come el primer hueco de la tarde y nadie sabe por qué.
 *  2. Que el ALCANCE se respeta: un bloqueo de un doctor no cierra la agenda
 *     de sus compañeros, y uno de la clínica los cierra a todos.
 *  3. Que un bloqueo RETIRADO no cuenta nunca.
 *  4. Que «del 15 al 17» incluye el 17 ENTERO, y que la conversión se hace
 *     con la zona de la CLÍNICA y no con la del dispositivo.
 *
 * Todo esto es puro: no hay base de datos, no hay excusa.
 *
 * Run: npm run test:agenda-bloqueos
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BLOQUEO_KINDS,
  BLOQUEO_KIND_LABELS,
  BLOQUEO_MAX_DIAS,
  BloqueoError,
  avisoDeBloqueo,
  bandasDelDia,
  bloqueaEsteHueco,
  bloqueaEsteSlot,
  bloqueoAlcanzaDoctor,
  esDiaCompleto,
  lineaDeBloqueo,
  parseDiaISO,
  parseKind,
  parseMinutoDelDia,
  parseMotivo,
  parseRangoTecleado,
  rangoDeDiaCompleto,
  rangosSePisan,
  sumarDiasISO,
  type AgendaBlockKind,
  type BloqueoDTO,
  type BloqueoLike,
} from "../core";

const TZ = "America/Mexico_City";
const D = (iso: string) => new Date(iso);

/** Un bloqueo de prueba. Por defecto, de toda la clínica. */
function bloqueo(p: Partial<BloqueoLike> & { startsAt: Date; endsAt: Date }): BloqueoLike {
  return {
    id: "b1",
    doctorId: null,
    kind: "OTRO",
    reason: "Motivo de prueba",
    deletedAt: null,
    ...p,
  };
}

/* ═══ 1 · EL BORDE NO SOLAPA ════════════════════════════════════════════ */

test("tocar el borde NO es solapar: 14:00–16:00 no estorba a una cita de las 16:00", () => {
  const b = [bloqueo({ startsAt: D("2026-11-12T20:00:00Z"), endsAt: D("2026-11-12T22:00:00Z") })];

  // La cita empieza EXACTAMENTE donde acaba el bloqueo: no se pisan.
  assert.equal(
    bloqueaEsteHueco(b, D("2026-11-12T22:00:00Z"), D("2026-11-12T23:00:00Z"), null),
    null,
  );
  // Y al revés: la cita acaba exactamente donde empieza el bloqueo.
  assert.equal(
    bloqueaEsteHueco(b, D("2026-11-12T19:00:00Z"), D("2026-11-12T20:00:00Z"), null),
    null,
  );
  // Un solo minuto dentro YA solapa, por los dos lados.
  assert.ok(bloqueaEsteHueco(b, D("2026-11-12T21:59:00Z"), D("2026-11-12T23:00:00Z"), null));
  assert.ok(bloqueaEsteHueco(b, D("2026-11-12T19:00:00Z"), D("2026-11-12T20:01:00Z"), null));
});

test("rangosSePisan cubre las cinco posiciones relativas", () => {
  const bi = D("2026-11-12T10:00:00Z");
  const bf = D("2026-11-12T12:00:00Z");
  const pisa = (a: string, b: string) => rangosSePisan(D(a), D(b), bi, bf);

  assert.equal(pisa("2026-11-12T08:00:00Z", "2026-11-12T09:00:00Z"), false, "antes del todo");
  assert.equal(pisa("2026-11-12T09:00:00Z", "2026-11-12T11:00:00Z"), true, "entra por la izquierda");
  assert.equal(pisa("2026-11-12T10:30:00Z", "2026-11-12T11:00:00Z"), true, "dentro");
  assert.equal(pisa("2026-11-12T09:00:00Z", "2026-11-12T13:00:00Z"), true, "lo contiene entero");
  assert.equal(pisa("2026-11-12T11:00:00Z", "2026-11-12T13:00:00Z"), true, "sale por la derecha");
  assert.equal(pisa("2026-11-12T13:00:00Z", "2026-11-12T14:00:00Z"), false, "después del todo");
});

/* ═══ 2 · EL ALCANCE ════════════════════════════════════════════════════ */

test("un bloqueo de toda la clínica (doctorId null) tapa a TODOS los doctores", () => {
  const b = [
    bloqueo({ doctorId: null, startsAt: D("2026-12-25T06:00:00Z"), endsAt: D("2026-12-26T06:00:00Z") }),
  ];
  for (const doctor of ["doc-1", "doc-2", "doc-3", null]) {
    assert.ok(
      bloqueaEsteHueco(b, D("2026-12-25T16:00:00Z"), D("2026-12-25T17:00:00Z"), doctor),
      `debería tapar a ${doctor}`,
    );
  }
});

test("un bloqueo de UN doctor tapa solo a ese doctor", () => {
  const b = [
    bloqueo({ doctorId: "doc-1", startsAt: D("2026-11-12T14:00:00Z"), endsAt: D("2026-11-12T22:00:00Z") }),
  ];
  const ini = D("2026-11-12T16:00:00Z");
  const fin = D("2026-11-12T17:00:00Z");

  assert.ok(bloqueaEsteHueco(b, ini, fin, "doc-1"), "al suyo sí");
  assert.equal(bloqueaEsteHueco(b, ini, fin, "doc-2"), null, "a su compañero NO");
  // Sin doctor concreto (la barra del Mes, una solicitud sin doctor elegido)
  // solo tapan los de toda la clínica: decir que el hueco está cerrado porque
  // UN doctor se fue de vacaciones escondería a los otros tres que atienden.
  assert.equal(bloqueaEsteHueco(b, ini, fin, null), null, "sin doctor concreto, NO");
});

test("bloqueoAlcanzaDoctor es la regla del NULL, escrita una sola vez", () => {
  assert.equal(bloqueoAlcanzaDoctor({ doctorId: null }, "doc-1"), true);
  assert.equal(bloqueoAlcanzaDoctor({ doctorId: null }, null), true);
  assert.equal(bloqueoAlcanzaDoctor({ doctorId: "doc-1" }, "doc-1"), true);
  assert.equal(bloqueoAlcanzaDoctor({ doctorId: "doc-1" }, "doc-2"), false);
  assert.equal(bloqueoAlcanzaDoctor({ doctorId: "doc-1" }, null), false);
});

/* ═══ 3 · LOS RETIRADOS NO CUENTAN ══════════════════════════════════════ */

test("un bloqueo con deletedAt no cuenta NUNCA, ni siquiera el de toda la clínica", () => {
  const b = [
    bloqueo({
      doctorId: null,
      startsAt: D("2026-11-12T14:00:00Z"),
      endsAt: D("2026-11-12T22:00:00Z"),
      deletedAt: D("2026-11-01T00:00:00Z"),
    }),
  ];
  assert.equal(
    bloqueaEsteHueco(b, D("2026-11-12T16:00:00Z"), D("2026-11-12T17:00:00Z"), "doc-1"),
    null,
  );
});

test("entre varios, gana el primero de la lista que de verdad tapa", () => {
  const b = [
    // Éste NO tapa (es de otro doctor): se salta, no gana por ser el primero.
    bloqueo({ id: "otro-doctor", doctorId: "doc-9", startsAt: D("2026-11-12T14:00:00Z"), endsAt: D("2026-11-12T22:00:00Z") }),
    bloqueo({ id: "retirado", doctorId: null, startsAt: D("2026-11-12T14:00:00Z"), endsAt: D("2026-11-12T22:00:00Z"), deletedAt: D("2026-11-01T00:00:00Z") }),
    bloqueo({ id: "el-bueno", doctorId: null, reason: "Congreso CDMX", startsAt: D("2026-11-12T15:00:00Z"), endsAt: D("2026-11-12T22:00:00Z") }),
  ];
  const r = bloqueaEsteHueco(b, D("2026-11-12T16:00:00Z"), D("2026-11-12T17:00:00Z"), "doc-1");
  assert.equal(r?.id, "el-bueno");
  assert.equal(r?.reason, "Congreso CDMX");
});

test("sin bloqueos, no bloquea nada", () => {
  assert.equal(bloqueaEsteHueco([], D("2026-11-12T16:00:00Z"), D("2026-11-12T17:00:00Z"), "doc-1"), null);
});

test("bloqueaEsteSlot es el mismo criterio con inicio + duración", () => {
  const b = [bloqueo({ startsAt: D("2026-11-12T20:00:00Z"), endsAt: D("2026-11-12T22:00:00Z") })];
  // Un slot de 30 min que empieza a las 21:45 entra 15 min en el bloqueo.
  assert.ok(bloqueaEsteSlot(b, D("2026-11-12T21:45:00Z"), 30, null));
  // Uno que empieza justo al acabar, no.
  assert.equal(bloqueaEsteSlot(b, D("2026-11-12T22:00:00Z"), 30, null), null);
  // Y uno que acaba justo al empezar, tampoco.
  assert.equal(bloqueaEsteSlot(b, D("2026-11-12T19:30:00Z"), 30, null), null);
});

/* ═══ 4 · EL RANGO QUE TECLEA UNA PERSONA ═══════════════════════════════ */

test("«del 15 al 17» incluye el 17 ENTERO: el corte es la medianoche del 18", () => {
  const { startsAt, endsAt, diaCompleto } = parseRangoTecleado(
    { desdeDia: "2026-09-15", hastaDia: "2026-09-17" },
    TZ,
  );
  assert.equal(diaCompleto, true);
  // CDMX es UTC−6 en septiembre: la medianoche local son las 06:00 UTC.
  assert.equal(startsAt.toISOString(), "2026-09-15T06:00:00.000Z");
  assert.equal(endsAt.toISOString(), "2026-09-18T06:00:00.000Z");

  // Y por tanto: una cita del 17 por la tarde SÍ queda dentro.
  const b = [bloqueo({ startsAt, endsAt })];
  assert.ok(bloqueaEsteHueco(b, D("2026-09-17T22:00:00Z"), D("2026-09-17T23:00:00Z"), null));
  // Pero una del 18 por la mañana, NO.
  assert.equal(
    bloqueaEsteHueco(b, D("2026-09-18T16:00:00Z"), D("2026-09-18T17:00:00Z"), null),
    null,
  );
});

test("un solo día completo también incluye el día entero", () => {
  const { startsAt, endsAt } = parseRangoTecleado(
    { desdeDia: "2026-12-25", hastaDia: "2026-12-25" },
    TZ,
  );
  // Diciembre: CDMX sigue en UTC−6.
  assert.equal(startsAt.toISOString(), "2026-12-25T06:00:00.000Z");
  assert.equal(endsAt.toISOString(), "2026-12-26T06:00:00.000Z");
});

test("la conversión usa la zona de la CLÍNICA, no una fija", () => {
  const cdmx = parseRangoTecleado({ desdeDia: "2026-12-25", hastaDia: "2026-12-25" }, "America/Mexico_City");
  const tijuana = parseRangoTecleado({ desdeDia: "2026-12-25", hastaDia: "2026-12-25" }, "America/Tijuana");
  // Tijuana va dos horas por detrás: su 25 empieza dos horas después.
  assert.equal(cdmx.startsAt.toISOString(), "2026-12-25T06:00:00.000Z");
  assert.equal(tijuana.startsAt.toISOString(), "2026-12-25T08:00:00.000Z");
  assert.notEqual(cdmx.startsAt.getTime(), tijuana.startsAt.getTime());
});

test("con horas, el bloqueo es de horas y no de día completo", () => {
  const { startsAt, endsAt, diaCompleto } = parseRangoTecleado(
    { desdeDia: "2026-11-12", desdeHora: "14:00", hastaDia: "2026-11-12", hastaHora: "16:00" },
    TZ,
  );
  assert.equal(diaCompleto, false);
  assert.equal(startsAt.toISOString(), "2026-11-12T20:00:00.000Z");
  assert.equal(endsAt.toISOString(), "2026-11-12T22:00:00.000Z");
});

test("media pareja de horas se rechaza en vez de adivinar", () => {
  // «de las 14:00 a…» ¿hasta cuándo? Adivinar «hasta el cierre» cerraría más
  // de lo que la persona pidió, y sin decírselo.
  assert.throws(
    () => parseRangoTecleado({ desdeDia: "2026-11-12", desdeHora: "14:00", hastaDia: "2026-11-12" }, TZ),
    (e: unknown) => e instanceof BloqueoError && e.codigo === "HORA_INCOMPLETA",
  );
});

test("una hora ilegible se corta en vez de ignorarse", () => {
  // Ignorarla cerraría el DÍA ENTERO cuando la persona pidió dos horas.
  assert.throws(
    () => parseRangoTecleado(
      { desdeDia: "2026-11-12", desdeHora: "las dos", hastaDia: "2026-11-12", hastaHora: "16:00" },
      TZ,
    ),
    (e: unknown) => e instanceof BloqueoError && e.codigo === "HORA_INVALIDA",
  );
});

test("el rango invertido y el rango absurdo se rechazan", () => {
  assert.throws(
    () => parseRangoTecleado({ desdeDia: "2026-11-17", hastaDia: "2026-11-15" }, TZ),
    (e: unknown) => e instanceof BloqueoError && e.codigo === "RANGO_INVERTIDO",
  );
  // Fin anterior al inicio dentro del MISMO día.
  assert.throws(
    () => parseRangoTecleado(
      { desdeDia: "2026-11-12", desdeHora: "16:00", hastaDia: "2026-11-12", hastaHora: "14:00" },
      TZ,
    ),
    (e: unknown) => e instanceof BloqueoError && e.codigo === "RANGO_INVERTIDO",
  );
  // Sin fechas.
  assert.throws(
    () => parseRangoTecleado({}, TZ),
    (e: unknown) => e instanceof BloqueoError && e.codigo === "RANGO_REQUERIDO",
  );
});

test("el dedazo de año se corta: más de un año de bloqueo no pasa", () => {
  // «2027» donde iba «2026» dejaría la agenda cerrada para siempre sin que
  // nadie entendiera por qué.
  assert.throws(
    () => parseRangoTecleado({ desdeDia: "2026-01-01", hastaDia: "2027-12-31" }, TZ),
    (e: unknown) => e instanceof BloqueoError && e.codigo === "RANGO_DEMASIADO_LARGO",
  );
  // Justo en el tope sí pasa.
  const ok = parseRangoTecleado({ desdeDia: "2026-01-01", hastaDia: "2026-12-31" }, TZ);
  const dias = (ok.endsAt.getTime() - ok.startsAt.getTime()) / 86_400_000;
  assert.ok(dias <= BLOQUEO_MAX_DIAS, `${dias} días`);
});

test("una fecha que no existe en el calendario no pasa", () => {
  assert.equal(parseDiaISO("2026-02-31"), null);
  assert.equal(parseDiaISO("2026-13-01"), null);
  assert.equal(parseDiaISO("12/11/2026"), null);
  assert.equal(parseDiaISO(""), null);
  assert.equal(parseDiaISO(null), null);
  assert.equal(parseDiaISO("2026-02-28"), "2026-02-28");
  // 2028 es bisiesto; 2026 no.
  assert.equal(parseDiaISO("2028-02-29"), "2028-02-29");
  assert.equal(parseDiaISO("2026-02-29"), null);
});

test("parseMinutoDelDia acepta horas y rechaza lo demás", () => {
  assert.equal(parseMinutoDelDia("09:30"), 570);
  assert.equal(parseMinutoDelDia("9:30"), 570);
  assert.equal(parseMinutoDelDia("00:00"), 0);
  assert.equal(parseMinutoDelDia("24:00"), 1440);
  assert.equal(parseMinutoDelDia("25:00"), null);
  assert.equal(parseMinutoDelDia("9.30"), null);
  assert.equal(parseMinutoDelDia(930), null);
});

/* ═══ 5 · EL MOTIVO ES OBLIGATORIO ══════════════════════════════════════ */

test("un hueco cerrado sin motivo es una llamada de teléfono: el motivo es obligatorio", () => {
  assert.throws(
    () => parseMotivo(""),
    (e: unknown) => e instanceof BloqueoError && e.codigo === "MOTIVO_REQUERIDO",
  );
  assert.throws(() => parseMotivo("   "), /Escribe el motivo/);
  assert.throws(() => parseMotivo("ok"), /Escribe el motivo/); // menos de 3
  assert.throws(() => parseMotivo(undefined), /Escribe el motivo/);
  assert.equal(parseMotivo("  Congreso CDMX  "), "Congreso CDMX");
  // Se recorta al tope de la columna en vez de reventar el INSERT.
  assert.equal(parseMotivo("x".repeat(500)).length, 200);
});

/* ═══ 6 · EL TIPO ═══════════════════════════════════════════════════════ */

test("parseKind normaliza y cae en OTRO ante lo desconocido", () => {
  assert.equal(parseKind("FESTIVO"), "FESTIVO");
  assert.equal(parseKind("festivo"), "FESTIVO");
  assert.equal(parseKind("  vacaciones "), "VACACIONES");
  assert.equal(parseKind("LO_QUE_SEA"), "OTRO");
  assert.equal(parseKind(42), "OTRO");
  assert.equal(parseKind(null), "OTRO");
});

test("todo kind del enum tiene etiqueta: el mapa es exhaustivo", () => {
  // Si mañana se añade un tipo al enum de Prisma y a la unión, esto obliga a
  // darle etiqueta en vez de dejar `undefined` en la pantalla.
  const mapa: Record<AgendaBlockKind, string> = BLOQUEO_KIND_LABELS;
  for (const k of BLOQUEO_KINDS) {
    assert.equal(typeof mapa[k], "string");
    assert.ok(mapa[k].length > 0, `${k} sin etiqueta`);
  }
  assert.equal(BLOQUEO_KINDS.length, 5);
});

/* ═══ 7 · LOS TEXTOS ════════════════════════════════════════════════════ */

test("el aviso al staff dice que la cita SE GUARDÓ", () => {
  // Es lo que evita que quien lea el toast crea que perdió la cita y la
  // vuelva a capturar.
  const a = avisoDeBloqueo(bloqueo({
    doctorId: null,
    kind: "FESTIVO",
    reason: "Navidad",
    startsAt: D("2026-12-25T06:00:00Z"),
    endsAt: D("2026-12-26T06:00:00Z"),
  }));
  assert.equal(a.reason, "blocked");
  assert.match(a.message, /toda la clínica/);
  assert.match(a.message, /Navidad/);
  assert.match(a.message, /se guardó de todas formas/i);
});

test("la línea de la celda del Mes dice tipo, motivo y alcance", () => {
  assert.equal(
    lineaDeBloqueo({ kind: "FESTIVO", reason: "Navidad", doctorId: null }),
    "Día festivo · Navidad · toda la clínica",
  );
  assert.equal(
    lineaDeBloqueo({ kind: "VACACIONES", reason: "Playa", doctorId: "doc-1" }),
    "Vacaciones · Playa · un doctor",
  );
});

/* ═══ 8 · LAS BANDAS DE LA REJILLA (lo que consume ws1-t3) ══════════════ */

const dto = (p: Partial<BloqueoDTO> & { inicio: string; fin: string }): BloqueoDTO => ({
  id: "b1",
  doctorId: null,
  doctorNombre: null,
  kind: "OTRO",
  reason: "Motivo",
  diaCompleto: false,
  holidayKey: null,
  creadoPor: "Quien sea",
  creadoEl: "2026-11-01T00:00:00.000Z",
  puedoRetirarlo: true,
  ...p,
});

test("una banda de horas sale en minutos de PARED del día", () => {
  // 14:00–16:00 hora de CDMX = 20:00–22:00 UTC.
  const bandas = bandasDelDia(
    [dto({ inicio: "2026-11-12T20:00:00.000Z", fin: "2026-11-12T22:00:00.000Z" })],
    "2026-11-12",
    null,
    TZ,
  );
  assert.equal(bandas.length, 1);
  assert.equal(bandas[0].desdeMinuto, 14 * 60);
  assert.equal(bandas[0].hastaMinuto, 16 * 60);
  assert.equal(bandas[0].todoElDia, false);
  assert.equal(bandas[0].vieneDeAntes, false);
  assert.equal(bandas[0].sigueDespues, false);
});

test("«sigue mañana» NO es «acaba a medianoche»", () => {
  // Un puente del 15 al 17 se guarda con el corte en las 00:00 del 18. El día
  // 17 acaba justo en el borde y NO continúa: si la flecha «→» apareciera,
  // prometería un 18 cerrado que la rejilla enseña abierto.
  const puente = dto({ inicio: "2026-09-15T06:00:00.000Z", fin: "2026-09-18T06:00:00.000Z" });

  const dia15 = bandasDelDia([puente], "2026-09-15", null, TZ)[0];
  assert.equal(dia15.todoElDia, true);
  assert.equal(dia15.vieneDeAntes, false);
  assert.equal(dia15.sigueDespues, true, "el 15 sí continúa");

  const dia17 = bandasDelDia([puente], "2026-09-17", null, TZ)[0];
  assert.equal(dia17.todoElDia, true);
  assert.equal(dia17.vieneDeAntes, true);
  assert.equal(dia17.sigueDespues, false, "el 17 acaba en el borde: NO continúa");

  // Y el 18 no tiene banda: el intervalo es semiabierto.
  assert.deepEqual(bandasDelDia([puente], "2026-09-18", null, TZ), []);
});

test("las bandas respetan el alcance cuando la columna es un doctor", () => {
  const dela = dto({ id: "suyo", doctorId: "doc-1", inicio: "2026-11-12T20:00:00.000Z", fin: "2026-11-12T22:00:00.000Z" });
  const clinica = dto({ id: "todos", doctorId: null, inicio: "2026-11-12T22:00:00.000Z", fin: "2026-11-12T23:00:00.000Z" });

  // Columna del doctor 1: ve las dos.
  assert.deepEqual(
    bandasDelDia([dela, clinica], "2026-11-12", "doc-1", TZ).map((b) => b.id),
    ["suyo", "todos"],
  );
  // Columna del doctor 2: solo la de la clínica.
  assert.deepEqual(
    bandasDelDia([dela, clinica], "2026-11-12", "doc-2", TZ).map((b) => b.id),
    ["todos"],
  );
  // Columna que es un DÍA entero (Semana, Mes): entran las dos, porque no hay
  // doctor contra el que aplicar la regla del NULL.
  assert.deepEqual(
    bandasDelDia([dela, clinica], "2026-11-12", null, TZ).map((b) => b.id),
    ["suyo", "todos"],
  );
});

test("las bandas salen ordenadas por hora de inicio", () => {
  const tarde = dto({ id: "tarde", inicio: "2026-11-12T22:00:00.000Z", fin: "2026-11-12T23:00:00.000Z" });
  const manana = dto({ id: "manana", inicio: "2026-11-12T15:00:00.000Z", fin: "2026-11-12T16:00:00.000Z" });
  assert.deepEqual(
    bandasDelDia([tarde, manana], "2026-11-12", null, TZ).map((b) => b.id),
    ["manana", "tarde"],
  );
});

test("un bloqueo de otro día no deja banda, y una fecha ilegible se ignora", () => {
  const otro = dto({ inicio: "2026-11-20T20:00:00.000Z", fin: "2026-11-20T22:00:00.000Z" });
  assert.deepEqual(bandasDelDia([otro], "2026-11-12", null, TZ), []);
  const roto = dto({ inicio: "no es una fecha", fin: "tampoco" });
  assert.deepEqual(bandasDelDia([roto], "2026-11-12", null, TZ), []);
});

/* ═══ 9 · AYUDANTES ═════════════════════════════════════════════════════ */

test("esDiaCompleto mira la hora de PARED en la zona de la clínica", () => {
  const { startsAt, endsAt } = rangoDeDiaCompleto("2026-12-25", TZ);
  assert.equal(esDiaCompleto(startsAt, endsAt, TZ), true);
  // Los MISMOS instantes vistos desde otra zona ya no son días completos.
  assert.equal(esDiaCompleto(startsAt, endsAt, "America/Tijuana"), false);
  // Un rango de horas no lo es.
  assert.equal(
    esDiaCompleto(D("2026-11-12T20:00:00Z"), D("2026-11-12T22:00:00Z"), TZ),
    false,
  );
});

test("sumarDiasISO cruza mes y año sin husos de por medio", () => {
  assert.equal(sumarDiasISO("2026-11-12", 1), "2026-11-13");
  assert.equal(sumarDiasISO("2026-11-30", 1), "2026-12-01");
  assert.equal(sumarDiasISO("2026-12-31", 1), "2027-01-01");
  assert.equal(sumarDiasISO("2027-01-01", -1), "2026-12-31");
  assert.equal(sumarDiasISO("2028-02-28", 1), "2028-02-29"); // bisiesto
});
