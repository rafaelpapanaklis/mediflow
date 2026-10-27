/**
 * Recargar Saldo IA (decisión de Rafael, 27-oct-2026): no es solo del dueño; lo
 * hace quien tenga «Recargar Saldo IA» (`aiWallet.topup`) en Equipo → Permisos,
 * y el SUPER_ADMIN siempre. Guardia en las 7 rutas que meten dinero o autorizan
 * cobrarlo, y la pantalla enseña el saldo a todos pero el botón solo a quien puede.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_PERMISSIONS, PERMISSION_GROUPS, ROLE_DEFAULT_PERMISSIONS } from "@/lib/auth/permissions";
import { gruposVisibles } from "@/lib/team/permisos-modal";
import {
  MENSAJE_SIN_PERMISO_RECARGA,
  PERMISO_RECARGA_SALDO_IA,
  puedeRecargarSaldoIa,
  sinPermisoDeRecarga,
} from "@/lib/ai-wallet/permiso-recarga";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");
const sinComentarios = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("la regla: el dueño siempre; los demás, si tienen el permiso (por rol o por override)", () => {
  assert.equal(PERMISO_RECARGA_SALDO_IA, "aiWallet.topup");
  assert.ok("aiWallet.topup" in ALL_PERMISSIONS);
  assert.equal(puedeRecargarSaldoIa({ role: "SUPER_ADMIN", permissionsOverride: [] }), true);
  assert.equal(
    puedeRecargarSaldoIa({ role: "SUPER_ADMIN", permissionsOverride: ["agenda.view"] }),
    true,
    "el dueño siempre, aunque su override no lo traiga",
  );
  assert.equal(puedeRecargarSaldoIa({ role: "ADMIN", permissionsOverride: [] }), true, "ADMIN lo trae por default (todo)");
  assert.equal(puedeRecargarSaldoIa({ role: "ADMIN", permissionsOverride: ["agenda.view"] }), false, "se le puede quitar");
  for (const role of ["DOCTOR", "RECEPTIONIST", "READONLY"]) {
    assert.equal(puedeRecargarSaldoIa({ role, permissionsOverride: [] }), false, `${role} por default no`);
    assert.equal(puedeRecargarSaldoIa({ role, permissionsOverride: ["agenda.view", "aiWallet.topup"] }), true, `${role} con el permiso, sí`);
  }
  assert.equal(puedeRecargarSaldoIa(null), false);
  assert.equal(ROLE_DEFAULT_PERMISSIONS.READONLY.includes("aiWallet.topup"), false, "no acaba en .view");
});

test("el permiso sale en Equipo → Permisos, con su propio grupo", () => {
  const grupo = gruposVisibles(PERMISSION_GROUPS).find((g) => g.keys.includes("aiWallet.topup"));
  assert.ok(grupo, "visible en el modal");
  assert.equal(grupo!.title, "Saldo IA");
  assert.match(ALL_PERMISSIONS["aiWallet.topup"], /^Recargar Saldo IA/);
});

test("el 403 dice a quién pedírselo, y la llave viaja aparte", () => {
  assert.deepEqual(sinPermisoDeRecarga(), {
    error: MENSAJE_SIN_PERMISO_RECARGA,
    code: "SIN_PERMISO_RECARGA_SALDO_IA",
    permiso: "aiWallet.topup",
  });
  assert.match(MENSAJE_SIN_PERMISO_RECARGA, /Pídeselo a quien tenga el permiso «Recargar Saldo IA»/);
});

const RUTAS = [
  "app/api/ai-wallet/stripe/checkout/route.ts",
  "app/api/ai-wallet/mercadopago/checkout/route.ts",
  "app/api/ai-wallet/spei/ticket/route.ts",
  "app/api/ai-wallet/spei/topup/route.ts",
  "app/api/ai-wallet/stripe/setup-intent/route.ts",
  "app/api/ai-wallet/stripe/setup-intent/confirm/route.ts",
  "app/api/ai-wallet/settings/route.ts",
];

test("las 7 rutas de recarga y auto-recarga exigen el permiso antes de tocar nada, y ya no miran isAdmin", () => {
  for (const rel of RUTAS) {
    // Desde el handler: lo de arriba son helpers (p. ej. `function adminSupabase()`), no efectos.
    const codigo = sinComentarios(leer(rel)).replace(/^[\s\S]*?export async function /, "export async function ");
    const guardia = codigo.indexOf("if (!puedeRecargarSaldoIa(ctx)) return NextResponse.json(sinPermisoDeRecarga(), { status: 403 });");
    assert.ok(guardia > 0, `${rel}: falta la guardia`);
    assert.doesNotMatch(codigo, /ctx\.isAdmin|requireAdmin\(/, `${rel}: aún mira isAdmin`);
    for (const efecto of ["prisma.", "req.json(", "getStripeSafe(", "createTicket(", "adminSupabase("]) {
      const i = codigo.indexOf(efecto);
      if (i >= 0) assert.ok(guardia < i, `${rel}: ${efecto} corre antes de la guardia`);
    }
  }
});

test("encender o apagar funciones de IA sigue siendo de administradores (no es recargar)", () => {
  assert.match(sinComentarios(leer("app/api/ai-wallet/funciones/route.ts")), /requireAdmin\(ctx\)/);
});

test("pantalla: el saldo se ve siempre; la tarjeta de recargar y la auto-recarga solo con el permiso", () => {
  assert.match(sinComentarios(leer("app/api/ai-wallet/route.ts")), /puedeRecargar: puedeRecargarSaldoIa\(ctx\),/);
  const clasica = sinComentarios(leer("app/dashboard/whatsapp/bot/saldo/saldo-client.tsx"));
  const rediseno = sinComentarios(leer("components/dashboard/whatsapp-rediseno/saldo.tsx"));
  for (const [nombre, codigo] of [["clásica", clasica], ["rediseño", rediseno]] as const) {
    assert.doesNotMatch(codigo, /data\.isAdmin/, `${nombre}: aún decide con isAdmin`);
    assert.match(codigo, /data\.puedeRecargar \? \(/, `${nombre}: la tarjeta de recargar`);
    assert.match(codigo, /Pídeselo a quien tenga el permiso «Recargar Saldo IA»\./, `${nombre}: a quién pedirlo`);
    assert.doesNotMatch(codigo, /Pídele a un administrador|Solo administradores pueden recargar/, nombre);
  }
  assert.match(clasica, /<RechargeCta puedeRecargar=\{data\.puedeRecargar\} \/>/);
  // La auto-recarga vive dentro del mismo bloque que la tarjeta de recargar (las dos pantallas).
  for (const codigo of [clasica, rediseno]) {
    const inicio = codigo.indexOf("data.puedeRecargar ? (");
    const auto = codigo.indexOf("Recarga automática");
    const fin = codigo.indexOf("Recargar o configurar la recarga automática pide el permiso");
    assert.ok(inicio > 0 && inicio < auto && auto < fin, "la auto-recarga queda dentro del bloque con permiso");
  }
});
