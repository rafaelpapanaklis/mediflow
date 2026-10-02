"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { fechaDeVigencia } from "@/lib/quotes/vigencia";
import { CheckCircle, AlertCircle, Loader2, Clock, CalendarDays } from "lucide-react";
import { planParaDocumento } from "@/lib/quotes/condiciones-pago";
import type { CondicionesPago } from "@/lib/quotes/condiciones-pago";
import { armarAceptacion, resumirAceptacion } from "@/lib/quotes/aceptacion";

interface PublicItem {
  /** Solo con la aceptación por concepto encendida (viene de `itemIds`). */
  id?: string;
  name: string;
  toothFdi: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  phase: number | null;
  notes: string | null;
}
interface PublicView {
  folio: string;
  title: string;
  status: string;
  validUntil: string | null;
  /** "YYYY-MM-DD" en la zona de la clínica: el mismo día que la tarjeta del panel. */
  validUntilDia?: string | null;
  expired: boolean;
  subtotal: number;
  discountAmount: number;
  total: number;
  notes: string | null;
  acceptedAt: string | null;
  clinicName: string;
  clinicLogoUrl: string | null;
  patientFirstName: string;
  signatureUrl: string | null;
  items: PublicItem[];
  /** Formas de pago propuestas. null = no hay (o falta el SQL): no se pinta. */
  condicionesPago: CondicionesPago | null;
  /** ws1-t6: el paciente puede marcar qué conceptos acepta. */
  porConcepto?: boolean;
  itemIds?: string[];
  /** Ya aceptado: qué aceptó. null = aceptó todo, o se aceptó antes de esta función. */
  aceptacion?: { aceptados: string[]; total: number; alcance: "total" | "parcial" } | null;
}

function money(n: number): string {
  const v = isFinite(Number(n)) ? Number(n) : 0;
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(v);
}

interface PhaseGroup { phase: number | null; items: PublicItem[] }
function groupByPhase(items: PublicItem[]): PhaseGroup[] {
  const groups: PhaseGroup[] = [];
  items.forEach((it) => {
    const key = it.phase == null ? null : it.phase;
    let g = groups.find((x) => x.phase === key);
    if (!g) { g = { phase: key, items: [] }; groups.push(g); }
    g.items.push(it);
  });
  groups.sort((a, b) => {
    if (a.phase == null) return 1;
    if (b.phase == null) return -1;
    return a.phase - b.phase;
  });
  return groups;
}

export default function PresupuestoPublicPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [agreed, setAgreed] = useState(false);
  // Conceptos que el paciente acepta (ids). Arranca con todos marcados.
  const [marcados, setMarcados] = useState<string[]>([]);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasSig, setHasSig] = useState(false);

  useEffect(() => {
    fetch(`/api/presupuesto/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          const ids: string[] = Array.isArray(d.itemIds) ? d.itemIds : [];
          if (Array.isArray(d.items)) {
            d.items = d.items.map((it: PublicItem, i: number) => ({ ...it, id: ids[i] }));
          }
          setMarcados(ids);
          setData(d);
          if (d.status === "ACCEPTED") setAccepted(true);
        }
        setLoading(false);
      })
      .catch(() => { setError("Error al cargar el presupuesto"); setLoading(false); });
  }, [token]);

  function startDraw(e: React.TouchEvent | React.MouseEvent) {
    setDrawing(true);
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }
  function draw(e: React.TouchEvent | React.MouseEvent) {
    if (!drawing) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const rect = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top : (e as React.MouseEvent).clientY - rect.top;
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.stroke();
    setHasSig(true);
  }
  function stopDraw() { setDrawing(false); }
  function clearSig() {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSig(false);
  }

  // Lo que suma lo marcado, con la MISMA regla que guarda el servidor
  // (lib/quotes/aceptacion.ts): descuento global repartido en proporción.
  const elegidos = data?.aceptacion ? data.aceptacion.aceptados : marcados;
  const resumenElegido = data?.porConcepto && data.items.every((it) => it.id)
    ? resumirAceptacion(
        armarAceptacion(
          {
            discountAmount: data.discountAmount,
            items: data.items.map((it) => ({ ...it, id: it.id as string })),
          },
          elegidos,
        ),
        data.total,
      )
    : null;
  const parcial = !!resumenElegido && resumenElegido.alcance === "parcial";

  function alternar(id: string) {
    setMarcados((prev) => (prev.indexOf(id) === -1 ? [...prev, id] : prev.filter((x) => x !== id)));
  }

  async function accept() {
    if (!agreed) { setError("Debes aceptar los términos para continuar"); return; }
    if (!hasSig) { setError("Por favor dibuja tu firma"); return; }
    if (data?.porConcepto && marcados.length === 0) {
      setError("Marca al menos un tratamiento para aceptar");
      return;
    }
    setAccepting(true);
    setError("");
    try {
      const signatureDataUrl = canvasRef.current!.toDataURL("image/png");
      const res = await fetch(`/api/presupuesto/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          data?.porConcepto ? { signatureDataUrl, itemIds: marcados } : { signatureDataUrl },
        ),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error ?? "Error al aceptar");
      setAccepted(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAccepting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-violet-600" size={32} />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center">
          <AlertCircle size={48} className="text-red-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-slate-800">{error}</h1>
          <p className="text-sm text-slate-500 mt-1">Este enlace no es válido o ya no está disponible.</p>
        </div>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center max-w-sm">
          <CheckCircle size={56} className="text-emerald-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-slate-800">¡Presupuesto aceptado!</h1>
          <p className="text-sm text-slate-500 mt-2">
            Gracias{data ? `, ${data.patientFirstName}` : ""}. Tu aceptación del presupuesto{" "}
            <strong>{data?.folio}</strong> quedó registrada. La clínica te contactará para continuar.
          </p>
          {resumenElegido && resumenElegido.alcance === "parcial" && (
            <p className="text-sm text-slate-600 mt-3">
              Aceptaste {resumenElegido.aceptados} de {resumenElegido.conceptos} tratamientos, por{" "}
              <strong>{money(resumenElegido.total)}</strong>. Lo que no marcaste no se te cobrará.
            </p>
          )}
        </div>
      </div>
    );
  }

  const groups = data ? groupByPhase(data.items) : [];
  const showPhases = groups.length > 1 || (groups[0] && groups[0].phase != null);
  const canAccept = data && data.status === "PRESENTED" && !data.expired;
  // Casillas por concepto: solo mientras se puede aceptar y con más de uno.
  const conCasillas = !!(canAccept && data?.porConcepto && data.items.length > 1);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto">
          {data?.clinicLogoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.clinicLogoUrl} alt={data.clinicName} className="h-8 object-contain mb-1" />
          )}
          <h1 className="text-base font-bold text-slate-800">{data?.clinicName}</h1>
          <p className="text-xs text-slate-500">Presupuesto {data?.folio}</p>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-4 space-y-4 pb-32">
        <div className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3">
          <p className="text-xs font-bold text-violet-800">Para</p>
          <p className="text-sm font-semibold text-violet-900">{data?.patientFirstName}</p>
          <p className="text-sm font-bold text-slate-800 mt-1">{data?.title}</p>
        </div>

        {data?.expired && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-2">
            <Clock size={16} className="text-amber-600" />
            <p className="text-xs font-semibold text-amber-800">
              Este presupuesto venció{data.validUntil ? ` el ${fechaDeVigencia(data)}` : ""}.
              Contacta a la clínica para una cotización actualizada.
            </p>
          </div>
        )}

        {conCasillas && (
          <p className="text-xs text-slate-600 px-1">
            Desmarca los tratamientos que no quieras aceptar por ahora. Solo se te cobrará lo que dejes marcado.
          </p>
        )}

        {/* Detalle */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {groups.map((g, gi) => (
            <div key={gi}>
              {showPhases && (
                <div className="px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  {g.phase == null ? "Sin fase" : `Fase ${g.phase}`}
                </div>
              )}
              <table className="w-full text-xs">
                <tbody>
                  {g.items.map((it, idx) => (
                    <tr
                      key={idx}
                      className={`border-b border-slate-100 last:border-0 ${
                        conCasillas && it.id && marcados.indexOf(it.id) === -1 ? "opacity-50" : ""
                      }`}
                    >
                      {conCasillas && it.id && (
                        <td className="pl-4 py-2.5 align-top w-6">
                          <input
                            type="checkbox"
                            checked={marcados.indexOf(it.id) !== -1}
                            onChange={() => alternar(it.id as string)}
                            aria-label={`Acepto: ${it.name}`}
                            className="mt-0.5 w-4 h-4 accent-violet-600"
                          />
                        </td>
                      )}
                      <td className="px-4 py-2.5 align-top">
                        <div className="font-semibold text-slate-800">{it.name}</div>
                        <div className="text-slate-400 mt-0.5">
                          {it.toothFdi ? `Dientes ${it.toothFdi} · ` : ""}
                          {it.quantity} × {money(it.unitPrice)}
                          {it.discount > 0 ? ` · desc. ${money(it.discount)}` : ""}
                        </div>
                        {it.notes && <div className="text-slate-400 mt-0.5 italic">{it.notes}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-slate-800 whitespace-nowrap align-top">
                        {money(it.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {/* Totales */}
          <div className="border-t border-slate-200 px-4 py-3 space-y-1">
            <div className="flex justify-between text-xs text-slate-500">
              <span>Subtotal</span><span>{money(data?.subtotal ?? 0)}</span>
            </div>
            {(data?.discountAmount ?? 0) > 0 && (
              <div className="flex justify-between text-xs text-slate-500">
                <span>Descuento</span><span>-{money(data?.discountAmount ?? 0)}</span>
              </div>
            )}
            <div className={`flex justify-between pt-1 ${parcial ? "text-xs text-slate-500" : "text-base font-bold text-violet-700"}`}>
              <span>{parcial ? "Total del presupuesto" : "Total"}</span><span>{money(data?.total ?? 0)}</span>
            </div>
            {parcial && resumenElegido && (
              <div className="flex justify-between text-base font-bold text-violet-700 pt-1">
                <span>{data?.status === "ACCEPTED" ? "Total aceptado" : "Total de lo que aceptas"}</span>
                <span>{money(resumenElegido.total)}</span>
              </div>
            )}
          </div>
        </div>

        {/* Forma de pago: el plan YA dividido, con las mismas cifras que vio
            la clínica al armarlo (planParaDocumento sobre el mismo cálculo).
            Es lo que el paciente quiere saber antes de firmar. */}
        {(() => {
          const plan = planParaDocumento(data?.total ?? 0, data?.condicionesPago);
          if (!plan) return null;
          // El plan se calculó sobre el total: con una aceptación parcial ya no
          // cuadra, y la clínica lo ajusta con el paciente.
          if (parcial) {
            return (
              <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 text-xs text-slate-600">
                La forma de pago propuesta se calculó sobre el total del presupuesto. Como no aceptas todo, la clínica la
                ajustará contigo a lo que aceptes.
              </div>
            );
          }
          return (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
                <CalendarDays size={15} className="text-violet-600 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800">{plan.frase}</p>
                  {plan.metodo && (
                    <p className="text-xs text-slate-500 mt-0.5">Método: {plan.metodo}</p>
                  )}
                </div>
              </div>
              {plan.cuotas.length > 1 && (
                <div className="divide-y divide-slate-100">
                  {plan.cuotas.map((c, i) => (
                    <div key={i} className="flex items-baseline gap-3 px-4 py-2 text-xs">
                      <span className="font-semibold text-slate-700 w-20 shrink-0">{c.etiqueta}</span>
                      <span className="flex-1 text-slate-500 min-w-0">{c.fecha}</span>
                      <span className="font-bold text-slate-800 tabular-nums shrink-0">{money(c.monto)}</span>
                    </div>
                  ))}
                  <p className="px-4 py-2 text-[11px] text-slate-400 text-right">
                    Los pagos suman {money(plan.suma)}.
                  </p>
                </div>
              )}
              {plan.leyendaDifiere && (
                <div className="px-4 py-3 border-t border-slate-200">
                  <p className="text-[11px] text-slate-500">{plan.leyendaDifiere}</p>
                </div>
              )}
            </div>
          );
        })()}

        {data?.notes && (
          <div className="bg-white border border-slate-200 rounded-xl p-4 text-xs text-slate-600 whitespace-pre-wrap">
            {data.notes}
          </div>
        )}

        <p className="text-[11px] text-slate-400 text-center">
          Presupuesto informativo, sujeto a valoración clínica. Precios en MXN.
          {data?.validUntil && !data.expired ? ` Válido hasta el ${fechaDeVigencia(data)}.` : ""}
        </p>

        {/* Aceptación */}
        {canAccept && (
          <>
            <label className="flex items-start gap-3 cursor-pointer bg-white border border-slate-200 rounded-xl p-4">
              <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-violet-600" />
              <p className="text-xs text-slate-700 leading-relaxed">
                {conCasillas
                  ? "He revisado este presupuesto y acepto los tratamientos que dejé marcados, con sus costos. Entiendo que es informativo y está sujeto a valoración clínica."
                  : "He revisado este presupuesto y acepto el tratamiento y los costos indicados. Entiendo que es informativo y está sujeto a valoración clínica."}
              </p>
            </label>

            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-slate-700">Firma de aceptación</p>
                <button onClick={clearSig} className="text-xs text-slate-500 underline">Borrar</button>
              </div>
              <canvas
                ref={canvasRef}
                width={560}
                height={140}
                className="w-full border-2 border-dashed border-slate-300 rounded-lg bg-slate-50 touch-none"
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
              />
              <p className="text-xs text-slate-400 mt-1 text-center">Dibuja tu firma con el dedo o el ratón</p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs font-semibold text-red-700">
                {error}
              </div>
            )}

            <button onClick={accept} disabled={accepting || !agreed || !hasSig || (conCasillas && marcados.length === 0)}
              className={`w-full py-4 rounded-2xl text-base font-bold transition-colors ${
                agreed && hasSig && !accepting && !(conCasillas && marcados.length === 0)
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed"
              }`}>
              {accepting
                ? "Procesando..."
                : parcial && resumenElegido
                  ? `✅ Aceptar ${resumenElegido.aceptados} de ${resumenElegido.conceptos} (${money(resumenElegido.total)})`
                  : "✅ Aceptar presupuesto"}
            </button>
          </>
        )}
      </main>
    </div>
  );
}
