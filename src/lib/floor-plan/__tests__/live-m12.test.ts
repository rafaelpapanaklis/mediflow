/**
 * M12 (auditoría 30-sep-2026) — Modo En Vivo: contraseña obligatoria y de 8+ para
 * las nuevas, lockout persistente al desbloquear, y `?date=` acotado.
 *
 * Run: npm run test:seguridad-rapidos
 */
import "./sin-server-only";
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

import {
  contrasenaLiveEsAntigua, esContrasenaLiveValida, fechaLiveEnRango, hashLivePassword,
  problemaDeContrasenaLive, LIVE_PASSWORD_MIN,
} from "../live-config";

// ═══ Piezas puras ═══════════════════════════════════════════════════════════
test("contraseña nueva: mínimo 8 caracteres", () => {
  assert.equal(LIVE_PASSWORD_MIN, 8);
  assert.equal(esContrasenaLiveValida("1234567"), false);
  assert.equal(esContrasenaLiveValida("12345678"), true);
  assert.equal(esContrasenaLiveValida("x".repeat(201)), false);
  assert.equal(esContrasenaLiveValida(1234 as any), false);
});

test("encendido sin contraseña no se puede; apagado sí; quitarla encendido tampoco", () => {
  const p = problemaDeContrasenaLive;
  assert.equal(p({ enabledFinal: true, hayContrasenaGuardada: false, nueva: undefined }), "password_required");
  assert.equal(p({ enabledFinal: true, hayContrasenaGuardada: false, nueva: "" }), "password_required");
  assert.equal(p({ enabledFinal: true, hayContrasenaGuardada: true, nueva: null }), "password_required");
  assert.equal(p({ enabledFinal: false, hayContrasenaGuardada: true, nueva: null }), null);
  assert.equal(p({ enabledFinal: false, hayContrasenaGuardada: false, nueva: undefined }), null);
  assert.equal(p({ enabledFinal: true, hayContrasenaGuardada: true, nueva: undefined }), null, "la existente sigue valiendo");
  assert.equal(p({ enabledFinal: true, hayContrasenaGuardada: false, nueva: "12345678" }), null);
  assert.equal(p({ enabledFinal: true, hayContrasenaGuardada: true, nueva: "corta" }), "password_too_short");
  assert.equal(p({ enabledFinal: false, hayContrasenaGuardada: false, nueva: "abc" }), "password_too_short");
});

test("las contraseñas anteriores (bcrypt costo 10) se reconocen como antiguas; las nuevas no", async () => {
  const vieja = await bcrypt.hash("1234", 10);
  assert.equal(contrasenaLiveEsAntigua(vieja), true);
  assert.equal(contrasenaLiveEsAntigua(await hashLivePassword("contraseña-larga")), false);
  assert.equal(contrasenaLiveEsAntigua(null), false);
  assert.equal(contrasenaLiveEsAntigua("no-es-bcrypt"), true);
});

test("?date= solo vale hoy, ayer y mañana", () => {
  assert.equal(fechaLiveEnRango("2026-10-05", "2026-10-05"), true);
  assert.equal(fechaLiveEnRango("2026-10-04", "2026-10-05"), true);
  assert.equal(fechaLiveEnRango("2026-10-06", "2026-10-05"), true);
  assert.equal(fechaLiveEnRango("2026-10-07", "2026-10-05"), false);
  assert.equal(fechaLiveEnRango("2024-01-01", "2026-10-05"), false);
  assert.equal(fechaLiveEnRango("2026-11-01", "2026-10-31"), true, "cruce de mes");
});

// ═══ Rutas ═══════════════════════════════════════════════════════════════════
let clinica: any;
let escrito: any;
let sesion: any;
let fallos: any[];
let exitos: any[];
let bloqueado: boolean;
let consultasDeAgenda: any[];

beforeEach(() => {
  escrito = null;
  fallos = [];
  exitos = [];
  bloqueado = false;
  consultasDeAgenda = [];
  sesion = { user: { id: "u", clinicId: "c1", role: "SUPER_ADMIN", permissionsOverride: [] } };
  clinica = {
    id: "c1", name: "Clínica", logoUrl: null, city: null, timezone: "America/Mexico_City",
    liveModeEnabled: true, liveModeSlug: "mi-clinica", liveModeShowPatientNames: false,
    liveModePassword: null as string | null,
  };
});

(mock as any).module("@/lib/prisma", {
  namedExports: {
    prisma: {
      clinic: {
        findUnique: async ({ where }: any) =>
          (where.liveModeSlug === "mi-clinica" || where.id === "c1") ? { ...clinica } : null,
        findFirst: async () => null,
        update: async ({ data }: any) => { escrito = data; Object.assign(clinica, data); return { ...clinica }; },
      },
      clinicLayout: { findUnique: async () => null },
      resource: { findMany: async () => [] },
      appointment: { findMany: async (a: any) => { consultasDeAgenda.push(a); return []; } },
    },
  },
});
(mock as any).module("@/lib/auth-context", { namedExports: { getAuthContext: async () => sesion } });
(mock as any).module("@/lib/auth/require-permission", { namedExports: { denyIfMissingPermission: () => null } });
(mock as any).module("next/headers", { namedExports: { cookies: () => ({ get: () => undefined }) } });
(mock as any).module("@/lib/failban", {
  namedExports: {
    persistentRateLimit: async () => null,
    failbanGuard: async () =>
      bloqueado ? new Response(JSON.stringify({ error: "Demasiados intentos" }), { status: 429 }) : null,
    recordAuthFailure: async (_r: any, t: any) => { fallos.push(t); },
    recordAuthSuccess: async (_r: any, t: any) => { exitos.push(t); },
  },
});

const jsonReq = (body: unknown) => ({ json: async () => body, headers: new Headers(), nextUrl: { pathname: "/x", searchParams: new URLSearchParams() } }) as any;

test("PATCH: encender En Vivo sin contraseña es 400 password_required y no se escribe nada", async () => {
  clinica.liveModeEnabled = false;
  const { PATCH } = await import("@/app/api/clinic-layout/live-config/route");
  const res = await PATCH(jsonReq({ liveModeEnabled: true, liveModeSlug: "mi-clinica" }));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, "password_required");
  assert.equal(escrito, null);
});

test("PATCH: contraseña nueva de menos de 8 es 400 password_too_short; de 8 se guarda hasheada con el costo nuevo", async () => {
  clinica.liveModeEnabled = false;
  const { PATCH } = await import("@/app/api/clinic-layout/live-config/route");
  const corta = await PATCH(jsonReq({ liveModeEnabled: true, liveModePassword: "1234567" }));
  assert.equal(corta.status, 400);
  assert.equal((await corta.json()).error, "password_too_short");
  assert.equal(escrito, null);

  const ok = await PATCH(jsonReq({ liveModeEnabled: true, liveModePassword: "contraseña-segura" }));
  assert.equal(ok.status, 200);
  const cuerpo = await ok.json();
  assert.equal(cuerpo.hasPassword, true);
  assert.equal(cuerpo.passwordLegacy, false);
  assert.ok(await bcrypt.compare("contraseña-segura", escrito.liveModePassword));
  assert.notEqual(escrito.liveModePassword, "contraseña-segura");
});

test("PATCH: con En Vivo encendido no se puede quitar la contraseña; una existente sigue valiendo al guardar otros ajustes", async () => {
  clinica.liveModePassword = await bcrypt.hash("1234", 10);
  const { PATCH } = await import("@/app/api/clinic-layout/live-config/route");
  const quitar = await PATCH(jsonReq({ liveModePassword: null }));
  assert.equal(quitar.status, 400);
  assert.equal((await quitar.json()).error, "password_required");

  const otros = await PATCH(jsonReq({ liveModeShowPatientNames: true }));
  assert.equal(otros.status, 200);
  assert.equal((await otros.json()).passwordLegacy, true, "se avisa que la existente es antigua");
});

test("GET live-config: dice si hay contraseña y si es antigua, sin devolver el hash", async () => {
  clinica.liveModePassword = await bcrypt.hash("1234", 10);
  const { GET } = await import("@/app/api/clinic-layout/live-config/route");
  const cuerpo = await (await GET()).json();
  assert.deepEqual(cuerpo, { liveModeEnabled: true, liveModeSlug: "mi-clinica", hasPassword: true, passwordLegacy: true });
});

test("público: ?date= fuera de ayer/hoy/mañana es 400 y NO consulta la agenda", async () => {
  const { GET } = await import("@/app/api/live/[slug]/route");
  const req = (q: string) => ({ nextUrl: { searchParams: new URLSearchParams(q) } }) as any;
  for (const q of ["date=2020-01-01", "date=2031-12-31", "date=basura"]) {
    const res = await GET(req(q), { params: { slug: "mi-clinica" } });
    assert.equal(res.status, 400, q);
    assert.equal((await res.json()).error, "date_out_of_range");
  }
  assert.equal(consultasDeAgenda.length, 0);
  // Sin date, o con hoy, funciona.
  assert.equal((await GET(req(""), { params: { slug: "mi-clinica" } })).status, 200);
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
  assert.equal((await GET(req(`date=${hoy}`), { params: { slug: "mi-clinica" } })).status, 200);
});

test("unlock: contraseña mala registra un fallo PERSISTENTE (IP + slug); bloqueado corta antes de la base; buena limpia", async () => {
  clinica.liveModePassword = await bcrypt.hash("la-contraseña-buena", 10);
  const { POST } = await import("@/app/api/live/[slug]/unlock/route");
  const mala = await POST(jsonReq({ password: "otra-cosa" }), { params: { slug: "mi-clinica" } });
  assert.equal(mala.status, 401);
  assert.equal(fallos.length, 1);
  assert.equal(fallos[0].scope, "live-unlock");
  assert.equal(fallos[0].account, "mi-clinica");

  bloqueado = true;
  const bloq = await POST(jsonReq({ password: "la-contraseña-buena" }), { params: { slug: "mi-clinica" } });
  assert.equal(bloq.status, 429, "bloqueado: ni siquiera con la contraseña correcta");

  bloqueado = false;
  const buena = await POST(jsonReq({ password: "la-contraseña-buena" }), { params: { slug: "mi-clinica" } });
  assert.equal(buena.status, 200);
  assert.equal(exitos.length, 1);
});
