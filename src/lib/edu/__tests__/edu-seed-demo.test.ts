/**
 * EL SEMBRADOR DEL INSTITUTO DE DEMO — sus guardias, leídas del código.
 *
 * Run:  npx tsx --test src/lib/edu/__tests__/edu-seed-demo.test.ts
 *       (o `npm run test:edu`, que lo descubre solo)
 *
 * 🔴 POR QUÉ ESTE ARCHIVO EXISTE.
 *
 * `scripts/edu-seed-demo.ts` escribe VEINTE MIL FILAS en una base de datos
 * y su promesa central es negativa: **no toca nada que no sea suyo**. Eso
 * no se puede comprobar llamando a una función pura — hace falta una base
 * —, pero sí se puede comprobar que las guardias siguen ahí. Una guardia
 * que alguien borra en un refactor no rompe ninguna prueba: simplemente
 * deja de correr, y el día que importe ya será tarde.
 *
 * Lo que fija este archivo:
 *  1. la base remota se rechaza salvo que se declare el host EXACTO;
 *  2. el destino se comprueba por slug Y por prefijo de nombre;
 *  3. la foto de filas AJENAS se toma antes y se compara al final;
 *  4. NO se crea configuración de WhatsApp (el cron no ve este instituto);
 *  5. 🔴 `--direccion=` cuelga una cuenta REAL sin crear nada en Supabase
 *     y sin escribir una sola fila fuera del instituto de demo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** El archivo SIN comentarios: se acusa (y se absuelve) por el código, no
 *  por la prosa que lo explica. Mismo criterio que edu-auditoria.test.ts. */
const SEED = readFileSync(join(RAIZ, "scripts", "edu-seed-demo.ts"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\/\/[^\n]*/g, "");

/** El cuerpo de una función del seed, desde su declaración. */
function cuerpo(nombre: string, largo = 2500): string {
  const i = SEED.indexOf(`function ${nombre}`);
  assert.notEqual(i, -1, `¿renombraron ${nombre}?`);
  return SEED.slice(i, i + largo);
}

// ══════════════════════════════════════════════════════════════════════
// 1 · LAS GUARDIAS QUE YA HABÍA
// ══════════════════════════════════════════════════════════════════════

test("🔴 una base que no es local se rechaza salvo que se declare el host EXACTO", () => {
  const c = cuerpo("guardaBase");
  assert.match(c, /localhost/);
  assert.match(c, /EDU_SEED_HOST_REMOTO/);
  assert.match(c, /=== host/, "el host declarado tiene que compararse ENTERO, no por prefijo");
  assert.match(c, /throw new Error/);
});

test("🔴 el destino se comprueba por slug Y por prefijo de nombre", () => {
  const c = cuerpo("guardaDestino");
  assert.match(c, /DEMO_SLUG/);
  assert.match(c, /startsWith\(DEMO_NAME_PREFIX\)/);
  assert.match(c, /porSlug\.id !== id/);
});

test("🔴 la foto de filas AJENAS se toma antes y se compara al final", () => {
  assert.match(SEED, /const antes = await fotoAjenas\(db, destino\.id\)/);
  assert.match(SEED, /compararAjenas\(antes, await fotoAjenas\(db, destino\.id\)\)/);
  assert.match(SEED, /process\.exitCode = 1/, "la guardia tiene que FALLAR, no solo avisar");
  // El conteo mira lo que NO es del demo.
  assert.match(cuerpo("fotoAjenas"), /"institutionId" <> \$1/);
});

test("no se crea configuración de WhatsApp: sin fila, el cron no ve este instituto", () => {
  assert.doesNotMatch(SEED, /eduWhatsappConfig\.(create|upsert|createMany)/);
  assert.doesNotMatch(SEED, /eduWhatsappMessage\.(create|upsert|createMany)/);
});

// ══════════════════════════════════════════════════════════════════════
// 2 · 🔴 LA PUERTA DE ENTRADA (--direccion=)
//
// El seed pone `supabaseId: demoseed-NNNN` en las 135 personas, que nunca
// es un UUID de Supabase Auth: nadie puede entrar al demo. `--direccion=`
// cuelga UNA cuenta que YA EXISTE, sin crear nada en Supabase y sin salir
// del instituto de demo.
// ══════════════════════════════════════════════════════════════════════

test("🔴 las 135 personas sembradas SIGUEN sin poder entrar", () => {
  // Si esto cambia, el seed empezó a fabricar identidades — y con ellas,
  // invitaciones por correo a 135 direcciones inventadas.
  assert.match(SEED, /supabaseId: `demoseed-\$\{String\(\+\+supa\)/);
});

test("🔴 --direccion= NO crea cuentas: exige un UUID que ya existe, o lo busca por correo", () => {
  const c = cuerpo("resolverDireccionReal", 3500);
  // Solo dos formas admitidas, y las dos vienen de una cuenta existente.
  assert.match(c, /pareceUuid\(valor\)/);
  assert.match(c, /valor\.includes\("@"\)/);
  // Por correo se COPIA un supabaseId real; no se inventa ninguno.
  assert.match(c, /NOT: \{ supabaseId: \{ startsWith: "demoseed-" \} \}/);
  assert.match(c, /supabaseId = previo\.supabaseId/);
  // Y si no aparece, se rebota en vez de fabricar una cuenta muerta.
  assert.match(c, /throw new Error\(\s*`GUARDIA: no hay ninguna cuenta/);
  // Cualquier otra cosa tampoco pasa.
  assert.match(c, /no es un UUID de Supabase ni un correo/);
});

test("🔴 la fila de dirección real se escribe SIEMPRE en el instituto de demo", () => {
  const c = cuerpo("colgarDireccionReal", 2000);
  assert.match(c, /eduUser\.upsert/);
  // El create Y el update fijan el institutionId. Un upsert cuyo update no
  // lo fija es cómo una fila de demo termina apuntando a otro sitio.
  const create = /create: \{[\s\S]*?\},\s*update:/.exec(c)?.[0] ?? "";
  const update = /update: \{[\s\S]*?\},\s*select:/.exec(c)?.[0] ?? "";
  assert.match(create, /institutionId: inst/, "el create no fija el instituto");
  assert.match(update, /institutionId: inst/, "el update no fija el instituto");
  assert.match(c, /role: "DIRECCION"/);
  // Idempotente: el id sale del supabaseId, no de un random.
  assert.match(c, /idDireccionReal\(quien\.supabaseId\)/);
  assert.match(cuerpo("idDireccionReal", 300), /did\("dirreal", supabaseId\)/);
});

test("⚠️ se avisa cuando la cuenta ya entra a OTRO instituto (y no se toca esa fila)", () => {
  // getEduContext resuelve la sesión con la fila MÁS VIEJA
  // (edu-auth.ts: findFirst por supabaseId, orderBy createdAt asc). Si esa
  // fila es de otro instituto, el login no llega nunca al demo.
  const c = cuerpo("resolverDireccionReal", 3500);
  assert.match(c, /isActive: true/);
  assert.match(c, /orderBy: \{ createdAt: "asc" \}/);
  assert.match(c, /otro\.institutionId !== idDemo/);
  assert.match(SEED, /quien\.yaEntraA/, "se detecta y no se dice");

  // Y NO se arregla escribiendo en el otro instituto: no hay ni un update
  // ni un delete de eduUser fuera del upsert por id del demo.
  assert.doesNotMatch(SEED, /eduUser\.update\(/);
  assert.doesNotMatch(SEED, /eduUser\.updateMany\(/);
  assert.doesNotMatch(SEED, /eduUser\.delete/);
});

test("la escritura de la cuenta real pasa POR la guardia de filas ajenas", () => {
  // Tiene que ir después de tomar la foto (`antes`) y antes de compararla:
  // si un día tocara una fila de otro instituto, la guardia lo caza.
  const foto = SEED.indexOf("const antes = await fotoAjenas");
  const escribe = SEED.indexOf("await colgarDireccionReal");
  const compara = SEED.indexOf("compararAjenas(antes,");
  assert.ok(foto !== -1 && escribe !== -1 && compara !== -1);
  assert.ok(foto < escribe, "la cuenta real se escribe ANTES de la foto: la guardia no la vería");
  assert.ok(escribe < compara, "la comparación corre ANTES de escribir la cuenta real");
});
