"use client";
// Ortodoncia — Parte 7 «Imagen y análisis» (ws1-t8, ola 1, sep-2026). H3:
// superposición del trazado inicial sobre el final, alineados en Silla-
// Nasion (el plano que no cambia con el tratamiento — convención estándar
// de superposición cefalométrica).

import type { CephalometricAnalysisRow } from "@/app/actions/orthodontics/imagen/listCephalometricAnalyses";
import type { CephLandmarkId } from "@/lib/orthodontics/cefalometria/landmarks";
import type { Point2D } from "@/lib/orthodontics/geometria-plana";

export interface CephalometricOverlayProps {
  initial: CephalometricAnalysisRow;
  final: CephalometricAnalysisRow;
}

/** Traslada+rota los puntos de `points` para que su S-N coincida con el de `reference`. */
function registerOnSellaNasion(
  points: Partial<Record<CephLandmarkId, Point2D>>,
  reference: Partial<Record<CephLandmarkId, Point2D>>,
): Partial<Record<CephLandmarkId, Point2D>> {
  const s = points.S;
  const n = points.N;
  const refS = reference.S;
  const refN = reference.N;
  if (!s || !n || !refS || !refN) return points;

  const angle = (v: Point2D) => Math.atan2(v.y, v.x);
  const len = (v: Point2D) => Math.sqrt(v.x * v.x + v.y * v.y);

  const srcVec = { x: n.x - s.x, y: n.y - s.y };
  const refVec = { x: refN.x - refS.x, y: refN.y - refS.y };
  const scale = len(refVec) / (len(srcVec) || 1);
  const rotation = angle(refVec) - angle(srcVec);
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  const transformed: Partial<Record<CephLandmarkId, Point2D>> = {};
  for (const [id, p] of Object.entries(points) as [CephLandmarkId, Point2D][]) {
    const dx = (p.x - s.x) * scale;
    const dy = (p.y - s.y) * scale;
    transformed[id] = {
      x: refS.x + dx * cos - dy * sin,
      y: refS.y + dx * sin + dy * cos,
    };
  }
  return transformed;
}

export function CephalometricOverlay({ initial, final }: CephalometricOverlayProps) {
  const registeredInitial = registerOnSellaNasion(initial.points, final.points);
  const canRegister = Boolean(initial.points.S && initial.points.N && final.points.S && final.points.N);

  return (
    <div>
      <div className="relative w-full rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-950" style={{ aspectRatio: "3 / 4" }}>
        <PointsLayer points={final.points} color="#22c55e" />
        <PointsLayer points={canRegister ? registeredInitial : initial.points} color="#f59e0b" />
      </div>
      <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Inicial
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> {final.kind === "FINAL" ? "Final" : "Más reciente"}
        </span>
        {!canRegister ? (
          <span className="text-amber-600 dark:text-amber-400">
            Falta Silla o Nasion en algún trazado — se muestran sin alinear.
          </span>
        ) : null}
      </div>
    </div>
  );
}

function PointsLayer({ points, color }: { points: Partial<Record<CephLandmarkId, Point2D>>; color: string }) {
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
      {Object.values(points).map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={1} fill={color} />
      ))}
    </svg>
  );
}
