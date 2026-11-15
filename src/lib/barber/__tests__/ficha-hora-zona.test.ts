// QA A (15-nov-2026): la ficha del cliente lanzaba el error de hidratación de
// React #418. El servidor (UTC en Vercel) escribía «16 nov 2026, 5:15 p.m.» y
// el navegador en México «11:15 a.m.». Con la zona de la barbería, los dos
// escriben lo mismo.
//
//   npx tsx --test src/lib/barber/__tests__/ficha-hora-zona.test.ts
//
// Node respeta un cambio de process.env.TZ en caliente: se escribe la misma
// fecha «como servidor» (UTC) y «como navegador» (México) y se compara.
import "@/components/admin/portada/__tests__/_react-global";
import Module from "node:module";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const M = Module as unknown as { _load: (r: string, p: unknown, m: boolean) => unknown };
const original = M._load;
M._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request.endsWith(".css")) return {};
  return original.call(this, request, parent, isMain);
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ui = require("@/components/barber/clients/ui") as typeof import("@/components/barber/clients/ui");

const CITA = "2026-11-16T17:15:00.000Z"; // lunes 16 de noviembre, 11:15 a. m. en México
const TZ_ANTES = process.env.TZ;
after(() => {
  process.env.TZ = TZ_ANTES;
});

function enZona(tz: string, zonaBarberia?: string): string {
  process.env.TZ = tz;
  return `${ui.formatDate(CITA, "es", zonaBarberia)} | ${ui.formatDateTime(CITA, "es", zonaBarberia)}`;
}

test("con la zona de la barbería, servidor (UTC) y navegador (México) escriben la MISMA hora", () => {
  const servidor = enZona("UTC", "America/Mexico_City");
  const navegador = enZona("America/Mexico_City", "America/Mexico_City");
  assert.equal(servidor, navegador);
  assert.match(servidor, /11:15/);
});

test("sin la zona (como antes) no coinciden: era el #418", () => {
  assert.notEqual(enZona("UTC"), enZona("America/Mexico_City"));
});
