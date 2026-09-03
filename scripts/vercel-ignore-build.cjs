#!/usr/bin/env node
/**
 * vercel-ignore-build.cjs — ignoreCommand de Vercel.
 *
 * CONTRATO DE VERCEL:  exit 0 = SALTAR el build   |   exit 1 = CONSTRUIR
 * Ante cualquier duda (no hay SHA previo, el diff falla, aparece un archivo
 * desconocido) se CONSTRUYE. Nunca se salta por accidente.
 *
 * OJO: este archivo PISA el "Ignored Build Step" del panel de Vercel, asi que
 * replica primero su filtro de rama:
 *   [ "$VERCEL_ENV" = "production" ] && exit 1
 *   case "$VERCEL_GIT_COMMIT_REF" in preview/*) exit 1;; *) exit 0;; esac
 */

const { execFileSync } = require('node:child_process');

const ENTORNOS_CONOCIDOS = new Set(['production', 'preview', 'development']);

const RUTAS_SOLO_DOCS = [
  /\.md$/i,
  /^sql\//,
  /^docs\//,
  /^\.claude\//,
  /^\.gitignore$/,
  /^LICENSE$/,
];

function esSoloDocs(ruta) {
  return RUTAS_SOLO_DOCS.some((re) => re.test(ruta));
}

/**
 * @param {Record<string,string|undefined>} env
 * @param {(prev: string, actual: string) => string} diff  lanza si el comando falla
 * @returns {{skip: boolean, log: string}}  skip=true -> exit 0
 */
function decide(env, diff) {
  const entorno = String(env.VERCEL_ENV || '').trim().toLowerCase();
  const rama = String(env.VERCEL_GIT_COMMIT_REF || '').trim().replace(/^refs[/]heads[/]/, '');
  const ramaMin = rama.toLowerCase();

  // Un VERCEL_ENV que no reconocemos no puede decidir nada: ante la duda, construir.
  if (!ENTORNOS_CONOCIDOS.has(entorno)) {
    return { skip: false, log: `CONSTRUIR: VERCEL_ENV="${env.VERCEL_ENV || '(vacio)'}" no es un entorno conocido` };
  }

  // (a) Filtro de rama del panel: fuera de produccion solo se construye preview/*
  if (entorno !== 'production' && !ramaMin.startsWith('preview/')) {
    return { skip: true, log: `SALTAR: VERCEL_ENV=${entorno} y la rama "${rama || '(vacia)'}" no empieza por preview/` };
  }

  const shaPrevio = (env.VERCEL_GIT_PREVIOUS_SHA || '').trim();
  const shaActual = (env.VERCEL_GIT_COMMIT_SHA || '').trim();

  // (b) Sin SHA previo (primer deploy, redeploy manual) no hay diff fiable
  if (!shaPrevio) {
    return { skip: false, log: 'CONSTRUIR: no hay VERCEL_GIT_PREVIOUS_SHA, no se puede calcular el diff' };
  }

  // (c) Diff entre el commit anterior desplegado y el actual
  let salida;
  try {
    salida = diff(shaPrevio, shaActual);
  } catch (e) {
    return { skip: false, log: `CONSTRUIR: el git diff fallo (clon shallow u objeto ausente): ${e && e.message ? e.message.split('\n')[0] : e}` };
  }

  const archivos = String(salida).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  // (d) Lista vacia -> ante la duda, construir
  if (archivos.length === 0) {
    return { skip: false, log: 'CONSTRUIR: el diff no devolvio archivos' };
  }

  const noDocs = archivos.filter((f) => !esSoloDocs(f));
  if (noDocs.length === 0) {
    return { skip: true, log: `SALTAR: los ${archivos.length} archivos del commit son solo documentacion (${archivos.slice(0, 3).join(', ')}${archivos.length > 3 ? ', ...' : ''})` };
  }

  return { skip: false, log: `CONSTRUIR: ${noDocs.length} de ${archivos.length} archivos tocan codigo (p.ej. ${noDocs.slice(0, 3).join(', ')})` };
}

function diffReal(prev, actual) {
  // --no-renames: sin el, un `git mv src/x.ts docs/x.md` solo listaria el
  // destino (docs/) y saltariamos un build que borro codigo.
  return execFileSync('git', ['diff', '--name-only', '--no-renames', prev, actual], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function main() {
  const { skip, log } = decide(process.env, diffReal);
  console.log(`[vercel-ignore-build] ${log}`);
  process.exit(skip ? 0 : 1);
}

if (require.main === module) main();

module.exports = { decide, esSoloDocs };
