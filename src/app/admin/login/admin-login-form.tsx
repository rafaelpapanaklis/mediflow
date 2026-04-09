"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Shield, Eye, EyeOff } from "lucide-react";

export function AdminLoginForm() {
  const router = useRouter();
  const [step, setStep]         = useState<"password" | "totp">("password");
  const [password, setPassword] = useState("");
  const [totp, setTotp]         = useState("");
  const [showPwd, setShowPwd]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "password", password }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      setStep("totp");
    } finally {
      setLoading(false);
    }
  }

  async function handleTotp(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "totp", password, totp }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error); return; }
      // Hard redirect so the browser sends the new cookie on the server request
      window.location.href = "/admin";
      return;
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6">
      {error && (
        <div className="bg-rose-900/50 border border-rose-700 text-rose-300 text-sm rounded-xl px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {step === "password" ? (
        <form onSubmit={handlePassword} className="space-y-4">
          <div>
            <label className="text-sm font-semibold text-slate-300 mb-1.5 block">Contraseña maestra</label>
            <div className="relative">
              <input
                type={showPwd ? "text" : "password"}
                className="w-full h-11 bg-slate-800 border border-slate-600 rounded-xl px-4 pr-10 text-white text-sm focus:outline-none focus:ring-2 focus:ring-brand-600/50 focus:border-brand-600"
                placeholder="••••••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
              />
              <button type="button" onClick={() => setShowPwd(!showPwd)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white">
                {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <button type="submit" disabled={loading || !password}
            className="w-full h-11 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 disabled:opacity-50 transition-colors">
            {loading ? "Verificando…" : "Continuar →"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleTotp} className="space-y-4">
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold mb-2">
            <Shield className="w-4 h-4" />
            Contraseña verificada. Ingresa el código 2FA.
          </div>
          <div>
            <label className="text-sm font-semibold text-slate-300 mb-1.5 block">Código de Google Authenticator</label>
            <input
              type="text"
              inputMode="numeric"
              maxLength={6}
              className="w-full h-11 bg-slate-800 border border-slate-600 rounded-xl px-4 text-white text-xl font-mono text-center tracking-[0.5em] focus:outline-none focus:ring-2 focus:ring-brand-600/50 focus:border-brand-600"
              placeholder="000000"
              value={totp}
              onChange={e => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))}
              required
              autoFocus
            />
            <p className="text-xs text-slate-500 mt-1.5 text-center">Abre Google Authenticator y escribe el código de 6 dígitos</p>
          </div>
          <button type="submit" disabled={loading || totp.length !== 6}
            className="w-full h-11 bg-brand-600 text-white font-bold rounded-xl hover:bg-brand-700 disabled:opacity-50 transition-colors">
            {loading ? "Verificando…" : "Acceder al panel"}
          </button>
          <button type="button" onClick={() => { setStep("password"); setTotp(""); setError(""); }}
            className="w-full text-sm text-slate-400 hover:text-white transition-colors">
            ← Volver
          </button>
        </form>
      )}
    </div>
  );
}
