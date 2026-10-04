"use client";

// C-109 (ws1-t8): al rebotar por permisos (`/dashboard?denied=<key>`) se dice
// por qué y se quita el parámetro de la dirección. Va en el layout porque el
// rebote es una navegación de cliente: el layout no se vuelve a montar, así que
// se escucha cada cambio de dirección. No pinta nada propio: usa el aviso
// (toast) de siempre.

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import toast from "react-hot-toast";
import { useLocale } from "@/i18n/i18n-provider";
import { PARAMETRO_DENEGADO, direccionSinDenegado, mensajeDeRebote } from "@/lib/auth/aviso-denegado";

function Aviso() {
  const pathname = usePathname();
  const params = useSearchParams();
  const locale = useLocale();
  const llave = params.get(PARAMETRO_DENEGADO);

  useEffect(() => {
    if (!llave) return;
    const texto = mensajeDeRebote(llave, locale);
    if (texto) toast.error(texto, { id: `denegado-${llave}`, duration: 8000 });
    // `null` y no `history.state`: con el estado de Next, su siguiente refresco
    // devolvía el parámetro (Next 14.2).
    window.history.replaceState(null, "", direccionSinDenegado(window.location.pathname + window.location.search + window.location.hash));
  }, [pathname, llave, locale]);

  return null;
}

export function AvisoPermisoDenegado() {
  return (
    <Suspense fallback={null}>
      <Aviso />
    </Suspense>
  );
}
