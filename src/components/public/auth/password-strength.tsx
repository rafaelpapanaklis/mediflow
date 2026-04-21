interface PasswordStrengthProps {
  password: string;
}

/** 0 (vacío) — 4 (fuerte). */
export function scorePassword(pwd: string): 0 | 1 | 2 | 3 | 4 {
  if (!pwd) return 0;
  let s = 0;
  if (pwd.length >= 8) s++;
  if (pwd.length >= 12) s++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) s++;
  if (/\d/.test(pwd) && /[^\w\s]/.test(pwd)) s++;
  return Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
}

const LEVELS: Array<{ label: string; color: string }> = [
  { label: "",        color: "transparent" },
  { label: "Débil",   color: "#ef4444" },
  { label: "Regular", color: "#fbbf24" },
  { label: "Buena",   color: "#a78bfa" },
  { label: "Fuerte",  color: "#34d399" },
];

export function PasswordStrength({ password }: PasswordStrengthProps) {
  const score = scorePassword(password);
  const { label, color } = LEVELS[score];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 4 }}>
        {[1, 2, 3, 4].map(i => {
          const on = score >= i;
          return (
            <div
              key={i}
              aria-hidden="true"
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                background: on ? color : "rgba(255,255,255,0.08)",
                boxShadow: on ? `0 0 6px ${color}66` : "none",
                transition: "background .2s, box-shadow .2s",
              }}
            />
          );
        })}
      </div>
      {password && (
        <div style={{ fontSize: 11, color: "var(--ld-fg-muted)", display: "flex", justifyContent: "space-between" }}>
          <span>Fuerza de contraseña</span>
          <span style={{ color, fontWeight: 500 }}>{label}</span>
        </div>
      )}
    </div>
  );
}
