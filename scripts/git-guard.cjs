#!/usr/bin/env node
/**
 * git-guard.cjs — hook PreToolUse (Bash|PowerShell) de Claude Code.
 *
 * Lee el payload JSON del hook por stdin y BLOQUEA (exit 2 + mensaje en stderr):
 *   1. push a main en cualquiera de sus formas, salvo desde el clon principal.
 *   2. cualquier push forzado (--force, --force-with-lease, -f).
 *   3. git reset --hard fuera del clon principal.
 * Todo lo demas pasa (exit 0). Si algo no se puede parsear, deja pasar.
 */

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const CLON_PRINCIPAL = 'c:/users/rafael/documents/github/mediflow';
const RAMAS_PROTEGIDAS = new Set(['main', 'master']);

/** Comandos que solo imprimen texto: lo que lleven dentro no se ejecuta. */
const SOLO_IMPRIMEN = new Set(['echo', 'printf', 'cat', 'write-host', 'write-output', 'type']);

/** Shells que ejecutan su argumento como comando: hay que mirar dentro. */
const WRAPPERS = new Set(['bash', 'sh', 'zsh', 'dash', 'powershell', 'pwsh', 'cmd']);

/** Normaliza una ruta a minusculas con barras normales, sin barra final. */
function normalizePath(p) {
  if (!p || typeof p !== 'string') return '';
  let s = p.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  s = s.replace(/^\/\/\?\//, ''); // ruta extendida de Windows \\?\C:\...
  s = s.replace(/^\/([a-zA-Z])\//, '$1:/'); // Git Bash: /c/Users/... -> c:/Users/...
  s = s.toLowerCase();
  while (s.length > 3 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/** true solo para el clon principal (o un subdirectorio suyo). Los worktrees NO. */
function isMainClone(cwd) {
  const n = normalizePath(cwd);
  return n === CLON_PRINCIPAL || n.startsWith(CLON_PRINCIPAL + '/');
}

/**
 * Quita del comando lo que no es comando: cuerpos de heredoc, continuaciones de
 * linea (backtick de PowerShell, backslash de bash) y cadenas entrecomilladas
 * multilinea (mensajes de commit, nunca rutas).
 */
function limpiarComando(command) {
  let s = String(command);
  s = s.replace(
    /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\r?\n[\s\S]*?\r?\n[ \t]*\2[ \t]*(?=\r?\n|$)/g,
    ' '
  );
  s = s.replace(/[`\\]\r?\n/g, ' ');
  s = s.replace(/"[^"]*(?:\r?\n[^"]*)+"/g, '""');
  s = s.replace(/'[^']*(?:\r?\n[^']*)+'/g, "''");
  return s;
}

/** Parte un comando compuesto en segmentos ejecutables. */
function splitSegments(command) {
  return String(command)
    .split(/\r?\n|&&|\|\||;|&|\|/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Tokeniza respetando comillas, incluidas las pegadas tipo ma"in". */
function tokenize(segment) {
  const bruto = String(segment).match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return bruto.map((t) => t.replace(/["']/g, ''));
}

function esGit(token) {
  const base = String(token).replace(/\\/g, '/').split('/').pop().toLowerCase();
  return base.replace(/\.(exe|cmd|bat)$/, '') === 'git';
}

function esRutaAbsoluta(p) {
  return /^([a-z]:|\/|\\\\)/i.test(String(p).replace(/\\/g, '/'));
}

function resolverCwd(base, destino) {
  return esRutaAbsoluta(destino) ? destino : path.resolve(base || '.', destino);
}

/** Destino de un refspec: `+a:refs/heads/main` -> `main`. */
function refspecDestino(token) {
  const t = String(token).replace(/^\+/, '');
  const dst = t.includes(':') ? t.slice(t.indexOf(':') + 1) : t;
  return dst.replace(/^refs\/heads\//, '');
}

function refspecTocaMain(token) {
  const n = refspecDestino(token).toLowerCase();
  return RAMAS_PROTEGIDAS.has(n) || n.includes('*');
}

function refspecEsHead(token) {
  return refspecDestino(token).toUpperCase() === 'HEAD';
}

function esFlagForce(token) {
  if (token === '--force' || token === '--force-with-lease') return true;
  if (token.startsWith('--force-with-lease=')) return true;
  return /^-[a-z]+$/i.test(token) && token.includes('f') && !token.startsWith('--');
}

/** --all / --mirror / --branches empujan TODAS las ramas locales, main incluida. */
function esFlagTodasLasRamas(token) {
  return token === '--all' || token === '--mirror' || token === '--branches';
}

/**
 * @param {string} command
 * @param {string} cwd
 * @param {(cwd: string) => string|null} getBranch
 * @param {number} [profundidad]
 * @returns {{block: boolean, reason?: string}}
 */
function decide(command, cwd, getBranch, profundidad = 0) {
  if (!command || typeof command !== 'string') return { block: false };
  if (profundidad > 3) return { block: false };
  let cwdActual = cwd || '';

  for (const segmento of splitSegments(limpiarComando(command))) {
    let tokens = tokenize(segmento);
    if (tokens.length === 0) continue;

    // `cd <ruta>` cambia el cwd efectivo; el resto del segmento se sigue analizando.
    while (tokens.length && /^(cd|chdir|set-location|sl)$/i.test(tokens[0])) {
      let consumidos = 1;
      if (tokens[1] === '/d' || tokens[1] === '-d') consumidos = 2; // cd /d de cmd.exe
      const destino = tokens[consumidos];
      if (destino) cwdActual = resolverCwd(cwdActual, destino);
      tokens = tokens.slice(destino ? consumidos + 1 : consumidos);
    }
    if (tokens.length === 0) continue;

    const primero = String(tokens[0]).replace(/\\/g, '/').split('/').pop().toLowerCase();
    if (SOLO_IMPRIMEN.has(primero.replace(/\.exe$/, ''))) continue;

    // bash -c "..." / powershell -Command "..." / cmd /c "...": mira dentro.
    if (WRAPPERS.has(primero.replace(/\.exe$/, ''))) {
      const iFlag = tokens.findIndex((t) => /^(-c|--command|-command|\/c|\/k|-e)$/i.test(t));
      if (iFlag !== -1 && tokens[iFlag + 1]) {
        const dentro = decide(tokens.slice(iFlag + 1).join(' '), cwdActual, getBranch, profundidad + 1);
        if (dentro.block) return dentro;
        continue;
      }
    }

    const iGit = tokens.findIndex(esGit);
    if (iGit === -1) continue;

    // Flags globales de git antes del subcomando; -C cambia el cwd efectivo.
    let cwdSegmento = cwdActual;
    let i = iGit + 1;
    while (i < tokens.length && tokens[i].startsWith('-')) {
      if (tokens[i] === '-C' && tokens[i + 1]) {
        cwdSegmento = resolverCwd(cwdSegmento, tokens[i + 1]);
        i += 2;
        continue;
      }
      if (tokens[i] === '-c' && tokens[i + 1]) { i += 2; continue; }
      i += 1;
    }
    const sub = tokens[i];
    if (!sub) continue;
    const args = tokens.slice(i + 1);

    if (sub === 'push') {
      const flagForce = args.find(esFlagForce);
      if (flagForce) {
        return {
          block: true,
          reason: `Push forzado bloqueado (${flagForce}). Reescribir historia remota no esta permitido desde una terminal de agente.`,
        };
      }

      const enClon = isMainClone(cwdSegmento);

      const flagTodas = args.find(esFlagTodasLasRamas);
      if (flagTodas && !enClon) {
        return {
          block: true,
          reason:
            `git push ${flagTodas} bloqueado desde ${cwdSegmento || '(cwd desconocido)'}: empuja TODAS las ramas locales, main incluida.\n` +
            'Empuja solo la tuya: git push -u origin <tu-rama>',
        };
      }

      const posicionales = [];
      for (let k = 0; k < args.length; k++) {
        const a = args[k];
        if (a === '-o' || a === '--push-option' || a === '--repo' || a === '--receive-pack' || a === '--exec') {
          k += 1;
          continue;
        }
        if (a.startsWith('-')) continue;
        posicionales.push(a);
      }

      // Se evaluan TODOS los posicionales (incluido el remoto): con --repo X el
      // primero deja de ser el remoto y un slice(1) perderia el refspec.
      let esMain = posicionales.some(refspecTocaMain);

      const soloTags = args.includes('--tags') && posicionales.length <= 1;
      const sinRefspec = posicionales.length <= 1;
      const apuntaAHead = posicionales.some(refspecEsHead);

      if (!esMain && !soloTags && (sinRefspec || apuntaAHead)) {
        const rama = getBranch(cwdSegmento);
        if (rama && RAMAS_PROTEGIDAS.has(rama.toLowerCase())) esMain = true;
      }

      if (esMain && !enClon) {
        return {
          block: true,
          reason:
            `Push a main bloqueado desde ${cwdSegmento || '(cwd desconocido)'}.\n` +
            'Los worktrees y clones secundarios empujan SIEMPRE a su propia rama:\n' +
            '  git push -u origin <tu-rama>\n' +
            'La integracion a main la hace Rafael en un solo push desde el clon principal.',
        };
      }
    }

    if (sub === 'reset' && args.includes('--hard') && !isMainClone(cwdSegmento)) {
      return {
        block: true,
        reason:
          `git reset --hard bloqueado fuera del clon principal (cwd: ${cwdSegmento || 'desconocido'}).\n` +
          'Destruye trabajo sin red de seguridad. Usa git stash o git restore <archivo>.',
      };
    }
  }

  return { block: false };
}

function ramaActual(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: cwd && cwd.length ? cwd : process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500, // el hook entero tiene 5 s; si git se atasca, no lo agotamos
    }).trim();
  } catch {
    return null;
  }
}

function leerStdin() {
  try {
    return require('node:fs').readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let payload;
  try {
    const raw = leerStdin();
    if (!raw || !raw.trim()) process.exit(0);
    payload = JSON.parse(raw);
  } catch {
    process.exit(0); // no se pudo parsear: deja pasar
  }

  try {
    const command = payload && payload.tool_input && payload.tool_input.command;
    const cwd = (payload && payload.cwd) || process.cwd();
    const veredicto = decide(command, cwd, ramaActual);
    if (veredicto.block) {
      process.stderr.write('[git-guard] ' + veredicto.reason + '\n');
      process.exit(2);
    }
  } catch {
    process.exit(0);
  }
  process.exit(0);
}

if (require.main === module) main();

module.exports = { decide, normalizePath, isMainClone, splitSegments, tokenize, limpiarComando };
