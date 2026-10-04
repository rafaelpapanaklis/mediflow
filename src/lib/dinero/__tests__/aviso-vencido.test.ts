/**
 * Los dos avisos de «vencido» de Hoy se distinguen (ws1-t2, auditoría de uso
 * N-10; t10 F-10 y cruces de t12).
 *
 * Run: npm run test:aviso-vencido
 *
 * Hoy enseñaba «16 mensualidades vencidas · $60,400» y «16 facturas vencidas ·
 * $67,200» sin decir qué era cada uno. Con el código viejo falla:
 * `aviso-vencido.ts` no existía, el aviso de facturas no tenía segunda línea y
 * el de ortodoncia solo decía «Ortodoncia · ver quién debe en Cobranza».
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { avisoDeFacturasVencidas, detalleDeMensualidadesVencidas } from "@/lib/dinero/aviso-vencido";
import { subtituloDeMensualidadesVencidas } from "@/lib/orthodontics/hoy";

const leer = (rel: string) => readFileSync(path.join(process.cwd(), rel), "utf8");

test("N-10: el aviso de facturas dice que es todo lo vencido de la clínica; el de mensualidades, que es solo ortodoncia y ya va dentro", () => {
  const f = avisoDeFacturasVencidas(16, 67200);
  assert.equal(f.titulo, "16 facturas vencidas · $67,200");
  assert.match(f.detalle, /Todo lo vencido de la clínica \(ortodoncia incluida\)/);
  assert.equal(avisoDeFacturasVencidas(1, 800).titulo, "1 factura vencida · $800");
  const m = detalleDeMensualidadesVencidas(true);
  assert.match(m, /Solo ortodoncia, por cuota; ya va dentro de las facturas vencidas/);
  assert.match(m, /Cobranza/);
  assert.match(detalleDeMensualidadesVencidas(false), /Caja/);
  assert.equal(subtituloDeMensualidadesVencidas(true), m, "el aviso de ortodoncia de Hoy usa el texto nuevo");
});

test("N-10: el dueño y recepción mandan la segunda línea, y el rediseño la pinta", () => {
  const dueno = leer("src/app/api/dashboard/home/admin/route.ts");
  assert.match(dueno, /detail: aviso\.detalle/);
  const recep = leer("src/app/api/dashboard/home/receptionist/route.ts");
  assert.match(recep, /detail: avisoDeFacturasVencidas\(/);
  assert.match(leer("src/components/dashboard/hoy-rediseno/fila-aviso.tsx"), /alert\.detail && <span className=\{s\.sub\}>/);
});
