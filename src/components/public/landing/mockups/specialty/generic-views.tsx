import React from "react";

interface GenericProps {
  accent: string;
}

export const GenericAgenda: React.FC<GenericProps> = ({ accent }) => (
  <div>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "80px repeat(5, 1fr)",
        gap: 6,
        marginBottom: 10,
        fontSize: 10,
        color: "var(--fg-muted)",
        fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
      }}
    >
      <div></div>
      {["Lun 22", "Mar 23", "Mié 24", "Jue 25", "Vie 26"].map((d) => (
        <div key={d} style={{ textAlign: "center", padding: 4 }}>
          {d}
        </div>
      ))}
    </div>
    <div
      style={{
        borderRadius: 10,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--app-border)",
        overflow: "hidden",
      }}
    >
      {["09:00", "10:00", "11:00", "12:00", "13:00", "14:00"].map((h, ri) => (
        <div
          key={h}
          style={{
            display: "grid",
            gridTemplateColumns: "80px repeat(5, 1fr)",
            gap: 6,
            padding: 6,
            borderBottom: ri < 5 ? "1px solid var(--app-border)" : "none",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "var(--fg-muted)",
              fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              padding: 6,
            }}
          >
            {h}
          </div>
          {[0, 1, 2, 3, 4].map((ci) => {
            const apps: Record<string, string> = {
              "0-1": "Ana R.",
              "1-0": "Carlos M.",
              "1-3": "Sofía L.",
              "2-2": "Luis T.",
              "3-1": "María V.",
              "3-4": "Pedro A.",
              "4-0": "Elena G.",
              "5-3": "Raúl O.",
            };
            const a = apps[`${ri}-${ci}`];
            if (!a) return <div key={ci} style={{ padding: 6 }} />;
            return (
              <div
                key={ci}
                style={{
                  padding: "6px 8px",
                  borderRadius: 5,
                  background: accent + "1a",
                  border: `1px solid ${accent}55`,
                  fontSize: 10,
                  color: "var(--fg)",
                }}
              >
                <div style={{ fontWeight: 500 }}>{a}</div>
                <div
                  style={{
                    fontSize: 9,
                    color: "var(--fg-muted)",
                    fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                  }}
                >
                  Consulta
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  </div>
);

export const GenericPacientes: React.FC<GenericProps> = ({ accent }) => (
  <div>
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <div
        style={{
          flex: 1,
          padding: "8px 12px",
          borderRadius: 8,
          background: "rgba(255,255,255,0.03)",
          border: "1px solid var(--app-border)",
          fontSize: 11,
          color: "var(--fg-muted)",
        }}
      >
        ⌕  Buscar por nombre, RFC, teléfono…
      </div>
      <div
        style={{
          padding: "8px 14px",
          borderRadius: 8,
          background: accent,
          color: "white",
          fontSize: 11,
          fontWeight: 500,
        }}
      >
        + Nuevo paciente
      </div>
    </div>
    <div
      style={{
        borderRadius: 10,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--app-border)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr 1fr 1fr 80px",
          padding: "10px 14px",
          fontSize: 10,
          color: "var(--fg-muted)",
          fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          borderBottom: "1px solid var(--app-border)",
        }}
      >
        <div>Paciente</div>
        <div>Teléfono</div>
        <div>Última visita</div>
        <div>Próxima cita</div>
        <div>Estado</div>
      </div>
      {(
        [
          ["Ana Ramírez Soto", "34 años", "55 2847 9201", "Hace 12 días", "26 abr · 10:00", "Activo", "#34d399"],
          ["Carlos Mendoza L.", "42 años", "55 8471 0293", "Hace 3 meses", "—", "Seguimiento", "#fbbf24"],
          ["Sofía Hernández", "28 años", "55 2084 7103", "Ayer", "—", "Activo", "#34d399"],
          ["Luis Torres Ávila", "51 años", "55 9203 4871", "Hace 1 mes", "26 abr · 12:30", "Activo", "#34d399"],
          ["María Velázquez", "37 años", "55 3847 2019", "Hace 6 meses", "—", "Inactivo", "#6b7280"],
        ] as const
      ).map((r, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr 80px",
            padding: "12px 14px",
            fontSize: 11.5,
            borderBottom: i < 4 ? "1px solid var(--app-border)" : "none",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ color: "var(--fg)", fontWeight: 500 }}>{r[0]}</div>
            <div style={{ color: "var(--fg-muted)", fontSize: 10 }}>{r[1]}</div>
          </div>
          <div
            style={{
              color: "var(--fg-muted)",
              fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              fontSize: 10.5,
            }}
          >
            {r[2]}
          </div>
          <div style={{ color: "var(--fg-muted)", fontSize: 10.5 }}>{r[3]}</div>
          <div
            style={{
              color: r[4] === "—" ? "var(--fg-muted)" : accent,
              fontSize: 10.5,
              fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
            }}
          >
            {r[4]}
          </div>
          <div>
            <span
              style={{
                display: "inline-flex",
                padding: "2px 8px",
                borderRadius: 100,
                background: r[6] + "22",
                color: r[6],
                fontSize: 9.5,
                fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              }}
            >
              ● {r[5]}
            </span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const GenericFacturacion: React.FC<GenericProps> = ({ accent }) => (
  <div>
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 10,
        marginBottom: 14,
      }}
    >
      {(
        [
          ["Timbrados mes", "127", "#34d399"],
          ["Pendientes", "4", "#fbbf24"],
          ["Cancelados", "2", "#ef4444"],
          ["Total MXN", "$184,300", accent],
        ] as const
      ).map(([l, v, c], i) => (
        <div
          key={i}
          style={{
            padding: 12,
            borderRadius: 8,
            background: "rgba(255,255,255,0.02)",
            border: "1px solid var(--app-border)",
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "var(--fg-muted)",
              fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {l}
          </div>
          <div
            style={{
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              fontWeight: 600,
              fontSize: 20,
              letterSpacing: "-0.02em",
              color: c,
              marginTop: 4,
            }}
          >
            {v}
          </div>
        </div>
      ))}
    </div>
    <div
      style={{
        borderRadius: 10,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid var(--app-border)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "12px 14px",
          borderBottom: "1px solid var(--app-border)",
          fontFamily: "var(--font-sora, 'Sora', sans-serif)",
          fontWeight: 500,
          fontSize: 12.5,
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>CFDI recientes</span>
        <span
          style={{
            fontSize: 10,
            color: "var(--fg-muted)",
            fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
          }}
        >
          SAT · en línea ●
        </span>
      </div>
      {(
        [
          ["A-2041", "Ana Ramírez", "$850.00", "Timbrado", "#34d399"],
          ["A-2040", "Carlos Mendoza", "$1,700.00", "Timbrado", "#34d399"],
          ["A-2039", "Sofía Hernández", "$2,450.00", "Timbrado", "#34d399"],
          ["A-2038", "Luis Torres", "$650.00", "Pendiente", "#fbbf24"],
          ["A-2037", "María Velázquez", "$1,200.00", "Timbrado", "#34d399"],
        ] as const
      ).map((r, i) => (
        <div
          key={i}
          style={{
            display: "grid",
            gridTemplateColumns: "100px 2fr 1fr 1fr",
            padding: "10px 14px",
            fontSize: 11.5,
            borderBottom: i < 4 ? "1px solid var(--app-border)" : "none",
            alignItems: "center",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              color: "var(--fg-muted)",
              fontSize: 10.5,
            }}
          >
            {r[0]}
          </div>
          <div>{r[1]}</div>
          <div
            style={{
              fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              fontSize: 11,
            }}
          >
            {r[2]}
          </div>
          <div>
            <span
              style={{
                padding: "2px 8px",
                borderRadius: 100,
                background: r[4] + "22",
                color: r[4],
                fontSize: 9.5,
                fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
              }}
            >
              ● {r[3]}
            </span>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export const GenericReportes: React.FC<GenericProps> = ({ accent }) => {
  const bars = [45, 62, 58, 71, 84, 92, 78, 88, 95, 72, 81, 93];
  const max = Math.max(...bars);
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 10,
          marginBottom: 14,
        }}
      >
        {(
          [
            ["Ingresos mes", "$184,300", "+12.4%", "#34d399"],
            ["Nuevos pacientes", "38", "+8", accent],
            ["Tasa de asistencia", "94%", "+3pp", "#34d399"],
          ] as const
        ).map(([l, v, delta, c], i) => (
          <div
            key={i}
            style={{
              padding: 14,
              borderRadius: 10,
              background: "rgba(255,255,255,0.02)",
              border: "1px solid var(--app-border)",
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: "var(--fg-muted)",
                fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              {l}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
              <div
                style={{
                  fontFamily: "var(--font-sora, 'Sora', sans-serif)",
                  fontWeight: 600,
                  fontSize: 22,
                  letterSpacing: "-0.02em",
                  color: "var(--fg)",
                }}
              >
                {v}
              </div>
              <div
                style={{
                  fontSize: 10,
                  color: "#34d399",
                  fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                }}
              >
                {delta}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          padding: 16,
          borderRadius: 10,
          background: "rgba(255,255,255,0.02)",
          border: "1px solid var(--app-border)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
          <div
            style={{
              fontFamily: "var(--font-sora, 'Sora', sans-serif)",
              fontWeight: 500,
              fontSize: 12.5,
            }}
          >
            Ingresos · últimos 12 meses
          </div>
          <div
            style={{
              fontSize: 10,
              color: accent,
              fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
            }}
          >
            MXN ●
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 140 }}>
          {bars.map((b, i) => (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: `${(b / max) * 100}%`,
                  background: `linear-gradient(180deg, ${accent}, ${accent}55)`,
                  borderRadius: 3,
                  boxShadow: `0 0 12px ${accent}33`,
                }}
              />
              <div
                style={{
                  fontSize: 8.5,
                  color: "var(--fg-muted)",
                  fontFamily: "var(--font-jetbrains-mono, ui-monospace, monospace)",
                }}
              >
                {["M", "A", "M", "J", "J", "A", "S", "O", "N", "D", "E", "F"][i]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
