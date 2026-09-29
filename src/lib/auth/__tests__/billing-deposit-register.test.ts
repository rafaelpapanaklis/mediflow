// Permiso "billing.deposit.register" — «Registrar anticipo recibido»
// (encargo corto, ws1-t8, sep-2026, mientras espera la Parte B de
// cefalometría). Decisión de Rafael: el doctor puede registrar un anticipo
// si la clínica se lo da en Equipo → Permisos, SIN que eso le abra toda la
// Caja (que sigue exigiendo la key amplia "billing.charge" en el resto de
// endpoints). Quien ya tiene "billing.charge" sigue pudiendo registrar
// anticipos también — no se le quita nada a nadie.
//
// Endpoints que dependen de esto: POST /api/invoices/[id]/anticipo/
// registrar/route.ts y el flag `puedeRegistrar` de GET /api/invoices/[id]/
// anticipo/route.ts, los dos vía `denyIfMissingAnyPermission(ctx,
// ["billing.deposit.register", "billing.charge"])`.
//
// Patrón node:test + tsx, mismo estilo que whatsapp-write-permission.test.ts.
// Correr: npm run test:billing-deposit-register

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_PERMISSIONS,
  PERMISSION_GROUPS,
  ROLE_DEFAULT_PERMISSIONS,
  getEffectivePermissions,
  hasPermission,
} from "../permissions";
import { denyIfMissingAnyPermission } from "../require-permission";

const KEY = "billing.deposit.register" as const;

const user = (role: keyof typeof ROLE_DEFAULT_PERMISSIONS, override?: string[]) =>
  ({ role, permissionsOverride: override ?? [] }) as Parameters<typeof getEffectivePermissions>[0];

describe("catálogo", () => {
  it("existe con la etiqueta exacta del modal", () => {
    assert.equal(ALL_PERMISSIONS[KEY], "Registrar anticipo recibido");
  });

  it("vive en el grupo Facturación, junto a billing.deposit", () => {
    const facturacion = PERMISSION_GROUPS.find((g) => g.title === "Facturación")!;
    assert.ok(facturacion.keys.includes(KEY));
    assert.ok(facturacion.keys.includes("billing.deposit"));
  });
});

describe("quién lo tiene por default", () => {
  it("ADMIN y SUPER_ADMIN sí (todo el catálogo)", () => {
    assert.equal(hasPermission(user("ADMIN"), KEY), true);
    assert.equal(hasPermission(user("SUPER_ADMIN"), KEY), true);
  });

  it("DOCTOR sí — es exactamente la decisión de Rafael de este encargo", () => {
    assert.equal(hasPermission(user("DOCTOR"), KEY), true);
  });

  it("RECEPTIONIST sí", () => {
    assert.equal(hasPermission(user("RECEPTIONIST"), KEY), true);
  });

  it("READONLY no", () => {
    assert.equal(hasPermission(user("READONLY"), KEY), false);
  });
});

describe("la clínica se lo puede quitar al doctor (override reemplaza, no mergea)", () => {
  it("un DOCTOR con override sin esta key la pierde, sin perder el resto de billing.*", () => {
    const acotado = user("DOCTOR", ["today.view", "billing.view", "billing.create"]);
    assert.equal(hasPermission(acotado, KEY), false);
    assert.equal(hasPermission(acotado, "billing.create"), true);
  });

  it("un READONLY con la key marcada a mano SÍ puede (el override manda)", () => {
    assert.equal(hasPermission(user("READONLY", [KEY]), KEY), true);
  });
});

describe("denyIfMissingAnyPermission — la puerta real de los dos endpoints", () => {
  it("un doctor SIN ninguna de las dos keys queda fuera (403)", () => {
    const sinNada = user("DOCTOR", ["today.view"]);
    const denied = denyIfMissingAnyPermission(sinNada, [KEY, "billing.charge"]);
    assert.notEqual(denied, null);
  });

  it("un doctor CON billing.deposit.register (pero sin billing.charge) entra", () => {
    const conLaNueva = user("DOCTOR", ["today.view", KEY]);
    assert.equal(denyIfMissingAnyPermission(conLaNueva, [KEY, "billing.charge"]), null);
  });

  it("quien tiene billing.charge (pero no la key nueva) también entra — no se le quita nada", () => {
    const conCharge = user("RECEPTIONIST", ["today.view", "billing.charge"]);
    assert.equal(denyIfMissingAnyPermission(conCharge, [KEY, "billing.charge"]), null);
  });

  it("readonly por default (ninguna de las dos) queda fuera", () => {
    const denied = denyIfMissingAnyPermission(user("READONLY"), [KEY, "billing.charge"]);
    assert.notEqual(denied, null);
  });

  it("doctor por default (con la key nueva) entra sin tocar el override", () => {
    assert.equal(denyIfMissingAnyPermission(user("DOCTOR"), [KEY, "billing.charge"]), null);
  });
});

describe("cableado real en los route handlers (EQ-07: nada de interruptor muerto)", () => {
  const APP_ROOT = join(__dirname, "..", "..", "..", "app");
  const registrar = readFileSync(
    join(APP_ROOT, "api", "invoices", "[id]", "anticipo", "registrar", "route.ts"),
    "utf8",
  );
  const anticipo = readFileSync(join(APP_ROOT, "api", "invoices", "[id]", "anticipo", "route.ts"), "utf8");

  it("POST .../anticipo/registrar exige la key nueva (OR con billing.charge), antes de tocar Prisma", () => {
    const gateIdx = registrar.search(/denyIfMissingAnyPermission\([^)]*billing\.deposit\.register/);
    const prismaIdx = registrar.indexOf("prisma.");
    assert.notEqual(gateIdx, -1, "el POST no exige billing.deposit.register");
    assert.ok(gateIdx < prismaIdx, "el gate debe ir antes de la primera consulta");
  });

  it("GET .../anticipo calcula puedeRegistrar con la key nueva (OR con billing.charge)", () => {
    // Regla vigente: el permiso sigue siendo la key nueva (OR con billing.charge) y el resultado debe ser «permitido»
    // (=== null); además solo se ofrece si la factura admite anticipo (no CANCELADA ni sin saldo, H1).
    assert.match(anticipo, /puedeRegistrar:\s*admiteAnticipo\s*&&\s*denyIfMissingAnyPermission\(ctx,\s*\[[^\]]*billing\.deposit\.register[^\]]*billing\.charge[^\]]*\]\)\s*===\s*null/);
  });
});
