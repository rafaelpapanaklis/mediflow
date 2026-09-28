// El submenú de Ortodoncia no enseña lo que la persona no puede abrir
// (ws1-t4 ronda 6, fila 31 de la revisión de lógica de uso).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PERMISO_DE_APARTADO, RUTA_CONFIGURACION_ORTO, apartadosPermitidos } from "../submenu-permisos";
import { hasPermission } from "@/lib/auth/permissions";

const RAIZ = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");

const SUBMENU = [
  { href: "/dashboard/orthodontics/tablero", label: "Tablero" },
  { href: "/dashboard/orthodontics/pacientes", label: "Pacientes en tratamiento" },
  { href: "/dashboard/orthodontics/cobranza", label: "Cobranza de mensualidades" },
  { href: "/dashboard/orthodontics/controles", label: "Controles / agenda" },
  { href: "/dashboard/orthodontics/alertas", label: "Alertas" },
  { href: RUTA_CONFIGURACION_ORTO, label: "Configuración" },
];

const nombres = (puede: (p: string) => boolean) => apartadosPermitidos(SUBMENU, puede).map((a) => a.label);

test("quien puede ver la configuración ve los seis apartados, en su orden", () => {
  assert.deepEqual(nombres(() => true), SUBMENU.map((a) => a.label));
});

test("sin `settings.view` no sale Configuración, y lo demás se queda", () => {
  assert.deepEqual(
    nombres((p) => p !== "settings.view"),
    ["Tablero", "Pacientes en tratamiento", "Cobranza de mensualidades", "Controles / agenda", "Alertas"],
  );
});

test("con los roles de verdad: el doctor y recepción no ven Configuración; quien administra, sí", () => {
  const de = (role: string) => (p: string) => hasPermission({ role: role as never, permissionsOverride: null }, p as never);
  assert.ok(!nombres(de("DOCTOR")).includes("Configuración"));
  assert.ok(!nombres(de("RECEPTIONIST")).includes("Configuración"));
  assert.ok(nombres(de("ADMIN")).includes("Configuración"));
  assert.ok(nombres(de("SUPER_ADMIN")).includes("Configuración"));
});

test("el permiso es el MISMO que exige la acción que carga la pantalla", () => {
  assert.equal(PERMISO_DE_APARTADO[RUTA_CONFIGURACION_ORTO], "settings.view");
  const helpers = leer("src/app/actions/orthodontics/_helpers.ts");
  assert.match(helpers, /opts\?\.write === false \? "settings\.view" : "settings\.edit"/);
});

test("el layout filtra el submenú con la sesión, y la página ya no enseña un error técnico", () => {
  const layout = leer("src/app/dashboard/orthodontics/layout.tsx");
  assert.match(layout, /apartadosPermitidos\(SUBMENU, /);
  assert.match(layout, /<SubmenuOrtodoncia apartados=\{apartados\} \/>/);
  const pagina = leer("src/app/dashboard/orthodontics/configuracion/page.tsx");
  assert.match(pagina, /"settings\.view"/);
  assert.match(pagina, /La configuración del módulo la cambia quien administra la clínica/);
});
