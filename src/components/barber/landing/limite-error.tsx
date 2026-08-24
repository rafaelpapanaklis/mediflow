"use client";

/* ═══════════════════════════════════════════════════════════════════════
   EL CORTAFUEGOS DE LA VISTA PREVIA.

   La vista previa monta una plantilla ENTERA con datos que la barbería
   está escribiendo ahora mismo — a medias, vacíos, raros. Si una
   plantilla revienta al pintar, React desmonta el árbol hasta el primer
   límite de error que encuentre; y como en toda la app NO hay ningún
   `error.tsx`, ese límite es la raíz: se cae el editor, el sidebar y,
   con ellos, una tarde de trabajo sin publicar.

   Esto es ese límite, y vive lo más pegado posible a la plantilla: un
   fallo al dibujar se queda DENTRO del marco de la vista previa. Los
   controles, lo escrito y el botón de publicar siguen ahí.

   ── POR QUÉ UNA CLASE ─────────────────────────────────────────────
   No hay hook de límite de error en React. `getDerivedStateFromError`
   sólo existe en componentes de clase; es la única forma de atrapar un
   throw de render de los hijos.

   ── POR QUÉ SE REINTENTA SOLO ─────────────────────────────────────
   Un límite que se queda pegado convierte un fallo pasajero (un texto a
   medio escribir, una foto que aún no termina de subir) en una vista
   previa muerta hasta recargar. `reintentarCon` es la identidad de lo
   que se está pintando: en cuanto CAMBIA —o sea, en cuanto la barbería
   toca cualquier cosa— se vuelve a intentar. Si sigue rota, se vuelve a
   atrapar y sale otra vez el aviso: un throw por edición, nunca un
   bucle.

   ── Y POR QUÉ SÍ SE ESCRIBE EN LA CONSOLA ─────────────────────────
   El bug que motivó esto no dejaba rastro en la consola. Un cortafuegos
   silencioso repetiría ese error: aquí SIEMPRE se registra el fallo con
   su pila, y el aviso trae el mensaje técnico plegado para que quien lo
   sufre pueda copiarlo y mandarlo a soporte.
   ═══════════════════════════════════════════════════════════════════════ */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /**
   * Identidad de lo que se pinta. Cuando cambia se vuelve a intentar.
   * En el editor es el objeto `data`, que se memoiza y cambia con cada
   * edición.
   */
  reintentarCon: unknown;
  titulo: string;
  cuerpo: string;
  /** Rótulo del `<details>` con el mensaje técnico. Sin él no se pinta. */
  detalle?: string;
  /** `mini` para la miniatura del selector, donde no cabe un párrafo. */
  variante?: "marco" | "mini";
}

interface State {
  error: Error | null;
  /** La identidad que se pintó (o que falló) por última vez. */
  clave: unknown;
}

export class LimiteVistaPrevia extends Component<Props, State> {
  state: State = { error: null, clave: undefined };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  /**
   * El reintento.
   *
   * Ojo con el orden: cuando un hijo revienta, React llama primero a
   * `getDerivedStateFromError` y RE-RENDERIZA con las mismas props, así
   * que esto corre otra vez inmediatamente. Si borrara el error sin
   * comparar, volvería a montar al hijo que acaba de reventar, con los
   * mismos datos, para siempre. Por eso `clave` se sincroniza SIEMPRE
   * que no hay error: en el render del fallo, `clave` ya vale lo mismo
   * que `reintentarCon` y no se limpia nada.
   */
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.reintentarCon === state.clave) return null;
    // Datos nuevos: se pinta de cero, con o sin error previo.
    return { error: null, clave: props.reintentarCon };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // A propósito y siempre: sin esto el fallo no deja rastro en ningún
    // lado y volvemos al bug original —pantalla rota, consola limpia.
    console.error("[barber/mi-web] la vista previa no se pudo dibujar:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { titulo, cuerpo, detalle, variante = "marco" } = this.props;

    if (variante === "mini") {
      return (
        <div className="dcbwe-fallo dcbwe-fallo-mini" role="status">
          <strong>{titulo}</strong>
        </div>
      );
    }

    return (
      <div className="dcbwe-fallo" role="alert">
        <div className="dcbwe-fallo-caja">
          <strong>{titulo}</strong>
          <p>{cuerpo}</p>
          {detalle && (
            <details className="dcbwe-fallo-detalle">
              <summary>{detalle}</summary>
              <code>{error.message || String(error)}</code>
            </details>
          )}
        </div>
      </div>
    );
  }
}
