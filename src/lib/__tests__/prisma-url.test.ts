/**
 * ws1-t12 · prismaAdmin con UNA conexión, derivada de DATABASE_URL.
 *
 * Run: npm run test:conexiones-base
 *
 * Cada `new PrismaClient` abre su propio pool por instancia de función; el
 * incidente del 1-oct-2026 (EMAXCONN en el pooler) contó con dos por función.
 * Se fija que la cadena de prismaAdmin lleva connection_limit=1 y pool_timeout
 * corto, reemplazando lo que traiga DATABASE_URL y sin tocar nada más (la
 * contraseña puede llevar caracteres codificados), y que no hay más clientes
 * de Prisma sueltos en el código de la app.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { urlConTopeDeConexiones } from "@/lib/prisma-url";

const TOPE = { conexiones: 1, esperaSegundos: 5 };

test("reemplaza connection_limit y conserva el resto tal cual (pgbouncer, contraseña codificada)", () => {
  const url = "postgresql://postgres.abc:p%40ss%2Fw0rd@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5";
  assert.equal(
    urlConTopeDeConexiones(url, TOPE),
    "postgresql://postgres.abc:p%40ss%2Fw0rd@aws-1-us-east-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1&pool_timeout=5",
  );
});

test("con connection_limit=2 (lo que pone Rafael en Vercel) también queda en 1", () => {
  const r = urlConTopeDeConexiones("postgresql://u:p@h:6543/db?connection_limit=2&pgbouncer=true&pool_timeout=20", TOPE)!;
  assert.equal(r, "postgresql://u:p@h:6543/db?pgbouncer=true&connection_limit=1&pool_timeout=5");
  assert.equal(r.match(/connection_limit=/g)?.length, 1, "sin duplicados");
});

test("sin parámetros los añade; sin DATABASE_URL deja que Prisma decida (build)", () => {
  assert.equal(urlConTopeDeConexiones("postgresql://u:p@h:5432/db", TOPE), "postgresql://u:p@h:5432/db?connection_limit=1&pool_timeout=5");
  assert.equal(urlConTopeDeConexiones(undefined, TOPE), undefined);
  assert.equal(urlConTopeDeConexiones("", TOPE), undefined);
});

test("prismaAdmin usa la cadena con tope de 1 conexión", () => {
  const src = readFileSync(join(process.cwd(), "src/lib/prisma-admin.ts"), "utf8");
  assert.match(src, /datasourceUrl:\s*urlConTopeDeConexiones\(process\.env\.DATABASE_URL,\s*\{\s*conexiones:\s*1,/);
});

test("no hay otros `new PrismaClient` en el código de la app (fuera de pruebas)", () => {
  const encontrados: string[] = [];
  const recorrer = (dir: string) => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) {
        if (n === "__tests__" || n === "node_modules") continue;
        recorrer(p);
      } else if (/\.(ts|tsx|mts|js)$/.test(n) && !/\.test\.(ts|tsx)$/.test(n)) {
        if (/new PrismaClient\s*\(/.test(readFileSync(p, "utf8"))) encontrados.push(p.replace(process.cwd() + "/", ""));
      }
    }
  };
  recorrer(join(process.cwd(), "src"));
  assert.deepEqual(encontrados.sort(), ["src/lib/prisma-admin.ts", "src/lib/prisma.ts"]);
});
