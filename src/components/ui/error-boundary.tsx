"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { isAbortError } from "@/lib/fetch-safe";

interface Props {
  children: React.ReactNode;
  fallbackTitle?: string;
  /**
   * Si se provee, reemplaza el fallback default. Recibe `reset` para limpiar
   * el estado de error y reintentar el render del subárbol sin recargar la
   * página (útil para vistas con su propio estilo, ej. /live/[slug]).
   */
  fallbackRender?: (args: { error: Error | null; reset: () => void }) => React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  /** Recuperaciones ya gastadas por cancelación (ver componentDidCatch). */
  private abortRecoveries = 0;

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Cancelar NO es fallar. Una petición abortada (cambio de sección, cierre
    // de modal, desmontaje por router.refresh()) no debe pintar la pantalla de
    // "no se pudo cargar": el subárbol sigue siendo válido y el efecto que
    // sustituye al cancelado ya está pidiendo los datos otra vez. Se reintenta
    // el render UNA sola vez — acotado a propósito: si volviera a lanzar, el
    // fallback aparece en vez de entrar en bucle de re-render.
    //
    // En React 18 un rechazo de promesa NO llega a un error boundary (solo los
    // errores lanzados en render/lifecycle), así que esto es una red de
    // seguridad para subárboles que en el futuro usen `use()`/Suspense. La
    // defensa de verdad está en el origen: ver src/lib/fetch-safe.ts.
    if (isAbortError(error)) {
      if (this.abortRecoveries < 1) {
        this.abortRecoveries += 1;
        this.reset();
      }
      return;
    }
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallbackRender) {
        return this.props.fallbackRender({ error: this.state.error, reset: this.reset });
      }
      return (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-border bg-card p-8 text-center">
          <AlertTriangle className="h-10 w-10 text-destructive" />
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {this.props.fallbackTitle ?? "Algo salió mal"}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Ocurrió un error inesperado. Intenta recargar la página.
            </p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <RefreshCw className="h-4 w-4" />
            Reintentar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
