// RONDA 3 · M6 (revisora ws6-t3): las pruebas de integración del dinero crean
// y borran barberías, así que NO basta con que exista DATABASE_URL: solo
// corren si la base es local. Con la de producción, la del panel o cualquier
// otra, se saltan sin abrir ni una conexión.
//
//   npx tsx --test src/lib/barber/__tests__/base-local.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isLocalDatabaseUrl } from "./_base-local";

const ROOT = join(__dirname, "..", "..", "..", "..");

/** Las pruebas de integración de esta rama (todas crean barberías). */
const INTEGRATION = [
  "anticipo-en-caja-integration",
  "membresia-en-caja-integration",
  "comisiones-a-pagar-integration",
  "lealtad-en-caja-integration",
  "cobro-cita-no-completada-integration",
  "comision-corte-cubierto-integration",
  "barbero-sus-visitas-integration",
];

test("solo 127.0.0.1 y localhost cuentan como base local", () => {
  assert.equal(isLocalDatabaseUrl("postgresql://postgres:x@127.0.0.1:55480/barber"), true);
  assert.equal(isLocalDatabaseUrl("postgresql://postgres:x@localhost:54329/barber"), true);
  assert.equal(isLocalDatabaseUrl("postgresql://postgres:x@localhost/barber"), true);

  assert.equal(isLocalDatabaseUrl(""), false);
  assert.equal(isLocalDatabaseUrl(undefined), false);
  assert.equal(isLocalDatabaseUrl("postgresql://postgres.abcd:x@aws-0-us-east-1.pooler.supabase.com:6543/postgres"), false);
  assert.equal(isLocalDatabaseUrl("postgresql://postgres:x@db.abcd.supabase.co:5432/postgres"), false);
  assert.equal(isLocalDatabaseUrl("postgresql://postgres:x@10.0.0.5:5432/barber"), false);
  // Nombres que solo EMPIEZAN como algo local no cuelan.
  assert.equal(isLocalDatabaseUrl("postgresql://postgres:x@localhost.evil.example:5432/barber"), false);
  assert.equal(isLocalDatabaseUrl("postgresql://postgres:x@127.0.0.1.evil.example:5432/barber"), false);
  // Ni «localhost» escondido en la contraseña o en el nombre de la base.
  assert.equal(isLocalDatabaseUrl("postgresql://localhost:x@db.abcd.supabase.co:5432/localhost"), false);
});

test("todas las pruebas de integración de la rama usan la guardia, ninguna decide por su cuenta", () => {
  for (const name of INTEGRATION) {
    const src = readFileSync(join(ROOT, "src/lib/barber/__tests__", `${name}.test.ts`), "utf8");
    assert.match(src, /import \{ BASE_LOCAL as HAS_DB, skip \} from "\.\/_base-local";/, `${name}: importa la guardia`);
    assert.doesNotMatch(src, /Boolean\(process\.env\.DATABASE_URL\)/, `${name}: no se fía de que la variable exista`);
    // Cada prueba que toca la base lleva { skip }; las que no, son puras.
    const withDb = src.split("\n").filter((l) => /^test\(/.test(l) && /async \(\) =>/.test(l));
    for (const line of withDb) assert.match(line, /\{ skip \}/, `${name}: ${line.slice(0, 70)}…`);
  }
});

test("con una base que NO es local se salta todo y no se conecta a nada", () => {
  // Un host que no existe: si la prueba intentara conectarse, fallaría (no se saltaría).
  // (Sin NODE_TEST_CONTEXT: es la marca con la que node:test se niega a
  // lanzar un corredor de pruebas dentro de otro.)
  const { NODE_TEST_CONTEXT: _nested, ...parentEnv } = process.env;
  void _nested;
  const out = spawnSync(
    "npx",
    ["tsx", "--test", "src/lib/barber/__tests__/anticipo-en-caja-integration.test.ts"],
    {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...parentEnv,
        DATABASE_URL: "postgresql://postgres:secreto@db.no-es-local.example.invalid:5432/postgres",
        DIRECT_URL: "postgresql://postgres:secreto@db.no-es-local.example.invalid:5432/postgres",
      },
      timeout: 120_000,
    },
  );
  const report = `${out.stdout}\n${out.stderr}`;
  assert.equal(out.status, 0, report.slice(-1500));
  assert.match(report, /# fail 0/);
  assert.match(report, /# pass 0/, "ninguna prueba corrió contra esa base");
  const skipped = Number(/# skipped (\d+)/.exec(report)?.[1] ?? "0");
  assert.ok(skipped >= 20, `se saltaron ${skipped}`);
  assert.match(report, /DATABASE_URL no es local/);
});
