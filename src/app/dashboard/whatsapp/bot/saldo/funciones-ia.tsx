"use client";

import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { BadgeNew } from "@/components/ui/design-system/badge-new";
import {
  FUNCIONES_IA,
  GASTO_IA_GRUPO,
  GASTO_IA_TEXTO,
  type FuncionIaId,
  type GastoIa,
} from "@/lib/ai-billing/interruptores";

// Funciones de IA (ws1-t1): la clínica apaga, función por función, lo que
// gasta su Saldo de IA o su cupo. Esta pantalla solo ENSEÑA y GUARDA; el
// corte de verdad lo hace el servidor antes de llamar a la IA.

export const GRUPOS_GASTO: GastoIa[] = ["saldo", "cupo", "ninguno"];

/** Estado y manejadores compartidos por la vista de siempre y la del rediseño. */
export function useFuncionesIa() {
  const [apagadas, setApagadas] = useState<FuncionIaId[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);
  const [guardando, setGuardando] = useState<FuncionIaId | null>(null);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const res = await fetch("/api/ai-wallet/funciones");
        if (!res.ok) throw new Error();
        const d = await res.json();
        if (!vivo) return;
        setApagadas(Array.isArray(d.apagadas) ? d.apagadas : []);
        setIsAdmin(d.isAdmin === true);
      } catch {
        if (vivo) setError(true);
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  async function alternar(id: FuncionIaId) {
    if (!isAdmin || guardando) return;
    const encendida = apagadas.includes(id); // apagada → se enciende, y al revés
    setGuardando(id);
    try {
      const res = await fetch("/api/ai-wallet/funciones", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funcion: id, encendida }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error || "No se pudo guardar");
      setApagadas(Array.isArray(d?.apagadas) ? d.apagadas : []);
      const nombre = FUNCIONES_IA.find((f) => f.id === id)?.nombre ?? id;
      toast.success(encendida ? `${nombre}: encendida` : `${nombre}: apagada`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(null);
    }
  }

  return { apagadas, isAdmin, cargando, error, guardando, alternar };
}

/** Lo que el cliente le pasa a cualquiera de las dos vistas. */
export type FuncionesIaVM = ReturnType<typeof useFuncionesIa>;

export const FUNCIONES_IA_TITULO = "Funciones de IA";
export const FUNCIONES_IA_SUB =
  "Apaga lo que no quieras que gaste. Una función apagada no llama a la IA: no gasta nada hasta que la vuelvas a encender.";
export const FUNCIONES_IA_SOLO_ADMIN = "Solo un administrador puede encender o apagar funciones.";

/** Vista de siempre (sin el rediseño). El estado lo pone SaldoClient. */
export function FuncionesIaCard({ vm }: { vm: FuncionesIaVM }) {
  const { apagadas, isAdmin, cargando, error, guardando, alternar } = vm;

  return (
    <CardNew title={FUNCIONES_IA_TITULO} sub={FUNCIONES_IA_SUB}>
      {cargando ? (
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>Cargando…</div>
      ) : error ? (
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>
          No se pudieron cargar las funciones de IA. Vuelve a intentarlo en unos momentos.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {!isAdmin && <div style={{ fontSize: 12, color: "var(--text-3)" }}>{FUNCIONES_IA_SOLO_ADMIN}</div>}
          {GRUPOS_GASTO.map((gasto) => (
            <div key={gasto} style={{ display: "grid", gap: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  textTransform: "uppercase",
                  color: "var(--text-3)",
                }}
              >
                {GASTO_IA_GRUPO[gasto]}
              </div>
              {FUNCIONES_IA.filter((f) => f.gasta === gasto).map((f) => {
                const on = !apagadas.includes(f.id);
                return (
                  <div
                    key={f.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 12,
                      padding: "10px 12px",
                      border: "1px solid var(--border-soft)",
                      borderRadius: 10,
                    }}
                  >
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={f.nombre}
                      disabled={!isAdmin || guardando !== null}
                      onClick={() => alternar(f.id)}
                      className={`switch ${on ? "switch--on" : ""}`}
                      style={{ flexShrink: 0, marginTop: 2 }}
                    >
                      <span className="switch__thumb" />
                    </button>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-1)" }}>{f.nombre}</span>
                        {!on && <BadgeNew tone="warning">Apagada</BadgeNew>}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 3 }}>
                        <strong>{GASTO_IA_TEXTO[f.gasta]}</strong> {f.queHace}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                        Si la apagas: {f.siLaApagas}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </CardNew>
  );
}
