/**
 * Login rápido (28-oct) — el aviso «la caja lleva N días abierta» de «Hoy» ya no alarga el esqueleto:
 * la página EMPIEZA su lectura (`leerDiasCajaAbierta`) antes de su Promise.all y el componente solo la
 * espera. Mismo aviso y mismo permiso (canUseCaja); el doctor no lo ve ni se lee.
 *
 * Run: npm run test:caja-dinero
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const estado = { lecturas: 0, dias: 3, falla: false };
beforeEach(() => { estado.lecturas = 0; estado.dias = 3; estado.falla = false; });

// Dobles por Module._load: el módulo se carga con import() DESPUÉS (un import estático subiría por
// encima y traería el Prisma de verdad).
const dobles: Record<string, unknown> = {
  "@/lib/caja": {
    diasDeCajaAbierta: async () => {
      estado.lecturas++;
      if (estado.falla) throw new Error("sin base");
      return estado.dias;
    },
  },
  "next/link": { __esModule: true, default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> },
};
const Mod = Module as unknown as { _load: (req: string, ...r: unknown[]) => unknown };
const cargaOriginal = Mod._load;
Mod._load = function (req: string, ...r: unknown[]) {
  return req in dobles ? dobles[req] : cargaOriginal.call(this, req, ...r);
};

const aviso = () => import("../aviso-caja-abierta");
async function pintar(el: unknown): Promise<string> {
  const { renderToStaticMarkup } = await import("react-dom/server");
  return el ? renderToStaticMarkup(el as any) : "";
}

const DUENO = { role: "SUPER_ADMIN" };
const RECEPCION_CON_CAJA = { role: "RECEPTIONIST", canAccessCaja: true };
const RECEPCION_SIN_CAJA = { role: "RECEPTIONIST", canAccessCaja: false };

test("leerDiasCajaAbierta: sin permiso de Caja no consulta; con permiso, lee una vez; si falla, 0 (no rechaza)", async () => {
  const { leerDiasCajaAbierta } = await aviso();
  assert.equal(await leerDiasCajaAbierta("cl-1", RECEPCION_SIN_CAJA), 0);
  assert.equal(await leerDiasCajaAbierta("", DUENO), 0);
  assert.equal(estado.lecturas, 0);
  assert.equal(await leerDiasCajaAbierta("cl-1", RECEPCION_CON_CAJA), 3);
  assert.equal(estado.lecturas, 1);
  estado.falla = true;
  assert.equal(await leerDiasCajaAbierta("cl-1", DUENO), 0);
});

test("🔴 con la lectura ya empezada, el aviso no vuelve a leer y pinta lo mismo que antes", async () => {
  const { AvisoCajaAbierta, leerDiasCajaAbierta } = await aviso();
  const dias = leerDiasCajaAbierta("cl-1", DUENO);
  const html = await pintar(await AvisoCajaAbierta({ clinicId: "cl-1", locale: "es", user: DUENO, dias }));
  assert.equal(estado.lecturas, 1, "una sola lectura: la de la página");
  assert.match(html, /data-aviso-caja-abierta/);
  assert.match(html, /href="\/dashboard\/caja"/);
  // Sin la lectura de la página (cualquier otro uso), el componente lee él mismo: el mismo HTML.
  const solo = await pintar(await AvisoCajaAbierta({ clinicId: "cl-1", locale: "es", user: DUENO }));
  assert.equal(solo, html);
  assert.equal(estado.lecturas, 2);
});

test("mismo permiso: sin Caja no hay aviso aunque llegue una lectura; con menos de un día, tampoco", async () => {
  const { AvisoCajaAbierta } = await aviso();
  assert.equal(await AvisoCajaAbierta({ clinicId: "cl-1", locale: "es", user: RECEPCION_SIN_CAJA, dias: Promise.resolve(5) }), null);
  estado.dias = 0;
  assert.equal(await AvisoCajaAbierta({ clinicId: "cl-1", locale: "es", user: DUENO }), null);
});

test("página de inicio: la lectura empieza ANTES de su Promise.all, se le pasa al aviso y el doctor no lee", () => {
  const src = readFileSync(path.join(__dirname, "../../../app/dashboard/page.tsx"), "utf8");
  const empieza = src.indexOf("leerDiasCajaAbierta(clinic.id, user)");
  assert.ok(empieza > 0, "la página empieza la lectura");
  assert.ok(empieza < src.indexOf("await Promise.all("), "antes del primer Promise.all");
  assert.match(src, /const diasCaja = role === "DOCTOR" \? undefined : leerDiasCajaAbierta\(clinic\.id, user\);/);
  assert.match(src, /<AvisoCajaAbierta [^>]*dias=\{diasCaja\} \/>/);
});
