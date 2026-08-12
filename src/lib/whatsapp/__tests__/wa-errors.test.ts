// Error de la Graph API + traducción del motivo — puro, sin red ni BD.
//   npm run test:wa-errors

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WhatsAppApiError,
  parseWaError,
  formatWaErrorMessage,
  isTokenRevoked,
  isBillingError,
  WA_ERROR_CODE,
} from "../errors";
import {
  describeReminderError,
  describeReminderErrorCode,
  describeReminderFailure,
} from "../reminder-error";

/* ─────────────── parseWaError ─────────────── */

test("parseWaError saca código, subcódigo y título del sobre de Meta", () => {
  const err = parseWaError(
    {
      error: {
        message: "Message failed to send because more than 24 hours have passed",
        type: "OAuthException",
        code: 131047,
        error_subcode: 2494010,
        error_user_title: "Re-engagement message",
      },
    },
    400,
  );
  assert.equal(err.code, 131047);
  assert.equal(err.subcode, 2494010);
  assert.equal(err.title, "Re-engagement message");
  assert.equal(err.httpStatus, 400);
});

test("parseWaError sobrevive a un cuerpo que no es el JSON esperado", () => {
  // Meta responde HTML en los 502 de su gateway: ahí el único dato es el HTTP.
  const err = parseWaError({}, 502);
  assert.equal(err.code, null);
  assert.match(err.message, /502/);

  const err2 = parseWaError(null, 500);
  assert.equal(err2.code, null);
  assert.ok(err2 instanceof WhatsAppApiError);
});

test("parseWaError acepta el código como string (Meta no es consistente)", () => {
  const err = parseWaError({ error: { message: "x", code: "190" } }, 401);
  assert.equal(err.code, 190);
});

test("el error sigue siendo un Error normal: los callers que leen .message no cambian", () => {
  const err = parseWaError({ error: { message: "algo falló", code: 131026 } }, 400);
  assert.ok(err instanceof Error);
  assert.equal(typeof err.message, "string");
});

/* ─────────────── formatWaErrorMessage ─────────────── */

test("el código se incrusta en el texto (es lo único que guarda errorMsg)", () => {
  assert.equal(formatWaErrorMessage(131047, "fuera de ventana"), "(#131047) fuera de ventana");
});

test("no se duplica el código si Meta ya lo trae en el texto", () => {
  const raw = "(#131047) Message failed to send";
  assert.equal(formatWaErrorMessage(131047, raw), raw);
});

test("sin código el texto pasa tal cual, y un texto vacío no deja el mensaje en blanco", () => {
  assert.equal(formatWaErrorMessage(null, "algo"), "algo");
  assert.equal(formatWaErrorMessage(null, "   "), "Error al enviar el mensaje");
});

/* ─────────────── decisiones por código ─────────────── */

test("isTokenRevoked solo dispara con 190 o un 401 HTTP", () => {
  assert.equal(isTokenRevoked(parseWaError({ error: { code: 190, message: "x" } }, 400)), true);
  assert.equal(isTokenRevoked(parseWaError({ error: { code: 1, message: "x" } }, 401)), true);
  // Apagar waConnected deja a la clínica sin envíos: no puede dispararlo
  // cualquier fallo. Un 131047 es de ESE mensaje, no de la sesión.
  assert.equal(isTokenRevoked(parseWaError({ error: { code: 131047, message: "x" } }, 400)), false);
  assert.equal(isTokenRevoked(new Error("boom")), false);
  assert.equal(isTokenRevoked(null), false);
});

test("isBillingError distingue el 131042 de la clínica sin tarjeta", () => {
  const billing = parseWaError({ error: { code: WA_ERROR_CODE.BILLING_REQUIRED, message: "x" } }, 400);
  assert.equal(isBillingError(billing), true);
  assert.equal(isBillingError(parseWaError({ error: { code: 131047, message: "x" } }, 400)), false);
});

/* ─────────────── traducción del motivo ─────────────── */

test("el código manda sobre el texto", () => {
  assert.equal(describeReminderErrorCode(131047), "outside24h");
  assert.equal(describeReminderErrorCode(190), "tokenExpired");
  assert.equal(describeReminderErrorCode(131026), "undeliverable");
  assert.equal(describeReminderErrorCode(131042), "billingRequired");
  assert.equal(describeReminderErrorCode(132000), "templateRejected");
  assert.equal(describeReminderErrorCode(132001), "templateRejected");
});

test("un código desconocido no se inventa un motivo", () => {
  assert.equal(describeReminderErrorCode(999999), null);
  assert.equal(describeReminderErrorCode(null), null);
  assert.equal(describeReminderErrorCode(undefined), null);
});

test("describeReminderFailure prefiere el código aunque el texto diga otra cosa", () => {
  const key = describeReminderFailure({
    code: 131042,
    errorMsg: "más de 24 horas / more than 24 hours have passed",
  });
  assert.equal(key, "billingRequired");
});

test("sin código se reconoce por el texto: es el caso de las filas viejas", () => {
  assert.equal(
    describeReminderFailure({ errorMsg: "(#131047) more than 24 hours have passed" }),
    "outside24h",
  );
  assert.equal(
    describeReminderFailure({ code: null, errorMsg: "WhatsApp no conectado en la clínica" }),
    "notConnected",
  );
});

test("los motivos que escribe el propio worker ganan a las heurísticas en inglés", () => {
  assert.equal(describeReminderError("Cita cancelada, cerrada o ya iniciada antes del envío"), "apptClosed");
  assert.equal(describeReminderError("Expirado: pendiente por más de 7 días (cola detenida)"), "expired");
  assert.equal(
    describeReminderError("Fuera de la ventana de 24 h y falta configurar la plantilla de recordatorio"),
    "templateNotConfigured",
  );
});

test("sin nada reconocible devuelve null (la UI enseña el crudo, no un invento)", () => {
  assert.equal(describeReminderError("algo rarísimo"), null);
  assert.equal(describeReminderError(null), null);
  assert.equal(describeReminderFailure({}), null);
});
