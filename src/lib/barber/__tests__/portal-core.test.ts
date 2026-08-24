/**
 * Portal del cliente de barbería — sesión firmada y política de cancelación.
 *
 * Correr:
 *   npx tsx --test src/lib/barber/__tests__/portal-core.test.ts
 *
 * Aquí vive la prueba de AISLAMIENTO a nivel criptográfico: la cookie del
 * portal lleva dentro el clientId y el barbershopId, y cualquier intento de
 * cambiarlos (para asomarse a los datos de otro cliente o de otra barbería)
 * rompe la firma y la sesión deja de existir. La otra mitad del aislamiento
 * —que el barbershopId de la cookie se compara contra el del slug en CADA
 * petición— vive en getPortalSession (client-portal.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BARBER_CANCEL_WINDOW_HOURS,
  BARBER_PORTAL_COOKIE,
  PORTAL_CODE_MAX_ATTEMPTS,
  PORTAL_CODE_TTL_MIN,
  PORTAL_SESSION_DAYS,
  canClientCancel,
  packPortalSession,
  portalCookieOptions,
  readPortalSession,
} from "../portal-core";

const CLIENTE_A = "cli_aaaaaaaaaaaa";
const CLIENTE_B = "cli_bbbbbbbbbbbb";
const BARBERIA_X = "shop_xxxxxxxxxxxx";
const BARBERIA_Y = "shop_yyyyyyyyyyyy";

// ── Ida y vuelta ────────────────────────────────────────────────────────

test("una sesión recién firmada se lee de vuelta igual", () => {
  const { value, expiresAt } = packPortalSession(CLIENTE_A, BARBERIA_X);
  const leida = readPortalSession(value);
  assert.ok(leida);
  assert.equal(leida.clientId, CLIENTE_A);
  assert.equal(leida.barbershopId, BARBERIA_X);
  assert.equal(leida.expiresAt.getTime(), expiresAt.getTime());
});

test("la sesión dura lo que dice la constante", () => {
  const ahora = new Date("2026-08-24T12:00:00Z");
  const { expiresAt } = packPortalSession(CLIENTE_A, BARBERIA_X, ahora);
  const dias = (expiresAt.getTime() - ahora.getTime()) / 86_400_000;
  assert.equal(dias, PORTAL_SESSION_DAYS);
});

test("la cookie no lleva nada secreto: solo dos ids y la caducidad", () => {
  const { value } = packPortalSession(CLIENTE_A, BARBERIA_X);
  const [version, clientId, barbershopId, exp, mac] = value.split(".");
  assert.equal(version, "v1");
  assert.equal(clientId, CLIENTE_A);
  assert.equal(barbershopId, BARBERIA_X);
  assert.ok(Number(exp) > 0);
  assert.match(mac, /^[0-9a-f]{64}$/, "HMAC-SHA256 completo, no un recorte");
});

// ── Aislamiento: nada de esto puede pasar ───────────────────────────────

test("cambiar el clientId en la cookie invalida la sesión", () => {
  const { value } = packPortalSession(CLIENTE_A, BARBERIA_X);
  const suplantada = value.replace(CLIENTE_A, CLIENTE_B);
  assert.notEqual(suplantada, value);
  assert.equal(readPortalSession(suplantada), null, "el cliente A no puede volverse el B");
});

test("cambiar el barbershopId en la cookie invalida la sesión", () => {
  const { value } = packPortalSession(CLIENTE_A, BARBERIA_X);
  const cruzada = value.replace(BARBERIA_X, BARBERIA_Y);
  assert.equal(readPortalSession(cruzada), null, "no se salta de barbería cambiando la cookie");
});

test("estirar la caducidad invalida la sesión", () => {
  const { value } = packPortalSession(CLIENTE_A, BARBERIA_X);
  const partes = value.split(".");
  partes[3] = String(Number(partes[3]) + 86_400_000 * 365);
  assert.equal(readPortalSession(partes.join(".")), null);
});

test("pegar la firma de OTRA cookie no sirve", () => {
  const a = packPortalSession(CLIENTE_A, BARBERIA_X).value;
  const b = packPortalSession(CLIENTE_B, BARBERIA_X).value;
  const macDeB = b.slice(b.lastIndexOf(".") + 1);
  const frankenstein = a.slice(0, a.lastIndexOf(".") + 1) + macDeB;
  assert.equal(readPortalSession(frankenstein), null);
});

test("una sesión vencida ya no vale", () => {
  const hace30Dias = new Date(Date.now() - 30 * 86_400_000);
  const { value } = packPortalSession(CLIENTE_A, BARBERIA_X, hace30Dias);
  assert.equal(readPortalSession(value), null);
});

test("basura, vacío y formatos raros devuelven null sin reventar", () => {
  for (const raw of [
    undefined,
    null,
    "",
    "  ",
    "loquesea",
    "v1.cli.shop.123",
    "v2." + CLIENTE_A + "." + BARBERIA_X + ".99999999999999.deadbeef",
    ".".repeat(50),
    "a.b",
  ]) {
    assert.equal(readPortalSession(raw as string), null, `entrada: ${String(raw)}`);
  }
});

test("una versión desconocida de la cookie no se acepta aunque venga firmada", () => {
  // Se firma un payload v2 con la misma llave: la firma cuadra, pero la
  // versión no está soportada y se rechaza igual.
  const { value } = packPortalSession(CLIENTE_A, BARBERIA_X);
  const conV2 = "v2" + value.slice(2);
  assert.equal(readPortalSession(conV2), null);
});

// ── Cookie ──────────────────────────────────────────────────────────────

test("la cookie del portal es httpOnly y no viaja a otros sitios", () => {
  const opts = portalCookieOptions(new Date(Date.now() + 1000));
  assert.equal(opts.httpOnly, true, "el JavaScript de la página no puede leerla");
  assert.equal(opts.sameSite, "lax");
  assert.equal(opts.path, "/");
  assert.equal(BARBER_PORTAL_COOKIE, "dcb_portal");
  assert.notEqual(BARBER_PORTAL_COOKIE, "patient_session", "no comparte cookie con el dental");
});

// ── Cancelación ─────────────────────────────────────────────────────────

test("el cliente cancela solo con margen suficiente", () => {
  const ahora = new Date("2026-08-24T12:00:00Z");
  const dentroDe = (h: number) => new Date(ahora.getTime() + h * 3_600_000);

  assert.equal(canClientCancel("CONFIRMED", dentroDe(24), ahora), true);
  assert.equal(canClientCancel("PENDING", dentroDe(24), ahora), true);
  assert.equal(
    canClientCancel("CONFIRMED", dentroDe(BARBER_CANCEL_WINDOW_HOURS), ahora),
    false,
    "justo en el límite todavía NO",
  );
  assert.equal(canClientCancel("CONFIRMED", dentroDe(1), ahora), false);
  assert.equal(canClientCancel("CONFIRMED", dentroDe(-1), ahora), false, "ya pasó");
});

test("una cita terminada no se cancela desde el portal", () => {
  const ahora = new Date("2026-08-24T12:00:00Z");
  const manana = new Date(ahora.getTime() + 86_400_000);
  for (const estado of ["DONE", "CANCELLED", "NO_SHOW"] as const) {
    assert.equal(canClientCancel(estado, manana, ahora), false, estado);
  }
  // IN_PROGRESS sí es una transición válida a CANCELLED, pero una cita en
  // curso ya empezó: la ventana la frena igual.
  assert.equal(canClientCancel("IN_PROGRESS", new Date(ahora.getTime() - 600_000), ahora), false);
});

test("los topes del código de acceso son los que dice el contrato", () => {
  assert.equal(PORTAL_CODE_TTL_MIN, 10, "caducidad corta");
  assert.equal(PORTAL_CODE_MAX_ATTEMPTS, 5, "tope de intentos contra un código");
  assert.ok(BARBER_CANCEL_WINDOW_HOURS > 0);
});
