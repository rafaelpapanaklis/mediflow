"use client";

// Caja (ws1-t5, F7):
//   · «N cobros en efectivo fuera de todo corte»: cobrados sin caja abierta o
//     con fecha anterior a la apertura. Se ven, y con la caja abierta se pasan
//     a ella con un clic («Pasar a esta caja»), que los suma a su efectivo
//     esperado. Se calla si no hay ninguno.
//   · «Cierre automático a medianoche» y «Descuento máximo sin el dueño»:
//     ajustes por clínica (apagado / 20 % de fábrica). Solo los ve quien puede
//     cambiarlos.
// La ropa es la de los demás avisos de Caja (tokens del panel).

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertTriangle, Settings2 } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { useLocale } from "@/i18n/i18n-provider";
import { fmtMXNdec } from "@/lib/format";
import { textosDinero } from "@/lib/dinero/textos";
import type { CobroFueraDeCorte } from "@/lib/caja";
import s from "@/components/dashboard/cobros-inventario-rediseno/avisos.module.css";

export function CobrosFueraDeCorte({
  cobros,
  cajaAbierta,
  timezone,
}: {
  cobros: CobroFueraDeCorte[] | undefined;
  cajaAbierta: boolean;
  timezone: string;
}) {
  const tx = textosDinero(useLocale()).caja;
  const router = useRouter();
  const [enviando, setEnviando] = useState<string | null>(null);
  if (!cobros || cobros.length === 0) return null;

  const fecha = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("es-MX", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: timezone });
    } catch {
      return new Date(iso).toLocaleString("es-MX");
    }
  };

  async function asignar(paymentId: string) {
    if (enviando) return;
    setEnviando(paymentId);
    try {
      const res = await fetch("/api/caja/asignar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(out?.code === "SQL_PENDIENTE" ? tx.fueraSinSql : out?.error ?? "No se pudo.");
        return;
      }
      toast.success(tx.fueraAsignado);
      router.refresh();
    } finally {
      setEnviando(null);
    }
  }

  const total = cobros.reduce((a, c) => a + c.amount, 0);
  return (
    <div className={s.aviso} role="alert" data-caja-fuera-de-corte>
      <div className={s.cabeza}>
        <span className={`${s.icono} ${s.iconoAlerta}`}>
          <AlertTriangle size={16} strokeWidth={1.75} aria-hidden />
        </span>
        <p className={s.titulo}>{tx.fueraTitulo(cobros.length)} · {fmtMXNdec(total)}</p>
      </div>
      <p className={s.sub} style={{ margin: "4px 0 8px" }}>{tx.fueraTexto} {cajaAbierta ? "" : tx.fueraSinCaja}</p>
      <ul className={s.renglones}>
        {cobros.slice(0, 20).map((c) => (
          <li key={c.paymentId} className={s.renglon} style={{ flexWrap: "wrap", gap: 8 }}>
            <span className={s.renglonTextos}>
              <span className={s.renglonNombre}>{c.patientName}</span>
              <span className={s.renglonMotivo}>{fecha(c.at)} · {c.concept}</span>
            </span>
            <span className={s.renglonImporte}>{fmtMXNdec(c.amount)}</span>
            {cajaAbierta && (
              <ButtonNew variant="secondary" size="sm" disabled={enviando !== null} onClick={() => asignar(c.paymentId)}>
                {enviando === c.paymentId ? "…" : tx.fueraAsignar}
              </ButtonNew>
            )}
          </li>
        ))}
      </ul>
      {cobros.length > 20 && <p className={s.resto}>+{cobros.length - 20}</p>}
    </div>
  );
}

export function AjustesDineroCaja({ puedeCierre, esDueno }: { puedeCierre: boolean; esDueno: boolean }) {
  const locale = useLocale();
  const tx = textosDinero(locale);
  const [aj, setAj] = useState<{ cajaCierreAutomatico: boolean; descuentoMaxPct: number; disponible: boolean } | null>(null);
  const [pct, setPct] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (!puedeCierre && !esDueno) return;
    let vivo = true;
    fetch("/api/caja/ajustes")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d) { setAj(d); setPct(String(d.descuentoMaxPct)); }
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [puedeCierre, esDueno]);

  if ((!puedeCierre && !esDueno) || !aj) return null;

  async function guardar(cambios: Record<string, unknown>) {
    setGuardando(true);
    try {
      const res = await fetch("/api/caja/ajustes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cambios) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(out?.code === "SQL_PENDIENTE" ? tx.caja.fueraSinSql : out?.error ?? "No se pudo."); return; }
      setAj(out); setPct(String(out.descuentoMaxPct)); toast.success(tx.caja.guardado);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <details className={s.aviso} data-caja-ajustes>
      <summary className={s.cabeza} style={{ cursor: "pointer", listStyle: "none" }}>
        <span className={`${s.icono} ${s.iconoInfo}`}><Settings2 size={16} strokeWidth={1.75} aria-hidden /></span>
        <span className={s.titulo}>{tx.caja.cierreAutoTitulo} · {tx.descuento.limiteTitulo}</span>
      </summary>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 10 }}>
        {!aj.disponible && <p className={s.sub}>{tx.caja.fueraSinSql}</p>}
        {puedeCierre && (
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: 13, color: "var(--text-1)" }}>
            <input
              type="checkbox"
              checked={aj.cajaCierreAutomatico}
              disabled={guardando || !aj.disponible}
              onChange={(e) => guardar({ cajaCierreAutomatico: e.target.checked })}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>{tx.caja.cierreAutoTitulo}</strong>
              <span className={s.sub} style={{ display: "block" }}>{tx.caja.cierreAutoTexto}</span>
            </span>
          </label>
        )}
        <div style={{ fontSize: 13, color: "var(--text-1)" }}>
          <strong>{tx.descuento.limiteTitulo}</strong>
          <span className={s.sub} style={{ display: "block" }}>{tx.descuento.limiteTexto}</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
            <input
              type="number" min={0} max={100} step={1} value={pct}
              disabled={!esDueno || guardando || !aj.disponible}
              onChange={(e) => setPct(e.target.value)}
              className="input-new" style={{ width: 90 }} aria-label={tx.descuento.limiteTitulo}
            />
            <span>%</span>
            {esDueno && (
              <ButtonNew variant="secondary" size="sm" disabled={guardando || !aj.disponible || pct === String(aj.descuentoMaxPct)} onClick={() => guardar({ descuentoMaxPct: Number(pct) })}>
                {tx.caja.guardar}
              </ButtonNew>
            )}
          </div>
        </div>
      </div>
    </details>
  );
}
