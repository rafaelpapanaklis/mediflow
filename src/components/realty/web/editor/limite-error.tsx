"use client";

/* ═══════════════════════════════════════════════════════════════════════
   CORTAFUEGOS DE LA VISTA PREVIA.

   La vista previa pinta la plantilla real con datos A MEDIO ESCRIBIR: una
   URL que todavía es "htt", un texto vacío, una lista con un hueco. Si una
   de esas combinaciones lanza al pintar y no hay cortafuegos, React
   desmonta hasta la raíz y la inmobiliaria pierde la tarde entera de
   trabajo sin haber guardado.

   Es una CLASE porque no existe hook de límite de error. Y se reintenta
   solo comparando `reintentarCon` en getDerivedStateFromProps: en cuanto
   la config cambia (o sea, en cuanto la persona sigue escribiendo), se
   vuelve a intentar. Sin eso, un error deja el marco muerto hasta recargar.
   ═══════════════════════════════════════════════════════════════════════ */

import { Component, type ReactNode } from "react";

interface Props {
  /** Cualquier valor que, al cambiar, deba provocar un reintento. */
  reintentarCon: unknown;
  children: ReactNode;
}

interface State {
  fallo: boolean;
  clave: unknown;
}

export class LimiteVistaPrevia extends Component<Props, State> {
  state: State = { fallo: false, clave: null };

  static getDerivedStateFromError(): Partial<State> {
    return { fallo: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (state.fallo && props.reintentarCon !== state.clave) {
      return { fallo: false, clave: props.reintentarCon };
    }
    if (!state.fallo && props.reintentarCon !== state.clave) {
      return { clave: props.reintentarCon };
    }
    return null;
  }

  componentDidCatch(error: unknown) {
    console.error("[realty mi-web] la vista previa falló:", error);
  }

  render() {
    if (this.state.fallo) {
      return (
        <div className="dcrwe-previa-fallo" role="status">
          <strong>La vista previa se quedó a medias</strong>
          <p>
            Sigue escribiendo y vuelve sola. Lo que llevas escrito no se ha perdido: nada se
            guarda hasta que le des a publicar.
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
