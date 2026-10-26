"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Lock, X } from "lucide-react";
import s from "./reporte-sedes.module.css";

export interface TextosCuadroClave {
  titulo: string;
  texto: string;
  etiqueta: string;
  entrar: string;
  comprobando: string;
  cancelar: string;
  incorrecta: string;
  bloqueo: string;
  enCurso: string;
  error: string;
  olvido: string;
}

/**
 * ws1-t4 v2 — pedido de Rafael: en el Reporte de sedes, la sede con clave se
 * queda con su nombre y un candado; al tocarla sale este cuadro para teclear su
 * clave. Usa el MISMO endpoint de desbloqueo (y sus límites de intentos) con
 * `cambiarDeSede: false`: el dueño se queda en la sede en la que está y el
 * desbloqueo vale sus 72 h normales. Con la clave correcta, el reporte se
 * recarga (`onListo`) y la sede sale completa, también en el CSV.
 */
export function CuadroClave({
  clinicId,
  nombre,
  tx,
  onListo,
  onCerrar,
}: {
  clinicId: string;
  nombre: string;
  tx: TextosCuadroClave;
  onListo: () => void;
  onCerrar: () => void;
}) {
  const [clave, setClave] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, [onCerrar]);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    if (ocupado || !clave) return;
    setOcupado(true);
    setError(null);
    try {
      const res = await fetch("/api/sede-clave/desbloquear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ clinicId, clave, cambiarDeSede: false }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setClave("");
        if (data?.code === "bloqueo") setError(tx.bloqueo.replace("{minutos}", String(data?.minutos ?? 15)));
        else if (data?.code === "en_curso") setError(tx.enCurso);
        else if (data?.code === "clave_incorrecta") setError(tx.incorrecta.replace("{restantes}", String(data?.restantes ?? 0)));
        else setError(tx.error);
        return;
      }
      onListo();
    } catch {
      setError(tx.error);
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className={s.cuadroFondo} onClick={onCerrar}>
      <div
        className={s.cuadro}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cuadro-clave-titulo"
        data-testid="cuadro-clave"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={s.cuadroCabeza}>
          <h2 id="cuadro-clave-titulo" className={s.cuadroTitulo}>
            <Lock size={15} aria-hidden /> {tx.titulo}
          </h2>
          <button type="button" className={s.cuadroCerrar} onClick={onCerrar} aria-label={tx.cancelar}>
            <X size={16} aria-hidden />
          </button>
        </div>
        <p className={s.cuadroTexto}><strong>{nombre}</strong> · {tx.texto}</p>
        <form onSubmit={entrar} className={s.cuadroForma}>
          {error && <p className={s.aviso} role="alert">{error}</p>}
          <label className={s.campoEtiqueta} htmlFor="cuadro-clave-entrada">{tx.etiqueta}</label>
          <input
            id="cuadro-clave-entrada"
            className={s.campoEntrada}
            type="password"
            autoComplete="off"
            autoFocus
            maxLength={72}
            value={clave}
            onChange={(e) => setClave(e.target.value)}
          />
          <p className={s.notaPie}>{tx.olvido}</p>
          <div className={s.cuadroAcciones}>
            <button type="button" className={s.boton} onClick={onCerrar} disabled={ocupado}>{tx.cancelar}</button>
            <button type="submit" className={`${s.boton} ${s.botonPrincipal}`} disabled={ocupado || !clave}>
              {ocupado ? tx.comprobando : tx.entrar}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
