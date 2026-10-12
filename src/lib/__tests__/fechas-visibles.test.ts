/**
 * F2 (ws1-t5): las fechas que se pintan salen IGUAL en el servidor (UTC) y en el
 * navegador de México. Con `toLocaleDateString` sin zona, el HTML del servidor
 * decía «6 nov» y tras hidratar «5 nov» (#418), y una fecha de nacimiento a
 * medianoche UTC salía un día antes. Run: npm run test:fechas-visibles
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fechaCalendario, fechaEnZona } from "../fechas-visibles";
import { formatRelativeDate } from "../format";

function conZonaDelProceso<T>(tz: string, f: () => T): T {
  const antes = process.env.TZ;
  process.env.TZ = tz;
  try {
    return f();
  } finally {
    if (antes === undefined) delete process.env.TZ;
    else process.env.TZ = antes;
  }
}

const SOLO_DIA = { day: "numeric", month: "short" } as const;

test("fecha de nacimiento a medianoche UTC: el mismo día en servidor (UTC) y en México", () => {
  const dob = "1990-05-12T00:00:00.000Z";
  const servidor = conZonaDelProceso("UTC", () => fechaCalendario(dob));
  const navegador = conZonaDelProceso("America/Mexico_City", () => fechaCalendario(dob));
  assert.equal(servidor, "12 de mayo de 1990");
  assert.equal(navegador, servidor);
  // Lo que hacía el código viejo: un día antes en México.
  const viejo = conZonaDelProceso("America/Mexico_City", () =>
    new Date(dob).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" }),
  );
  assert.equal(viejo, "11 de mayo de 1990");
});

test("«YYYY-MM-DD» es un día de calendario en cualquier zona", () => {
  for (const tz of ["UTC", "America/Mexico_City", "Pacific/Auckland"]) {
    assert.equal(conZonaDelProceso(tz, () => fechaCalendario("2026-09-28")), "28 de septiembre de 2026");
    assert.equal(conZonaDelProceso(tz, () => fechaEnZona("2026-09-28", "America/Mexico_City")), "28 de septiembre de 2026");
  }
});

test("instante: «6 nov» en UTC y «5 nov» en México se unifican con la zona de la clínica", () => {
  // 6 nov 2026 03:30 UTC = 5 nov 21:30 en Ciudad de México (UTC-6, sin horario de verano).
  const iso = "2026-11-06T03:30:00.000Z";
  const enUtc = conZonaDelProceso("UTC", () => new Date(iso).toLocaleDateString("es-MX", SOLO_DIA));
  const enMx = conZonaDelProceso("America/Mexico_City", () => new Date(iso).toLocaleDateString("es-MX", SOLO_DIA));
  assert.notEqual(enUtc, enMx, "el código viejo daba dos textos distintos (la causa del #418)");
  const servidor = conZonaDelProceso("UTC", () => fechaEnZona(iso, "America/Mexico_City", SOLO_DIA));
  const navegador = conZonaDelProceso("America/Mexico_City", () => fechaEnZona(iso, "America/Mexico_City", SOLO_DIA));
  assert.equal(servidor, navegador);
  assert.equal(servidor, enMx);
});

test("sin zona de clínica usa America/Mexico_City; una zona inválida no rompe", () => {
  const iso = "2026-11-06T03:30:00.000Z";
  assert.equal(fechaEnZona(iso, null, SOLO_DIA), fechaEnZona(iso, "America/Mexico_City", SOLO_DIA));
  assert.equal(fechaEnZona(iso, "No/Existe", SOLO_DIA), fechaEnZona(iso, "America/Mexico_City", SOLO_DIA));
  assert.equal(fechaEnZona(null, "America/Mexico_City"), "—");
  assert.equal(fechaCalendario("no-es-fecha"), "—");
});

test("formatRelativeDate con zona: una fecha futura sale igual en servidor y navegador", () => {
  const futura = new Date(Date.now() + 40 * 86_400_000);
  futura.setUTCHours(3, 30, 0, 0); // cae en el día anterior en México
  const a = conZonaDelProceso("UTC", () => formatRelativeDate(futura, "America/Mexico_City"));
  const b = conZonaDelProceso("America/Mexico_City", () => formatRelativeDate(futura, "America/Mexico_City"));
  assert.equal(a, b);
});

test("las pantallas ya no pintan estas fechas con la zona del proceso", () => {
  const raiz = join(__dirname, "..", "..");
  const portal = readFileSync(join(raiz, "app", "portal", "[token]", "portal-client.tsx"), "utf8");
  assert.doesNotMatch(portal, /new Date\(s\)\.toLocaleDateString/);
  assert.match(portal, /fechaCalendario\(patient\.dob\)/);
  for (const f of ["app/dashboard/treatments/treatments-client.tsx", "components/dashboard/piezas-rediseno/tratamientos.tsx"]) {
    const src = readFileSync(join(raiz, f), "utf8");
    assert.doesNotMatch(src, /new Date\(s[e]?\.completedAt\)\.toLocaleDateString/, f);
  }
});
