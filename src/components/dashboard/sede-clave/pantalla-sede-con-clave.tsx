"use client";

import { useState, type FormEvent } from "react";
import { Building2, LockKeyhole } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";
import { cerrarSesionPanel } from "@/lib/auth/cerrar-sesion-panel";
import { RUTA_SEDE_CON_CLAVE, STATUS_SEDE_CON_CLAVE } from "@/lib/sede-clave/constantes";

interface Props {
  clinicId: string;
  nombre: string;
  /** La sede pedida es la activa (el layout la mandó aquí) o una hermana (el selector). */
  esLaActiva: boolean;
  /** La sede ya no pide clave (desbloqueo vigente o se la quitaron): solo falta cambiar. */
  abierta: boolean;
  otras: Array<{ clinicId: string; clinicName: string }>;
  next: string;
}

/**
 * «Esta sede tiene clave» (ws1-t4). Pinta con los tokens de siempre
 * (`--text-1`, `--brand`…), igual que el reto del 2FA: con el rediseño
 * encendido la página la envuelve en `RaizCuenta barrera`, que los redirige a
 * los del menú. La decisión de quién entra la toma el servidor: esto solo
 * pregunta la clave y lleva a donde toque.
 */
export function PantallaSedeConClave({ clinicId, nombre, esLaActiva, abierta, otras, next }: Props) {
  const t = useT();
  const [clave, setClave] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cambiandoA, setCambiandoA] = useState<string | null>(null);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    if (ocupado || !clave) return;
    setError(null);
    setOcupado(true);
    try {
      const res = await fetch("/api/sede-clave/desbloquear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clave, clinicId: esLaActiva ? undefined : clinicId, next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setClave("");
        if (data?.code === "bloqueo") setError(t("sedeClave.pantalla.bloqueo", { minutos: data?.minutos ?? 15 }));
        else if (data?.code === "clave_incorrecta") setError(t("sedeClave.pantalla.incorrecta", { restantes: data?.restantes ?? 0 }));
        else setError(t("sedeClave.pantalla.error"));
        setOcupado(false);
        return;
      }
      // Navegación DURA: el layout server decide qué se pinta con la sede nueva.
      window.location.href = typeof data?.destino === "string" ? data.destino : "/dashboard";
    } catch {
      setError(t("sedeClave.pantalla.error"));
      setOcupado(false);
    }
  }

  async function irA(id: string) {
    if (cambiandoA) return;
    setCambiandoA(id);
    try {
      const res = await fetch("/api/switch-clinic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clinicId: id }),
      });
      if (res.status === STATUS_SEDE_CON_CLAVE) {
        window.location.href = `${RUTA_SEDE_CON_CLAVE}?sede=${encodeURIComponent(id)}`;
        return;
      }
      if (!res.ok) throw new Error();
      window.location.href = "/dashboard";
    } catch {
      setError(t("sedeClave.pantalla.errorCambio"));
      setCambiandoA(null);
    }
  }

  return (
    <div className="w-full" style={{ maxWidth: 420, margin: "0 auto" }} data-testid="sede-con-clave">
      <div className="card p-6 space-y-5" style={{ boxShadow: "var(--shadow-2)" }}>
        <div className="flex flex-col items-center text-center gap-2">
          <div
            className="flex items-center justify-center rounded-full"
            style={{ width: 44, height: 44, background: "var(--brand-soft)", color: "var(--consult-active-accent)" }}
          >
            <LockKeyhole size={20} strokeWidth={1.75} aria-hidden />
          </div>
          <h1 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
            {t("sedeClave.pantalla.titulo")}
          </h1>
          {nombre && (
            <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)", margin: 0 }}>{nombre}</p>
          )}
          <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: 0 }}>
            {abierta ? t("sedeClave.pantalla.abierta") : t("sedeClave.pantalla.subtitulo")}
          </p>
        </div>

        {abierta ? (
          <button
            type="button"
            className="btn-new btn-new--primary"
            style={{ width: "100%", height: 40, justifyContent: "center" }}
            disabled={!!cambiandoA}
            onClick={() => irA(clinicId)}
          >
            {t("sedeClave.pantalla.irALaSede")}
          </button>
        ) : (
          <form onSubmit={entrar} className="space-y-4">
            {error && (
              <div
                role="alert"
                style={{
                  background: "var(--danger-soft)",
                  border: "1px solid var(--danger-border-strong)",
                  borderRadius: "var(--radius)",
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "var(--danger)",
                }}
              >
                {error}
              </div>
            )}
            <div className="field-new">
              <label className="field-new__label" htmlFor="sede-clave-entrada">
                {t("sedeClave.pantalla.etiqueta")}
              </label>
              <input
                id="sede-clave-entrada"
                type="password"
                value={clave}
                onChange={(e) => setClave(e.target.value)}
                autoComplete="off"
                autoFocus
                maxLength={72}
                className="input-new"
                style={{ height: 44 }}
              />
            </div>
            <button
              type="submit"
              className="btn-new btn-new--primary"
              style={{ width: "100%", height: 40, justifyContent: "center" }}
              disabled={ocupado || !clave}
            >
              {ocupado ? t("sedeClave.pantalla.comprobando") : t("sedeClave.pantalla.entrar")}
            </button>
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0, textAlign: "center" }}>
              {t("sedeClave.pantalla.olvido")}
            </p>
          </form>
        )}

        {otras.length > 0 && (
          <div className="space-y-2" style={{ borderTop: "1px solid var(--border-soft)", paddingTop: 14 }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)", margin: 0 }}>
              {t("sedeClave.pantalla.volver")}
            </p>
            {otras.map((s) => (
              <button
                key={s.clinicId}
                type="button"
                className="btn-new btn-new--ghost"
                style={{ width: "100%", height: 38, justifyContent: "flex-start", gap: 8, fontSize: 13 }}
                disabled={!!cambiandoA}
                onClick={() => irA(s.clinicId)}
              >
                <Building2 size={14} strokeWidth={1.75} aria-hidden style={{ color: "var(--text-3)", flexShrink: 0 }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.clinicName}</span>
              </button>
            ))}
          </div>
        )}

        <button
          type="button"
          onClick={() => cerrarSesionPanel("SedeConClave")}
          className="btn-new btn-new--ghost"
          style={{ width: "100%", height: 36, justifyContent: "center", fontSize: 12, color: "var(--text-3)" }}
        >
          {t("sedeClave.pantalla.cerrarSesion")}
        </button>
      </div>
    </div>
  );
}
