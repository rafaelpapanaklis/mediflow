"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import toast from "react-hot-toast";

interface SocialButtonsProps {
  /** URL a la que redirigir tras el OAuth callback */
  redirectTo?: string;
}

export function SocialButtons({ redirectTo = "/dashboard" }: SocialButtonsProps) {
  const [loading, setLoading] = useState<null | "google" | "azure">(null);

  async function handleOAuth(provider: "google" | "azure") {
    try {
      setLoading(provider);
      const supabase = createClient();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo:
            typeof window !== "undefined"
              ? `${window.location.origin}/api/auth/callback?next=${encodeURIComponent(redirectTo)}`
              : undefined,
        },
      });
      if (error) throw error;
    } catch (err: any) {
      toast.error(err?.message ?? "No se pudo iniciar sesión con el proveedor");
      setLoading(null);
    }
  }

  const baseBtn = {
    flex: 1,
    height: 42,
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    gap: 10,
    padding: "0 16px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid var(--ld-border)",
    color: "var(--ld-fg)",
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    fontFamily: "inherit",
    transition: "background .15s, border-color .15s",
  };

  return (
    <div style={{ display: "flex", gap: 10 }}>
      <button
        type="button"
        onClick={() => handleOAuth("google")}
        disabled={loading !== null}
        style={{ ...baseBtn, opacity: loading !== null && loading !== "google" ? 0.5 : 1 }}
      >
        <GoogleIcon />
        <span>{loading === "google" ? "Conectando…" : "Google"}</span>
      </button>
      <button
        type="button"
        onClick={() => handleOAuth("azure")}
        disabled={loading !== null}
        style={{ ...baseBtn, opacity: loading !== null && loading !== "azure" ? 0.5 : 1 }}
      >
        <MicrosoftIcon />
        <span>{loading === "azure" ? "Conectando…" : "Microsoft"}</span>
      </button>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.5 12.2c0-.8-.1-1.4-.2-2.1H12v3.9h5.9c-.1.9-.7 2.4-2.1 3.3l-.02.13 3.05 2.36.21.02c1.95-1.8 3.07-4.44 3.07-7.58z" />
      <path fill="#34A853" d="M12 23c2.8 0 5.14-.92 6.85-2.5l-3.27-2.53c-.88.6-2.05 1.03-3.58 1.03-2.74 0-5.06-1.8-5.9-4.3l-.12.01-3.17 2.45-.04.12C4.48 20.7 7.98 23 12 23z" />
      <path fill="#FBBC05" d="M6.1 14.7c-.22-.66-.35-1.37-.35-2.1 0-.73.13-1.44.34-2.1l-.01-.14-3.22-2.5-.1.05C2 9.4 1.5 10.65 1.5 12.6s.5 3.2 1.26 4.7l3.34-2.6z" />
      <path fill="#EB4335" d="M12 5.9c1.94 0 3.25.84 4 1.54l2.92-2.85C17.13 3.05 14.8 2 12 2 7.98 2 4.48 4.3 2.84 7.6L6.1 10.2c.85-2.5 3.17-4.3 5.9-4.3z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2"  y="2"  width="9" height="9" fill="#F25022" />
      <rect x="13" y="2"  width="9" height="9" fill="#7FBA00" />
      <rect x="2"  y="13" width="9" height="9" fill="#00A4EF" />
      <rect x="13" y="13" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}
