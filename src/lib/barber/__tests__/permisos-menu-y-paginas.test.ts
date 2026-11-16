// ═══════════════════════════════════════════════════════════════════════
// Auditoría de PERMISOS (ws6-t8, 16-nov-2026) — LO QUE VE CADA ROL.
//
// «Nada que se ve y luego da 403; nada escondido que sí se puede por URL.»
// El menú (BARBER_NAV_ITEMS, que filtra el layout con hasBarberPermission) y
// cada página tienen que pedir LO MISMO, y cada página del panel tiene que
// revisar permiso en el servidor (el layout no corta el paso: ver su
// comentario). Prueba de fuente, sin base: corre siempre.
//
//   npx tsx --test src/lib/barber/__tests__/permisos-menu-y-paginas.test.ts
// ═══════════════════════════════════════════════════════════════════════
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { BARBER_NAV_ITEMS } from "../types";
import { BARBER_PERMISSION_KEYS, BARBER_ROLE_DEFAULT_PERMISSIONS, resolveBarberPermissions } from "../permissions";

const PANEL = path.resolve(__dirname, "../../../app/barber/(panel)");
const pagina = (href: string) => path.join(PANEL, href.replace(/^\/barber\//, ""), "page.tsx");

/** Páginas que cualquiera del panel puede abrir, y por qué. */
const SIN_PERMISO: Record<string, string> = {
  inicio: "su Inicio; cada tarjeta trae su propio permiso (G2: el dinero, «Ver caja»)",
  configuracion: "sin «Configuración» abre «Mi cuenta» (su contraseña), no la barbería",
};

test("cada entrada del menú existe y su página pide el MISMO permiso en el servidor", () => {
  for (const item of BARBER_NAV_ITEMS) {
    const file = pagina(item.href);
    assert.ok(fs.existsSync(file), `${item.key}: no existe ${file}`);
    const src = fs.readFileSync(file, "utf8");
    const claves = [item.permission, ...(item.anyPermission ?? [])].filter(Boolean) as string[];
    if (item.key in SIN_PERMISO) continue;
    assert.ok(claves.length > 0, `${item.key}: el menú no pide permiso`);
    for (const k of claves) {
      assert.ok((BARBER_PERMISSION_KEYS as string[]).includes(k), `${item.key}: «${k}» no es un permiso`);
    }
    const revisa = /hasBarberPermission|canViewReports|assertBarberPermission/.test(src);
    assert.ok(revisa, `${item.key}: la página no revisa permiso en el servidor`);
    if (item.anyPermission) {
      // Reportes: canViewReports = cash.view || commissions.view (stats.ts).
      assert.ok(/canViewReports/.test(src), `${item.key}: debe usar canViewReports`);
    } else {
      assert.ok(src.includes(`"${item.permission}"`), `${item.key}: la página no pide «${item.permission}» como el menú`);
    }
  }
});

test("toda página del panel (también las que no están en el menú) revisa permiso en el servidor", () => {
  const paginas: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "page.tsx") paginas.push(p);
    }
  };
  walk(PANEL);
  assert.ok(paginas.length >= 25, `encontró ${paginas.length} páginas`);
  const sinFreno = paginas
    .filter((p) => !Object.keys(SIN_PERMISO).some((k) => p === path.join(PANEL, k, "page.tsx")))
    .filter((p) => !/hasBarberPermission|canViewReports|assertBarberPermission/.test(fs.readFileSync(p, "utf8")))
    .map((p) => path.relative(PANEL, p));
  assert.deepEqual(sinFreno, [], "páginas que cualquiera abre escribiendo la dirección");
  for (const p of paginas) {
    const src = fs.readFileSync(p, "utf8");
    assert.ok(/getBarberContext/.test(src), `${path.relative(PANEL, p)}: no lee la sesión en cada carga`);
  }
});

test("el menú de cada rol de fábrica: lo que ve es lo que puede (y nada de lo que no)", () => {
  const ve = (role: keyof typeof BARBER_ROLE_DEFAULT_PERMISSIONS) => {
    const set = resolveBarberPermissions(role, []);
    return BARBER_NAV_ITEMS.filter((i) => {
      if (i.permission && !set.has(i.permission as never)) return false;
      if (i.anyPermission && !i.anyPermission.some((k) => set.has(k as never))) return false;
      return true;
    }).map((i) => i.key);
  };
  const barbero = ve("BARBER");
  for (const k of ["caja", "equipo", "suscripcion", "barberos", "servicios", "membresias", "productos", "mensajes", "campanas", "afiliados"]) {
    assert.ok(!barbero.includes(k), `Barbero no ve ${k}`);
  }
  for (const k of ["inicio", "agenda", "fila", "clientes", "comisiones"]) assert.ok(barbero.includes(k), `Barbero ve ${k}`);
  const recepcion = ve("RECEPTION");
  for (const k of ["comisiones", "equipo", "suscripcion", "barberos", "servicios", "afiliados", "mi-web"]) {
    assert.ok(!recepcion.includes(k), `Recepción no ve ${k}`);
  }
  for (const k of ["agenda", "caja", "clientes", "membresias", "productos", "mensajes"]) assert.ok(recepcion.includes(k), `Recepción ve ${k}`);
  const gerente = ve("MANAGER");
  assert.ok(!gerente.includes("suscripcion") && !gerente.includes("afiliados"), "el Encargado no ve la suscripción");
  assert.ok(gerente.includes("equipo"));
  assert.equal(ve("OWNER").length, BARBER_NAV_ITEMS.length, "el dueño ve todo");
});
