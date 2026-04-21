/** Mini radiografía bitewing con marcadores IA. Estático (sin hooks). */
export function MiniRadio() {
  const teeth = [
    { x: 20,  caries: null,     filling: null       },
    { x: 60,  caries: "distal", filling: null       },
    { x: 100, caries: null,     filling: "occlusal" },
    { x: 140, caries: null,     filling: null       },
  ] as const;
  const lowerTeeth = [
    { x: 20,  caries: null     },
    { x: 60,  caries: null     },
    { x: 100, caries: "mesial" },
    { x: 140, caries: null     },
  ] as const;

  return (
    <div style={{
      height: 150,
      borderRadius: 10,
      background: "#060610",
      border: "1px solid rgba(255,255,255,0.05)",
      position: "relative",
      overflow: "hidden",
    }}>
      <div style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(ellipse at center, rgba(180,190,220,0.18), transparent 70%)",
      }} />
      <svg width="100%" height="100%" viewBox="0 0 180 150" preserveAspectRatio="xMidYMid meet" style={{ position: "absolute", inset: 0 }}>
        <defs>
          <radialGradient id="mr-tooth" cx="50%" cy="50%" r="50%">
            <stop offset="0%"   stopColor="#e8eef5" stopOpacity="0.95" />
            <stop offset="70%"  stopColor="#a8b0bd" stopOpacity="0.8"  />
            <stop offset="100%" stopColor="#4a5060" stopOpacity="0.5"  />
          </radialGradient>
          <radialGradient id="mr-root" cx="50%" cy="30%" r="70%">
            <stop offset="0%"   stopColor="#9aa3b0" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#3a4050" stopOpacity="0.3" />
          </radialGradient>
          <filter id="mr-blur"><feGaussianBlur stdDeviation="0.3" /></filter>
        </defs>

        <rect x="0" y="73" width="180" height="4" fill="rgba(0,0,0,0.6)" />

        {teeth.map((t, i) => (
          <g key={`u${i}`} filter="url(#mr-blur)">
            <path d={`M${t.x + 5} 30 L${t.x + 2} 8 L${t.x + 10} 6 L${t.x + 13} 30 Z`} fill="url(#mr-root)" />
            <path d={`M${t.x + 18} 30 L${t.x + 20} 10 L${t.x + 28} 9 L${t.x + 26} 30 Z`} fill="url(#mr-root)" />
            <path d={`M${t.x} 30 Q${t.x} 45 ${t.x + 6} 60 Q${t.x + 15} 68 ${t.x + 24} 60 Q${t.x + 30} 45 ${t.x + 30} 30 Z`} fill="url(#mr-tooth)" />
            {t.filling === "occlusal" && <ellipse cx={t.x + 15} cy={55} rx="8" ry="3" fill="#fff" opacity="0.95" />}
            {t.caries === "distal" && <ellipse cx={t.x + 27} cy={48} rx="3" ry="4" fill="#1a1a2a" opacity="0.85" />}
          </g>
        ))}

        {lowerTeeth.map((t, i) => (
          <g key={`l${i}`} filter="url(#mr-blur)">
            <path d={`M${t.x + 5} 120 L${t.x + 2} 142 L${t.x + 10} 144 L${t.x + 13} 120 Z`} fill="url(#mr-root)" />
            <path d={`M${t.x + 18} 120 L${t.x + 20} 140 L${t.x + 28} 141 L${t.x + 26} 120 Z`} fill="url(#mr-root)" />
            <path d={`M${t.x} 120 Q${t.x} 105 ${t.x + 6} 90 Q${t.x + 15} 82 ${t.x + 24} 90 Q${t.x + 30} 105 ${t.x + 30} 120 Z`} fill="url(#mr-tooth)" />
            {t.caries === "mesial" && <ellipse cx={t.x + 3} cy={100} rx="3" ry="4" fill="#1a1a2a" opacity="0.85" />}
          </g>
        ))}

        <g>
          <rect x="82"  y="42" width="14" height="14" fill="none" stroke="#fbbf24" strokeWidth="0.8" rx="1.5" className="ld-pulse" />
          <rect x="116" y="94" width="14" height="14" fill="none" stroke="#fbbf24" strokeWidth="0.8" rx="1.5" className="ld-pulse" style={{ animationDelay: "0.7s" }} />
          <rect x="110" y="50" width="14" height="14" fill="none" stroke="#34d399" strokeWidth="0.8" rx="1.5" />
        </g>
      </svg>

      <div style={{ position: "absolute", top: 6, left: 8, fontSize: 8, color: "rgba(255,255,255,0.35)", fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)", letterSpacing: "0.1em" }}>
        BITEWING · 26/04/26
      </div>
      <div style={{ position: "absolute", top: 6, right: 8, fontSize: 8, color: "#fbbf24", fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)" }}>
        2 hallazgos
      </div>
      <div style={{ position: "absolute", bottom: 6, left: 8, fontSize: 9, color: "#fbbf24", fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)", background: "rgba(0,0,0,0.5)", padding: "2px 6px", borderRadius: 3 }}>
        ⚠ Caries · 87%
      </div>
      <div style={{ position: "absolute", bottom: 6, right: 8, fontSize: 9, color: "#34d399", fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)", background: "rgba(0,0,0,0.5)", padding: "2px 6px", borderRadius: 3 }}>
        ✓ Empaste
      </div>
    </div>
  );
}
