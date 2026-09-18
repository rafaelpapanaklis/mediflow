"use client";
import { useCallback, useState } from "react";
import { encogidoEfectivo, pacienteDeFicha } from "./recogido";

type Encogido = [boolean, (v: boolean) => void];

/**
 * Envuelve la preferencia manual del menú (`useEncogido` de
 * menu-dos-niveles.tsx: localStorage + su setter) con la regla de la ficha
 * de paciente. Misma firma de salida, así el menú no cambia nada más.
 *
 *  - `preferencia`/`guardarPreferencia`: lo que la persona eligió con el
 *    botón fuera de la ficha. Aquí nunca se escribe desde dentro de la ficha.
 *  - La elección dentro de la ficha vive en estado de React atada al id del
 *    paciente: cambia el paciente (o se sale de la ficha) y se olvida, con lo
 *    que la siguiente ficha vuelve a abrirse recogida.
 *
 * El primer render ya sale recogido en la ficha (el pathname es el mismo en
 * servidor y cliente): no hay salto de desplegado a recogido al cargar.
 */
export function useEncogidoEnFicha([preferencia, guardarPreferencia]: Encogido, pathname: string | null): Encogido {
  const paciente = pacienteDeFicha(pathname);
  const [eleccion, setEleccion] = useState<{ paciente: string | null; encogido: boolean | null }>({
    paciente,
    encogido: null,
  });
  // Ajuste de estado al cambiar de paciente (patrón documentado por React:
  // comparar durante el render y volver a pintar, sin efecto ni parpadeo).
  if (eleccion.paciente !== paciente) setEleccion({ paciente, encogido: null });
  const eleccionVigente = eleccion.paciente === paciente ? eleccion.encogido : null;

  const encogido = encogidoEfectivo(preferencia, paciente !== null, eleccionVigente);
  const cambiar = useCallback(
    (v: boolean) => {
      if (paciente !== null) setEleccion({ paciente, encogido: v });
      else guardarPreferencia(v);
    },
    [paciente, guardarPreferencia],
  );
  return [encogido, cambiar];
}
