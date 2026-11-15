// EL MENÚ DEL PANEL (auditoría 14-nov, G6 y M12).
//
// «Programa de socios» se anunciaba en la portada y no tenía entrada en
// ninguna parte; Soporte y Reportes colgaban de otras pantallas. Aquí se
// vigila que cada entrada del menú tenga su etiqueta en es y en, un icono
// que el sidebar sabe pintar, y el MISMO candado que su pantalla.
//
//   npx tsx --test src/lib/barber/__tests__/menu-panel.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getBarberT } from "@/i18n/dictionaries/barber";
import { BARBER_FEATURES, BARBER_UNPAID_NAV_KEYS, barberNavItemsWhileUnpaid } from "@/lib/barber/plan-shared";
import { BARBER_PERMISSION_KEYS } from "@/lib/barber/permissions";
import { BARBER_NAV_ITEMS } from "@/lib/barber/types";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const item = (key: string) => BARBER_NAV_ITEMS.find((i) => i.key === key);

test("Socios, Soporte y Reportes tienen entrada propia, con el candado de su pantalla", () => {
  const socios = item("afiliados");
  assert.ok(socios, "falta Socios");
  assert.equal(socios.href, "/barber/afiliados");
  assert.equal(socios.featureKey, "affiliates");
  assert.equal(socios.permission, "billing.manage");

  const soporte = item("soporte");
  assert.ok(soporte, "falta Soporte");
  assert.equal(soporte.href, "/barber/soporte");
  assert.equal(soporte.featureKey, null, "Soporte está en todos los planes");
  assert.equal(soporte.permission, "support.view");

  const reportes = item("reportes");
  assert.ok(reportes, "falta Reportes");
  assert.equal(reportes.href, "/barber/reportes");
  assert.equal(reportes.featureKey, "analytics");
  assert.deepEqual(reportes.anyPermission, ["cash.view", "commissions.view"]);
});

test("cada entrada del menú tiene etiqueta en es y en en", () => {
  for (const locale of ["es", "en"]) {
    const t = getBarberT(locale);
    for (const i of BARBER_NAV_ITEMS) {
      const llave = `barber.shell.nav.${i.key}`;
      const texto = t(llave);
      assert.ok(texto && !texto.includes("barber.shell.nav"), `[${locale}] falta la etiqueta ${llave}`);
    }
  }
  assert.equal(getBarberT("es")("barber.shell.nav.afiliados"), "Socios");
  assert.equal(getBarberT("es")("barber.shell.nav.soporte"), "Soporte");
  assert.equal(getBarberT("es")("barber.shell.nav.reportes"), "Reportes");
});

test("cada icono del menú existe en el mapa del sidebar (si no, cae a tijeras)", () => {
  const sidebar = leer("src/components/barber/barber-sidebar.tsx");
  const mapa = /const ICONS[^=]*= \{([\s\S]*?)\n\};/.exec(sidebar);
  assert.ok(mapa, "no se encontró el mapa ICONS en el sidebar");
  const conocidos = new Set(
    Array.from(mapa[1].matchAll(/^\s*"?([a-z0-9-]+)"?:/gm)).map((m) => m[1]),
  );
  for (const i of BARBER_NAV_ITEMS) {
    assert.ok(conocidos.has(i.icon), `el icono "${i.icon}" de ${i.key} no está en ICONS`);
  }
});

test("llaves únicas, y features y permisos que existen de verdad", () => {
  const llaves = BARBER_NAV_ITEMS.map((i) => i.key);
  assert.equal(new Set(llaves).size, llaves.length, "hay una llave repetida");
  const features = new Set<string>(BARBER_FEATURES.map((f) => f.key));
  const permisos = new Set<string>(BARBER_PERMISSION_KEYS);
  for (const i of BARBER_NAV_ITEMS) {
    if (i.featureKey) assert.ok(features.has(i.featureKey), `${i.key}: feature desconocida ${i.featureKey}`);
    for (const p of [i.permission, ...(i.anyPermission ?? [])]) {
      if (p) assert.ok(permisos.has(p), `${i.key}: permiso desconocido ${p}`);
    }
  }
});

test("sin pagar: Suscripción y Soporte, y nada más (Socios no se cuela)", () => {
  const menu = barberNavItemsWhileUnpaid(BARBER_NAV_ITEMS).map((i) => i.key);
  assert.deepEqual(menu, ["suscripcion", "soporte"]);
  assert.deepEqual([...BARBER_UNPAID_NAV_KEYS].sort(), ["soporte", "suscripcion"]);
  // Son exactamente las pantallas exentas del candado de pago.
  for (const key of BARBER_UNPAID_NAV_KEYS) {
    const pagina = leer(`src/app/barber/(panel)/${key}/page.tsx`).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!/await requireBarberPaidAccess\(/.test(pagina), `${key} tiene candado: en el menú sin pagar sería un bucle`);
  }
});

test("el layout aplica anyPermission", () => {
  const layout = leer("src/app/barber/(panel)/layout.tsx");
  assert.match(layout, /item\.anyPermission &&\s*!item\.anyPermission\.some\(/);
});
