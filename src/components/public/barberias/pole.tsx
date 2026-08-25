/**
 * El poste de barbero en CSS puro. Es lo que ve TODO el mundo en el primer
 * pintado (viaja en el HTML, cero JS) y lo que ve para siempre el móvil,
 * quien pidió menos movimiento y cualquier equipo sin WebGL. Las franjas
 * suben con una animación de transform (compuesta en GPU); ver
 * `.dcbl-pole` en barberias.css.
 *
 * En escritorio capaz, pole-upgrade.tsx monta el poste 3D encima y este
 * se desvanece (opacity) sin salir del DOM: si el contexto WebGL se pierde,
 * vuelve a verse al instante.
 */
export function BarberPole({ className }: { className?: string }) {
  return (
    <div className={`dcbl-pole${className ? ` ${className}` : ""}`} data-pole="css" aria-hidden="true">
      <span className="dcbl-pole__finial" />
      <span className="dcbl-pole__neck" />
      <span className="dcbl-pole__cap" />
      <span className="dcbl-pole__glass">
        <span className="dcbl-pole__stripes" />
        <span className="dcbl-pole__shine" />
      </span>
      <span className="dcbl-pole__cap" />
      <span className="dcbl-pole__neck" />
      <span className="dcbl-pole__finial" />
      <span className="dcbl-pole__shadow" />
    </div>
  );
}
