"use client";

// En el formulario de timbrado: el CSD vencido o por vencer y la persona moral en «exento»
// (ws1-t8, F-15), para quien timbra, no solo para quien entra a Configuración. Lo trae
// GET /api/cfdi/usage (admin, el mismo que ya consulta el formulario) en `avisosEmisor`.

import { useEffect, useState } from "react";
import type { AvisoEmisor } from "@/lib/cfdi/emisor";
import { AvisosEmisor } from "@/components/dashboard/settings/cfdi-avisos-emisor";

export function AvisosEmisorAlTimbrar() {
  const [avisos, setAvisos] = useState<AvisoEmisor[] | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/cfdi/usage")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo && Array.isArray(d?.avisosEmisor)) setAvisos(d.avisosEmisor); })
      .catch(() => {});
    return () => { vivo = false; };
  }, []);
  return <AvisosEmisor avisos={avisos} />;
}
