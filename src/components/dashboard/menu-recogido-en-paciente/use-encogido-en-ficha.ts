"use client";
import { useCallback, useState } from "react";
import { encogidoEfectivo, zonaRecogida } from "./recogido";

type Encogido = [boolean, (v: boolean) => void];

/**
 * Envuelve la preferencia manual del menú (`useEncogido` de
 * menu-dos-niveles.tsx: localStorage + su setter) con la regla de la ficha
 * de paciente. Misma firma de salida, así el menú no cambia nada más.
 *
 *  - `preferencia`/`guardarPreferencia`: lo que la persona eligió con el
 *    botón fuera de la ficha. Aquí nunca se escribe desde dentro de la ficha.
 *  - La elección dentro de la ficha vive en estado de React atada a la zona
 *    (`zonaRecogida`: cada paciente es la suya, el módulo de Ortodoncia es
 *    una): cambia la zona (o se sale de ella) y se olvida, con lo que la
 *    siguiente ficha vuelve a abrirse recogida.
 *
 * El primer render ya sale recogido en la ficha (el pathname es el mismo en
 * servidor y cliente): no hay salto de desplegado a recogido al cargar.
 */
export function useEncogidoEnFicha([preferencia, guardarPreferencia]: Encogido, pathname: string | null): Encogido {
  const zona = zonaRecogida(pathname);
  const [eleccion, setEleccion] = useState<{ zona: string | null; encogido: boolean | null }>({
    zona,
    encogido: null,
  });
  // Ajuste de estado al cambiar de zona (patrón documentado por React:
  // comparar durante el render y volver a pintar, sin efecto ni parpadeo).
  if (eleccion.zona !== zona) setEleccion({ zona, encogido: null });
  const eleccionVigente = eleccion.zona === zona ? eleccion.encogido : null;

  const encogido = encogidoEfectivo(preferencia, zona !== null, eleccionVigente);
  const cambiar = useCallback(
    (v: boolean) => {
      if (zona !== null) setEleccion({ zona, encogido: v });
      else guardarPreferencia(v);
    },
    [zona, guardarPreferencia],
  );
  return [encogido, cambiar];
}
