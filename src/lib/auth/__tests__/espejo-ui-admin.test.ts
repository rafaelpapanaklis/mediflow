/**
 * ws1-t11 v5 — a quien el servidor le va a dar 403, la pantalla no le enseña el
 * control (espejo de H3). Que el espejo diga lo mismo que cada ruta lo fija
 * admin-con-override.test.ts (matriz rol × override contra las rutas reales);
 * aquí se fija que cada pantalla lo USA y no vuelve a decidir por el rol.
 *
 * Run: npm run test:espejo-ui-admin
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { accionesDe, type CfdiVista } from "@/components/dashboard/billing/cfdi-ante-el-sat-core";
import { adminConPermiso } from "@/lib/auth/admin-con-permiso";

const raiz = path.resolve(__dirname, "../../../..");
const leer = (rel: string) => fs.readFileSync(path.join(raiz, rel), "utf8");

test("adminConPermiso: el dueño siempre; el ADMIN con la llave (override incluido); nadie más", () => {
  const recortado = ["today.view", "agenda.view"];
  assert.equal(adminConPermiso({ role: "SUPER_ADMIN", permissionsOverride: recortado }, "settings.edit"), true);
  assert.equal(adminConPermiso({ role: "ADMIN", permissionsOverride: [] }, "settings.edit"), true);
  assert.equal(adminConPermiso({ role: "ADMIN", permissionsOverride: recortado }, "settings.edit"), false);
  assert.equal(adminConPermiso({ role: "ADMIN", permissionsOverride: [...recortado, "settings.edit"] }, "settings.edit"), true);
  assert.equal(adminConPermiso({ role: "DOCTOR", permissionsOverride: ["settings.edit"] }, "settings.edit"), false);
  assert.equal(adminConPermiso(null, "settings.edit"), false);
});

// ── CFDI: cada botón con el permiso de SU ruta ──
const vigente: CfdiVista = {
  id: "c1", uuid: "U-1", status: "valid", cancellationStatus: null, tipoComprobante: "I", paymentId: null,
  relationType: null, relatedUuid: null, total: 100,
} as unknown as CfdiVista;

test("CFDI · ADMIN sin «Reembolsar / cancelar»: no ve Cancelar, sí Sustituir y Nota de crédito (bonificación)", () => {
  const a = accionesDe(vigente, [vigente], { listo: true, admin: true, cancelar: false, invoiceCfdiUuid: "U-1" });
  assert.equal(a.cancelar, false);
  assert.equal(a.cancelarSustituido, false);
  assert.equal(a.sustituir, true, "timbrar el sustituto solo pide administrador");
  assert.equal(a.notaCredito, true, "la nota como bonificación solo pide administrador");
});

test("CFDI · sin el flag nuevo, todo sigue como antes (cancelar = admin)", () => {
  const a = accionesDe(vigente, [vigente], { listo: true, admin: true, invoiceCfdiUuid: "U-1" });
  assert.equal(a.cancelar, true);
});

test("CFDI · la pantalla pasa cada permiso y esconde «devolver dinero» a quien no lo tiene", () => {
  const src = leer("src/components/dashboard/billing/cfdi-ante-el-sat.tsx");
  assert.match(src, /cancelar: datos\.puedeCancelar/);
  assert.match(src, /puedeDevolver=\{datos\.puedeDevolver \?\? true\}/);
  assert.match(src, /useState\(puedeDevolver\)/, "sin el permiso, la nota nace como bonificación");
  assert.match(src, /\{puedeDevolver && \(\s*<label/, "la casilla «se le devuelve el dinero» solo a quien la ruta se lo acepta");
});

// ── 2FA de la clínica e interruptores de IA ──
test("Configuración · el toggle «Exigir 2FA» sale con el criterio de su ruta, no con el rol", () => {
  assert.match(leer("src/app/dashboard/settings/page.tsx"), /puedeExigir2fa = adminConPermiso\(user, "settings\.edit"\)/);
  const cliente = leer("src/app/dashboard/settings/settings-client.tsx");
  assert.equal((cliente.match(/<TwoFactorCard[\s\S]*?isAdmin=\{puedeExigir2fa\}/g) ?? []).length, 2, "las dos vistas de Configuración");
  assert.doesNotMatch(cliente, /isAdmin=\{user\.role === "ADMIN"/);
});

test("Saldo IA · los interruptores se mueven con «puedeCambiar» del servidor, no con isAdmin", () => {
  const hook = leer("src/app/dashboard/whatsapp/bot/saldo/funciones-ia.tsx");
  assert.match(hook, /setIsAdmin\(d\.puedeCambiar === true\)/);
  assert.doesNotMatch(hook, /setIsAdmin\(d\.isAdmin/);
});
