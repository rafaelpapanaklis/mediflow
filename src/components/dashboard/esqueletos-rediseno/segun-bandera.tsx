"use client";

import { useContext, type ReactNode } from "react";
import { useNewAppointmentDialog } from "@/components/dashboard/new-appointment/new-appointment-provider";

/**
 * Elige el esqueleto de carga según la bandera `menu-dos-niveles`, SIN esperar
 * a nada (ws1-t3, hallazgo 19).
 *
 * Un `loading.tsx` es lo primero que se pinta al navegar. Leer la bandera ahí
 * con `getCurrentUser()` + `menuDosNivelesEncendido()` costaría un viaje a la
 * sesión antes de enseñar el esqueleto en cada navegación de cliente (el
 * layout no se vuelve a renderizar y su caché de request está fría), o sea,
 * retrasar justo lo que existe para no hacer esperar.
 *
 * En cambio, el layout de /dashboard ya PUBLICA el interruptor a los
 * componentes de cliente que cuelgan de él: `NewAppointmentProvider` recibe
 * `apariencia={menuDosNiveles ? "nueva" : "clasica"}` y lo expone en su
 * contexto. Aquí se lee de ahí: cero consultas, cero espera, y la misma
 * respuesta que ve el menú en ese mismo request (SSR incluido, porque el
 * proveedor se renderiza en el servidor con el valor ya resuelto).
 *
 * Con la bandera apagada devuelve `viejo` tal cual —el elemento de siempre,
 * sin un nodo ni una clase de más—; encendida, `nuevo`. Cada `loading.tsx`
 * sigue siendo un componente de servidor: solo pasa los dos árboles.
 *
 * Fuera del proveedor —el `minimalShell` del layout, que envuelve el reto de
 * 2FA y el cambio de contraseña obligatorio sin proveedores— el hook lanza.
 * Ahí no hay menú nuevo que imitar y la respuesta es la de siempre: `viejo`.
 * El `try` no altera el orden de hooks (dentro solo hay un `useContext`).
 *
 * El test de la carpeta vigila que el layout siga cableando `apariencia`
 * con el interruptor y que ningún loading.tsx vuelva a ser asíncrono.
 */
export function EsqueletoSegunBandera({ viejo, nuevo }: { viejo: ReactNode; nuevo: ReactNode }) {
  return <>{banderaEncendida() ? nuevo : viejo}</>;
}

function banderaEncendida(): boolean {
  try {
    return useNewAppointmentDialog().apariencia === "nueva";
  } catch {
    return false;
  }
}

// Referencia explícita para dejar claro que lo único que corre dentro del
// `try` es un `useContext` (no suspende ni cambia de orden entre renders).
void useContext;
