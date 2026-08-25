#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════
 * GUARDIA BARBER — garantía mecánica de que el trabajo del vertical
 * barber NO toca el producto dental (que está VIVO en producción).
 *
 * Uso:
 *   node scripts/barber-guard.cjs
 *
 * Qué revisa: los archivos cambiados respecto a origin/main (commits de la
 * rama + staged + working tree + untracked) y los clasifica en:
 *   1. PROPIOS de barber  → permitidos siempre.
 *   2. COMPARTIDOS        → permitidos SOLO si se declaran en la variable
 *      de entorno BARBER_GUARD_SHARED (lista separada por comas).
 *   3. PROHIBIDOS         → cualquier otra cosa. Falla.
 *
 * Cómo declarar excepciones (SOLO archivos de la lista COMPARTIDA):
 *   BARBER_GUARD_SHARED="prisma/schema.prisma,src/lib/auth.ts" \
 *     node scripts/barber-guard.cjs
 *   (En PowerShell: $env:BARBER_GUARD_SHARED="prisma/schema.prisma"; node ...)
 *
 * Exit 0 → limpio (sin prohibidos ni compartidos sin declarar).
 * Exit 1 → "GUARDIA BARBER: se tocaron archivos fuera del vertical".
 *
 * Sin dependencias externas: solo child_process + path.
 * ═══════════════════════════════════════════════════════════════════════ */
"use strict";

const { execSync } = require("child_process");
const path = require("path");

// ── 1. Reglas de clasificación ─────────────────────────────────────────
// PROPIO de barber: prefijos de carpeta (deben terminar en "/").
const OWN_PREFIXES = [
  "src/app/barber/",
  "src/app/b/", // páginas públicas de barbería (mini-web + reserva)
  "src/app/barberias/", // landing pública del vertical (/barberias)
  "src/components/public/barberias/", // secciones de esa landing
  "src/app/api/barber/",
  "src/components/barber/",
  "src/lib/barber/",
  "src/i18n/dictionaries/barber/",
  // Sección BARBERÍAS del panel de plataforma. Viven bajo src/app/admin/**
  // y src/components/admin/** porque ahí es donde el admin las espera, pero
  // son carpetas EXCLUSIVAS del vertical: nada del dental las importa. Todo
  // lo demás de src/app/admin/** sigue siendo PROHIBIDO.
  "src/app/admin/barberias/",
  "src/app/api/admin/barberias/",
  "src/components/admin/barberias/",
  // Páginas públicas de COMPARATIVA del vertical (/barberias/comparar/**).
  // Se escribieron en paralelo con la landing, y por eso cada terminal
  // declaró lo suyo: ella el árbol completo `src/app/barberias/` (arriba),
  // ésta sólo su sub-árbol `comparar/`. Con los dos renglones puestos, éstos
  // ya quedan CUBIERTOS por los de arriba y son redundantes; se conservan a
  // propósito, porque documentan de quién es la carpeta y no cuestan nada.
  "src/app/barberias/comparar/",
  "src/components/public/barberias/comparar/",
];

// PROPIO de barber: archivos exactos.
const OWN_FILES = ["src/lib/barber-auth.ts", "scripts/barber-guard.cjs"];

// PROPIO de barber: patrones especiales.
function matchesOwnPattern(p) {
  // sql/barber*.sql
  if (p.startsWith("sql/barber") && p.endsWith(".sql")) return true;
  // prisma/migrations/*barber*/**
  if (p.startsWith("prisma/migrations/")) {
    const dir = p.split("/")[2] || "";
    if (dir.includes("barber")) return true;
  }
  return false;
}

// COMPARTIDO: solo pasan si aparecen en BARBER_GUARD_SHARED.
const SHARED_FILES = [
  "prisma/schema.prisma",
  "src/lib/auth.ts",
  "tailwind.config.ts",
  "src/app/globals.css",
  "src/lib/whatsapp.ts",
  "src/app/api/whatsapp/webhook/route.ts",
  "ORQUESTA.md",
  "src/app/sitemap.ts",
  // Sidebar del panel de plataforma: compartido con el dental (VIVO). Sólo
  // se declara para AÑADIR una entrada de menú del vertical; cualquier otro
  // cambio ahí se revisa a mano.
  "src/app/admin/admin-nav.tsx",
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

const declared = (process.env.BARBER_GUARD_SHARED || "")
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
console.log("GUARDIA BARBER — archivos cambiados vs origin/main: " + files.length);
console.log("════════════════════════════════════════════════════════");
printList("✅ PROPIOS del vertical barber", own, "·");
printList("🟡 COMPARTIDOS declarados (BARBER_GUARD_SHARED)", sharedDeclared, "·");
printList("🔶 COMPARTIDOS SIN declarar", sharedUndeclared, "✗");
printList("⛔ PROHIBIDOS (fuera del vertical)", forbidden, "✗");
console.log("");

if (forbidden.length > 0 || sharedUndeclared.length > 0) {
  console.error("GUARDIA BARBER: se tocaron archivos fuera del vertical");
  for (const p of [...sharedUndeclared, ...forbidden]) console.error("  ✗ " + p);
  if (sharedUndeclared.length > 0) {
    console.error("");
    console.error(
      "Los COMPARTIDOS se declaran así: BARBER_GUARD_SHARED=\"" +
        sharedUndeclared.join(",") +
        "\" node scripts/barber-guard.cjs",
    );
  }
  process.exit(1);
}

console.log("GUARDIA BARBER: OK — todo dentro del vertical.");
process.exit(0);
