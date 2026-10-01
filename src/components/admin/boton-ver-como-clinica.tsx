"use client";

// «Ver como clínica» (auditoría 30-sep-2026, M5): antes era un enlace GET que
// abría la sesión del dueño sin pedir nada. Ahora es un formulario POST con el
// motivo obligatorio; abre en una pestaña nueva y la sesión dura 2 h.

import { useState } from "react";
import { Eye, X } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";

const NOTA_MIN = 10; // = NOTA_MIN de @/lib/admin/suplantacion-core (no se importa: ese archivo es de servidor)

export function BotonVerComoClinica({
  clinicId,
  etiqueta = "Ver como clínica",
  size,
}: {
  clinicId: string;
  etiqueta?: string;
  size?: "sm";
}) {
  const [abierto, setAbierto] = useState(false);
  const [nota, setNota] = useState("");
  const valida = nota.replace(/\s+/g, " ").trim().length >= NOTA_MIN;

  if (!abierto) {
    return (
      <ButtonNew size={size} variant="primary" icon={<Eye size={size === "sm" ? 13 : 14} />} onClick={() => setAbierto(true)}>
        {etiqueta}
      </ButtonNew>
    );
  }

  return (
    <form
      method="POST"
      action="/api/admin/impersonate"
      target="_blank"
      onSubmit={() => setTimeout(() => { setAbierto(false); setNota(""); }, 0)}
      style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 280, maxWidth: 420 }}
    >
      <input type="hidden" name="clinicId" value={clinicId} />
      <label style={{ fontSize: 12, fontWeight: 600 }}>
        Motivo de la entrada (obligatorio)
        <textarea
          name="nota"
          required
          minLength={NOTA_MIN}
          maxLength={500}
          rows={3}
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          placeholder="Ej.: el dueño pidió ayuda por teléfono con su agenda"
          style={{ display: "block", width: "100%", marginTop: 4, fontSize: 13, padding: 8, borderRadius: 8, border: "1px solid var(--border, #cbd5e1)", background: "transparent", color: "inherit" }}
        />
      </label>
      <span style={{ fontSize: 11, opacity: 0.7 }}>La sesión dura 2 horas y queda registrada a tu nombre.</span>
      <div style={{ display: "flex", gap: 8 }}>
        <ButtonNew size="sm" variant="primary" type="submit" disabled={!valida} icon={<Eye size={13} />}>
          Entrar
        </ButtonNew>
        <ButtonNew size="sm" variant="secondary" type="button" icon={<X size={13} />} onClick={() => setAbierto(false)}>
          Cancelar
        </ButtonNew>
      </div>
    </form>
  );
}
