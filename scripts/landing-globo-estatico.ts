/**
 * Genera la imagen estática del globo de la franja de seguridad de la portada
 * (public/landing/seguridad/globo.svg) a partir del mismo mapa y la misma
 * geometría del motor del canvas. Se corre a mano cuando cambie el motor:
 *
 *   npx tsx scripts/landing-globo-estatico.ts
 *
 * La prueba src/components/public/landing/sales/v2/__tests__/globo-seguridad-estatico.test.ts
 * falla si el archivo publicado no coincide con lo que genera el código.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { RUTA_GLOBO_ESTATICO, resumenGloboEstatico, svgGloboEstatico } from "../src/components/public/landing/sales/v2/globo-seguridad-estatico";

const destino = join(process.cwd(), "public", RUTA_GLOBO_ESTATICO);
const svg = svgGloboEstatico();
mkdirSync(dirname(destino), { recursive: true });
writeFileSync(destino, svg);
console.log(`${destino}: ${JSON.stringify(resumenGloboEstatico(svg))}`);
