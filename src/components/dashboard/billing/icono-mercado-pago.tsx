/**
 * La marca de Mercado Pago —el óvalo del apretón de manos— para el botón del
 * método de pago.
 *
 * Es el LOGOTIPO OFICIAL, el que mandó Rafael, no un dibujo nuestro: del
 * archivo original se recortó solo el óvalo (fuera el fondo de icono de app y
 * fuera el texto «mercado pago», que sobra porque el botón ya lo dice) y se le
 * quitó el fondo. Vive en `public/brand/mercado-pago.png`, a 96 px de alto para
 * que se vea nítido en pantallas retina a los 14-16 px en que se usa.
 *
 * 🔴 No lo redibujes en SVG «para que pese menos». Es una marca registrada: o
 * es el archivo de ellos, o no se pone.
 *
 * `size` va en píxeles y por defecto es 14, el mismo que los iconos de lucide
 * de los demás métodos, para que todos se alineen en la misma fila. El óvalo es
 * más ancho que alto, así que se fija el ALTO y el ancho sale solo.
 */
export function IconoMercadoPago({ size = 14 }: { size?: number }) {
  return (
    <img
      src="/brand/mercado-pago.png"
      alt=""
      aria-hidden="true"
      height={size}
      // El ancho lo pone la proporción del recorte (588 × 419).
      width={Math.round((size * 588) / 419)}
      style={{ height: size, width: "auto", flex: "0 0 auto", display: "block" }}
      draggable={false}
    />
  );
}
