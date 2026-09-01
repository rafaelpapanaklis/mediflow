#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
 * GUARDIA INSTITUCIONAL — garantía mecánica de que el trabajo del vertical
 * DaleControl Institucional (escuelas de especialidades odontológicas) NO
 * toca el producto dental, que está VIVO en producción.
 *
 * Uso:
 *   node scripts/edu-guard.cjs
 *
 * Qué revisa: los archivos cambiados respecto a origin/main (commits de la
 * rama + staged + working tree + untracked) y los clasifica en:
 *   1. PROPIOS del vertical  → permitidos siempre.
 *   2. COMPARTIDOS           → permitidos SOLO si se declaran en la variable
 *      de entorno EDU_GUARD_SHARED (lista separada por comas).
 *   3. PROHIBIDOS            → cualquier otra cosa. Falla.
 *
 * Cómo declarar excepciones (SOLO archivos de la lista COMPARTIDA):
 *   EDU_GUARD_SHARED="prisma/schema.prisma,src/middleware.ts,ORQUESTA.md" \
 *     node scripts/edu-guard.cjs
 *   (En PowerShell: $env:EDU_GUARD_SHARED="prisma/schema.prisma"; node ...)
 *
 * Exit 0 → limpio (sin prohibidos ni compartidos sin declarar).
 * Exit 1 → "GUARDIA INSTITUCIONAL: se tocaron archivos fuera del vertical".
 *
 * Sin dependencias externas: solo child_process + path.
 * ═══════════════════════════════════════════════════════════════════════ */
"use strict";

const { execSync } = require("child_process");

// ── 1. Reglas de clasificación ─────────────────────────────────────────
// PROPIO del vertical: prefijos de carpeta (deben terminar en "/").
//
// ⚠️ Una carpeta NUEVA no queda indultada por estar cerca: si una ola
// futura crea, por ejemplo, src/i18n/dictionaries/edu/, tiene que agregar
// ese prefijo AQUÍ. Mientras no esté, el guard la marca prohibida — que es
// exactamente lo que queremos que pase antes de que alguien la empuje.
const OWN_PREFIXES = [
  "src/app/instituto/",
  "src/app/api/instituto/",
  "src/components/edu/",
  "src/lib/edu/",
];

// PROPIO del vertical: archivos exactos.
const OWN_FILES = [
  "src/lib/edu-auth.ts",
  "scripts/edu-guard.cjs",
  "scripts/edu-tests.cjs",
  // El sembrador del instituto de DEMO. Es PROPIO y no COMPARTIDO: no
  // toca una linea del dental, solo escribe filas edu_* de un instituto
  // con slug propio, y se niega a correr si el destino no es el suyo.
  "scripts/edu-seed-demo.ts",
];

// PROPIO del vertical: patrones especiales.
function matchesOwnPattern(p) {
  // sql/edu-*.sql
  if (p.startsWith("sql/edu-") && p.endsWith(".sql")) return true;
  // docs/audits/EDU_*.md — la auditoría del vertical y sus marcas de
  // arreglado. Es prosa SOBRE el instituto y no toca una línea del dental;
  // se agrega aquí, que es lo que el aviso de arriba pide hacer con
  // cualquier ruta nueva del vertical, en vez de declararla "compartida"
  // (la lista de compartidos es corta a propósito: cada renglón suyo es un
  // pedazo del dental que el vertical se permite tocar, y esto no lo es).
  if (p.startsWith("docs/audits/EDU_") && p.endsWith(".md")) return true;
  return false;
}

// COMPARTIDO: solo pasan si aparecen en EDU_GUARD_SHARED. La lista es
// CORTA a propósito — cada renglón nuevo aquí es un pedazo del dental que
// el vertical se permite tocar.
//
// `package.json` entra aquí al cerrar el P3-15 de la auditoría: el script
// `test:edu` que corre las pruebas del vertical no puede vivir en ningún
// otro lado. Va de COMPARTIDO y no de PROPIO a propósito — es el manifiesto
// de TODO el repo, y una ola del instituto que lo toque sin decirlo sigue
// siendo un fallo. Declarándolo, el guard obliga a que el cambio se vea:
//   EDU_GUARD_SHARED="package.json" node scripts/edu-guard.cjs
const SHARED_FILES = [
  "prisma/schema.prisma",
  "src/middleware.ts",
  "ORQUESTA.md",
  "package.json",
];

function isOwn(p) {
  if (OWN_FILES.includes(p)) return true;
  if (OWN_PREFIXES.some((pre) => p.startsWith(pre))) return true;
  return matchesOwnPattern(p);
}

function isShared(p) {
  return SHARED_FILES.includes(p);
}

// ── 2. Archivos cambiados respecto a origin/main ───────────────────────
function sh(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    // Un diff sin base (p.ej. sin origin/main) no debe tumbar el guard:
    // devolvemos lo que haya salido y seguimos con las otras fuentes.
    return e && e.stdout ? String(e.stdout) : "";
  }
}

function gitRoot() {
  const out = sh("git rev-parse --show-toplevel").trim();
  return out || process.cwd();
}

function collectChangedFiles() {
  const sources = [
    sh("git diff --name-only origin/main...HEAD"), // commits de la rama
    sh("git diff --name-only --cached"), // staged
    sh("git diff --name-only"), // working tree (tracked)
    sh("git ls-files --others --exclude-standard"), // untracked nuevos
  ];
  const set = new Set();
  for (const block of sources) {
    for (const raw of block.split(/\r?\n/)) {
      const p = raw.trim();
      if (p) set.add(p.replace(/\\/g, "/"));
    }
  }
  return Array.from(set).sort();
}

// ── 3. Clasificar y reportar ───────────────────────────────────────────
process.chdir(gitRoot());

const declared = (process.env.EDU_GUARD_SHARED || "")
  .split(",")
  .map((s) => s.trim().replace(/\\/g, "/"))
  .filter(Boolean);

const files = collectChangedFiles();
const own = [];
const sharedDeclared = [];
const sharedUndeclared = [];
const forbidden = [];

for (const p of files) {
  if (isOwn(p)) own.push(p);
  else if (isShared(p)) {
    if (declared.includes(p)) sharedDeclared.push(p);
    else sharedUndeclared.push(p);
  } else forbidden.push(p);
}

function printList(title, list, mark) {
  console.log("");
  console.log(title + " (" + list.length + ")");
  if (list.length === 0) console.log("  (ninguno)");
  for (const p of list) console.log("  " + mark + " " + p);
}

console.log("════════════════════════════════════════════════════════");
console.log("GUARDIA INSTITUCIONAL — archivos cambiados vs origin/main: " + files.length);
console.log("════════════════════════════════════════════════════════");
printList("✅ PROPIOS del vertical instituto", own, "·");
printList("🟡 COMPARTIDOS declarados (EDU_GUARD_SHARED)", sharedDeclared, "·");
printList("🔶 COMPARTIDOS SIN declarar", sharedUndeclared, "✗");
printList("⛔ PROHIBIDOS (fuera del vertical)", forbidden, "✗");
console.log("");

if (forbidden.length > 0 || sharedUndeclared.length > 0) {
  console.error("GUARDIA INSTITUCIONAL: se tocaron archivos fuera del vertical");
  for (const p of [...sharedUndeclared, ...forbidden]) console.error("  ✗ " + p);
  if (sharedUndeclared.length > 0) {
    console.error("");
    console.error(
      'Los COMPARTIDOS se declaran así: EDU_GUARD_SHARED="' +
        sharedUndeclared.join(",") +
        '" node scripts/edu-guard.cjs',
    );
  }
  process.exit(1);
}

console.log("GUARDIA INSTITUCIONAL: OK — todo dentro del vertical.");
process.exit(0);
