"use client";
import { useState, useEffect, useRef } from "react";

export default function ConsentPage({ params }: { params: { token: string } }) {
  const [form, setForm]       = useState<any>(null);
  const [error, setError]     = useState("");
  const [signed, setSigned]   = useState(false);
  const [signing, setSigning] = useState(false);
  const [agreed, setAgreed]   = useState(false);
  const canvasRef             = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  useEffect(() => {
    fetch(`/api/consent/${params.token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else {
          setForm(d);
          if (d.signedAt) setSigned(true);
        }
      })
      .catch(() => setError("Error al cargar el formulario"));
  }, [params.token]);

  // Canvas drawing for signature
  function getPos(e: React.MouseEvent | React.TouchEvent, canvas: HTMLCanvasElement) {
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  }

  function startDraw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const pos = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(pos.x, pos.y);
    setDrawing(true); setHasSignature(true);
  }

  function draw(e: React.MouseEvent | React.TouchEvent) {
    e.preventDefault();
    if (!drawing) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.strokeStyle = "#1e293b";
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y); ctx.stroke();
  }

  function stopDraw() { setDrawing(false); }

  function clearSignature() {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  async function sign() {
    if (!hasSignature) { alert("Por favor dibuja tu firma"); return; }
    if (!agreed) { alert("Debes aceptar los términos"); return; }
    const canvas = canvasRef.current; if (!canvas) return;
    const signatureDataUrl = canvas.toDataURL("image/png");
    setSigning(true);
    try {
      const res = await fetch(`/api/consent/${params.token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signatureDataUrl }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setSigned(true);
    } catch(e: any) { alert(e.message); }
    finally { setSigning(false); }
  }

  if (error) return (
    <div style={{ minHeight:"100vh", background:"#f8fafc", display:"flex", alignItems:"center", justifyContent:"center", padding:"20px", fontFamily:"system-ui" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>⚠️</div>
        <h1 style={{ fontSize:20, fontWeight:700, color:"#0f172a", marginBottom:8 }}>Formulario no disponible</h1>
        <p style={{ color:"#64748b" }}>{error}</p>
      </div>
    </div>
  );

  if (!form) return (
    <div style={{ minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"#f8fafc" }}>
      <div style={{ color:"#94a3b8", fontFamily:"system-ui" }}>Cargando...</div>
    </div>
  );

  if (signed) return (
    <div style={{ minHeight:"100vh", background:"#f8fafc", display:"flex", alignItems:"center", justifyContent:"center", padding:"20px", fontFamily:"system-ui" }}>
      <div style={{ textAlign:"center", maxWidth:400 }}>
        <div style={{ width:72, height:72, borderRadius:"50%", background:"#dcfce7", display:"flex", alignItems:"center", justifyContent:"center", margin:"0 auto 20px", fontSize:36 }}>✅</div>
        <h1 style={{ fontSize:24, fontWeight:700, color:"#0f172a", marginBottom:8 }}>Consentimiento firmado</h1>
        <p style={{ color:"#64748b", lineHeight:1.6 }}>
          Tu consentimiento para <strong>{form.procedure}</strong> en <strong>{form.clinic?.name}</strong> ha sido firmado exitosamente.
        </p>
        <p style={{ fontSize:12, color:"#94a3b8", marginTop:16 }}>
          Fecha: {new Date(form.signedAt ?? Date.now()).toLocaleString("es-MX")}
        </p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:"#f8fafc", fontFamily:"system-ui", paddingBottom:40 }}>
      {/* Header */}
      <header style={{ background:"#fff", borderBottom:"1px solid #e2e8f0", padding:"16px 20px" }}>
        <div style={{ maxWidth:600, margin:"0 auto", display:"flex", alignItems:"center", gap:12 }}>
          {form.clinic?.logoUrl && <img src={form.clinic.logoUrl} alt="" style={{ height:36 }} />}
          <div>
            <div style={{ fontWeight:700, fontSize:15, color:"#0f172a" }}>{form.clinic?.name}</div>
            <div style={{ fontSize:12, color:"#64748b" }}>Consentimiento Informado</div>
          </div>
        </div>
      </header>

      <main style={{ maxWidth:600, margin:"0 auto", padding:"24px 16px" }}>
        <div style={{ background:"#fff", borderRadius:16, border:"1px solid #e2e8f0", padding:20, marginBottom:20 }}>
          <h1 style={{ fontSize:18, fontWeight:700, color:"#0f172a", marginBottom:4 }}>{form.procedure}</h1>
          <p style={{ fontSize:13, color:"#64748b", marginBottom:16 }}>
            Paciente: <strong>{form.patient?.firstName} {form.patient?.lastName}</strong>
          </p>
          <div style={{ fontSize:13, lineHeight:1.8, color:"#374151", whiteSpace:"pre-wrap", background:"#f8fafc", borderRadius:12, padding:16 }}>
            {form.content}
          </div>
        </div>

        {/* Signature */}
        <div style={{ background:"#fff", borderRadius:16, border:"1px solid #e2e8f0", padding:20, marginBottom:20 }}>
          <div style={{ fontWeight:700, fontSize:15, color:"#0f172a", marginBottom:12 }}>Firma del paciente</div>
          <div style={{ border:"2px dashed #cbd5e1", borderRadius:12, overflow:"hidden", marginBottom:12, touchAction:"none" }}>
            <canvas
              ref={canvasRef}
              width={560} height={150}
              style={{ width:"100%", height:150, display:"block", cursor:"crosshair" }}
              onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
              onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
            />
          </div>
          {!hasSignature && <p style={{ fontSize:12, color:"#94a3b8", textAlign:"center", marginBottom:8 }}>Dibuja tu firma arriba</p>}
          {hasSignature && (
            <button onClick={clearSignature}
              style={{ fontSize:12, color:"#64748b", background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>
              Limpiar firma
            </button>
          )}
        </div>

        {/* Agreement */}
        <div style={{ display:"flex", gap:10, alignItems:"flex-start", marginBottom:20, background:"#fff", borderRadius:16, border:"1px solid #e2e8f0", padding:16 }}>
          <input type="checkbox" id="agree" checked={agreed} onChange={e => setAgreed(e.target.checked)}
            style={{ marginTop:2, width:18, height:18, cursor:"pointer" }} />
          <label htmlFor="agree" style={{ fontSize:13, color:"#374151", lineHeight:1.6, cursor:"pointer" }}>
            He leído y entendido el presente consentimiento informado. Acepto voluntariamente el tratamiento descrito y confirmo que la información proporcionada sobre mi estado de salud es verídica y completa.
          </label>
        </div>

        <button
          onClick={sign}
          disabled={signing || !agreed || !hasSignature}
          style={{
            width:"100%", padding:"16px", borderRadius:14, border:"none",
            background: agreed && hasSignature ? "#2563eb" : "#e2e8f0",
            color: agreed && hasSignature ? "#fff" : "#94a3b8",
            fontWeight:700, fontSize:16, cursor: agreed && hasSignature ? "pointer" : "default",
          }}>
          {signing ? "Firmando..." : "✅ Firmar consentimiento"}
        </button>

        <p style={{ fontSize:11, color:"#94a3b8", textAlign:"center", marginTop:12 }}>
          Este documento tiene validez legal como consentimiento informado digital.
        </p>
      </main>
    </div>
  );
}
