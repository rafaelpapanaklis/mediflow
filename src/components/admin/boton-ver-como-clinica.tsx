"use client";

// «Ver como clínica» (auditoría 30-sep-2026, M5; un clic desde ws1-t11, 2-oct):
// un formulario POST de un solo botón —sin ventana ni motivo, pedido de Rafael—
// que entra directo al panel de la clínica en esta misma pestaña. La sesión
// dura 2 h y se registra solo en la bitácora de admin (admin_impersonation_sessions);
// para volver, la barra «Estás viendo como…» del panel lleva a /admin.

import { useEffect, useState } from "react";
import { Eye } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";

export function BotonVerComoClinica({
  clinicId,
  etiqueta = "Ver como clínica",
  size,
}: {
  clinicId: string;
  etiqueta?: string;
  size?: "sm";
}) {
  const [entrando, setEntrando] = useState(false);
  // Al volver con «Atrás» el navegador restaura la página tal cual (bfcache):
  // el botón no puede quedarse en «Entrando…».
  useEffect(() => {
    const reactivar = () => setEntrando(false);
    window.addEventListener("pageshow", reactivar);
    return () => window.removeEventListener("pageshow", reactivar);
  }, []);

  return (
    <form method="POST" action="/api/admin/impersonate" onSubmit={() => setEntrando(true)} style={{ display: "inline" }}>
      <input type="hidden" name="clinicId" value={clinicId} />
      <ButtonNew size={size} variant="primary" type="submit" disabled={entrando} icon={<Eye size={size === "sm" ? 13 : 14} />}>
        {entrando ? "Entrando…" : etiqueta}
      </ButtonNew>
    </form>
  );
}
