"use client";

import { Suspense, lazy } from "react";

// lazy() de verdad: el chunk de @splinetool/react-spline (y con él el runtime
// de ~1.2 MB) solo se descarga cuando este componente llega a montarse. Quien
// lo renderiza (login-visual) lo hace detrás de un gate de desktop, así que en
// móvil el import nunca se dispara.
const Spline = lazy(() => import("@splinetool/react-spline"));

interface SplineSceneProps {
  scene: string;
  className?: string;
  onLoad?: (app: unknown) => void;
}

/**
 * Fallback del Suspense: el <span className="loader"> del snippet original no
 * existe en el proyecto. Este placeholder ocupa el 100% del contenedor (mismo
 * espacio que ocupará el canvas → cero CLS) y muestra un anillo girando.
 */
function SplineLoader() {
  return (
    <div className="flex h-full w-full items-center justify-center" aria-hidden="true">
      <div className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-violet-400" />
    </div>
  );
}

export function SplineScene({ scene, className, onLoad }: SplineSceneProps) {
  return (
    <Suspense fallback={<SplineLoader />}>
      <Spline scene={scene} className={className} onLoad={onLoad} />
    </Suspense>
  );
}
