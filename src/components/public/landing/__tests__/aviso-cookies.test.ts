/**
 * AVISO DE COOKIES SIN BOTÓN + FECHA DEL AVISO DE PRIVACIDAD (ajuste 3, decisión de Rafael tras la
 * revisión del abogado).
 *
 * Run: npm run test:aviso-cookies
 *
 * Los dos pies públicos (SalesFooter: portada, blog, herramientas, páginas de producto; Footer: páginas de
 * especialidad y roadmap) llevan UNA línea con el enlace a la sección de cookies del aviso; el aviso ya no
 * trae el marcador «[fecha de publicación]» y su sección 3 dice que seguir navegando es aceptar. Sin banner,
 * sin botón, sin bloquear nada.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { HREF_AVISO_COOKIES, TEXTO_AVISO_COOKIES } from "../primitives/aviso-cookies";

const RAIZ = path.resolve(__dirname, "../../../../..");
const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

test("el texto es exactamente el que pidió Rafael y enlaza a la sección de cookies del aviso", () => {
  assert.equal(TEXTO_AVISO_COOKIES, "Al navegar en este sitio aceptas el uso de cookies conforme a nuestro");
  assert.equal(HREF_AVISO_COOKIES, "/privacidad#cookies");
  const c = leer("src/components/public/landing/primitives/aviso-cookies.tsx");
  assert.match(c, /Aviso de privacidad/);
  assert.doesNotMatch(c, /<button|onClick|useState|"use client"/, "sin botón, sin estado, sin banner");
});

test("los dos pies públicos lo montan (y solo una vez cada uno)", () => {
  for (const f of ["src/components/public/landing/sales/footer.tsx", "src/components/public/landing/footer.tsx"]) {
    const t = leer(f);
    assert.match(t, /import \{ AvisoCookies \}/, f);
    assert.equal((t.match(/<AvisoCookies /g) ?? []).length, 1, f);
  }
  // La portada usa el SalesFooter.
  assert.match(leer("src/app/page.tsx"), /<SalesFooter portada \/>/);
});

test("el aviso de privacidad: fecha real, ancla #cookies y frase de aceptación por uso en la sección 3", () => {
  const p = leer("src/app/privacidad/page.tsx");
  assert.match(p, /const LAST_UPDATED = "20 de octubre de 2026";/);
  assert.doesNotMatch(p, /\[fecha de publicación\]/);
  assert.match(p, /<Section id="cookies" title="3\. Cookies">/);
  assert.match(p, /section id=\{id\}/);
  const s3 = p.slice(p.indexOf('title="3. Cookies"'), p.indexOf('title="4. Finalidades'));
  assert.match(s3, /al continuar navegando en este sitio se entiende\s+que usted acepta el uso de las cookies/);
  assert.match(s3, /No mostramos un botón de aceptar ni bloqueamos contenido/);
  assert.match(s3, /Cómo borrar o bloquear las cookies/, "sigue diciendo cómo desactivarlas");
});

test("el aviso describe el botón de WhatsApp (nombre y número para contactarte) en «3. Cookies»; LiveChat y Tawk.to ya no aparecen", () => {
  const p = leer("src/app/privacidad/page.tsx");
  const s3 = p.slice(p.indexOf('title="3. Cookies"'), p.indexOf('title="4. Finalidades'));
  assert.match(s3, /Botón de WhatsApp/);
  assert.match(s3, /su nombre y su número de WhatsApp/);
  assert.match(s3, /únicamente\s+para contactarle/);
  assert.match(s3, /no instala\s+cookies propias ni de terceros/);
  assert.match(s3, /no en el panel de la clínica, ni en el portal del paciente/);
  // W8: Resend como encargado y plazo de conservación.
  assert.match(s3, /conservamos hasta <b>90 días<\/b>/);
  const s5 = p.slice(p.indexOf('title="5. Transferencias"'), p.indexOf('title="6. Derechos ARCO"'));
  assert.match(s5, /<b>Resend, Inc\.<\/b> — envío de los correos de la plataforma/);
  assert.match(s5, /<b>Postmark<\/b> — recepción de correo entrante/);
  assert.match(s5, /<b>Meta Platforms, Inc\. \(WhatsApp Business Platform\)<\/b> — envío y recepción de los mensajes de WhatsApp/);
  assert.match(s5, /<b>Twilio, Inc\.<\/b> — respaldo para el envío de WhatsApp[^<]*No enviamos SMS/);
  assert.doesNotMatch(s5, /envío de WhatsApp y SMS/, "no hay SMS en el código");
  assert.doesNotMatch(s5, /Twilio, Inc\. \/ Postmark/, "Postmark no envía: solo recibe");
  assert.doesNotMatch(p, /texto aprobado por el abogado/, "el texto nuevo aún no lo revisa el abogado");
  const s8 = p.slice(p.indexOf('title="8. Conservación'));
  assert.match(s8, /Contacto por el botón de WhatsApp\.<\/b>[\s\S]*?hasta <b>90 días<\/b>/);
  assert.doesNotMatch(p, /livechat/i, "el aviso ya no nombra LiveChat");
  assert.doesNotMatch(p, /tawk/i, "el aviso ya no nombra Tawk.to");
});

test("es verdad lo que dice el aviso: el botón de WhatsApp solo en la portada y el blog; LiveChat y Tawk.to en ningún sitio", () => {
  assert.match(leer("src/app/page.tsx"), /<WhatsappWidget \/>/);
  assert.match(leer("src/app/blog/layout.tsx"), /<WhatsappWidget \/>/);
  assert.doesNotMatch(leer("src/app/page.tsx"), /LiveChat/);
  assert.doesNotMatch(leer("src/app/blog/layout.tsx"), /LiveChat/);
  const c = leer("src/components/public/landing/sales/v2/whatsapp-widget.tsx");
  assert.match(c, /^"use client";/);
  assert.match(c, /\/api\/public\/whatsapp-lead/);
  // Ningún otro archivo de src/app monta el botón ni el chat viejo.
  const montan: string[] = [];
  const recorrer = (dir: string) => {
    for (const e of readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) recorrer(rel);
      else if (/\.tsx?$/.test(e.name)) {
        const t = leer(rel);
        assert.doesNotMatch(t, /<LiveChat\b/, `${rel} monta LiveChat`);
        if (/<WhatsappWidget\b/.test(t)) montan.push(rel);
      }
    }
  };
  recorrer("src/app");
  assert.deepEqual(montan.sort(), ["src/app/blog/layout.tsx", "src/app/page.tsx"]);
  assert.equal(existsSync(path.join(RAIZ, "src/components/public/landing/sales/v2/tawk-chat.tsx")), false);
  assert.doesNotMatch(leer("src/components/public/landing/sales/v2/index.ts"), /Tawk|LiveChat/);
  // La CSP ya no abre dominios para LiveChat ni Tawk.to.
  const csp = leer("next.config.mjs");
  assert.doesNotMatch(csp, /tawk|livechat/i);
});
