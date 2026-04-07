"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { CheckCircle, AlertCircle, Loader2 } from "lucide-react";

export default function ConsentSignPage() {
  const { token }  = useParams<{ token: string }>();
  const [form,     setForm]     = useState<any>(null);
  const [loading,  setLoading]  = useState(true);
  const [signing,  setSigning]  = useState(false);
  const [signed,   setSigned]   = useState(false);
  const [error,    setError]    = useState("");
  const [agreed,   setAgreed]   = useState(false);
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const [drawing,  setDrawing]  = useState(false);
  const [hasSig,   setHasSig]   = useState(false);

  useEffect(() => {
    fetch(`/api/consent/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else { setForm(d); if (d.signedAt) setSigned(true); }
        setLoading(false);
      })
      .catch(() => { setError("Error al cargar el documento"); setLoading(false); });
  }, [token]);

  // Signature canvas
  function startDraw(e: React.TouchEvent | React.MouseEvent) {
    setDrawing(true);
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext("2d")!;
    const rect   = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top  : (e as React.MouseEvent).clientY - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(e: React.TouchEvent | React.MouseEvent) {
    if (!drawing) return;
    e.preventDefault();
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext("2d")!;
    const rect   = canvas.getBoundingClientRect();
    const x = "touches" in e ? e.touches[0].clientX - rect.left : (e as React.MouseEvent).clientX - rect.left;
    const y = "touches" in e ? e.touches[0].clientY - rect.top  : (e as React.MouseEvent).clientY - rect.top;
    ctx.lineTo(x, y);
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth   = 2;
    ctx.lineCap     = "round";
    ctx.stroke();
    setHasSig(true);
  }

  function stopDraw() { setDrawing(false); }

  function clearSig() {
    const canvas = canvasRef.current!;
    const ctx    = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSig(false);
  }

  async function sign() {
    if (!agreed)  { setError("Debes aceptar los términos para firmar"); return; }
    if (!hasSig)  { setError("Por favor dibuja tu firma"); return; }
    setSigning(true);
    setError("");
    try {
      const signatureUrl = canvasRef.current!.toDataURL("image/png");
      const res = await fetch(`/api/consent/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al firmar");
      setSigned(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSigning(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-brand-600" size={32} />
      </div>
    );
  }

  if (error && !form) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center">
          <AlertCircle size={48} className="text-red-500 mx-auto mb-3" />
          <h1 className="text-lg font-bold text-slate-800">{error}</h1>
          <p className="text-sm text-slate-500 mt-1">Este enlace no es válido o ha expirado.</p>
        </div>
      </div>
    );
  }

  if (signed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center max-w-sm">
          <CheckCircle size={56} className="text-emerald-500 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-slate-800">¡Documento firmado!</h1>
          <p className="text-sm text-slate-500 mt-2">
            Tu consentimiento informado para <strong>{form?.procedure}</strong> ha sido firmado exitosamente.
            La clínica recibirá tu firma automáticamente.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-lg mx-auto">
          {form?.logoUrl && <img src={form.logoUrl} alt={form.clinicName} className="h-8 object-contain mb-1" />}
          <h1 className="text-base font-bold text-slate-800">{form?.clinicName}</h1>
          <p className="text-xs text-slate-500">Consentimiento informado — {form?.procedure}</p>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4 pb-32">
        {/* Patient info */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <p className="text-xs font-bold text-blue-800">Paciente</p>
          <p className="text-sm font-semibold text-blue-900">{form?.firstName} {form?.lastName}</p>
        </div>

        {/* Content */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <h2 className="text-sm font-bold text-slate-800 mb-3">{form?.procedure}</h2>
          <pre className="text-xs text-slate-700 whitespace-pre-wrap font-sans leading-relaxed">
            {form?.content}
          </pre>
        </div>

        {/* Agreement */}
        <label className="flex items-start gap-3 cursor-pointer bg-white border border-slate-200 rounded-xl p-4">
          <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-emerald-600" />
          <p className="text-xs text-slate-700 leading-relaxed">
            He leído y comprendido el contenido de este consentimiento informado. Acepto el procedimiento
            mencionado y autorizo al equipo médico a realizarlo. Entiendo que puedo hacer preguntas en cualquier momento.
          </p>
        </label>

        {/* Signature */}
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-bold text-slate-700">Firma del paciente</p>
            <button onClick={clearSig} className="text-xs text-slate-500 underline">Borrar</button>
          </div>
          <canvas
            ref={canvasRef}
            width={380}
            height={120}
            className="w-full border-2 border-dashed border-slate-300 rounded-lg bg-slate-50 touch-none"
            onMouseDown={startDraw}
            onMouseMove={draw}
            onMouseUp={stopDraw}
            onMouseLeave={stopDraw}
            onTouchStart={startDraw}
            onTouchMove={draw}
            onTouchEnd={stopDraw}
          />
          <p className="text-xs text-slate-400 mt-1 text-center">Dibuja tu firma con el dedo o el ratón</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-xs font-semibold text-red-700">
            {error}
          </div>
        )}

        {/* Sign button */}
        <button onClick={sign} disabled={signing || !agreed || !hasSig}
          className={`w-full py-4 rounded-2xl text-base font-bold transition-colors ${
            agreed && hasSig && !signing
              ? "bg-emerald-600 text-white"
              : "bg-slate-200 text-slate-400 cursor-not-allowed"
          }`}>
          {signing ? "Firmando..." : "✅ Firmar consentimiento"}
        </button>

        <p className="text-xs text-slate-400 text-center">
          Tu firma es legalmente válida. Enlace válido hasta: {form?.expiresAt ? new Date(form.expiresAt).toLocaleString("es-MX") : ""}
        </p>
      </main>
    </div>
  );
}
