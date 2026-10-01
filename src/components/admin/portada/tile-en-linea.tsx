"use client";

// «Clínicas en línea»: la tarjeta azul del Dashboard de /admin (antes «Clínicas
// cerca de un tope», que ahora vive dentro de «Este mes»).
//
// El número sale de Redis (señal de vida del panel de cada clínica, ver
// @/lib/presencia). Se refresca cada 60 s mientras la pestaña de /admin está
// visible. Al hacer clic abre la lista: clínicas en línea, usuarios conectados,
// «en línea desde HH:MM · duración» y la pantalla de cada usuario.
// Sin Redis (o si falla) la tarjeta dice «sin dato»: nunca un 0 que mienta.

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Wifi, X } from "lucide-react";
import { horaAdmin } from "@/lib/admin/zona-horaria";
import { formatoDuracion, type RespuestaEnLinea } from "@/lib/presencia/presencia-core";

const REFRESCO_MS = 60_000;
const RUTA = "/api/admin/en-linea";

export type EnLineaInicial = Pick<RespuestaEnLinea, "disponible" | "clinicas" | "ahora">;

export function TileEnLinea({ inicial }: { inicial: EnLineaInicial }) {
  const [resp, setResp] = useState<RespuestaEnLinea>({ ...inicial });
  const [abierto, setAbierto] = useState(false);
  const [cargando, setCargando] = useState(false);
  const abiertoRef = useRef(false);
  abiertoRef.current = abierto;

  const leer = useCallback(async (conDetalle: boolean) => {
    try {
      const r = await fetch(conDetalle ? `${RUTA}?detalle=1` : RUTA, { cache: "no-store", credentials: "same-origin" });
      if (!r.ok) throw new Error(String(r.status));
      setResp((await r.json()) as RespuestaEnLinea);
    } catch {
      // Sin respuesta no se inventa un número: se queda lo último y la siguiente lectura reintenta.
    } finally {
      setCargando(false);
    }
  }, []);

  // Refresco cada 60 s (con la pestaña visible); con la lista abierta, la lista entera.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void leer(abiertoRef.current);
    }, REFRESCO_MS);
    return () => window.clearInterval(id);
  }, [leer]);

  // Al volver a la pestaña el número no espera al reloj.
  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === "visible") void leer(abiertoRef.current);
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [leer]);

  useEffect(() => {
    if (!abierto) return;
    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") setAbierto(false); };
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [abierto]);

  const abrir = () => {
    setAbierto(true);
    setCargando(true);
    void leer(true);
  };

  const sinDato = !resp.disponible || resp.clinicas === null;
  const detalle = resp.detalle ?? null;

  return (
    <>
      <button
        type="button"
        className={`dcp-tile dcp-tile--${sinDato ? "quieto" : "info"} dcp-tile--boton`}
        onClick={abrir}
        aria-haspopup="dialog"
        title="Clínicas con al menos un usuario con el panel abierto y activo en los últimos 5 minutos. Clic para ver quién y en qué pantalla."
        data-en-linea
      >
        <span className="dcp-tile__icono" aria-hidden><Wifi size={24} strokeWidth={2} /></span>
        <span className="dcp-tile__texto">
          <span className="dcp-tile__n dcp-num">{sinDato ? "—" : resp.clinicas}</span>
          <span className="dcp-tile__label">{sinDato ? "Clínicas en línea · sin dato" : "Clínicas en línea"}</span>
        </span>
      </button>

      {abierto && (
        <div className="dcp-modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setAbierto(false); }}>
          <div className="dcp-modal__caja" role="dialog" aria-modal="true" aria-labelledby="dcp-en-linea-titulo">
            <header className="dcp-modal__cabeza">
              <div style={{ minWidth: 0 }}>
                <h2 id="dcp-en-linea-titulo" className="dcp-card__title">Clínicas en línea</h2>
                <div className="dcp-card__sub">
                  Con el panel abierto y activo en los últimos 5 min · se actualiza cada minuto
                </div>
              </div>
              <button type="button" className="dcp-modal__cerrar" onClick={() => setAbierto(false)} aria-label="Cerrar">
                <X size={16} aria-hidden />
              </button>
            </header>

            <div className="dcp-modal__cuerpo">
              {sinDato ? (
                <div className="dcp-tabla__vacio">
                  Sin dato: no se pudo leer la señal de las clínicas (Redis no está configurado o no responde).
                </div>
              ) : detalle === null || cargando ? (
                <div className="dcp-tabla__vacio">Cargando…</div>
              ) : detalle.length === 0 ? (
                <div className="dcp-tabla__vacio">Ninguna clínica en línea ahora.</div>
              ) : (
                <ul className="dcp-pend">
                  {detalle.map((c) => (
                    <li key={c.clinicId} className="dcp-enlinea__clinica">
                      <div className="dcp-enlinea__fila">
                        <Link href={`/admin/clinics/${c.clinicId}`} className="dcp-pend__clinica">{c.nombre}</Link>
                        <span className="dcp-pend__dato dcp-num">
                          {c.usuarios.length} {c.usuarios.length === 1 ? "usuario" : "usuarios"}
                        </span>
                      </div>
                      <div className="dcp-meta" style={{ maxWidth: "none" }}>
                        en línea desde {horaAdmin(c.desde) ?? "—"} · {formatoDuracion(resp.ahora - c.desde)}
                      </div>
                      <ul className="dcp-enlinea__usuarios">
                        {c.usuarios.map((u, i) => (
                          <li key={`${u.nombre}-${i}`}>
                            <span className="dcp-online" aria-hidden />
                            <span className="dcp-enlinea__nombre">{u.nombre}</span>
                            <span className="dcp-suave">{u.pantalla}</span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
