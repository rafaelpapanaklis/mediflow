/**
 * EL CUERPO DEL POST — el bug que tiraba la pantalla entera, clavado.
 *
 * Run: npx tsx --test src/components/dashboard/bloqueos/__tests__/bloqueos-cuerpo-post.test.ts
 * (sin script en package.json: ese archivo no está entre las rutas de esta
 * tarea. Añadirle `test:bloqueos` es una línea, y va en el reporte.)
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 🔴 QUÉ PASÓ, Y POR QUÉ ESTE ARCHIVO EXISTE
 *
 * El formulario se programó contra el DTO de RESPUESTA (`inicio`/`fin`,
 * instantes UTC) en vez de contra el cuerpo de PETICIÓN (`desdeDia`/
 * `hastaDia`, días tecleados). Nunca funcionó: Rafael llenó el formulario
 * entero —del 22 al 23 de septiembre, día completo, Mantenimiento, con su
 * motivo— y al pulsar «Crear bloqueo» le salió `RANGO_REQUERIDO`.
 *
 * Una aserción sobre la FORMA del objeto no habría bastado: alguien puede
 * cambiar el nombre de una clave en los dos lados y seguir sin hablar el
 * mismo idioma. Así que este archivo hace el recorrido de verdad —el cuerpo
 * que arma la pantalla entra en `parseRangoTecleado`, que es EXACTAMENTE la
 * función que corre dentro de la API— y comprueba los instantes que se
 * guardarían. Si el cuerpo vuelve a desalinearse, aquí salta un throw, no un
 * `deepEqual` que se actualiza sin pensar.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { alcanceDelBloqueo, cuerpoDeBloqueo, type RangoLocal } from "../fechas";
import { mensajeDeError, codigoDeError } from "../tipos";
import { BloqueoError, parseRangoTecleado } from "@/lib/agenda-bloqueos/core";

const MX = "America/Mexico_City";
const CLINICA = { modoDoctor: false, miDoctorId: null, doctorElegido: "" };

const rango = (r: Partial<RangoLocal>): RangoLocal => ({
  desde: "", hasta: "", diaCompleto: true, horaInicio: "09:00", horaFin: "14:00", ...r,
});

/* ─────────────────── 1 · las claves, que son el bug ─────────────────── */

test("🔴 el cuerpo lleva desdeDia/hastaDia, NUNCA inicio/fin", () => {
  const cuerpo = cuerpoDeBloqueo(
    rango({ desde: "2026-09-22", hasta: "2026-09-23" }),
    CLINICA,
  )!;

  assert.equal(cuerpo.desdeDia, "2026-09-22");
  assert.equal(cuerpo.hastaDia, "2026-09-23");

  // Y lo que NO puede volver: las claves del DTO de respuesta.
  const claves = Object.keys(cuerpo);
  assert.ok(!claves.includes("inicio"), `«inicio» volvió al cuerpo: ${claves.join(", ")}`);
  assert.ok(!claves.includes("fin"), `«fin» volvió al cuerpo: ${claves.join(", ")}`);
  assert.ok(!claves.includes("diaCompleto"), "«diaCompleto» no es del cuerpo: las horas lo dicen");

  // Nada de instantes UTC: un día tecleado es `YYYY-MM-DD` y nada más.
  for (const v of [cuerpo.desdeDia, cuerpo.hastaDia]) {
    assert.match(v, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!v.includes("T") && !v.includes("Z"), `«${v}» parece un instante, no un día`);
  }
});

test("🔴 el servidor ENTIENDE ese cuerpo: del 22 al 23, día completo", () => {
  const cuerpo = cuerpoDeBloqueo(
    rango({ desde: "2026-09-22", hasta: "2026-09-23" }),
    CLINICA,
  )!;

  // La misma función que corre dentro de POST /api/settings/bloqueos.
  const { startsAt, endsAt, diaCompleto } = parseRangoTecleado(cuerpo, MX);

  assert.equal(diaCompleto, true);
  assert.equal(startsAt.toISOString(), "2026-09-22T06:00:00.000Z"); // 00:00 en México (CST = UTC-6 todo el año desde 2022)
  // «Hasta el 23» cubre el 23 ENTERO: el corte exclusivo es la medianoche
  // del 24. Con el corte en el 23 el bloqueo acabaría un día antes de lo que
  // dice la pantalla y el 23 la agenda se abriría sola.
  assert.equal(endsAt.toISOString(), "2026-09-24T06:00:00.000Z");
});

test("🔴 y con horas: el 22 de 14:00 a 16:00 son dos horas de ese día", () => {
  const cuerpo = cuerpoDeBloqueo(
    rango({ desde: "2026-09-22", diaCompleto: false, horaInicio: "14:00", horaFin: "16:00" }),
    CLINICA,
  )!;

  assert.equal(cuerpo.desdeDia, "2026-09-22");
  assert.equal(cuerpo.hastaDia, "2026-09-22"); // por horas es de UN día
  assert.equal(cuerpo.desdeHora, "14:00");
  assert.equal(cuerpo.hastaHora, "16:00");

  const { startsAt, endsAt, diaCompleto } = parseRangoTecleado(cuerpo, MX);
  assert.equal(diaCompleto, false);
  assert.equal(startsAt.toISOString(), "2026-09-22T20:00:00.000Z");
  assert.equal(endsAt.toISOString(), "2026-09-22T22:00:00.000Z");
});

test("el cuerpo de día completo NO lleva las horas: media pareja es un 400", () => {
  const cuerpo = cuerpoDeBloqueo(rango({ desde: "2026-09-22", hasta: "2026-09-23" }), CLINICA)!;
  assert.equal("desdeHora" in cuerpo, false);
  assert.equal("hastaHora" in cuerpo, false);
  // Y el servidor lo lee como día completo, que es lo que se pidió.
  assert.equal(parseRangoTecleado(cuerpo, MX).diaCompleto, true);
});

test("la hora se normaliza a HH:MM antes de viajar", () => {
  const cuerpo = cuerpoDeBloqueo(
    rango({ desde: "2026-09-22", diaCompleto: false, horaInicio: "9:00", horaFin: "11:30" }),
    CLINICA,
  )!;
  assert.equal(cuerpo.desdeHora, "09:00");
  assert.equal(cuerpo.hastaHora, "11:30");
  assert.equal(parseRangoTecleado(cuerpo, MX).startsAt.toISOString(), "2026-09-22T15:00:00.000Z");
});

test("un día suelto: sin «Hasta», el servidor cierra ese día y ni un minuto más", () => {
  const cuerpo = cuerpoDeBloqueo(rango({ desde: "2026-09-22" }), CLINICA)!;
  assert.equal(cuerpo.hastaDia, "2026-09-22");
  const { startsAt, endsAt } = parseRangoTecleado(cuerpo, MX);
  assert.equal(startsAt.toISOString(), "2026-09-22T06:00:00.000Z");
  assert.equal(endsAt.toISOString(), "2026-09-23T06:00:00.000Z");
});

/* ─────────────── 2 · la zona la pone el SERVIDOR, no el navegador ────── */

test("🔴 el MISMO cuerpo da instantes distintos en Tijuana: por eso no convierte el navegador", () => {
  const cuerpo = cuerpoDeBloqueo(rango({ desde: "2026-09-22" }), CLINICA)!;

  const mx = parseRangoTecleado(cuerpo, MX).startsAt.toISOString();
  const tj = parseRangoTecleado(cuerpo, "America/Tijuana").startsAt.toISOString();
  const madrid = parseRangoTecleado(cuerpo, "Europe/Madrid").startsAt.toISOString();

  assert.equal(mx, "2026-09-22T06:00:00.000Z");   // CST, UTC-6
  assert.equal(tj, "2026-09-22T07:00:00.000Z");   // PDT, UTC-7
  assert.equal(madrid, "2026-09-21T22:00:00.000Z"); // CEST, UTC+2 — el día ANTERIOR en UTC
  assert.notEqual(mx, tj);
  // El cuerpo es el mismo en los tres: quien decide es la zona de la CLÍNICA,
  // que solo el servidor conoce. Si la pantalla convirtiera, un doctor en
  // Cancún con el portátil en hora de Madrid cerraría ocho horas corridas.
});

/* ───────────────────────── 3 · a quién cierra ────────────────────────── */

test("🔴 el DOCTOR manda su propio id: omitirlo le da 403", () => {
  const doc = { modoDoctor: true, miDoctorId: "u-doc-1", doctorElegido: "" };
  assert.equal(alcanceDelBloqueo(doc), "u-doc-1");

  const cuerpo = cuerpoDeBloqueo(rango({ desde: "2026-09-22" }), doc)!;
  assert.equal(cuerpo.doctorId, "u-doc-1");
  // La clave viaja SIEMPRE: `resolverAlcance` lee «sin doctorId» como «toda
  // la clínica», y eso a un DOCTOR le devuelve ALCANCE_NO_PERMITIDO.
  assert.ok("doctorId" in cuerpo);
});

test("el admin manda null para la clínica entera, y el id cuando elige a alguien", () => {
  assert.equal(alcanceDelBloqueo(CLINICA), null);
  assert.equal(
    alcanceDelBloqueo({ modoDoctor: false, miDoctorId: null, doctorElegido: "u-doc-2" }),
    "u-doc-2",
  );
  const cuerpo = cuerpoDeBloqueo(rango({ desde: "2026-09-22" }), CLINICA)!;
  assert.equal(cuerpo.doctorId, null);
});

test("quien no es admin ni doctor (recepción con el permiso) sigue cerrando la clínica", () => {
  // `modoDoctor` es «no es admin», que también cubre a recepción con
  // `agenda.bloqueos` concedido a mano. Sin id de doctor, `null`: el servidor
  // se lo acepta por `esAdministrativo`, y colgarle su propio id le haría el
  // bloqueo como si fuera un doctor.
  assert.equal(alcanceDelBloqueo({ modoDoctor: true, miDoctorId: null, doctorElegido: "" }), null);
});

/* ─────────────── 4 · lo que la pantalla NO manda al servidor ─────────── */

test("un rango imposible no llega a viajar", () => {
  const no = (r: Partial<RangoLocal>) => assert.equal(cuerpoDeBloqueo(rango(r), CLINICA), null);
  no({ desde: "" });                                              // sin empezar
  no({ desde: "2026-13-01" });                                    // mes 13
  no({ desde: "2026-02-30" });                                    // no existe
  no({ desde: "2026-09-23", hasta: "2026-09-22" });               // invertido
  no({ desde: "2026-09-22", diaCompleto: false, horaInicio: "16:00", horaFin: "14:00" });
  no({ desde: "2026-09-22", diaCompleto: false, horaInicio: "14:00", horaFin: "14:00" }); // cero minutos
  no({ desde: "2026-09-22", diaCompleto: false, horaInicio: "", horaFin: "16:00" });
});

/* ─────────────────── 5 · el error se lee, no se descifra ─────────────── */

test("🔴 se pinta el `mensaje`, jamás el código", () => {
  // Lo que de verdad devuelve `respuestaDeError` para el bug de arriba.
  const cuerpo400 = {
    error: "RANGO_REQUERIDO",
    mensaje: "Elige el día en que empieza el bloqueo y el último día que cubre.",
  };
  assert.equal(mensajeDeError(cuerpo400, "respaldo"), cuerpo400.mensaje);
  assert.notEqual(mensajeDeError(cuerpo400, "respaldo"), "RANGO_REQUERIDO");

  // El 503 de la tabla sin crear trae su propio mensaje, y también se lee.
  const cuerpo503 = {
    error: "SQL_PENDIENTE",
    mensaje:
      "Los bloqueos de agenda todavía no están activados en esta base. " +
      "Falta aplicar sql/agenda-bloqueos.sql; avisa a soporte.",
  };
  assert.equal(mensajeDeError(cuerpo503, "respaldo"), cuerpo503.mensaje);

  // Sin `mensaje` cae al texto de i18n — NUNCA al código.
  assert.equal(mensajeDeError({ error: "SIN_PERMISO" }, "No se pudo crear el bloqueo"),
    "No se pudo crear el bloqueo");
  assert.equal(mensajeDeError({ error: "X", mensaje: "   " }, "respaldo"), "respaldo");
  assert.equal(mensajeDeError(null, "respaldo"), "respaldo");
  assert.equal(mensajeDeError("texto suelto", "respaldo"), "respaldo");
  assert.equal(mensajeDeError({ mensaje: 42 }, "respaldo"), "respaldo");
});

test("el código sigue disponible para DECIDIR, en su propia función", () => {
  assert.equal(codigoDeError({ error: "SQL_PENDIENTE", mensaje: "…" }), "SQL_PENDIENTE");
  assert.equal(codigoDeError({ mensaje: "…" }), null);
  assert.equal(codigoDeError(null), null);
});

test("el `mensaje` que el servidor manda de verdad llega entero desde su error", () => {
  // Sin mocks: se provoca el error REAL y se comprueba que lo que
  // `respuestaDeError` pondría en `mensaje` es una frase, no un código.
  let capturado: BloqueoError | null = null;
  try {
    parseRangoTecleado({}, MX);
  } catch (err) {
    capturado = err as BloqueoError;
  }
  assert.ok(capturado instanceof BloqueoError);
  assert.equal(capturado!.codigo, "RANGO_REQUERIDO");
  // Este es el cuerpo exacto que arma `respuestaDeError` (ruta.server.ts:73).
  const cuerpo = { error: capturado!.codigo, mensaje: capturado!.message };
  assert.equal(mensajeDeError(cuerpo, "respaldo"), capturado!.message);
  assert.ok(capturado!.message.length > 20, "el mensaje tiene que ser una frase");
  assert.ok(!/^[A-Z_]+$/.test(capturado!.message), "el mensaje no puede ser un código");
});
