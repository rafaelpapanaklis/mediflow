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
  assert.match(leer("app/dashboard/inbox/page.tsx"), /title: "Mensajes — DaleControl"/);
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
