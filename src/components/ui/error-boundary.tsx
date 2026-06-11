"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

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

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
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
