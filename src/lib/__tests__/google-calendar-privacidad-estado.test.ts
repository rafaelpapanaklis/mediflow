/**
 * Google Calendar — privacidad del evento, estado de la conexión y revocación
 * (auditoría ws1-t2: huecos #4, #5, #6 y #9). Sin red: clientes y bases falsos.
 *
 * `npx tsx --test src/lib/__tests__/google-calendar-privacidad-estado.test.ts`
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { armarContenidoEventoGoogle, nombreCortoParaTitulo } from "../google-calendar-contenido";
import {
  esErrorDeAutorizacionGoogle, esTablaDeGoogleAusente, estadoConexionGoogle, guardarInvitarPaciente,
  leerAjustesGoogle, limpiarGoogleCaido, marcarGoogleCaido, AJUSTES_GOOGLE_POR_DEFECTO,
  type DbEstadoGoogle,
} from "../google-calendar-estado";
import { revocarTokensGoogle } from "../google-calendar-revocar";

/* ── #5 · qué viaja a Google ─────────────────────────────────────────── */

const cita = {
  type: "Limpieza",
  patientName: "Ana García López",
  doctorName: "Dr. Pérez",
  doctorEmail: "doc@clinica.mx",
  patientEmail: "ana@correo.mx",
  clinicName: "Clínica Sonrisa",
  clinicAddress: "Av. Reforma 123, CDMX",
};

test("las notas internas NUNCA viajan, ni aunque alguien las cuele en el objeto", () => {
  const notas = "Paciente con VIH, no decirle a la familia";
  const c = armarContenidoEventoGoogle({ ...cita, notes: notas } as any);
  const todo = JSON.stringify(c);
  assert.ok(!todo.includes("VIH"), "las notas no pueden aparecer en ningún campo del evento");
  assert.ok(!/notas/i.test(c.description), "ni siquiera una línea «Notas:»");
});

test("la descripción lleva solo tipo, doctor, clínica y dirección", () => {
  const c = armarContenidoEventoGoogle(cita);
  assert.equal(
    c.description,
    ["Tipo: Limpieza", "Doctor/a: Dr. Pérez", "Clínica: Clínica Sonrisa", "Dirección: Av. Reforma 123, CDMX", "\nAgendado desde DaleControl"].join("\n"),
  );
  assert.equal(c.location, "Av. Reforma 123, CDMX");
});

test("el nombre completo del paciente no va en la descripción; el título lleva nombre e inicial", () => {
  const c = armarContenidoEventoGoogle(cita);
  assert.ok(!c.description.includes("García"));
  assert.ok(!c.summary.includes("García"));
  assert.equal(c.summary, "🏥 Limpieza — Ana L.");
});

test("nombreCortoParaTitulo: una palabra, vacío y acentos", () => {
  assert.equal(nombreCortoParaTitulo("Ana"), "Ana");
  assert.equal(nombreCortoParaTitulo("  "), "Paciente");
  assert.equal(nombreCortoParaTitulo("José Ñandú"), "José Ñ.");
});

test("sin dirección, la ubicación es el nombre de la clínica y no hay línea de dirección", () => {
  const c = armarContenidoEventoGoogle({ ...cita, clinicAddress: null });
  assert.equal(c.location, "Clínica Sonrisa");
  assert.ok(!c.description.includes("Dirección"));
});

test("interruptor «invitar al paciente»: por defecto invita (como hoy); apagado solo queda el doctor", () => {
  assert.deepEqual(armarContenidoEventoGoogle(cita).attendees, [{ email: "doc@clinica.mx" }, { email: "ana@correo.mx" }]);
  assert.deepEqual(armarContenidoEventoGoogle({ ...cita, invitarPaciente: true }).attendees.length, 2);
  assert.deepEqual(armarContenidoEventoGoogle({ ...cita, invitarPaciente: false }).attendees, [{ email: "doc@clinica.mx" }]);
});

test("correos vacíos, inválidos o repetidos no entran como invitados", () => {
  const c = armarContenidoEventoGoogle({ ...cita, doctorEmail: "no-es-correo", patientEmail: "ana@correo.mx" });
  assert.deepEqual(c.attendees, [{ email: "ana@correo.mx" }]);
  const d = armarContenidoEventoGoogle({ ...cita, doctorEmail: "Ana@Correo.mx", patientEmail: "ana@correo.mx" });
  assert.equal(d.attendees.length, 1);
});

/* ── #4 · ¿este error es «la conexión murió»? ────────────────────────── */

test("invalid_grant y permiso revocado cuentan como conexión perdida", () => {
  assert.ok(esErrorDeAutorizacionGoogle({ response: { data: { error: "invalid_grant", error_description: "Token has been expired or revoked." } } }));
  assert.ok(esErrorDeAutorizacionGoogle(new Error("invalid_grant")));
  assert.ok(esErrorDeAutorizacionGoogle({ message: "Token has been expired or revoked." }));
  assert.ok(esErrorDeAutorizacionGoogle({ response: { status: 401, data: {} } }));
  assert.ok(esErrorDeAutorizacionGoogle({ code: 401 }));
  assert.ok(esErrorDeAutorizacionGoogle({ response: { status: 403, data: { error: { errors: [{ reason: "insufficientPermissions" }] } } } }));
  assert.ok(esErrorDeAutorizacionGoogle({ response: { status: 400, data: { error: "invalid_client" } } }));
});

test("un fallo pasajero NO marca la conexión como caída (cuota, 5xx, red, 404)", () => {
  assert.ok(!esErrorDeAutorizacionGoogle({ response: { status: 403, data: { error: { errors: [{ reason: "rateLimitExceeded" }] } } } }));
  assert.ok(!esErrorDeAutorizacionGoogle({ response: { status: 403, data: { error: { errors: [{ reason: "quotaExceeded" }] } } } }));
  assert.ok(!esErrorDeAutorizacionGoogle({ response: { status: 500, data: {} } }));
  assert.ok(!esErrorDeAutorizacionGoogle({ response: { status: 404, data: {} } }));
  assert.ok(!esErrorDeAutorizacionGoogle(new Error("socket hang up")));
  assert.ok(!esErrorDeAutorizacionGoogle(null));
  assert.ok(!esErrorDeAutorizacionGoogle(undefined));
});

/* ── #4 · marcar / limpiar / leer, con una base falsa ─────────────────── */

function baseFalsa(opts: { sinTabla?: boolean; falla?: boolean } = {}) {
  const llamadas: { tipo: string; sql: string; valores: unknown[] }[] = [];
  const apagadas: string[] = [];
  let fila: { lostAt: Date | null; lostReason: string | null; invitePatient: boolean } | null = null;
  const errTabla = () => Object.assign(new Error('relation "clinic_google_status" does not exist'), { code: "P2010", meta: { code: "42P01" } });
  const db: DbEstadoGoogle = {
    $executeRaw: async (q: TemplateStringsArray, ...v: unknown[]) => {
      const sql = q.join("?");
      llamadas.push({ tipo: "exec", sql, valores: v });
      if (opts.sinTabla) throw errTabla();
      if (opts.falla) throw new Error("pooler saturado");
      if (/INSERT INTO clinic_google_status \("clinicId", "lostAt"/.test(sql)) {
        fila = { lostAt: fila?.lostAt ?? new Date("2026-09-30T12:00:00Z"), lostReason: String(v[1]), invitePatient: fila?.invitePatient ?? true };
      } else if (/INSERT INTO clinic_google_status \("clinicId", "invitePatient"/.test(sql)) {
        fila = { lostAt: fila?.lostAt ?? null, lostReason: fila?.lostReason ?? null, invitePatient: v[1] as boolean };
      } else if (/UPDATE clinic_google_status/.test(sql) && fila) {
        fila = { ...fila, lostAt: null, lostReason: null };
      }
      return 1;
    },
    $queryRaw: async (q: TemplateStringsArray, ...v: unknown[]) => {
      llamadas.push({ tipo: "query", sql: q.join("?"), valores: v });
      if (opts.sinTabla) throw errTabla();
      if (opts.falla) throw new Error("pooler saturado");
      return fila ? [fila] : [];
    },
    clinic: { updateMany: async ({ where, data }) => { if (data.googleCalendarEnabled === false) apagadas.push(where.id); return { count: 1 }; } },
  };
  return { db, llamadas, apagadas, fila: () => fila };
}

test("marcarGoogleCaido deja fecha y motivo y apaga el sync de ESA clínica", async () => {
  const b = baseFalsa();
  await marcarGoogleCaido("cl-1", "autorizacion", b.db);
  assert.equal(b.fila()?.lostReason, "autorizacion");
  assert.ok(b.fila()?.lostAt instanceof Date);
  assert.deepEqual(b.apagadas, ["cl-1"]);
  assert.ok(b.llamadas[0].valores.includes("cl-1"), "filtra por la clínica recibida");
});

test("marcarGoogleCaido conserva la PRIMERA fecha de la caída al repetirse", async () => {
  const b = baseFalsa();
  await marcarGoogleCaido("cl-1", "autorizacion", b.db);
  const primera = b.fila()!.lostAt;
  await marcarGoogleCaido("cl-1", "permisos", b.db);
  assert.equal(b.fila()!.lostAt, primera);
  assert.equal(b.fila()!.lostReason, "permisos");
  assert.ok(/COALESCE\(clinic_google_status\."lostAt", NOW\(\)\)/.test(b.llamadas[1].sql));
});

test("sin la tabla nueva, marcar igual apaga el sync y no lanza (funciona antes del SQL)", async () => {
  const b = baseFalsa({ sinTabla: true });
  await assert.doesNotReject(marcarGoogleCaido("cl-1", "autorizacion", b.db));
  assert.deepEqual(b.apagadas, ["cl-1"]);
});

test("un fallo de la base al marcar no lanza (la cita ya se guardó; esto corre desde un catch)", async () => {
  const b = baseFalsa({ falla: true });
  await assert.doesNotReject(marcarGoogleCaido("cl-1", "autorizacion", b.db));
  assert.deepEqual(b.apagadas, [], "no apaga si ni siquiera pudo registrar");
});

test("regla (c): sin clínica no se consulta nada", async () => {
  const b = baseFalsa();
  await marcarGoogleCaido("", "x", b.db);
  await marcarGoogleCaido(undefined as any, "x", b.db);
  await limpiarGoogleCaido("  ", b.db);
  assert.equal((await leerAjustesGoogle("", b.db)).invitarPaciente, true);
  assert.equal(b.llamadas.length, 0);
  await assert.rejects(guardarInvitarPaciente("", false, b.db));
});

test("limpiarGoogleCaido borra fecha y motivo (reconectar)", async () => {
  const b = baseFalsa();
  await marcarGoogleCaido("cl-1", "autorizacion", b.db);
  await limpiarGoogleCaido("cl-1", b.db);
  assert.equal(b.fila()?.lostAt, null);
  assert.equal((await leerAjustesGoogle("cl-1", b.db)).caidoDesde, null);
});

test("leerAjustesGoogle: sin tabla y con fallo devuelve lo de siempre (invita al paciente), sin lanzar", async () => {
  assert.deepEqual(await leerAjustesGoogle("cl-1", baseFalsa({ sinTabla: true }).db), AJUSTES_GOOGLE_POR_DEFECTO);
  assert.equal((await leerAjustesGoogle("cl-1", baseFalsa({ falla: true }).db)).invitarPaciente, true);
  const sinFila = await leerAjustesGoogle("cl-1", baseFalsa().db);
  assert.equal(sinFila.invitarPaciente, true);
  assert.equal(sinFila.tablaDisponible, true);
});

test("guardarInvitarPaciente: guarda, se lee de vuelta, y sin tabla avisa con false", async () => {
  const b = baseFalsa();
  assert.equal(await guardarInvitarPaciente("cl-1", false, b.db), true);
  assert.equal((await leerAjustesGoogle("cl-1", b.db)).invitarPaciente, false);
  assert.equal(await guardarInvitarPaciente("cl-1", false, baseFalsa({ sinTabla: true }).db), false);
  await assert.rejects(guardarInvitarPaciente("cl-1", true, baseFalsa({ falla: true }).db), /pooler/);
});

test("esTablaDeGoogleAusente solo reconoce «no existe la tabla»", () => {
  assert.ok(esTablaDeGoogleAusente({ code: "42P01" }));
  assert.ok(esTablaDeGoogleAusente({ code: "P2010", meta: { code: "42P01" } }));
  assert.ok(!esTablaDeGoogleAusente(new Error("timeout")));
  assert.ok(!esTablaDeGoogleAusente(null));
});

/* ── #6 · estado de LA CLÍNICA ─────────────────────────────────────── */

test("estadoConexionGoogle: mira la clínica, no al usuario", () => {
  const sano = { ...AJUSTES_GOOGLE_POR_DEFECTO, tablaDisponible: true };
  assert.equal(estadoConexionGoogle({ googleCalendarEnabled: true, googleRefreshToken: "rt" }, sano), "conectado");
  assert.equal(estadoConexionGoogle({ googleCalendarEnabled: false, googleRefreshToken: null }, sano), "no_conectado");
  assert.equal(estadoConexionGoogle(null, sano), "no_conectado");
  assert.equal(estadoConexionGoogle(undefined, sano), "no_conectado");
});

test("estadoConexionGoogle: caída con la tabla (marca) y sin la tabla (token guardado y sync apagado)", () => {
  const conMarca = { ...AJUSTES_GOOGLE_POR_DEFECTO, tablaDisponible: true, caidoDesde: new Date() };
  assert.equal(estadoConexionGoogle({ googleCalendarEnabled: false, googleRefreshToken: null }, conMarca), "caido");
  assert.equal(estadoConexionGoogle({ googleCalendarEnabled: false, googleRefreshToken: "rt" }, AJUSTES_GOOGLE_POR_DEFECTO), "caido");
  // Reconectó (encendido) con una marca vieja que no se alcanzó a borrar: manda el encendido.
  assert.equal(estadoConexionGoogle({ googleCalendarEnabled: true, googleRefreshToken: "rt" }, conMarca), "conectado");
});

/* ── #9 · revocar al desconectar ───────────────────────────────────── */

test("revocarTokensGoogle revoca cada token distinto UNA vez", async () => {
  const vistos: string[] = [];
  const r = await revocarTokensGoogle(["rt-a", "rt-a", "rt-b", null, undefined, ""], () => ({ revokeToken: async (t) => { vistos.push(t); } }));
  assert.deepEqual(vistos.sort(), ["rt-a", "rt-b"]);
  assert.deepEqual(r, { intentados: 2, revocados: 2 });
});

test("sin tokens no llama a Google", async () => {
  let llamado = false;
  const r = await revocarTokensGoogle([null, undefined], () => { llamado = true; return { revokeToken: async () => {} }; });
  assert.equal(llamado, false);
  assert.deepEqual(r, { intentados: 0, revocados: 0 });
});

test("si Google falla, no lanza y lo cuenta como no revocado; un token ya inválido cuenta como revocado", async () => {
  const falla = await revocarTokensGoogle(["rt-a"], () => ({ revokeToken: async () => { throw new Error("ECONNRESET"); } }));
  assert.deepEqual(falla, { intentados: 1, revocados: 0 });
  const yaMuerto = await revocarTokensGoogle(["rt-a"], () => ({
    revokeToken: async () => { throw Object.assign(new Error("Invalid Credentials"), { response: { data: { error: "invalid_token" } } }); },
  }));
  assert.deepEqual(yaMuerto, { intentados: 1, revocados: 1 });
});

test("Google que no contesta no cuelga la desconexión (tope de tiempo)", async () => {
  const t0 = Date.now();
  const r = await revocarTokensGoogle(["rt-a"], () => ({ revokeToken: () => new Promise(() => {}) }), 50);
  assert.ok(Date.now() - t0 < 1000);
  assert.deepEqual(r, { intentados: 1, revocados: 0 });
});
