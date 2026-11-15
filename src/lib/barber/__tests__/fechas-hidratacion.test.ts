/* ═══════════════════════════════════════════════════════════════════════
   Fechas iguales en el servidor y en el navegador (error #418).

     npx tsx --test src/lib/barber/__tests__/fechas-hidratacion.test.ts

   QA C (15-nov-2026): /barber/whatsapp, su Bot y Soporte daban «Minified
   React error #418» en panel.108 y en PRODUCCIÓN. Medido: con el navegador en
   la zona del servidor no salía; con la de México, sí. formatWhen escribía
   la hora en la zona de quien la ejecutaba (UTC en Vercel, México en el
   teléfono): el HTML del servidor no coincidía con el del navegador y React
   lo tiraba. Ahora se formatea en la zona de la barbería.
   ═══════════════════════════════════════════════════════════════════════ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const ISO = "2026-11-15T06:30:00.000Z"; // 00:30 en Mérida/CDMX (UTC-6)

/** Corre formatWhen en un proceso con OTRA zona del sistema (como el servidor y el teléfono). */
function enProceso(tzSistema: string, conZona: boolean): string {
  const codigo =
    `import { formatBarberShortWhen } from "./src/lib/barber/fecha-corta.ts";` +
    `process.stdout.write(formatBarberShortWhen(${JSON.stringify(ISO)}, "es"${conZona ? ', "America/Merida"' : ""}));`;
  return execFileSync("npx", ["tsx", "-e", codigo], {
    // Sin NODE_TEST_CONTEXT: con él, el hijo cree que corre dentro de node:test y no imprime.
    env: (() => { const e: Record<string, string | undefined> = { ...process.env, TZ: tzSistema }; delete e.NODE_TEST_CONTEXT; return e as NodeJS.ProcessEnv; })(),
    encoding: "utf8",
    timeout: 60_000,
  });
}

test("con la zona de la barbería, servidor (UTC) y teléfono (México) escriben LO MISMO", () => {
  const servidor = enProceso("UTC", true);
  const telefono = enProceso("America/Mexico_City", true);
  assert.equal(servidor, telefono);
  assert.match(servidor, /12:30/, "la hora de la barbería, no la de UTC");
  // Sin la zona (como antes) se ve el desajuste que tumbaba la hidratación.
  assert.notEqual(enProceso("UTC", false), enProceso("America/Mexico_City", false));
});

test("los tres formateadores de pantalla usan la función única (con su zona)", () => {
  for (const f of [
    "src/components/barber/team/admin-ui.tsx",
    "src/components/barber/whatsapp/ui.tsx",
    "src/components/barber/bot/bot-screen.tsx",
  ]) {
    assert.match(readFileSync(f, "utf8"), /return formatBarberShortWhen\(iso, locale, timeZone\);/, f);
  }
});

test("las tres pantallas le pasan la zona de la barbería a sus fechas", () => {
  const wa = readFileSync("src/app/barber/(panel)/whatsapp/page.tsx", "utf8");
  assert.match(wa, /timezone=\{ctx\.barbershop\.timezone\}/);
  const bot = readFileSync("src/app/barber/(panel)/whatsapp/bot/page.tsx", "utf8");
  assert.match(bot, /timezone=\{ctx\.barbershop\.timezone\}/);
  const soporte = readFileSync("src/app/barber/(panel)/soporte/page.tsx", "utf8");
  assert.match(soporte, /timezone=\{ctx\.barbershop\.timezone\}/);

  const conexion = readFileSync("src/components/barber/whatsapp/connection-panel.tsx", "utf8");
  assert.doesNotMatch(conexion, /formatWhen\([^)]*, locale\)/, "ninguna fecha de Conexión sin zona");
  const botUi = readFileSync("src/components/barber/bot/bot-screen.tsx", "utf8");
  assert.doesNotMatch(botUi, /shortWhen\([^)]*, locale\)/);
  const soporteUi = readFileSync("src/components/barber/support/support-client.tsx", "utf8");
  assert.doesNotMatch(soporteUi, /formatWhen\([^)]*, locale\)/);
});
