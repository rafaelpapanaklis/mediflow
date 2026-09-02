import type { ReactNode } from "react";
import { EscenaGate, type EduEscenaNombre } from "./escena-gate";

/**
 * El anfitrión de una escena: el dibujo estático (servidor, viaja en el
 * HTML) y encima la puerta que puede montar la versión en tres dimensiones.
 *
 * Para el lector de pantalla es UNA imagen: `role="img"` con su etiqueta.
 * Lo de dentro —el SVG y el lienzo— va `aria-hidden`, porque describir
 * dieciséis polígonos no le sirve a nadie.
 *
 * La caja tiene proporción fija en el CSS, así que el lienzo aparece
 * ENCIMA del dibujo sin mover un píxel de la página: el desplazamiento
 * acumulado de diseño es cero, la escena entre o no.
 */
export function Escena({
  nombre,
  aria,
  children,
  className,
}: {
  nombre: EduEscenaNombre;
  aria: string;
  /** El dibujo estático. Es lo que ve todo el mundo primero. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`dcei-escena${className ? ` ${className}` : ""}`} role="img" aria-label={aria}>
      <div className="dcei-escena__art" aria-hidden="true">
        {children}
      </div>
      <EscenaGate nombre={nombre} />
    </div>
  );
}
