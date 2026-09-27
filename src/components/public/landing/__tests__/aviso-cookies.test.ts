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
import { readFileSync } from "node:fs";
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
  assert.match(p, /const LAST_UPDATED = "27 de septiembre de 2026";/);
  assert.doesNotMatch(p, /\[fecha de publicación\]/);
  assert.match(p, /<Section id="cookies" title="3\. Cookies">/);
  assert.match(p, /section id=\{id\}/);
  const s3 = p.slice(p.indexOf('title="3. Cookies"'), p.indexOf('title="4. Finalidades'));
  assert.match(s3, /al continuar navegando en este sitio se entiende\s+que usted acepta el uso de las cookies/);
  assert.match(s3, /No mostramos un botón de aceptar ni bloqueamos contenido/);
  assert.match(s3, /Cómo borrar o bloquear las cookies/, "sigue diciendo cómo desactivarlas");
});

test("el aviso nombra el chat Tawk.to: viñeta en «3. Cookies» (qué es, para qué, sus cookies, cómo bloquearlas) y encargado en «5. Transferencias»", () => {
  const p = leer("src/app/privacidad/page.tsx");
  const s3 = p.slice(p.indexOf('title="3. Cookies"'), p.indexOf('title="4. Finalidades'));
  assert.match(s3, /Chat de soporte \(Tawk\.to\)/);
  assert.match(s3, /escribirnos para pedir información o soporte/);
  assert.match(s3, /guarda en su\s+navegador cookies propias/);
  assert.match(s3, /puede bloquear las cookies de Tawk\.to/);
  assert.match(s3, /no\s+en el panel de la clínica, ni en el portal del paciente/);
  const s5 = p.slice(p.indexOf('title="5. Transferencias"'), p.indexOf('title="6. Derechos ARCO"'));
  assert.match(s5, /<b>Tawk\.to<\/b>/);
  // Es verdad lo que dice: solo la portada monta el chat.
  assert.match(leer("src/app/page.tsx"), /<TawkChat \/>/);
  const usos = ["src/app/dashboard", "src/app/paciente", "src/app/signup", "src/app/portal"].filter((d) => {
    try { return /TawkChat/.test(leer(`${d}/layout.tsx`)); } catch { return false; }
  });
  assert.deepEqual(usos, []);
});
