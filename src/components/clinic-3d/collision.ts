// ─────────────────────────────────────────────────────────────────────────────
// A6 — Sistema de colisiones. AABB por celda ocupada + clamp a los límites del
// piso, con DESLIZAMIENTO sobre las paredes (resolver ejes por separado).
//
// TODO(A6): implementar createCollisionSystem según este brief.
//
// resolveMove(from, delta, radius) → nueva posición (NO muta `from`):
//   - El jugador es un círculo de `radius` en el plano XZ (y se ignora).
//   - Resolver EN DOS PASOS independientes para deslizar:
//       1) intenta mover solo en X: nx = from.x + delta.x. Si el círculo en
//          (nx, from.z) colisiona con alguna celda bloqueada, cancela X
//          (nx = from.x).
//       2) intenta mover solo en Z: nz = from.z + delta.z (con la X ya
//          resuelta). Si colisiona, cancela Z.
//   - Una celda (col,row) bloqueada ocupa el AABB [col,col+1]×[row,row+1].
//     Colisión círculo-AABB: clamp del centro al AABB y distancia < radius.
//     Basta chequear las pocas celdas alrededor de la posición (floor(x)-1..+1,
//     floor(z)-1..+1) — NO recorras toda la grilla.
//   - Clamp final a bounds con margen = radius:
//       x ∈ [minX+radius, maxX-radius], z ∈ [minZ+radius, maxZ-radius].
//   - Devuelve new THREE.Vector3(nx, from.y, nz).
//
// helper isBlocked(col,row): fuera de grilla → tratar como NO bloqueado (el
//   clamp de bounds ya impide salir del piso; así no te trabas en el borde).
//   Dentro → world.blocked[row]?.[col] === true.
//
// Robustez: nunca lanzar; si blocked está vacío, solo aplica el clamp de bounds.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from "three";
import type { WorldModel } from "./world-types";

export interface CollisionSystem {
  /** Devuelve la posición resuelta (deslizando) sin mutar `from`. */
  resolveMove(from: THREE.Vector3, delta: THREE.Vector3, radius: number): THREE.Vector3;
  /** true si la celda (col,row) está bloqueada. */
  isBlocked(col: number, row: number): boolean;
}

export function createCollisionSystem(world: WorldModel): CollisionSystem {
  const b = world.bounds;
  const blocked = world.blocked ?? [];

  /** Fuera de grilla → NO bloqueado; el clamp de bounds impide salir del piso. */
  function isBlocked(col: number, row: number): boolean {
    return blocked[row]?.[col] === true;
  }

  /**
   * Colisión círculo-AABB para el centro (x,z) contra las celdas bloqueadas
   * vecinas. Cada celda (col,row) bloqueada es el AABB [col,col+1]×[row,row+1];
   * se clampa el centro al AABB y se mide la distancia: choca si < radius.
   * Solo recorre las celdas alrededor (floor-1..+1), no toda la grilla.
   */
  function hits(x: number, z: number, radius: number): boolean {
    if (blocked.length === 0) return false;
    const r2 = radius * radius;
    const c0 = Math.floor(x) - 1;
    const r0 = Math.floor(z) - 1;
    for (let row = r0; row <= r0 + 2; row++) {
      for (let col = c0; col <= c0 + 2; col++) {
        if (!isBlocked(col, row)) continue;
        // Punto del AABB [col,col+1]×[row,row+1] más cercano al centro.
        const cx = x < col ? col : x > col + 1 ? col + 1 : x;
        const cz = z < row ? row : z > row + 1 ? row + 1 : z;
        const dx = x - cx;
        const dz = z - cz;
        if (dx * dx + dz * dz < r2) return true;
      }
    }
    return false;
  }

  return {
    isBlocked,
    resolveMove(from, delta, radius) {
      // Resolver X y Z por separado para DESLIZAR sobre las paredes.
      // 1) Eje X: si el círculo en (nx, from.z) choca, cancela el avance X.
      let nx = from.x + delta.x;
      if (hits(nx, from.z, radius)) nx = from.x;
      // 2) Eje Z: con la X ya resuelta; si choca, cancela el avance Z.
      let nz = from.z + delta.z;
      if (hits(nx, nz, radius)) nz = from.z;
      // Clamp final a los límites caminables con margen = radius.
      nx = Math.max(b.minX + radius, Math.min(b.maxX - radius, nx));
      nz = Math.max(b.minZ + radius, Math.min(b.maxZ - radius, nz));
      return new THREE.Vector3(nx, from.y, nz);
    },
  };
}
