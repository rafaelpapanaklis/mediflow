/* ============================================================
   REGENERA EL HTML DE REFERENCIA DE LAS PLANTILLAS DE LANDING.

     npx tsx --tsconfig tsconfig.test.json scripts/landing-golden.ts

   Pinta cada plantilla con la clínica de prueba y guarda el HTML en
   src/app/[slug]/_shared/__tests__/html-publicado/<plantilla>.html.
   Esos archivos son el contrato: la prueba de instrumentación compara
   contra ellos byte a byte.

   ⚠️ Correr esto DESPUÉS de tocar una plantilla es aceptar el cambio.
   Solo se hace cuando el cambio en la página pública es DELIBERADO —
   nunca "para que pase la prueba". Revisa siempre el diff del .html
   antes de commitear.
   ============================================================ */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { congelarReloj, htmlPublicado, PLANTILLAS_CON_GOLDEN, CARPETA_GOLDEN } from "../src/app/[slug]/_shared/__tests__/fixture";

congelarReloj();

const destino = join(process.cwd(), CARPETA_GOLDEN);
mkdirSync(destino, { recursive: true });

for (const tpl of PLANTILLAS_CON_GOLDEN) {
  const html = htmlPublicado(tpl);
  writeFileSync(join(destino, `${tpl}.html`), html, "utf8");
  console.log(`  ${tpl.padEnd(14)} ${String(html.length).padStart(7)} bytes`);
}

console.log(`\n${PLANTILLAS_CON_GOLDEN.length} plantillas guardadas en ${CARPETA_GOLDEN}`);
