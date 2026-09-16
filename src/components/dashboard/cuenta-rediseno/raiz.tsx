import type { CSSProperties, ReactNode } from "react";
import { CLASES_MENU } from "@/components/dashboard/menu-dos-niveles/clases";
import s from "./cuenta.module.css";

/**
 * La raíz del rediseño de las pantallas de cuenta y estado (ws1-t1, lote 3):
 * Cambiar contraseña, 2FA y Clínica suspendida, vestidas con el mismo lenguaje
 * visual que el menú de dos niveles, Pacientes, la Agenda y «Hoy».
 *
 * NO declara tokens propios: monta `CLASES_MENU` (`menu-dos-niveles/clases.ts`),
 * que trae los `--m2-*` del menú —con su versión oscura— y la tipografía
 * (Instrument Sans). Las clases de `cuenta.module.css` leen esos tokens por
 * herencia. Si el menú cambia de color, estas pantallas cambian con él.
 *
 * Solo la montan las páginas de `src/app/dashboard/{cambiar-contrasena,2fa,
 * suspended}` cuando el interruptor por clínica `menu-dos-niveles`
 * (`clinic_feature_flags`) está encendido. Apagado, cada página devuelve
 * exactamente el árbol de siempre, sin un nodo de esto.
 *
 * `barrera`: modo para las dos barreras previas al panel (2FA y cambio de
 * contraseña). Ahí no hay marcado nuevo: los componentes de seguridad
 * (`two-factor-challenge`, `two-factor-setup`, `change-password-client`) no
 * se tocan —ni un flujo, ni una validación, ni un mensaje— y se visten desde
 * fuera. Pintan con los tokens de siempre de globals.css (`--text-1`,
 * `--brand`, `--shadow-2`…), así que la raíz los REDIRIGE, en su propio
 * subárbol, a los del menú: `--text-1` pasa a ser `var(--m2-texto)`, `--brand`
 * a `var(--m2-activo)`, etcétera. Es el mismo mecanismo con el que
 * `tipografia-panel.tsx` redirige `--font-sans` al panel entero: no es una
 * paleta nueva (no hay un solo valor propio, todo apunta a `--m2-*`), es el
 * puente entre las clases viejas y los tokens aprobados. Va en línea y no en
 * el .module.css porque el candado de esa hoja prohíbe declarar variables ahí.
 *
 * Las dos barreras se renderizan en el layout mínimo (sin menú ni barra
 * superior), donde la raíz de tipografía del panel (tipografia-panel.tsx) no se monta: la letra la pone aquí
 * `CLASES_MENU`, y las cifras tabulares, `.raiz > *`.
 *
 * Es un componente sin hooks para que los server components lo monten
 * directamente; lo que va dentro puede ser de cliente.
 */
const TOKENS_DE_SIEMPRE_AL_MENU = {
  "--text-1": "var(--m2-texto)",
  "--text-2": "var(--m2-texto-2)",
  "--text-3": "var(--m2-texto-3)",
  "--text-4": "var(--m2-texto-3)",
  "--bg-elev": "var(--m2-tarjeta)",
  "--bg-elev-2": "var(--m2-buscador-fondo)",
  "--bg-hover": "var(--m2-hover)",
  "--border-soft": "var(--m2-tarjeta-borde)",
  "--border-strong": "var(--m2-borde)",
  "--brand": "var(--m2-activo)",
  "--brand-soft": "var(--m2-iniciales-fondo)",
  "--consult-active-accent": "var(--m2-activo)",
  "--shadow-1": "var(--m2-sombra)",
  "--shadow-2": "var(--m2-sombra)",
  "--ring": "var(--m2-foco)",
  "--radius-sm": "8px",
  "--radius": "10px",
  "--radius-lg": "14px",
} as CSSProperties;

export function RaizCuenta({
  children,
  barrera = false,
  className,
}: {
  children: ReactNode;
  /** 2FA y cambio de contraseña: viste los componentes de siempre desde fuera. */
  barrera?: boolean;
  className?: string;
}) {
  return (
    <div
      className={[CLASES_MENU, s.raiz, barrera ? s.barrera : "", className ?? ""].filter(Boolean).join(" ")}
      style={barrera ? TOKENS_DE_SIEMPRE_AL_MENU : undefined}
    >
      {children}
    </div>
  );
}
