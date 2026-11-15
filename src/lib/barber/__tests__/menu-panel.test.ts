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

test("cada entrada del menú tiene su icono del oficio, y ese icono existe (si no, cae al poste)", () => {
  // Rediseño 15-nov: el icono va por la CLAVE de la entrada (WhatsApp y
  // Campañas comparten `icon` en BARBER_NAV_ITEMS y aquí llevan uno cada una).
  const iconos = leer("src/components/barber/barber-icons.tsx");
  const mapa = /export const BARBER_NAV_ICON[^=]*= \{([\s\S]*?)\n\};/.exec(iconos);
  assert.ok(mapa, "no se encontró BARBER_NAV_ICON en barber-icons.tsx");
  const porClave = new Map(
    Array.from(mapa[1].matchAll(/^\s*"?([a-z0-9-]+)"?:\s*"([a-z]+)"/gm)).map((m) => [m[1], m[2]]),
  );
  const paths = /const PATHS = \{([\s\S]*?)\n\} satisfies/.exec(iconos);
  assert.ok(paths, "no se encontró PATHS en barber-icons.tsx");
  const dibujados = new Set(Array.from(paths[1].matchAll(/^ {2}([a-z]+):/gm)).map((m) => m[1]));
  for (const i of BARBER_NAV_ITEMS) {
    const nombre = porClave.get(i.key);
    assert.ok(nombre, `la entrada ${i.key} no tiene icono en BARBER_NAV_ICON`);
    assert.ok(dibujados.has(nombre), `el icono "${nombre}" de ${i.key} no está dibujado en PATHS`);
  }
  // El sidebar usa ese mapa (y no lucide) para las entradas.
  const sidebar = leer("src/components/barber/barber-sidebar.tsx");
  assert.match(sidebar, /BARBER_NAV_ICON\[item\.key\]/);
  assert.doesNotMatch(sidebar, /from "lucide-react"/);
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
