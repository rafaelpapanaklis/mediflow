"use client";

import { PlugZap, RefreshCw } from "lucide-react";
import { ButtonNew } from "@/components/ui/design-system/button-new";

/**
 * Pantalla para el caso "no pudimos VERIFICAR la sesión" (la BD no respondió),
 * que NO es lo mismo que "no has iniciado sesión". Antes ambos casos caían en el
 * login y el admin acababa reescribiendo contraseña + 2FA por un timeout del
 * pooler. Aquí no se pide ninguna credencial y la cookie se queda intacta: sólo
 * hay que reintentar.
 */
export function AdminSessionError() {
  return (
    <div
      className="mf-extpanel"
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        color: "var(--text-1)",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          width: "100%",
          textAlign: "center",
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
          borderRadius: 14,
          padding: "32px 28px",
        }}
      >
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: 12,
            margin: "0 auto 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--brand-soft)",
            color: "var(--brand)",
          }}
        >
          <PlugZap size={20} />
        </div>

        <h1 style={{ fontSize: 17, fontWeight: 600, margin: 0, letterSpacing: "-0.01em" }}>
          No pudimos verificar tu sesión
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: "8px 0 20px", lineHeight: 1.5 }}>
          Hubo un problema de conexión con la base de datos. Tu sesión sigue
          abierta: no hace falta volver a iniciarla.
        </p>

        <ButtonNew
          variant="primary"
          icon={<RefreshCw size={14} />}
          onClick={() => window.location.reload()}
        >
          Reintentar
        </ButtonNew>
      </div>
    </div>
  );
}
