/**
 * «Ver como barbería» NO toca «Ver como clínica» (ws6-t1, 16-nov, punto 2).
 *
 * Run: npx tsx --test --experimental-test-module-mocks src/lib/barber/__tests__/ver-como-dental-intacto.test.ts
 *
 * La versión barber vive entera en rutas del vertical (guardia: 0 compartidos).
 * Aquí se fija que las dos no se mezclan:
 *   · una sesión de «Ver como barbería» es «normal» para el dental (su
 *     getSession / getAuthContext / bitácora no la confunden con una de clínica);
 *   · una sesión de «Ver como clínica» es «normal» para el panel /barber;
 *   · la ruta del dental, su salida, su barra y su botón no mencionan nada de
 *     barber, y la entrada barber no escribe en la tabla ni en las cookies del dental.
 * Las pruebas del dental (test:suplantacion y compañía) se corren aparte sobre
 * esta rama: ver el reporte.
 */
import { test, mock, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const RAIZ = join(__dirname, "..", "..", "..", "..");

function jwt(claims: Record<string, unknown>): string {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256" })}.${b(claims)}.firma`;
}

let token = "";
const filasBarber = new Map<string, Record<string, unknown>>();
const filasDental = new Map<string, Record<string, unknown>>();
const consultas: string[] = [];

const prismaFalso = {
  $queryRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => {
    const sql = strings.join("?");
    consultas.push(sql);
    if (sql.includes("to_regclass")) return [{ ok: true }];
    if (/FROM "barber_admin_impersonation_sessions"/.test(sql)) {
      const f = filasBarber.get(String(valores[0]));
      return f ? [f] : [];
    }
    if (/FROM "admin_impersonation_sessions"/.test(sql)) {
      const f = filasDental.get(String(valores[0]));
      return f ? [f] : [];
    }
    return [];
  },
  $executeRaw: async () => 1,
};
mock.module("@/lib/prisma", { namedExports: { prisma: prismaFalso } });

const cliente = () => ({ auth: { getSession: async () => ({ data: { session: { access_token: token } } }) } });
const libBarber = () => import("../ver-como");
const libDental = () => import("../../admin/suplantacion");

beforeEach(async () => {
  filasBarber.clear(); filasDental.clear(); consultas.length = 0;
  (await libBarber())._reiniciarCacheVerComo();
  (await libDental())._reiniciarCacheSuplantacion();
});

const vence = () => new Date(Date.now() + 3600_000);

test("una sesión de «Ver como barbería» es «normal» para el dental", async () => {
  token = jwt({ session_id: "ses-barber" });
  filasBarber.set("ses-barber", { id: "vc-1", adminUserId: "a", adminEmail: "a", barbershopId: "shop-1", targetBarberUserId: "b", expiresAt: vence(), endedAt: null });
  assert.equal((await (await libBarber()).estadoVerComoDe(cliente())).tipo, "activa");
  assert.equal((await (await libDental()).estadoSuplantacionDe(cliente())).tipo, "normal");
});

test("una sesión de «Ver como clínica» es «normal» para el panel /barber", async () => {
  token = jwt({ session_id: "ses-dental" });
  filasDental.set("ses-dental", { id: "imp-1", adminUserId: "a", adminEmail: "a", clinicId: "c1", targetUserId: "u", expiresAt: vence(), endedAt: null });
  assert.equal((await (await libDental()).estadoSuplantacionDe(cliente())).tipo, "activa");
  assert.equal((await (await libBarber()).estadoVerComoDe(cliente())).tipo, "normal");
});

test("cada una lee SOLO su tabla", async () => {
  token = jwt({ session_id: "ses-x" });
  await (await libBarber()).estadoVerComoDe(cliente());
  const deBarber = consultas.filter((c) => c.includes("impersonation_sessions") && !c.includes("to_regclass"));
  assert.ok(deBarber.length > 0 && deBarber.every((c) => c.includes('"barber_admin_impersonation_sessions"')));
  consultas.length = 0;
  await (await libDental()).estadoSuplantacionDe(cliente());
  const deDental = consultas.filter((c) => c.includes("impersonation_sessions") && !c.includes("to_regclass"));
  assert.ok(deDental.length > 0 && deDental.every((c) => !c.includes("barber_")));
});

test("el «Ver como clínica» del dental no depende de «Ver como barbería» (no se tocó)", () => {
  for (const f of [
    "src/app/api/admin/impersonate/route.ts",
    "src/app/api/admin/impersonate/salir/route.ts",
    "src/app/api/admin/impersonate/estado/route.ts",
    "src/app/api/auth/logout/route.ts",
    "src/components/admin/boton-ver-como-clinica.tsx",
    "src/components/dashboard/aviso-suplantacion.tsx",
    "src/components/dashboard/vigia-ver-como.tsx",
    "src/lib/admin/suplantacion.ts",
    "src/lib/admin/suplantacion-core.ts",
    "src/lib/admin/suplantacion-salida.ts",
    "src/lib/auth.ts",
    "src/lib/auth-context.ts",
  ]) {
    // (src/lib/auth.ts ya nombraba barber en la base: manda a /barber a quien es BarberUser.)
    assert.ok(!/barber_admin_impersonation|barber\/ver-como|dcb_ver_como|VerComoBarberia/.test(readFileSync(join(RAIZ, f), "utf8")), `${f} no debe depender de «Ver como barbería»`);
  }
});

test("la entrada barber no escribe en la tabla ni en las cookies del dental", () => {
  const src = readFileSync(join(RAIZ, "src/app/api/admin/barberias/[id]/ver-como/route.ts"), "utf8");
  assert.ok(!/INSERT INTO "admin_impersonation_sessions"|registrarSuplantacion|cerrarSuplantacion/.test(src));
  assert.ok(!/setVerComoCookie|writeActiveClinicCookie|COOKIE_SESION_PREVIA|COOKIE_PESTANA_VER_COMO/.test(src));
  const core = readFileSync(join(RAIZ, "src/lib/barber/ver-como-core.ts"), "utf8");
  assert.match(core, /COOKIE_VER_COMO_PREVIA = "dcb_ver_como_previa"/, "cookie propia, no df_sesion_previa");
});
