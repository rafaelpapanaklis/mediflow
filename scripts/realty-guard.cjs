#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
 * GUARDIA INMUEBLES — garantía mecánica de que el trabajo del vertical de
 * inmuebles NO toca el producto dental ni el de barbería (los dos VIVOS en
 * producción, con clientes que pagan).
 *
 * Uso:
 *   node scripts/realty-guard.cjs
 *
 * Qué revisa: los archivos cambiados respecto a origin/main (commits de la
 * rama + staged + working tree + untracked) y los clasifica en:
 *   1. PROPIOS de inmuebles → permitidos siempre.
 *   2. COMPARTIDOS          → permitidos SOLO si se declaran en la variable
 *      de entorno REALTY_GUARD_SHARED (lista separada por comas).
 *   3. PROHIBIDOS           → cualquier otra cosa. Falla.
 *
 * Cómo declarar excepciones (SOLO archivos de la lista COMPARTIDA):
 *   REALTY_GUARD_SHARED="prisma/schema.prisma,src/lib/auth.ts" \
 *     node scripts/realty-guard.cjs
 *   (En PowerShell: $env:REALTY_GUARD_SHARED="prisma/schema.prisma"; node ...)
 *
 * OJO: REALTY_GUARD_SHARED no es un comodín. Solo indulta rutas que ya
 * estén en SHARED_FILES; una carpeta nueva del vertical se agrega a
 * OWN_PREFIXES, no a la variable de entorno.
 *
 * Exit 0 → limpio (sin prohibidos ni compartidos sin declarar).
 * Exit 1 → "GUARDIA INMUEBLES: se tocaron archivos fuera del vertical".
 *
 * Sin dependencias externas: solo child_process.
 * ═══════════════════════════════════════════════════════════════════════ */
"use strict";

const { execSync } = require("child_process");

// ── 1. Reglas de clasificación ─────────────────────────────────────────
// PROPIO de inmuebles: prefijos de carpeta (deben terminar en "/").
const OWN_PREFIXES = [
  "src/app/inmobiliaria/", // panel del vertical
  "src/app/i/", // web pública de cada cuenta (/i/[slug])
  "src/app/inmobiliarias/", // landing pública del vertical (RESERVADA)
  "src/app/api/realty/",
  // Crons del vertical. Viven bajo src/app/api/cron/** porque ahí es donde
  // Vercel los busca, pero cada carpeta es EXCLUSIVA de inmuebles y lleva
  // el prefijo "realty-": nada del dental ni de barber las importa. Todo lo
  // demás de src/app/api/cron/** sigue siendo PROHIBIDO.
  "src/app/api/cron/realty-rent/",
  // Feeds públicos del vertical (/feeds/realty/<accountId>/…). Carpeta nueva
  // y EXCLUSIVA de inmuebles: nada del dental ni de barber vive bajo
  // src/app/feeds/. Se agrega aquí y no a REALTY_GUARD_SHARED porque la
  // variable de entorno solo indulta rutas de SHARED_FILES — una carpeta
  // nueva del vertical va a OWN_PREFIXES, como dice la cabecera.
  "src/app/feeds/realty/",
  "src/components/realty/",
  "src/lib/realty/",
  "src/i18n/dictionaries/realty/",
  // Sección INMOBILIARIAS del panel de plataforma. Viven bajo
  // src/app/admin/** y src/components/admin/** porque ahí es donde el admin
  // las espera, pero son carpetas EXCLUSIVAS del vertical: nada del dental
  // ni de barber las importa. Todo lo demás de src/app/admin/** sigue
  // siendo PROHIBIDO.
  "src/app/admin/inmobiliarias/",
  "src/app/api/admin/inmobiliarias/",
  "src/components/admin/inmobiliarias/",
];

// PROPIO de inmuebles: archivos exactos.
const OWN_FILES = ["src/lib/realty-auth.ts", "scripts/realty-guard.cjs"];

// PROPIO de inmuebles: patrones especiales.
function matchesOwnPattern(p) {
  // sql/realty*.sql
  if (p.startsWith("sql/realty") && p.endsWith(".sql")) return true;
  // prisma/migrations/*realty*/**
  if (p.startsWith("prisma/migrations/")) {
    const dir = p.split("/")[2] || "";
    if (dir.includes("realty")) return true;
  }
  return false;
}

// COMPARTIDO: solo pasan si aparecen en REALTY_GUARD_SHARED.
const SHARED_FILES = [
  // Los CUATRO que esta ola tiene permitido tocar:
  "prisma/schema.prisma",
  "src/lib/auth.ts",
  "next.config.mjs", // el archivo del CSP (frame-src de los recorridos)
  "src/app/error.tsx", // límite de error de la raíz
  // Los que necesitarán las olas siguientes, declarados de antemano para
  // que nadie los agregue a escondidas:
  "src/app/admin/admin-nav.tsx", // una entrada de menú del vertical
  "src/app/sitemap.ts", // las rutas públicas /i/[slug]
  "ORQUESTA.md", // el reporte de cada ola
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

const declared = (process.env.REALTY_GUARD_SHARED || "")
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
console.log("GUARDIA INMUEBLES — archivos cambiados vs origin/main: " + files.length);
console.log("════════════════════════════════════════════════════════");
printList("✅ PROPIOS del vertical inmuebles", own, "·");
printList("🟡 COMPARTIDOS declarados (REALTY_GUARD_SHARED)", sharedDeclared, "·");
printList("🔶 COMPARTIDOS SIN declarar", sharedUndeclared, "✗");
printList("⛔ PROHIBIDOS (fuera del vertical)", forbidden, "✗");
console.log("");

if (forbidden.length > 0 || sharedUndeclared.length > 0) {
  console.error("GUARDIA INMUEBLES: se tocaron archivos fuera del vertical");
  for (const p of [...sharedUndeclared, ...forbidden]) console.error("  ✗ " + p);
  if (sharedUndeclared.length > 0) {
    console.error("");
    console.error(
      'Los COMPARTIDOS se declaran así: REALTY_GUARD_SHARED="' +
        sharedUndeclared.join(",") +
        '" node scripts/realty-guard.cjs',
    );
  }
  process.exit(1);
}

console.log("GUARDIA INMUEBLES: OK — todo dentro del vertical.");
process.exit(0);
