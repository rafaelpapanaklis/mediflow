"use client";

/**
 * Vigía de «Ver como clínica» en cada pestaña del panel (ws1-t11, punto 2).
 *
 * La sesión del panel es una cookie: la comparten todas las pestañas del
 * navegador. Al entrar a «Ver como» (o al salir), una pestaña que ya estaba
 * abierta sigue mostrando la clínica con la que se pintó, pero lo que guarde
 * va a la sesión nueva. Se eligió bloquearla en vez de intentar una
 * suplantación «por pestaña» (imposible con la sesión en cookie sin rehacer la
 * autenticación de todo el panel): en cuanto la pestaña vuelve a estar a la
 * vista, o cada 2 s mientras lo está, compara la marca df_ver_como con la que
 * tenía al pintarse; si cambió, lo confirma con el servidor y tapa la pantalla
 * con un aviso que solo ofrece recargar o salir. Las pestañas nuevas se pintan
 * ya con la franja de arriba. Una sesión normal sin suplantación nunca cambia
 * la marca: no hace ninguna petición.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/i18n/i18n-provider";
import { COOKIE_PESTANA_VER_COMO, pestanaDesfasada } from "@/lib/admin/suplantacion-core";
import { textosPestanaVerComo } from "@/lib/admin/ver-como-pestana-textos";

const CANAL = "dalecontrol-ver-como";

function leerMarca(): string {
  const par = document.cookie.split(/;\s*/).find((c) => c.startsWith(`${COOKIE_PESTANA_VER_COMO}=`));
  return par ? decodeURIComponent(par.slice(COOKIE_PESTANA_VER_COMO.length + 1)) : "";
}

type Aviso = { tipo: "ahora"; clinica: string | null } | { tipo: "salio" };

export function VigiaVerComo({ clave }: { clave: string }) {
  let locale = "es";
  try {
    locale = useLocale();
  } catch {
    // sin provider: español
  }
  const t = textosPestanaVerComo(locale);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const revisando = useRef(false);
  const ultimaMarca = useRef<string | null>(null);

  const revisar = useCallback(async () => {
    if (revisando.current) return;
    const marca = leerMarca();
    if (!pestanaDesfasada(clave, marca)) return;
    if (ultimaMarca.current === marca) return; // ya se confirmó esta marca
    revisando.current = true;
    try {
      let srv: { activa?: boolean; id?: string; clinica?: string | null } | null = null;
      try {
        const r = await fetch("/api/admin/impersonate/estado", { cache: "no-store" });
        if (r.ok) srv = await r.json();
      } catch { /* sin red: decide la marca */ }
      ultimaMarca.current = marca;
      const idServidor = srv ? (srv.activa ? srv.id ?? "" : "") : marca;
      if (!pestanaDesfasada(clave, idServidor)) return; // la marca quedó vieja; la sesión es la misma
      setAviso(idServidor ? { tipo: "ahora", clinica: srv?.clinica ?? null } : { tipo: "salio" });
    } finally {
      revisando.current = false;
    }
  }, [clave]);

  useEffect(() => {
    let canal: BroadcastChannel | null = null;
    try {
      canal = new BroadcastChannel(CANAL);
      canal.onmessage = () => void revisar();
      // Avisa a las demás pestañas de que este navegador pintó una sesión.
      canal.postMessage({ clave });
    } catch { /* navegador sin BroadcastChannel: quedan el foco y el intervalo */ }
    const alVolver = () => { if (document.visibilityState === "visible") void revisar(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("focus", alVolver);
    const id = window.setInterval(alVolver, 2000);
    void revisar();
    return () => {
      canal?.close();
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("focus", alVolver);
      window.clearInterval(id);
    };
  }, [clave, revisar]);

  if (!aviso) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="vigia-ver-como-titulo"
      data-vigia-ver-como={aviso.tipo}
      style={{
        position: "fixed", inset: 0, zIndex: 2147483000, display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, background: "color-mix(in srgb, var(--text-1) 55%, transparent)",
      }}
    >
      <div
        style={{
          maxWidth: 480, width: "100%", padding: 20, borderRadius: "var(--radius-lg)", background: "var(--bg-elev)",
          color: "var(--text-1)", border: "2px solid var(--warning)", boxShadow: "var(--shadow-3)",
        }}
      >
        <h2 id="vigia-ver-como-titulo" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: "var(--warning-strong)" }}>
          {aviso.tipo === "ahora" ? t.tituloAhora(aviso.clinica) : t.tituloSalio}
        </h2>
        <p style={{ margin: "10px 0 16px", fontSize: 14, lineHeight: 1.5, color: "var(--text-2)" }}>
          {aviso.tipo === "ahora" ? t.cuerpoAhora : t.cuerpoSalio}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end" }}>
          {aviso.tipo === "ahora" && (
            <form method="POST" action="/api/admin/impersonate/salir">
              <button
                type="submit"
                style={{
                  padding: "8px 14px", borderRadius: "var(--radius)", border: "1px solid var(--border-strong)",
                  background: "var(--bg-elev)", color: "var(--text-1)", fontSize: 13, fontWeight: 600, cursor: "pointer",
                }}
              >
                {t.salir}
              </button>
            </form>
          )}
          <button
            type="button"
            autoFocus
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 14px", borderRadius: "var(--radius)", border: "1px solid var(--warning)",
              background: "var(--warning)", color: "var(--bg-elev)", fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >
            {t.recargar}
          </button>
        </div>
      </div>
    </div>
  );
}
