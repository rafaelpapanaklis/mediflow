// ws1-t1 (ronda de arreglos de la auditoría de uso, C-103 y C-106) — permisos y guardado del bot de WhatsApp.
// Con el código de antes: GET /api/whatsapp/bot contestaba 200 (persona, saludo, FAQs) a doctor, ortodoncista y
// solo lectura aunque la página los saca; el 403 del guardado decía «No tienes permiso para «Enviar WhatsApp»»
// sin decir que es lo que pide configurar el bot; y «Guardar» con el nombre vacío no avisaba nada.
// Decisión 12 (como hoy): ver = «Ver WhatsApp», cambiar = «Enviar WhatsApp»; no hay permiso propio.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { denegarBot } from "../permiso-bot";

const SRC = join(__dirname, "..", "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("🔴→🟢 ver el bot pide «Ver WhatsApp»: un doctor recibe 403 (antes 200)", async () => {
  const r = denegarBot({ role: "DOCTOR", permissionsOverride: [] }, "ver");
  assert.ok(r);
  assert.equal(r!.status, 403);
  const cuerpo = await r!.json();
  assert.equal(cuerpo.permiso, "whatsapp.view");
  assert.match(cuerpo.error, /configuración del bot/);
});

test("como hoy: recepción y dueño ven y cambian el bot; el doctor no lo cambia", () => {
  for (const role of ["RECEPTIONIST", "ADMIN", "SUPER_ADMIN"]) {
    assert.equal(denegarBot({ role }, "ver"), null, role);
    assert.equal(denegarBot({ role }, "editar"), null, role);
  }
  assert.ok(denegarBot({ role: "DOCTOR" }, "editar"));
  assert.ok(denegarBot({ role: "READONLY" }, "editar"));
});

test("🔴→🟢 el 403 de cambiarlo dice por qué ese permiso", async () => {
  const cuerpo = await denegarBot({ role: "DOCTOR" }, "editar")!.json();
  assert.equal(cuerpo.permiso, "whatsapp.send");
  assert.match(cuerpo.error, /Cambiar el bot pide el permiso «Enviar WhatsApp», porque/);
});

test("las rutas del bot usan la misma regla (GET incluido)", () => {
  const ruta = leer("app/api/whatsapp/bot/route.ts");
  const get = ruta.slice(ruta.indexOf("export async function GET"), ruta.indexOf("export async function PATCH"));
  assert.match(get, /denegarBot\(ctx, "ver"\)/);
  assert.match(ruta, /denegarBot\(ctx, "editar"\)/);
  for (const f of ["app/api/whatsapp/bot/faqs/route.ts", "app/api/whatsapp/bot/faqs/[id]/route.ts"]) {
    const t = leer(f);
    assert.ok(!t.includes("denyIfMissingPermission"), f);
    assert.match(t, /denegarBot\(ctx, "editar"\)/);
  }
});

test("🔴→🟢 «Guardar» con el nombre vacío avisa antes de mandar nada (C-106)", () => {
  const c = leer("app/dashboard/whatsapp/bot/bot-client.tsx");
  const f = c.slice(c.indexOf("async function saveConfig()"), c.indexOf("setSaving(true);", c.indexOf("async function saveConfig()")));
  assert.match(f, /if \(!form\.botName\.trim\(\)\) \{\s*toast\.error\(TEXTO_FALTA_NOMBRE_BOT\);\s*return;/);
});

test("🔴→🟢 a 390 px la cabecera del bot ya no desborda: las acciones tienen tope de ancho (C-106)", () => {
  const css = leer("components/dashboard/whatsapp-rediseno/whatsapp-rediseno.module.css");
  const acciones = css.slice(css.indexOf(".acciones {"), css.indexOf("}", css.indexOf(".acciones {")));
  assert.match(acciones, /max-width: 100%;/);
});
