"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LockKeyhole, LockKeyholeOpen } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import { CLAVE_MIN } from "@/lib/sede-clave/constantes";

type Estado = { disponible: boolean; puedeGestionar: boolean; activa: boolean };
type Modo = null | "activar" | "cambiar" | "desactivar";

/**
 * «Clave de la sede» en Configuración → Seguridad (ws1-t4). Lo decide todo el
 * servidor (GET/POST /api/sede-clave, sobre la sede activa de la sesión): esta
 * tarjeta no se pinta si quien la abre no es el SUPER_ADMIN ni un ADMIN con el
 * permiso «sede.clave», ni mientras el SQL de la función no esté pegado.
 * La clave nunca vuelve del servidor: solo `activa` sí/no.
 */
export function SedeClaveCard() {
  const t = useT();
  const [estado, setEstado] = useState<Estado | null>(null);
  const [modo, setModo] = useState<Modo>(null);
  const [actual, setActual] = useState("");
  const [nueva, setNueva] = useState("");
  const [confirmacion, setConfirmacion] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/sede-clave", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (vivo) setEstado(d && typeof d === "object" ? (d as Estado) : { disponible: false, puedeGestionar: false, activa: false }); })
      .catch(() => { if (vivo) setEstado({ disponible: false, puedeGestionar: false, activa: false }); });
    return () => { vivo = false; };
  }, []);

  function abrir(m: Modo) {
    setModo(m);
    setActual("");
    setNueva("");
    setConfirmacion("");
    setError(null);
  }

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!modo || ocupado) return;
    if (modo !== "desactivar") {
      if (nueva.length < CLAVE_MIN) { setError(t("sedeClave.card.corta", { min: CLAVE_MIN })); return; }
      if (nueva !== confirmacion) { setError(t("sedeClave.card.distintas")); return; }
    }
    setError(null);
    setOcupado(true);
    try {
      const res = await fetch("/api/sede-clave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          accion: modo,
          ...(modo !== "activar" ? { claveActual: actual } : {}),
          ...(modo !== "desactivar" ? { clave: nueva, confirmacion } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : t("sedeClave.card.error"));
        setActual("");
        return;
      }
      setEstado((s) => (s ? { ...s, activa: !!data.activa } : s));
      toast.success(
        modo === "activar" ? t("sedeClave.card.activadaToast")
          : modo === "cambiar" ? t("sedeClave.card.cambiadaToast")
            : t("sedeClave.card.desactivadaToast"),
      );
      abrir(null);
    } catch {
      setError(t("sedeClave.card.error"));
    } finally {
      setOcupado(false);
    }
  }

  // Cargando: esqueleto del mismo alto que la cabecera, para que no salte.
  if (estado === null) {
    return <div className="card p-6" aria-busy="true" style={{ minHeight: 88, opacity: 0.6 }} />;
  }
  if (!estado.puedeGestionar || !estado.disponible) return null;

  const activa = estado.activa;

  return (
    <div className="card p-6 space-y-4" data-testid="sede-clave-card">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{
              background: activa ? "var(--success-soft)" : "var(--bg-elev-2)",
              color: activa ? "var(--success-strong)" : "var(--text-3)",
            }}
          >
            {activa ? <LockKeyhole size={20} strokeWidth={1.75} /> : <LockKeyholeOpen size={20} strokeWidth={1.75} />}
          </div>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-1)", margin: 0 }}>
              {t("sedeClave.card.titulo")}
            </h2>
            <p style={{ fontSize: 12.5, color: "var(--text-3)", margin: "2px 0 0" }}>
              {t("sedeClave.card.subtitulo")}
            </p>
          </div>
        </div>
        <span className={`badge-new shrink-0 ${activa ? "badge-new--success" : "badge-new--neutral"}`}>
          {activa && <span className="badge-new__dot" />}
          {activa ? t("sedeClave.card.activa") : t("sedeClave.card.inactiva")}
        </span>
      </div>

      <p style={{ fontSize: 12.5, color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
        {t("sedeClave.card.explicacion")}
      </p>

      {modo === null && (
        <div className="flex flex-wrap gap-2">
          {activa ? (
            <>
              <button type="button" className="btn-new btn-new--secondary" onClick={() => abrir("cambiar")}>
                {t("sedeClave.card.cambiar")}
              </button>
              <button type="button" className="btn-new btn-new--ghost" style={{ color: "var(--danger)" }} onClick={() => abrir("desactivar")}>
                {t("sedeClave.card.desactivar")}
              </button>
            </>
          ) : (
            <button type="button" className="btn-new btn-new--primary" onClick={() => abrir("activar")}>
              {t("sedeClave.card.activar")}
            </button>
          )}
        </div>
      )}

      {modo !== null && (
        <form onSubmit={enviar} className="space-y-3">
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
          {modo !== "activar" && (
            <div className="field-new">
              <label className="field-new__label" htmlFor="sede-clave-actual">{t("sedeClave.card.actual")}</label>
              <input id="sede-clave-actual" type="password" autoComplete="off" className="input-new" maxLength={72}
                value={actual} onChange={(e) => setActual(e.target.value)} autoFocus />
            </div>
          )}
          {modo !== "desactivar" && (
            <>
              <div className="field-new">
                <label className="field-new__label" htmlFor="sede-clave-nueva">{t("sedeClave.card.nueva")}</label>
                <input id="sede-clave-nueva" type="password" autoComplete="new-password" className="input-new" maxLength={72}
                  placeholder={t("sedeClave.card.nuevaPlaceholder", { min: CLAVE_MIN })}
                  value={nueva} onChange={(e) => setNueva(e.target.value)} autoFocus={modo === "activar"} />
              </div>
              <div className="field-new">
                <label className="field-new__label" htmlFor="sede-clave-confirmacion">{t("sedeClave.card.confirmar")}</label>
                <input id="sede-clave-confirmacion" type="password" autoComplete="new-password" className="input-new" maxLength={72}
                  value={confirmacion} onChange={(e) => setConfirmacion(e.target.value)} />
              </div>
            </>
          )}
          {modo === "desactivar" && (
            <p style={{ fontSize: 12, color: "var(--text-3)", margin: 0 }}>{t("sedeClave.card.desactivarAviso")}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className={`btn-new ${modo === "desactivar" ? "btn-new--danger" : "btn-new--primary"}`}
              disabled={ocupado || (modo !== "activar" && !actual) || (modo !== "desactivar" && (!nueva || !confirmacion))}
            >
              {ocupado ? t("sedeClave.card.guardando")
                : modo === "activar" ? t("sedeClave.card.activarConfirmar")
                  : modo === "cambiar" ? t("sedeClave.card.cambiarConfirmar")
                    : t("sedeClave.card.desactivarConfirmar")}
            </button>
            <button type="button" className="btn-new btn-new--ghost" disabled={ocupado} onClick={() => abrir(null)}>
              {t("sedeClave.card.cancelar")}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
