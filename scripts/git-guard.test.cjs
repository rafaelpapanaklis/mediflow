const test = require('node:test');
const assert = require('node:assert');
const { decide, normalizePath, isMainClone } = require('./git-guard.cjs');

const CLON = 'C:\\Users\\Rafael\\Documents\\GitHub\\mediflow';
const WORKTREE = 'C:\\Users\\Rafael\\Documents\\GitHub\\mediflow-worktrees\\barber-caja';

const enMain = () => 'main';
const enRama = () => 'chore/workspace-ola1';

// --- normalizacion de rutas -------------------------------------------------

test('normalizePath unifica barras, mayusculas y prefijo de Git Bash', () => {
  assert.strictEqual(normalizePath(CLON), 'c:/users/rafael/documents/github/mediflow');
  assert.strictEqual(normalizePath('/c/Users/Rafael/Documents/GitHub/mediflow'), 'c:/users/rafael/documents/github/mediflow');
  assert.strictEqual(normalizePath('C:/Users/Rafael/Documents/GitHub/mediflow/'), 'c:/users/rafael/documents/github/mediflow');
});

test('isMainClone distingue el clon principal de mediflow-worktrees', () => {
  assert.ok(isMainClone(CLON));
  assert.ok(isMainClone(CLON + '\\src\\lib'), 'un subdirectorio del clon sigue siendo el clon');
  assert.ok(!isMainClone(WORKTREE), 'mediflow-worktrees NO es el clon aunque empiece igual');
  assert.ok(!isMainClone('C:/Users/Rafael/Documents/GitHub/mediflow2'));
});

// --- formas de push a main desde un worktree (todas bloqueadas) -------------

const FORMAS_PUSH_MAIN = [
  'git push origin main',
  'git push -u origin main',
  'git push --set-upstream origin main',
  'git push origin HEAD:main',
  'git push origin HEAD:refs/heads/main',
  'git push origin main:main',
  'git push origin +main',
  'git push origin refs/heads/main',
  'git push origin master',
];

for (const cmd of FORMAS_PUSH_MAIN) {
  test(`bloquea desde worktree: ${cmd}`, () => {
    const r = decide(cmd, WORKTREE, enRama);
    assert.strictEqual(r.block, true, `deberia bloquear: ${cmd}`);
    assert.match(r.reason, /main/i);
  });
}

test('push sin argumentos estando en main se bloquea desde un worktree', () => {
  assert.strictEqual(decide('git push', WORKTREE, enMain).block, true);
  assert.strictEqual(decide('git push origin', WORKTREE, enMain).block, true);
});

test('push sin argumentos estando en una rama normal pasa', () => {
  assert.strictEqual(decide('git push', WORKTREE, enRama).block, false);
});

// --- push a tu propia rama: siempre pasa -----------------------------------

test('push a tu rama pasa desde un worktree', () => {
  assert.strictEqual(decide('git push -u origin chore/workspace-ola1', WORKTREE, enRama).block, false);
  assert.strictEqual(decide('git push origin HEAD:barber-caja', WORKTREE, enRama).block, false);
  assert.strictEqual(decide('git push origin feat/maintenance', WORKTREE, enRama).block, false);
});

test('una rama que solo contiene "main" en el nombre no se confunde con main', () => {
  assert.strictEqual(decide('git push -u origin feat/maintenance-main-menu', WORKTREE, enRama).block, false);
  assert.strictEqual(decide('git push origin domain', WORKTREE, enRama).block, false);
});

// --- cwd: clon principal vs worktree ---------------------------------------

test('push a main desde el clon principal pasa (es donde integra Rafael)', () => {
  assert.strictEqual(decide('git push origin main', CLON, enMain).block, false);
  assert.strictEqual(decide('git push', CLON, enMain).block, false);
  assert.strictEqual(decide('git push origin HEAD:main', CLON + '\\src', enMain).block, false);
});

test('git -C apuntando al clon principal no burla la comprobacion de cwd', () => {
  // -C hacia el clon principal: permitido, es equivalente a estar ahi
  assert.strictEqual(decide(`git -C ${CLON} push origin main`, WORKTREE, enMain).block, false);
  // -C hacia un worktree desde el clon principal: bloqueado
  assert.strictEqual(decide(`git -C ${WORKTREE} push origin main`, CLON, enMain).block, true);
});

test('un cd previo dentro del mismo comando cambia el cwd efectivo', () => {
  assert.strictEqual(decide(`cd ${WORKTREE} && git push origin main`, CLON, enMain).block, true);
  assert.strictEqual(decide(`cd ${CLON} && git push origin main`, WORKTREE, enMain).block, false);
});

// --- force push: bloqueado SIEMPRE, incluso en el clon principal ------------

test('cualquier push forzado se bloquea, tambien en el clon principal', () => {
  for (const cmd of [
    'git push --force origin chore/workspace-ola1',
    'git push -f origin chore/workspace-ola1',
    'git push --force-with-lease origin main',
    'git push origin main --force',
  ]) {
    const r = decide(cmd, CLON, enRama);
    assert.strictEqual(r.block, true, `deberia bloquear: ${cmd}`);
    assert.match(r.reason, /forzado/i);
  }
});

// --- reset --hard -----------------------------------------------------------

test('git reset --hard se bloquea fuera del clon principal y pasa dentro', () => {
  assert.strictEqual(decide('git reset --hard origin/main', WORKTREE, enRama).block, true);
  assert.strictEqual(decide('git reset --hard', WORKTREE, enRama).block, true);
  assert.strictEqual(decide('git reset --hard origin/main', CLON, enRama).block, false);
  assert.strictEqual(decide('git reset --soft HEAD~1', WORKTREE, enRama).block, false);
  assert.strictEqual(decide('git reset src/lib/plans.ts', WORKTREE, enRama).block, false);
});

// --- comandos compuestos ----------------------------------------------------

test('detecta el push a main escondido en un comando compuesto', () => {
  assert.strictEqual(
    decide('npm run build && git add -A && git commit -m "x" && git push origin main', WORKTREE, enRama).block,
    true
  );
});

// --- todo lo demas pasa; nunca truena --------------------------------------

test('comandos inocuos pasan', () => {
  for (const cmd of [
    'npm run build',
    'git status',
    'git log --oneline -20',
    'git fetch origin main',
    'git merge origin/main',
    'git checkout main',
    'echo "git push origin main"',
    'node scripts/git-guard.test.cjs',
  ]) {
    assert.strictEqual(decide(cmd, WORKTREE, enRama).block, false, `deberia pasar: ${cmd}`);
  }
});

test('entradas vacias o invalidas no truenan y dejan pasar', () => {
  assert.strictEqual(decide('', WORKTREE, enRama).block, false);
  assert.strictEqual(decide(undefined, WORKTREE, enRama).block, false);
  assert.strictEqual(decide(null, undefined, enRama).block, false);
  assert.strictEqual(decide(123, WORKTREE, enRama).block, false);
});

test('si no se puede averiguar la rama actual, el push desnudo pasa', () => {
  assert.strictEqual(decide('git push', WORKTREE, () => null).block, false);
});

// --- el binario responde al contrato del hook -------------------------------

test('el CLI sale 2 ante un push a main y 0 ante stdin vacio', () => {
  const { spawnSync } = require('node:child_process');
  const guard = require('node:path').join(__dirname, 'git-guard.cjs');

  const bloqueado = spawnSync(process.execPath, [guard], {
    input: JSON.stringify({ tool_input: { command: 'git push origin main' }, cwd: WORKTREE }),
    encoding: 'utf8',
  });
  assert.strictEqual(bloqueado.status, 2);
  assert.match(bloqueado.stderr, /git-guard/);

  const vacio = spawnSync(process.execPath, [guard], { input: '', encoding: 'utf8' });
  assert.strictEqual(vacio.status, 0);

  const basura = spawnSync(process.execPath, [guard], { input: 'no soy json {{{', encoding: 'utf8' });
  assert.strictEqual(basura.status, 0);

  const ok = spawnSync(process.execPath, [guard], {
    input: JSON.stringify({ tool_input: { command: 'git push -u origin mi-rama' }, cwd: WORKTREE }),
    encoding: 'utf8',
  });
  assert.strictEqual(ok.status, 0);
});

// ===========================================================================
// Regresiones del refutador (ola 1). Cada test lleva su etiqueta del reporte.
// ===========================================================================

test('C1: git push origin HEAD estando en main se bloquea', () => {
  for (const cmd of ['git push origin HEAD', 'git push -u origin HEAD', 'git push origin HEAD:HEAD']) {
    assert.strictEqual(decide(cmd, WORKTREE, enMain).block, true, `deberia bloquear: ${cmd}`);
  }
  // en una rama normal, HEAD es tu rama: pasa
  assert.strictEqual(decide('git push origin HEAD', WORKTREE, enRama).block, false);
});

test('C2: --all / --mirror / --branches empujan main y se bloquean fuera del clon', () => {
  for (const cmd of ['git push --all origin', 'git push --mirror origin', 'git push origin --branches']) {
    const r = decide(cmd, WORKTREE, enRama);
    assert.strictEqual(r.block, true, `deberia bloquear: ${cmd}`);
    assert.match(r.reason, /TODAS las ramas/);
  }
  assert.strictEqual(decide('git push --all origin', CLON, enRama).block, false);
});

test('C3: un refspec con comodin se bloquea (no se puede probar que no toque main)', () => {
  assert.strictEqual(decide('git push origin refs/heads/*', WORKTREE, enRama).block, true);
  assert.strictEqual(decide('git push origin +refs/heads/*:refs/heads/*', WORKTREE, enRama).block, true);
});

test('C4: continuacion de linea (backtick de PowerShell, backslash de bash)', () => {
  assert.strictEqual(decide('git push `\n  origin main', WORKTREE, enRama).block, true);
  assert.strictEqual(decide('git push \\n  origin main', WORKTREE, enRama).block, true);
});

test('C5: wrappers de shell no esconden el push', () => {
  for (const cmd of [
    'bash -c "git push origin main"',
    'sh -c \'git push origin main\'',
    'powershell -Command "git push origin main"',
    'cmd /c "git push origin main"',
  ]) {
    assert.strictEqual(decide(cmd, WORKTREE, enRama).block, true, `deberia bloquear: ${cmd}`);
  }
  assert.strictEqual(decide('bash -c "npm run build"', WORKTREE, enRama).block, false);
});

test('C6: git se detecta por nombre de binario, no por string exacto', () => {
  for (const cmd of [
    'GIT push origin main',
    'Git push origin main',
    '/usr/bin/git push origin main',
    '"C:/Program Files/Git/cmd/git" push origin main',
    'git.exe push origin main',
  ]) {
    assert.strictEqual(decide(cmd, WORKTREE, enRama).block, true, `deberia bloquear: ${cmd}`);
  }
});

test('C7: un cd al principio del segmento no oculta el resto', () => {
  assert.strictEqual(decide('cd /tmp & git push origin main', WORKTREE, enRama).block, true);
  assert.strictEqual(decide(`cd ${WORKTREE} && git push origin main`, CLON, enMain).block, true);
});

test('C8: --repo desplaza el remoto y el refspec sigue detectandose', () => {
  assert.strictEqual(decide('git push --repo origin main', WORKTREE, enRama).block, true);
  assert.strictEqual(decide('git push --exec=x origin main', WORKTREE, enRama).block, true);
});

test('C9: comillas partidas dentro del token no ofuscan la rama', () => {
  assert.strictEqual(decide('git push origin ma"in"', WORKTREE, enRama).block, true);
  assert.strictEqual(decide("git push origin 'ma'in", WORKTREE, enRama).block, true);
});

test('M1: documentar el flujo de git no se bloquea (heredoc y -m multilinea)', () => {
  const heredoc = "cat > NOTES.md <<'EOF'\nPara integrar:\ngit push origin main\nEOF";
  assert.strictEqual(decide(heredoc, WORKTREE, enRama).block, false);

  const commit = 'git commit -m "fix" -m "antes hacia\ngit push origin main\nahora no"';
  assert.strictEqual(decide(commit, WORKTREE, enRama).block, false);
});

test('M2: echo sin comillas no se interpreta como comando', () => {
  assert.strictEqual(decide('echo git push origin main', WORKTREE, enRama).block, false);
});

test('M3: cd /d de cmd.exe resuelve bien el cwd', () => {
  assert.strictEqual(decide(`cd /d ${CLON} && git push origin main`, WORKTREE, enMain).block, false);
});

test('M4: --force-if-includes a secas no es un push forzado', () => {
  assert.strictEqual(decide('git push --force-if-includes origin feat/x', CLON, enRama).block, false);
  assert.strictEqual(decide('git push --force-with-lease origin feat/x', CLON, enRama).block, true);
});

test('M5: la ruta extendida de Windows sigue siendo el clon principal', () => {
  const extendida = String.raw`\\?\C:\Users\Rafael\Documents\GitHub\mediflow`;
  assert.strictEqual(extendida.slice(0, 4), '\\\\?\\', 'el literal debe ser \\\\?\\C:...');
  assert.ok(isMainClone(extendida));
  assert.strictEqual(decide('git push origin main', extendida, enMain).block, false);
});

test('solo tags no cuenta como push de rama', () => {
  assert.strictEqual(decide('git push origin --tags', WORKTREE, enMain).block, false);
});
