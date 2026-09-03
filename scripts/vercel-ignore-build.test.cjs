const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const { decide, esSoloDocs } = require('./vercel-ignore-build.cjs');

// Contrato de Vercel: skip=true -> exit 0 (SALTAR) | skip=false -> exit 1 (CONSTRUIR)
const diffQueDevuelve = (...archivos) => () => archivos.join('\n');
const diffQueFalla = () => {
  throw new Error('fatal: bad object 0000000');
};

// --- (a) filtro de rama del panel ------------------------------------------

test('rama normal fuera de produccion: SALTA (replica el Ignored Build Step)', () => {
  const r = decide({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/x' }, diffQueFalla);
  assert.strictEqual(r.skip, true);
  assert.match(r.log, /SALTAR/);
});

test('chore/workspace-ola1 (esta misma rama) SALTA: es el gate G1 del PR', () => {
  const r = decide(
    { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'chore/workspace-ola1', VERCEL_GIT_PREVIOUS_SHA: 'aaa', VERCEL_GIT_COMMIT_SHA: 'bbb' },
    diffQueDevuelve('src/app/page.tsx')
  );
  assert.strictEqual(r.skip, true, 'aunque toque codigo, la rama no es preview/* ni produccion');
});

test('preview/x SI pasa el filtro de rama y llega a la decision por archivos', () => {
  const sinSha = decide({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'preview/x' }, diffQueFalla);
  assert.strictEqual(sinSha.skip, false, 'sin PREVIOUS_SHA se construye');

  const conCodigo = decide(
    { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'preview/x', VERCEL_GIT_PREVIOUS_SHA: 'aaa', VERCEL_GIT_COMMIT_SHA: 'bbb' },
    diffQueDevuelve('src/lib/plans.ts')
  );
  assert.strictEqual(conCodigo.skip, false);
});

// --- (b) sin SHA previo -----------------------------------------------------

test('produccion sin VERCEL_GIT_PREVIOUS_SHA: CONSTRUYE', () => {
  const r = decide({ VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_COMMIT_SHA: 'bbb' }, diffQueFalla);
  assert.strictEqual(r.skip, false);
  assert.match(r.log, /PREVIOUS_SHA/);
});

// --- (c) el diff falla ------------------------------------------------------

test('produccion con diff que falla (clon shallow): CONSTRUYE', () => {
  const r = decide(
    { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_PREVIOUS_SHA: 'aaa', VERCEL_GIT_COMMIT_SHA: 'bbb' },
    diffQueFalla
  );
  assert.strictEqual(r.skip, false);
  assert.match(r.log, /diff fallo/);
});

// --- (d) clasificacion de archivos -----------------------------------------

const baseProd = { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_PREVIOUS_SHA: 'aaa', VERCEL_GIT_COMMIT_SHA: 'bbb' };

test('produccion con solo README.md: SALTA', () => {
  assert.strictEqual(decide(baseProd, diffQueDevuelve('README.md')).skip, true);
});

test('produccion con solo src/x.ts: CONSTRUYE', () => {
  const r = decide(baseProd, diffQueDevuelve('src/x.ts'));
  assert.strictEqual(r.skip, false);
  assert.match(r.log, /CONSTRUIR/);
});

test('produccion con un solo archivo de codigo entre muchos docs: CONSTRUYE', () => {
  const r = decide(baseProd, diffQueDevuelve('docs/a.md', 'sql/b.sql', '.gitignore', 'src/lib/plans.ts'));
  assert.strictEqual(r.skip, false, 'basta un archivo de codigo para no saltar');
});

test('produccion con el set completo de rutas de documentacion: SALTA', () => {
  const r = decide(
    baseProd,
    diffQueDevuelve('README.md', 'docs/PERF.md', 'sql/plan_configs.sql', '.claude/settings.json', '.gitignore', 'LICENSE')
  );
  assert.strictEqual(r.skip, true);
});

test('produccion con diff vacio: CONSTRUYE (ante la duda, construir)', () => {
  assert.strictEqual(decide(baseProd, diffQueDevuelve()).skip, false);
  assert.strictEqual(decide(baseProd, () => '\n  \n').skip, false);
});

test('esSoloDocs no confunde rutas parecidas con las de documentacion', () => {
  assert.ok(esSoloDocs('ORQUESTA.md'));
  assert.ok(esSoloDocs('docs/audits/EDU_1.md'));
  assert.ok(esSoloDocs('sql/realty-rent.sql'));
  assert.ok(!esSoloDocs('src/docs/page.tsx'), 'docs/ solo cuenta en la raiz');
  assert.ok(!esSoloDocs('src/components/sql/query.ts'));
  assert.ok(!esSoloDocs('package.json'));
  assert.ok(!esSoloDocs('prisma/schema.prisma'));
  assert.ok(!esSoloDocs('src/app/page.mdx'), 'mdx no es md: se construye');
});

// --- extremo a extremo contra un repo git real en os.tmpdir() ---------------

test('extremo a extremo: repo temporal real, exit 0 solo-docs y exit 1 con codigo', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-ignore-'));
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const script = path.join(__dirname, 'vercel-ignore-build.cjs');
  const correr = (env) =>
    spawnSync(process.execPath, [script], { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } });

  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');

    fs.writeFileSync(path.join(repo, 'README.md'), 'v1\n');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src', 'x.ts'), 'export const a = 1;\n');
    git('add', '-A');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');

    fs.appendFileSync(path.join(repo, 'README.md'), 'v2\n');
    git('add', '-A');
    git('commit', '-qm', 'docs');
    const soloDocs = git('rev-parse', 'HEAD');

    fs.appendFileSync(path.join(repo, 'src', 'x.ts'), 'export const b = 2;\n');
    git('add', '-A');
    git('commit', '-qm', 'codigo');
    const conCodigo = git('rev-parse', 'HEAD');

    const salta = correr({
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: 'main',
      VERCEL_GIT_PREVIOUS_SHA: base,
      VERCEL_GIT_COMMIT_SHA: soloDocs,
    });
    assert.strictEqual(salta.status, 0, `esperaba SALTAR (0), salio ${salta.status}: ${salta.stdout}${salta.stderr}`);
    assert.match(salta.stdout, /SALTAR/);

    const construye = correr({
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: 'main',
      VERCEL_GIT_PREVIOUS_SHA: soloDocs,
      VERCEL_GIT_COMMIT_SHA: conCodigo,
    });
    assert.strictEqual(construye.status, 1, `esperaba CONSTRUIR (1), salio ${construye.status}`);
    assert.match(construye.stdout, /CONSTRUIR/);

    const shaInexistente = correr({
      VERCEL_ENV: 'production',
      VERCEL_GIT_COMMIT_REF: 'main',
      VERCEL_GIT_PREVIOUS_SHA: '0000000000000000000000000000000000000000',
      VERCEL_GIT_COMMIT_SHA: conCodigo,
    });
    assert.strictEqual(shaInexistente.status, 1, 'un SHA ausente (clon shallow) debe CONSTRUIR');

    const ramaNormal = correr({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feat/x' });
    assert.strictEqual(ramaNormal.status, 0, 'una rama que no es preview/* debe SALTAR');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ===========================================================================
// Regresiones del refutador (ola 1).
// ===========================================================================

test('V1: un VERCEL_ENV desconocido o vacio CONSTRUYE, nunca salta', () => {
  const diffCodigo = diffQueDevuelve('src/app/page.tsx');
  for (const valor of [undefined, '', '   ', 'produccion', 'prod', 'staging']) {
    const env = { VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_PREVIOUS_SHA: 'a', VERCEL_GIT_COMMIT_SHA: 'b' };
    if (valor !== undefined) env.VERCEL_ENV = valor;
    const r = decide(env, diffCodigo);
    assert.strictEqual(r.skip, false, `VERCEL_ENV=${JSON.stringify(valor)} no debe saltar`);
    assert.match(r.log, /CONSTRUIR/);
  }
});

test('V1b: production con mayusculas o espacios sigue siendo produccion', () => {
  for (const valor of ['Production', 'PRODUCTION', ' production\n']) {
    const r = decide(
      { VERCEL_ENV: valor, VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_PREVIOUS_SHA: 'a', VERCEL_GIT_COMMIT_SHA: 'b' },
      diffQueDevuelve('src/app/page.tsx')
    );
    assert.strictEqual(r.skip, false, `VERCEL_ENV=${JSON.stringify(valor)} debe construir codigo`);
  }
  const docs = decide(
    { VERCEL_ENV: 'Production', VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_PREVIOUS_SHA: 'a', VERCEL_GIT_COMMIT_SHA: 'b' },
    diffQueDevuelve('README.md')
  );
  assert.strictEqual(docs.skip, true, 'y solo-docs sigue saltando');
});

test('M6: la rama se compara sin refs/heads/ y sin distinguir mayusculas', () => {
  for (const ref of ['preview/x', 'Preview/x', 'refs/heads/preview/x', 'PREVIEW/algo']) {
    const r = decide({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: ref }, diffQueFalla);
    assert.strictEqual(r.skip, false, `${ref} debe pasar el filtro de rama y construir`);
  }
  assert.strictEqual(decide({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'refs/heads/feat/x' }, diffQueFalla).skip, true);
});

test('V2: un rename de codigo a docs NO salta el build (--no-renames)', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-rename-'));
  const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const script = path.join(__dirname, 'vercel-ignore-build.cjs');
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('config', 'commit.gpgsign', 'false');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.mkdirSync(path.join(repo, 'docs'));
    fs.writeFileSync(path.join(repo, 'src', 'x.ts'), 'export const a = 1;\n'.repeat(20));
    git('add', '-A');
    git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');

    git('mv', 'src/x.ts', 'docs/x.md');
    git('commit', '-qm', 'rename a docs');
    const tras = git('rev-parse', 'HEAD');

    // Sin --no-renames git solo listaria docs/x.md y saltariamos un build que borro codigo.
    const conRenames = git('diff', '--name-only', base, tras);
    assert.strictEqual(conRenames, 'docs/x.md', 'precondicion: git colapsa el rename');

    const r = spawnSync(process.execPath, [script], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main', VERCEL_GIT_PREVIOUS_SHA: base, VERCEL_GIT_COMMIT_SHA: tras },
    });
    assert.strictEqual(r.status, 1, `un rename que saca codigo de src/ debe CONSTRUIR: ${r.stdout}`);
    assert.match(r.stdout, /src\/x\.ts/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
