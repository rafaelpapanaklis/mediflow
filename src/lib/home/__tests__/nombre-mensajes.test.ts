// ws1-t1 (ronda de arreglos de la auditoría de uso, C-108) — un solo nombre para la bandeja: «Mensajes».
// Con el código de antes: el menú clásico decía «Inbox», el de dos niveles «Mensajes», la carpeta «Bandeja de
// entrada», el Hoy de recepción «Abrir inbox» (y llevaba a la pantalla de WhatsApp, no a la bandeja), y los
// filtros «Validación» y «Recordatorio» salían siempre vacíos sin explicación (nada crea esas conversaciones).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "..", "..");
const leer = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("🔴→🟢 «Mensajes» en el menú clásico, en el de dos niveles y en el título de la página", () => {
  const es = JSON.parse(leer("i18n/dictionaries/es.json"));
  const en = JSON.parse(leer("i18n/dictionaries/en.json"));
  assert.equal(es.sidebar.nav.inbox, "Mensajes");
  assert.equal(en.sidebar.nav.inbox, "Messages");
  assert.equal(es.inbox.client.folderInbox, "Recibidos");
  assert.match(leer("components/dashboard/sidebar-nav.ts"), /\{ id: "inbox",\s+section: "workspace", label: "Mensajes",/);
  assert.match(leer("app/dashboard/inbox/page.tsx"), /title: "Mensajes" \}/);
});

test("🔴→🟢 «Abrir Mensajes» del Hoy de recepción lleva a la bandeja", () => {
  assert.match(leer("app/api/dashboard/home/receptionist/route.ts"), /cta: \{ label: "Abrir Mensajes", href: "\/dashboard\/inbox" \}/);
});

test("🔴→🟢 los filtros de canal ya no ofrecen «Validación» ni «Recordatorio» (nada los produce)", () => {
  const c = leer("app/dashboard/inbox/inbox-client.tsx");
  assert.match(c, /const CANALES_DEL_FILTRO = \(Object\.keys\(CHANNEL_META\) as Channel\[\]\)\.filter\(\s*\(ch\) => ch !== "VALIDATION" && ch !== "REMINDER",/);
  assert.ok(!c.includes("{(Object.keys(CHANNEL_META) as Channel[]).map((ch)"), "los dos filtros usan la lista nueva");
  // Y de verdad nadie crea conversaciones con esos canales (si alguien empieza, este candado avisa).
  const { execSync } = require("node:child_process");
  const usos = execSync(`grep -rln 'channel: "VALIDATION"\\|channel: "REMINDER"' ${SRC} --include=*.ts --include=*.tsx --exclude-dir=__tests__ || true`).toString().trim();
  assert.equal(usos, "", `alguien ya crea conversaciones de esos canales: ${usos}`);
});

// ws1-t1 (tercera ronda, C-108 a medias, C-119 y N-55).
test("🔴→🟢 C-108: ya no queda «Inbox» en los textos de la bandeja, de WhatsApp ni de Integraciones", () => {
  const es = JSON.parse(leer("i18n/dictionaries/es.json"));
  const textos = JSON.stringify(es);
  for (const viejo of ["al Inbox", "en el Inbox", "Ver en Inbox", "así va el inbox", "inbox unificado", "en el inbox"]) {
    assert.ok(!textos.includes(viejo), `queda «${viejo}»`);
  }
  assert.match(textos, /"tplNav":"Plantillas de WhatsApp"/, "no se confunde con Plantillas de documentos");
  assert.match(leer("app/dashboard/inbox/inbox-client.tsx"), /\{t\("sidebar\.nav\.inbox"\)\}/);
});

test("🔴→🟢 C-119: el saludo de Mensajes usa la hora de la clínica", async () => {
  const { horaEnZona } = await import("../greet");
  // 09:20 UTC = 03:20 en Ciudad de México: no son «Buenos días» de Nueva York, es de madrugada en la clínica.
  assert.equal(horaEnZona(new Date("2026-10-04T09:20:00Z"), "America/Mexico_City"), 3);
  const c = leer("app/dashboard/inbox/inbox-client.tsx");
  assert.match(c, /const h = horaEnZona\(new Date\(\), viewer\.timezone\);/);
  assert.match(leer("app/dashboard/inbox/page.tsx"), /timezone: await zonaDeClinica\(user\.clinicId\)/);
});

test("🔴→🟢 N-55: los títulos no repiten «DaleControl» (lo pone la plantilla del layout)", () => {
  for (const f of ["app/dashboard/inbox/page.tsx", "app/dashboard/whatsapp/page.tsx", "app/dashboard/whatsapp/bot/page.tsx", "app/dashboard/whatsapp/plantillas/page.tsx", "app/dashboard/appointments/page.tsx", "app/dashboard/walk-in/page.tsx", "app/dashboard/patients/page.tsx", "app/dashboard/settings/anticipos/page.tsx"]) {
    assert.ok(!/title: "[^"]*— DaleControl"/.test(leer(f)), f);
  }
  assert.match(leer("app/layout.tsx"), /template: "%s \| DaleControl"/);
});
