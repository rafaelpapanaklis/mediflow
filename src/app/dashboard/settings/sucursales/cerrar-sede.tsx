"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { useLocale } from "@/i18n/i18n-provider";

const es = {
  cerrar: "Cerrar sede",
  confirmar: (n: string) => `¿Cerrar «${n}»? Su equipo dejará de poder entrar y ya no contará en tus cupos. Los expedientes se conservan.`,
  si: "Sí, cerrar", no: "Cancelar", listo: "Sede cerrada", error: "No se pudo cerrar la sede",
};
const en = {
  cerrar: "Close location",
  confirmar: (n: string) => `Close “${n}”? Its team will no longer be able to sign in and it stops counting toward your limits. Records are kept.`,
  si: "Yes, close", no: "Cancel", listo: "Location closed", error: "Could not close the location",
};

/** M3: «Cerrar sede» con confirmación. El servidor decide si se puede (principal, activa, única). */
export function CerrarSede({ clinicId, clinicName, onCerrada }: { clinicId: string; clinicName: string; onCerrada: (id: string) => void }) {
  const x = useLocale().startsWith("en") ? en : es;
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, setOcupado] = useState(false);

  async function cerrar() {
    setOcupado(true);
    try {
      const res = await fetch("/api/clinics/archivar", {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ clinicId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? x.error);
      toast.success(x.listo);
      onCerrada(clinicId);
    } catch (e: any) {
      toast.error(e?.message ?? x.error);
      setConfirmando(false);
    } finally {
      setOcupado(false);
    }
  }

  if (!confirmando) {
    return (
      <button type="button" onClick={() => setConfirmando(true)}
        style={{ marginLeft: "auto", fontSize: 12, color: "var(--danger)", background: "none", border: 0, cursor: "pointer", flexShrink: 0 }}>
        {x.cerrar}
      </button>
    );
  }
  return (
    <span role="alertdialog" style={{ marginLeft: "auto", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", fontSize: 12 }}>
      <span style={{ color: "var(--text-2)" }}>{x.confirmar(clinicName)}</span>
      <button type="button" disabled={ocupado} onClick={cerrar} style={{ color: "var(--danger)", fontWeight: 700, background: "none", border: 0, cursor: "pointer" }}>{x.si}</button>
      <button type="button" disabled={ocupado} onClick={() => setConfirmando(false)} style={{ background: "none", border: 0, cursor: "pointer", color: "var(--text-3)" }}>{x.no}</button>
    </span>
  );
}
