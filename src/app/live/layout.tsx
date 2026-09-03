import type { Metadata } from "next";
/**
 * Los colores del piso — los MISMOS que Mi Clínica Visual en el panel.
 * Van aquí, en el layout, y no en cada pantalla: bajo /live hay cuatro
 * superficies que pintan la misma tarjeta de error (la página, su
 * boundary, el gate de contraseña y el recorrido 3D) y ninguna debería
 * tener que acordarse de encender los tokens. La hoja también traduce la
 * paleta a los `--fp-*` que lee la capa compartida, así que el televisor
 * pinta el piso con los colores del panel. Ver la cabecera de
 * floor-tokens.module.css.
 */
import mc from "../dashboard/clinic-layout/components/floor-tokens.module.css";

export const metadata: Metadata = {
  title: "DaleControl · vista pública",
  robots: { index: false, follow: false },
};

/**
 * Layout standalone para /live/[slug]. NO incluye sidebar dashboard, NO
 * requiere auth, fullscreen-friendly para TV de sala de espera. La página
 * misma maneja su background — el wrapper queda neutral para que el
 * toggle de tema (light/dark) lo controle vía CSS módulo.
 */
export default function LiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={mc.mcTokens}
      style={{
        minHeight: "100vh",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
}
