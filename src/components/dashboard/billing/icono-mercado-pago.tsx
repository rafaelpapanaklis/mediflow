/**
 * La marca de Mercado Pago, en pequeño, para el botón del método de pago.
 *
 * Es un dibujo NUESTRO en su azul de marca (#00A6E0), no el logotipo oficial:
 * el apretón de manos dentro del óvalo. Sirve para que el botón se reconozca de
 * un vistazo entre Efectivo, Débito y los demás, que llevan iconos de línea.
 *
 * 🔴 Si algún día hay que usar el logotipo de verdad —una nota de prensa, la
 * página pública— se baja de la marca de Mercado Pago y se sustituye aquí. No
 * se redibuja a mano: un logotipo mal reproducido es peor que ninguno.
 *
 * `size` va en píxeles y por defecto es 14, el mismo que los iconos de lucide
 * que usan los demás métodos, para que todos se alineen en la misma fila.
 */
export function IconoMercadoPago({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ flex: "0 0 auto" }}
    >
      {/* El óvalo: se queda azul en los dos temas — es color de marca, no del
          tema. Sobre el botón activo (fondo oscuro) sigue leyéndose. */}
      <ellipse cx="12" cy="12" rx="11" ry="8.2" fill="#00A6E0" />
      {/* El apretón de manos, en blanco: dos brazos que se encuentran. */}
      <path
        d="M5.4 11.3l2.5-1.9a1.5 1.5 0 0 1 1.7-.05l1.6 1a1 1 0 0 0 1.05 0l1.3-.8a1.6 1.6 0 0 1 1.85.12l3.1 2.5"
        stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      />
      <path
        d="M8.1 13.1l1.5 1.2a.9.9 0 0 0 1.2-.08m0 0l.95.8a.9.9 0 0 0 1.25-.1m0 0l.9.7a.85.85 0 0 0 1.2-.1"
        stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
