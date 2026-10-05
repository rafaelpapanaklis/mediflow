#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════════
// `next build` con el heap de V8 a la medida de la máquina (ws1-t5, encargo 8).
//
// POR QUÉ: Node NO usa toda la memoria de la máquina para el heap. Su tope por
// defecto es ~¼ de la RAM y nunca pasa de ~4 GB (medido: 2 GB en una de 8 GB,
// 4 GB en una de 377 GB). El build de este repo, en frío, necesita bastante más,
// así que con el tope por defecto muere compilando aunque la máquina tenga RAM de
// sobra. Y un tope FIJO tampoco sirve en Vercel «Elastic» (8–60 GB según el
// build): 6 GB ahoga a la de 60 GB, y 16 GB en la de 8 GB deja que V8 pida más
// memoria de la que existe («Fatal process out of memory: Worklist::Segment::Create»,
// el fallo de 36ae2dc2).
//
// QUÉ HACE: pone --max-old-space-size al 75 % de la memoria real (la del
// contenedor si hay límite de cgroup), dejando el 25 % para el resto de procesos
// del build (los workers de páginas, prisma, el sistema), con un TECHO de 8 GB
// (ver TECHO_MB). 8 GB → 6144 MB; 16 GB → 8192 MB; 60 GB → 8192 MB.
// Si ya viene un --max-old-space-size en NODE_OPTIONS (p. ej.
// `NODE_OPTIONS=--max-old-space-size=8192 npm run build`), se respeta tal cual.
// Es Node puro: funciona igual en Linux (Vercel) y en Windows, sin cross-env.
// ════════════════════════════════════════════════════════════════════════════
"use strict";

const os = require("node:os");
const { spawnSync } = require("node:child_process");

const FRACCION = 0.75;
const MINIMO_MB = 2048;
// Techo: lo que el build de verdad necesita, medido el 5-oct-2026 en frío con 8 CPU y
// sin la caché de webpack (next.config.mjs): la compilación cabe en 6 GB de heap, pero el
// chequeo de tipos del build (otro proceso, que hereda NODE_OPTIONS) pide más de 6 GB, y
// con 8 GB pasa (el mismo heap que usa `npm run typecheck`). Con 8 GB el build cupo en una
// máquina de 16 GB con un pico de 10.7 GB (proceso + hijos) y fue el más rápido (793 s).
// Más heap NO lo hace más rápido: V8 crece hasta el techo antes de recoger basura, y
// Vercel Elastic elige la máquina del siguiente build por la memoria que usaron los
// anteriores. Sin techo, en la de 60 GB se iría a ~17-22 GB y empujaría a máquinas más
// grandes (y más caras) sin necesidad.
const TECHO_MB = 8192;

/** Bytes de memoria que de verdad tiene el proceso: la RAM o el límite del contenedor, el menor. */
function memoriaDeLaMaquina() {
  const total = os.totalmem();
  let limite = 0;
  try {
    // Node ≥ 19: el límite del cgroup (contenedor). 0 o un número enorme = sin límite.
    limite = typeof process.constrainedMemory === "function" ? Number(process.constrainedMemory()) : 0;
  } catch {
    limite = 0;
  }
  return limite > 0 && limite < total ? limite : total;
}

/** El heap (MB) para una máquina con `bytes` de memoria: el 75 %, entre 2 GB y el techo. */
function heapParaMaquina(bytes) {
  return Math.min(TECHO_MB, Math.max(MINIMO_MB, Math.floor((bytes / 2 ** 20) * FRACCION)));
}

/** NODE_OPTIONS con el heap; si ya trae un --max-old-space-size, lo deja como está. */
function nodeOptionsConHeap(actual, heapMb) {
  const base = (actual || "").trim();
  if (/--max[-_]old[-_]space[-_]size=\d+/.test(base)) return base;
  return `${base} --max-old-space-size=${heapMb}`.trim();
}

module.exports = { memoriaDeLaMaquina, heapParaMaquina, nodeOptionsConHeap };

if (require.main === module) {
  const bytes = memoriaDeLaMaquina();
  const NODE_OPTIONS = nodeOptionsConHeap(process.env.NODE_OPTIONS, heapParaMaquina(bytes));
  console.log(`[build] memoria ${(bytes / 2 ** 30).toFixed(1)} GB → NODE_OPTIONS="${NODE_OPTIONS}"`);
  const r = spawnSync(process.execPath, [require.resolve("next/dist/bin/next"), "build", ...process.argv.slice(2)], {
    stdio: "inherit",
    env: { ...process.env, NODE_OPTIONS },
  });
  if (r.error) {
    console.error("[build] no se pudo lanzar next build:", r.error.message);
    process.exit(1);
  }
  if (r.signal) {
    console.error(`[build] next build terminó por la señal ${r.signal}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}
