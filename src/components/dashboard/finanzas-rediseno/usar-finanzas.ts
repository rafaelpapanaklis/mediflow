"use client";

/**
 * Los datos de «Finanzas» para el rediseño: la MISMA lógica que
 * `finanzas-client.tsx` (periodos, rango personalizado, las dos peticiones en
 * paralelo a /api/finanzas y /api/gastos, registrar y eliminar un gasto),
 * copiada tal cual y sin una sola cifra, fórmula ni periodo distinto. Vive
 * aparte para que el camino viejo siga intacto con el interruptor apagado.
 *
 * Ni una consulta nueva ni un reloj: son las dos mismas peticiones de hoy,
 * disparadas solo cuando cambia el periodo o cuando se guarda/elimina un gasto.
 */

import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";

// ── Contrato de datos (no renombrar claves) ────────────────────────
export interface SeriePoint { fecha: string; ingresos: number; gastos: number }
export interface DoctorRow  { doctorId: string; doctor: string; ingresos: number }
export interface FinanzasResumen {
  ingresos: number;
  gastos:   number;
  utilidad: number;
  ventas:   number;
  citas:    number;
  efectivo: number;
  serie:     SeriePoint[];
  porDoctor: DoctorRow[];
  saldos:    { porCobrar: number; vencido: number };
}
export interface Gasto { id: string; date: string; category: string; amount: number; note: string | null }

export type PeriodKey = "hoy" | "mes" | "mes_anterior" | "custom";

export const PERIODOS: { key: PeriodKey; label: string }[] = [
  { key: "hoy",          label: "Hoy" },
  { key: "mes",          label: "Este mes" },
  { key: "mes_anterior", label: "Mes anterior" },
  { key: "custom",       label: "Personalizado" },
];

export const CATEGORIAS = ["Renta", "Insumos", "Nómina", "Servicios", "Marketing", "Otro"];

export function todayLocalISO(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function useFinanzas() {
  const [period, setPeriod] = useState<PeriodKey>("mes");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo]     = useState("");
  // query = fuente de verdad del refetch. Cambiar el periodo / Aplicar la
  // actualiza; reloadKey fuerza recarga (Reintentar, post-guardar/eliminar gasto).
  const [query, setQuery]         = useState("period=mes");
  const [reloadKey, setReloadKey] = useState(0);

  const [data, setData]       = useState<FinanzasResumen | null>(null);
  const [gastos, setGastos]   = useState<Gasto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(false);

  // Diálogo «Registrar gasto»
  const [showModal, setShowModal]   = useState(false);
  const [mCategoria, setMCategoria] = useState(CATEGORIAS[0]);
  const [mMonto, setMMonto]         = useState("");
  const [mFecha, setMFecha]         = useState(todayLocalISO());
  const [mNota, setMNota]           = useState("");
  const [saving, setSaving]         = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Deps SOLO query + reloadKey (el estado que setea el efecto NO va en deps
  // para no auto-cancelarse). AbortController limpia el fetch anterior.
  useEffect(() => {
    const ctrl = new AbortController();
    let alive = true;
    setLoading(true);
    setError(false);
    Promise.all([
      fetch(`/api/finanzas?${query}`, { signal: ctrl.signal }).then((r) => {
        if (!r.ok) throw new Error("finanzas");
        return r.json();
      }),
      fetch(`/api/gastos?${query}`, { signal: ctrl.signal }).then((r) => {
        if (!r.ok) throw new Error("gastos");
        return r.json();
      }),
    ])
      .then(([resumen, g]) => {
        if (!alive) return;
        setData(resumen as FinanzasResumen);
        setGastos(Array.isArray(g?.gastos) ? (g.gastos as Gasto[]) : []);
        setLoading(false);
      })
      .catch((e: any) => {
        if (!alive || e?.name === "AbortError") return;
        setError(true);
        setLoading(false);
      });
    return () => { alive = false; ctrl.abort(); };
  }, [query, reloadKey]);

  const selectPeriod = (p: PeriodKey) => {
    setPeriod(p);
    if (p !== "custom") setQuery(`period=${p}`);
    // Personalizado espera al botón «Aplicar».
  };

  const customValid = !!customFrom && !!customTo && customFrom <= customTo;
  const applyCustom = () => {
    if (!customValid) return;
    setQuery(`period=custom&from=${customFrom}&to=${customTo}`);
  };

  const reintentar = () => setReloadKey((k) => k + 1);

  const openModal = () => {
    setMCategoria(CATEGORIAS[0]);
    setMMonto("");
    setMFecha(todayLocalISO());
    setMNota("");
    setShowModal(true);
  };
  const closeModal = () => setShowModal(false);

  const montoNum   = parseFloat(mMonto);
  const montoValid = !Number.isNaN(montoNum) && montoNum > 0;

  async function saveGasto() {
    if (!montoValid || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/gastos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: mFecha || undefined,
          category: mCategoria,
          amount: montoNum,
          note: mNota.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error();
      setShowModal(false);
      setReloadKey((k) => k + 1); // refresca gastos Y resumen
      toast.success("Gasto registrado");
    } catch {
      toast.error("No se pudo guardar el gasto. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteGasto(id: string) {
    if (!window.confirm("¿Eliminar este gasto?")) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/gastos?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setReloadKey((k) => k + 1);
    } catch {
      toast.error("No se pudo eliminar el gasto.");
    } finally {
      setDeletingId(null);
    }
  }

  // Memorizado: si no, `[]` sería una lista nueva en cada render y el useMemo de
  // abajo se recalcularía siempre (es el aviso de lint que arrastra el de siempre).
  const serie = useMemo(() => data?.serie ?? [], [data]);
  const hasMovs = useMemo(() => serie.some((p) => (p.ingresos || 0) > 0 || (p.gastos || 0) > 0), [serie]);
  const maxDoctor = useMemo(
    () => (data?.porDoctor ?? []).reduce((m, d) => Math.max(m, d.ingresos || 0), 0),
    [data],
  );
  const totalGastos = useMemo(() => gastos.reduce((s, g) => s + (g.amount || 0), 0), [gastos]);
  const utilidadPos = (data?.utilidad ?? 0) >= 0;

  return {
    period, selectPeriod,
    customFrom, setCustomFrom, customTo, setCustomTo, customValid, applyCustom,
    data, gastos, loading, error, reintentar,
    showModal, openModal, closeModal,
    mCategoria, setMCategoria, mMonto, setMMonto, mFecha, setMFecha, mNota, setMNota,
    montoValid, saving, saveGasto, deletingId, deleteGasto,
    serie, hasMovs, maxDoctor, totalGastos, utilidadPos,
  };
}
