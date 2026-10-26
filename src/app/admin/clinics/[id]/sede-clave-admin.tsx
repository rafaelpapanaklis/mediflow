"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";

/**
 * «Quitar clave de la sede» (ws1-t4). Solo se pinta si la sede tiene la clave
 * activa. Pide confirmación y motivo; el servidor (POST
 * /api/admin/clinics/[id]/sede-clave) la deja sin clave y lo registra en la
 * bitácora admin. La clave nunca se ve ni se escribe aquí.
 */
export function SedeClaveAdmin({ clinicId }: { clinicId: string }) {
  const [activa, setActiva] = useState<boolean | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/admin/clinics/${encodeURIComponent(clinicId)}/sede-clave`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setActiva(!!d?.disponible && !!d?.activa); })
      .catch(() => { if (vivo) setActiva(false); });
    return () => { vivo = false; };
  }, [clinicId]);

  async function quitar() {
    if (ocupado || motivo.trim().length < 5) return;
    setOcupado(true);
    try {
      const res = await fetch(`/api/admin/clinics/${encodeURIComponent(clinicId)}/sede-clave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "No se pudo quitar la clave");
      toast.success("Clave de la sede quitada. El dueño o el admin con permiso pueden poner una nueva.");
      setActiva(false);
      setAbierto(false);
      setMotivo("");
    } catch (e: any) {
      toast.error(e?.message ?? "No se pudo quitar la clave");
    } finally {
      setOcupado(false);
    }
  }

  if (!activa) return null;

  return (
    <CardNew>
      <div className="form-section__title">
        Clave de la sede <span className="form-section__rule" />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10, lineHeight: 1.5 }}>
        Esta sede tiene clave: nadie entra sin teclearla, tampoco el dueño de la cuenta. Si la olvidaron, quítala
        aquí y la sede queda sin clave hasta que el dueño o un administrador con el permiso pongan una nueva.
        «Ver como clínica» entra sin la clave.
      </div>
      {!abierto ? (
        <ButtonNew variant="danger" onClick={() => setAbierto(true)}>
          Quitar clave de la sede
        </ButtonNew>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="field-new">
            <label className="field-new__label" htmlFor="sede-clave-motivo">Motivo (queda en la bitácora)</label>
            <textarea
              id="sede-clave-motivo"
              className="input-new"
              rows={2}
              maxLength={500}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ej.: la administradora de la sede la olvidó; lo pidió por WhatsApp el dueño"
            />
          </div>
          <div style={{ fontSize: 12, color: "var(--danger)" }}>
            ¿Seguro? La sede quedará sin clave y cualquiera con acceso a ella podrá entrar.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ButtonNew variant="danger" onClick={quitar} disabled={ocupado || motivo.trim().length < 5}>
              {ocupado ? "Quitando…" : "Sí, quitar la clave"}
            </ButtonNew>
            <ButtonNew variant="secondary" onClick={() => { setAbierto(false); setMotivo(""); }} disabled={ocupado}>
              Cancelar
            </ButtonNew>
          </div>
        </div>
      )}
    </CardNew>
  );
}
