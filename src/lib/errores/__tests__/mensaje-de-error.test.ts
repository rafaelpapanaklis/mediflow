/**
 * UN SOLO TRADUCTOR DE ERRORES DE LA API (12j, ticket 3 de BEVADENT).
 *
 * Run: npm run test:mensaje-de-error
 *
 * El toast de adjuntar a una nota decía «upload_failed»; otros decían
 * «Unauthorized», «invalid_payload», «internal_error». Ahora todo pasa por
 * `mensajeDeError`, con el mapa en el diccionario (es y en).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CODIGOS_DE_ERROR,
  FRASES_EN_INGLES,
  mensajeDeError,
  mensajeDeRespuesta,
  pareceCodigo,
} from "../mensaje-de-error";

const dicc = (lang: string) =>
  JSON.parse(readFileSync(join(process.cwd(), "src", "i18n", "dictionaries", `${lang}.json`), "utf8"));
const ES = dicc("es");
const EN = dicc("en");
const hoja = (d: any, ruta: string): string | undefined => ruta.split(".").reduce((o, k) => o?.[k], d);
const tEs = (k: string) => hoja(ES, k) ?? `«${k}»`;
const tEn = (k: string) => hoja(EN, k) ?? `«${k}»`;

test("todas las llaves del mapa existen en es y en, y las dos lenguas tienen las MISMAS llaves", () => {
  const llaves = new Set([...Object.values(CODIGOS_DE_ERROR), ...Object.values(FRASES_EN_INGLES), "generico", "fallo", "datosInvalidos", "noEncontrado", "interno"]);
  for (const llave of llaves) {
    assert.ok(hoja(ES, `errores.${llave}`), `es: falta errores.${llave}`);
    assert.ok(hoja(EN, `errores.${llave}`), `en: falta errores.${llave}`);
  }
  assert.deepEqual(Object.keys(ES.errores).sort(), Object.keys(EN.errores).sort());
  for (const k of Object.keys(ES.errores)) assert.notEqual(ES.errores[k], EN.errores[k], `${k} está sin traducir al inglés`);
});

test("los códigos que BEVADENT vio salen en español claro, nunca el código", () => {
  const vistos = ["upload_failed", "attach_failed", "Unauthorized", "unauthorized", "invalid_payload", "internal_error", "not_found", "patient_not_found", "forbidden", "Forbidden", "invalid_json", "resource_not_found", "schema_not_migrated", "slot_taken", "appointment_overlap", "send_failed"];
  for (const codigo of vistos) {
    const m = mensajeDeError(codigo, tEs);
    assert.notEqual(m, codigo);
    assert.ok(!pareceCodigo(m), `«${m}» sigue pareciendo un código`);
    assert.ok(/[a-záéíóú]/.test(m) && m.includes(" "), `«${m}» no es una frase`);
  }
  assert.match(mensajeDeError("upload_failed", tEs), /No se pudo subir el archivo/);
  assert.match(mensajeDeError("Unauthorized", tEs), /sesión/);
  assert.match(mensajeDeError("forbidden", tEs), /permiso/);
});

test("en inglés, los mismos códigos salen en inglés", () => {
  assert.match(mensajeDeError("upload_failed", tEn), /couldn't be uploaded/);
  assert.match(mensajeDeError("Unauthorized", tEn), /session/);
});

test("un Error de un catch se traduce igual que el código suelto (`throw new Error(body.error)`)", () => {
  assert.equal(mensajeDeError(new Error("upload_failed"), tEs), mensajeDeError("upload_failed", tEs));
  assert.equal(mensajeDeError(new Error("upload_failed(abc123): timeout"), tEs), mensajeDeError("upload_failed", tEs));
});

test("el cuerpo JSON de la respuesta también: { error } y, si trae, el `reason` legible manda", () => {
  assert.equal(mensajeDeError({ error: "invalid_payload" }, tEs), tEs("errores.datosInvalidos"));
  const reason = "Ese profesional no recibe citas. Elige a otro.";
  assert.equal(mensajeDeError({ error: "doctor_not_found", reason }, tEs), reason);
});

test("doctor_not_found sin `reason` NO se enseña crudo (la frase buena la manda la Agenda en `reason`)", () => {
  const m = mensajeDeError("doctor_not_found", tEs);
  assert.notEqual(m, "doctor_not_found");
  assert.ok(!pareceCodigo(m));
});

test("una frase que ya escribió una persona se respeta; las frases HTTP en inglés se traducen", () => {
  assert.equal(mensajeDeError("Paciente no encontrado", tEs), "Paciente no encontrado");
  assert.equal(mensajeDeError("El monto excede el saldo pendiente", tEs), "El monto excede el saldo pendiente");
  assert.equal(mensajeDeError("Not found", tEs), tEs("errores.noEncontrado"));
  assert.equal(mensajeDeError("Internal Server Error", tEs), tEs("errores.interno"));
  assert.equal(mensajeDeError("Failed to fetch", tEs), tEs("errores.red"));
  assert.equal(mensajeDeError(new TypeError("Failed to fetch"), tEs), tEs("errores.red"));
});

test("un código que no conocemos NUNCA se enseña: estado HTTP, luego lo de la pantalla, luego lo genérico", () => {
  assert.equal(mensajeDeError("algo_raro_nuevo", tEs, { estado: 500 }), tEs("errores.interno"));
  assert.equal(mensajeDeError("algo_raro_nuevo", tEs, { estado: 403 }), tEs("errores.permiso"));
  assert.equal(mensajeDeError("algo_raro_nuevo", tEs, { porDefecto: "No se pudo guardar la nota." }), "No se pudo guardar la nota.");
  assert.equal(mensajeDeError("algo_raro_nuevo", tEs), tEs("errores.generico"));
});

test("por su forma: missing_*/invalid_* → datos; *_not_found → no encontrado; *_failed → fallo", () => {
  assert.equal(mensajeDeError("missing_foo", tEs), tEs("errores.datosInvalidos"));
  assert.equal(mensajeDeError("invalid_algo", tEs), tEs("errores.datosInvalidos"));
  assert.equal(mensajeDeError("cosa_not_found", tEs), tEs("errores.noEncontrado"));
  assert.equal(mensajeDeError("cosa_failed", tEs), tEs("errores.fallo"));
});

test("sin nada útil: un Error con mensaje vacío (new Error(undefined)) o null usan lo de la pantalla — nunca un toast vacío", () => {
  assert.equal(mensajeDeError(new Error(undefined as any), tEs, { porDefecto: "No se pudo subir el archivo." }), "No se pudo subir el archivo.");
  assert.equal(mensajeDeError(null, tEs), tEs("errores.generico"));
  assert.equal(mensajeDeError(undefined, tEs, { porDefecto: "  " }), tEs("errores.generico"));
});

test("mensajeDeRespuesta lee el cuerpo y respalda con el estado cuando no hay JSON", async () => {
  const conCuerpo = { status: 400, json: async () => ({ error: "invalid_payload" }) };
  assert.equal(await mensajeDeRespuesta(conCuerpo, tEs), tEs("errores.datosInvalidos"));
  const sinJson = { status: 502, json: async () => { throw new SyntaxError("Unexpected token <"); } };
  assert.equal(await mensajeDeRespuesta(sinJson, tEs), tEs("errores.interno"));
  assert.equal(await mensajeDeRespuesta({ status: 404, json: async () => ({}) }, tEs, "No se pudo."), tEs("errores.noEncontrado"));
});

// ── Las pantallas principales no enseñan el código crudo ────────────────────

const PANTALLAS = [
  "app/dashboard/patients/[id]/patient-detail-client.tsx",
  "app/dashboard/appointments/appointments-client.tsx",
  "app/dashboard/appointments/booking-requests-panel.tsx",
  "app/dashboard/xrays/xrays-client.tsx",
  "app/dashboard/treatments/treatments-client.tsx",
  "app/dashboard/billing/billing-client.tsx",
  "components/dashboard/agenda-nueva/panel-cita.tsx",
  "components/dashboard/agenda/agenda-detail-panel.tsx",
  "components/dashboard/agenda/agenda-appointment-card.tsx",
  "components/dashboard/billing/invoice-detail-modal.tsx",
  "components/dashboard/billing/payment-modal.tsx",
  "components/dashboard/billing/modal-registrar-anticipo.tsx",
  "components/dashboard/billing/modal-pedir-anticipo.tsx",
  "components/dashboard/billing/cobrar-en-factura.tsx",
  "components/dashboard/patient-detail/patient-photos-tab.tsx",
  "components/dashboard/patient-detail/note-detail-modal.tsx",
  "components/dashboard/patient-detail/treatments-modal.tsx",
  "components/dashboard/nota-evolucion/nota-evolucion-panel.tsx",
  "components/dashboard/new-patient-modal.tsx",
  "components/dashboard/factura-un-popup/use-cobro.ts",
];

test("agenda, ficha, cobros y subidas: ningún toast.error pinta `err.message`/`x.error` a pelo — todos pasan por mensajeDeError", () => {
  const CRUDO = /toast\.error\(\s*(?:\w+\??\.(?:message|error)\b|\w+ instanceof Error \? \w+\.message)/;
  for (const rel of PANTALLAS) {
    const texto = readFileSync(join(process.cwd(), "src", rel), "utf8");
    const lineas = texto.split("\n").filter((l) => CRUDO.test(l));
    assert.deepEqual(lineas, [], `${rel} enseña un error crudo:\n${lineas.join("\n")}`);
    assert.ok(texto.includes("mensajeDeError"), `${rel} no usa mensajeDeError`);
  }
});

test("el toast de adjuntar a la nota (el «upload_failed» del ticket) pasa por el traductor", () => {
  const texto = readFileSync(join(process.cwd(), "src", "app/dashboard/patients/[id]/patient-detail-client.tsx"), "utf8");
  assert.match(texto, /mensajeDeError\(err, t, \{ porDefecto: t\("patients\.attach\.failed"\) \}\)/);
});
