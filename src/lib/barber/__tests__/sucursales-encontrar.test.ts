// «Sucursales» no se encontraba (ws6-t6, 16-nov-2026).
//
// Rafael: el selector de Sede decía «Cerradas (se reabren en Sucursales)» y
// él no encontraba «Sucursales» para abrirlas: solo era una pestaña dentro de
// Barberos. Aquí se pinta (react-dom/server) el selector de arriba y la
// pantalla de Sucursales reales, en es y en.
//
//   npx tsx --tsconfig tsconfig.test.json --test src/lib/barber/__tests__/sucursales-encontrar.test.ts
import Module from "node:module";
{
  const M = Module as unknown as { _load: (r: string, ...rest: unknown[]) => unknown };
  const real = M._load;
  const clases = new Proxy({}, { get: (_t, k) => (typeof k === "string" ? k : undefined) });
  M._load = function (r: string, ...rest: unknown[]) {
    if (r === "next/navigation") {
      return { useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => "/barber/agenda" };
    }
    if (r.endsWith(".module.css")) return { __esModule: true, default: clases };
    if (r.endsWith(".css")) return {};
    return real.call(this, r, ...rest);
  };
}
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getBarberDict, getBarberT } from "@/i18n/dictionaries/barber";
import type { BarberBranchRow } from "@/lib/barber/branches";

// Los componentes se cargan DESPUÉS de los dobles (los import estáticos se
// adelantarían al parche de Module._load y el CSS module reventaría).
let BARBER_BRANCH_MANAGE = "";
let BarberBranchBadge: typeof import("@/components/barber/barber-branch-badge").BarberBranchBadge;
let BranchesClient: typeof import("@/components/barber/branches/branches-client").BranchesClient;
let AdminI18n: typeof import("@/components/barber/team/admin-ui").AdminI18n;
before(async () => {
  const badge = await import("@/components/barber/barber-branch-badge");
  BARBER_BRANCH_MANAGE = badge.BARBER_BRANCH_MANAGE;
  BarberBranchBadge = badge.BarberBranchBadge;
  BranchesClient = (await import("@/components/barber/branches/branches-client")).BranchesClient;
  AdminI18n = (await import("@/components/barber/team/admin-ui")).AdminI18n;
});

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const opciones = [
  { id: "principal", label: "Barbería Prueba", isActive: true },
  { id: "norte", label: "Norte", isActive: true },
  { id: "t2", label: "PRUEBA-T2 Sucursal", isActive: false },
];

function selector(locale: "es" | "en", manageHref: string | null) {
  const t = getBarberT(locale);
  return renderToStaticMarkup(
    createElement(BarberBranchBadge, {
      options: opciones,
      activeId: "principal",
      consolidated: false,
      selectedId: "principal",
      manageHref,
      labels: {
        branch: t("barber.shell.topbar.branch"),
        aria: t("barber.shell.topbar.branchAria"),
        all: t("barber.shell.topbar.branchAll"),
        closed: t("barber.shell.topbar.branchClosed"),
        closedGroup: t("barber.shell.topbar.branchClosedGroup"),
        manage: t("barber.shell.topbar.branchManage"),
      },
    }),
  );
}

test("selector de Sede: al final, «Administrar sucursales…»; las cerradas dicen dónde reabrirlas", () => {
  const es = selector("es", "/barber/sucursales");
  assert.match(es, /<optgroup label="Cerradas · reábrelas en Sucursales"><option value="t2" disabled="">PRUEBA-T2 Sucursal<\/option><\/optgroup>/);
  const ultima = es.slice(es.lastIndexOf("<option"));
  assert.equal(ultima, `<option value="${BARBER_BRANCH_MANAGE}">Administrar sucursales…</option></select></label>`);
  const en = selector("en", "/barber/sucursales");
  assert.match(en, /<optgroup label="Closed · reopen them in Locations">/);
  assert.match(en, />Manage locations…<\/option><\/select>/);
});

test("selector de Sede: sin permiso de sucursales no ofrece «Administrar sucursales…»", () => {
  assert.doesNotMatch(selector("es", null), /Administrar sucursales/);
  const layout = leer("src/app/barber/(panel)/layout.tsx");
  assert.match(layout, /hasBarberPermission\(permUser, "branches\.manage"\) \? "\/barber\/sucursales" : null/);
});

test("elegir «Administrar sucursales…» solo navega: no toca la cookie de sede", () => {
  const src = leer("src/components/barber/barber-branch-badge.tsx");
  assert.match(
    src,
    /if \(e\.target\.value === BARBER_BRANCH_MANAGE\) \{\s*if \(manageHref\) router\.push\(manageHref\);\s*return;\s*\}\s*setBusy\(true\);\s*void switchBranchAndReload/,
  );
});

const sede = (extra: Partial<BarberBranchRow>): BarberBranchRow =>
  ({
    id: "x", name: "Barbería Prueba", branchName: null, slug: "x", address: null, phone: null, city: null,
    state: null, timezone: "America/Mexico_City", isActive: true, isMainBranch: false, parentId: "principal",
    createdAt: "2026-11-01T00:00:00.000Z", barbersCount: 0, usersCount: 0, isHome: false, ...extra,
  }) as BarberBranchRow;

function sucursales(locale: "es" | "en") {
  return renderToStaticMarkup(
    createElement(AdminI18n, {
      dict: getBarberDict(locale),
      children: createElement(BranchesClient, {
        initialBranches: [
          sede({ id: "principal", isMainBranch: true, parentId: null, slug: "p" }),
          sede({ id: "t2", branchName: "PRUEBA-T2 Sucursal", isActive: false, slug: "t2" }),
        ],
        limit: { used: 2, max: 3, unlimited: false, featureOn: true, canCreate: true, planName: "Profesional" },
        activeBranchId: "principal",
        isConsolidated: false,
        publicBase: "https://dalecontrol.com/b",
      }),
    }),
  );
}

test("Sucursales: la sede cerrada dice qué le pasa y su PRIMER botón es «Reabrir sede», en primario", () => {
  const es = sucursales("es");
  const tarjeta = es.slice(es.indexOf("PRUEBA-T2 Sucursal"));
  assert.match(tarjeta, /Cerrada: no recibe reservas y no se puede elegir en el selector de Sede\./);
  const acciones = tarjeta.slice(tarjeta.indexOf("rowActions"));
  const primerBoton = /<button[^>]*>[\s\S]*?<\/button>/.exec(acciones)![0];
  assert.match(primerBoton, /Reabrir sede/);
  assert.match(primerBoton, /btnPrimary/);
  assert.doesNotMatch(acciones.slice(0, acciones.indexOf("</article>")), /Cerrar sede/, "una cerrada no ofrece cerrarse");
  assert.match(sucursales("en"), /Reopen location/);
});

test("Reabrir pide confirmación y, al reabrir, refresca el servidor (el selector la ve sin recargar)", () => {
  const src = leer("src/components/barber/branches/branches-client.tsx");
  assert.match(src, /if \(!confirmed\) \{\s*if \(next\) setConfirmOpen\(branch\);\s*else setConfirmClose\(branch\);\s*return;\s*\}/);
  assert.match(src, /json: \{ isActive: next \},[\s\S]*?setBranches\([\s\S]*?\);\s*\/\/[^\n]*\n[\s\S]*?router\.refresh\(\);/);
  for (const locale of ["es", "en"]) {
    const t = getBarberT(locale);
    for (const k of ["branches.openTitle", "branches.confirmOpen", "branches.closedNote"]) {
      const v = t(`barber.admin.${k}`, { name: "Norte" });
      assert.ok(v && !v.includes("barber.admin."), `[${locale}] falta ${k}`);
    }
  }
});

test("después de Reabrir, Cerrar, Nueva sede o Editar, el selector de arriba se actualiza solo (refresh del servidor)", () => {
  // Pase 19 de Rafael: reabrió PRUEBA-T2, la tarjeta salía abierta y el selector
  // de arriba la seguía listando en «Cerradas» hasta recargar a mano.
  const src = leer("src/components/barber/branches/branches-client.tsx");
  const toggle = src.slice(src.indexOf("async function toggleOpen"), src.indexOf("async function workHere"));
  assert.match(toggle, /router\.refresh\(\);/, "Reabrir / Cerrar");
  const guardar = src.slice(src.indexOf("async function save()"), src.indexOf("async function toggleOpen"));
  assert.match(guardar, /if \(ok\) \{\s*setForm\(null\);[\s\S]*?router\.refresh\(\);\s*\}/, "Nueva sede / Editar");
  // Y el selector de arriba recibe sus sedes del layout en cada pintado: no las guarda en estado.
  const badge = leer("src/components/barber/barber-branch-badge.tsx");
  assert.doesNotMatch(badge, /useState\(\s*options/);
});

test("una sola sede elegible por pantalla: la barra de Administración ya no trae su propio selector", () => {
  const nav = leer("src/components/barber/team/admin-nav.tsx");
  assert.doesNotMatch(nav, /role="listbox"|branchPicker|switchTo\(/);
  const frame = leer("src/components/barber/team/admin-frame.tsx");
  assert.match(frame, /<AdminNav tabs=\{tabs\} active=\{active\} supportBadge=\{supportBadge\} \/>/);
  // El de arriba sigue saliendo en esas pantallas: lo pinta el layout del panel para todas.
  const layout = leer("src/app/barber/(panel)/layout.tsx");
  assert.match(layout, /<BarberBranchBadge/);
});

test("Barberos, Equipo y Sucursales: cada una con su línea de qué es (es y en)", () => {
  const es = sucursales("es");
  assert.match(es, /Tus sedes \(cada local\): abrirlas, cerrarlas, reabrirlas y elegir desde cuál trabajas\./);
  assert.match(es, /Quién corta en cada sede está en <a [^>]*href="\/barber\/barberos"[^>]*>Barberos<\/a> y quién entra al panel, en <a [^>]*href="\/barber\/equipo"[^>]*>Equipo<\/a>\./);
  assert.match(sucursales("en"), /Who cuts at each location is in <a [^>]*href="\/barber\/barberos"[^>]*>Barbers<\/a> and who can sign in to the panel, in <a [^>]*href="\/barber\/equipo"[^>]*>Team<\/a>\./);
  for (const locale of ["es", "en"]) {
    const t = getBarberT(locale);
    for (const k of ["barbers.subtitle", "barbers.subtitleOther", "team.subtitle", "team.subtitleOther", "branches.subtitle", "branches.subtitleOther", "branches.subtitleAnd"]) {
      const v = t(`barber.admin.${k}`);
      assert.ok(v && !v.includes("barber.admin."), `[${locale}] falta ${k}`);
    }
  }
});
