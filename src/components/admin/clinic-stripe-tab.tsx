"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { CreditCard, AlertTriangle, CheckCircle2, Link as LinkIcon } from "lucide-react";

interface Props {
  clinicId: string;
  clinicName: string;
  plan: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  /** Si `false` NO se llama a la API, se muestra card con instrucciones. */
  stripeConfigured: boolean;
  instructions: string;
}

export function ClinicStripeTab({ clinicId, clinicName, plan, stripeCustomerId, stripeSubscriptionId, subscriptionStatus, stripeConfigured, instructions }: Props) {
  const [loading, setLoading] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(plan);
  const [lastCheckoutUrl, setLastCheckoutUrl] = useState<string | null>(null);

  if (!stripeConfigured) {
    return (
      <div className="bg-amber-950/40 border border-amber-700 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <h3 className="text-sm font-bold text-amber-300">Configurar Stripe primero</h3>
        </div>
        <pre className="whitespace-pre-wrap text-xs text-amber-200 bg-slate-950/60 border border-slate-800 rounded-lg p-4 leading-relaxed">{instructions}</pre>
        <a
          href="https://vercel.com/dashboard"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 text-xs font-bold text-amber-300 hover:underline"
        >
          Ir a Vercel Environment Variables →
        </a>
      </div>
    );
  }

  async function createCustomer() {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/stripe/create-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Error");
      const data = await res.json();
      toast.success(data.reused ? "Customer ya existente" : "Customer creado");
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  async function createSubscription() {
    setLoading(true);
    setLastCheckoutUrl(null);
    try {
      const res = await fetch("/api/admin/stripe/create-subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clinicId, plan: selectedPlan }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Error");
      const data = await res.json();
      if (data.url) {
        setLastCheckoutUrl(data.url);
        navigator.clipboard.writeText(data.url).catch(() => {});
        toast.success("Link de checkout copiado al portapapeles");
      } else {
        toast.success("Suscripción creada");
      }
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="space-y-4">
      {/* Connection status */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-600/15 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold">Stripe conectado</h3>
            <p className="text-xs text-slate-500">STRIPE_SECRET_KEY está configurada.</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-slate-400 mb-1">Customer ID</div>
            <div className="font-mono text-slate-200">{stripeCustomerId ?? <span className="text-slate-500">— ninguno</span>}</div>
          </div>
          <div>
            <div className="text-slate-400 mb-1">Subscription ID</div>
            <div className="font-mono text-slate-200">{stripeSubscriptionId ?? <span className="text-slate-500">— ninguno</span>}</div>
          </div>
          <div>
            <div className="text-slate-400 mb-1">Estado suscripción</div>
            <div className="font-semibold text-slate-200">{subscriptionStatus ?? "—"}</div>
          </div>
        </div>
      </div>

      {/* Create customer */}
      <div className="bg-slate-900 border border-slate-700 rounded-2xl p-5 space-y-3">
        <div className="flex items-center gap-2">
          <CreditCard className="w-4 h-4 text-brand-400" />
          <h3 className="text-sm font-bold">Acciones</h3>
        </div>

        {!stripeCustomerId && (
          <button
            onClick={createCustomer}
            disabled={loading}
            className="w-full bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white font-bold py-2 rounded-lg text-sm disabled:opacity-50"
          >
            {loading ? "Creando…" : `Crear Customer Stripe para ${clinicName}`}
          </button>
        )}

        <div className="grid grid-cols-3 gap-2">
          {(["BASIC", "PRO", "CLINIC"] as const).map(p => (
            <button
              key={p}
              onClick={() => setSelectedPlan(p)}
              className={`py-2 rounded-lg text-xs font-bold border ${
                selectedPlan === p
                  ? "bg-brand-600 border-brand-600 text-white"
                  : "bg-slate-800 border-slate-700 text-slate-400 hover:text-white"
              }`}
            >
              {p}
            </button>
          ))}
        </div>

        <button
          onClick={createSubscription}
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-700 text-white font-bold py-2.5 rounded-lg text-sm disabled:opacity-50"
        >
          <LinkIcon className="w-4 h-4" />
          {loading ? "Generando…" : `Generar link de checkout (${selectedPlan})`}
        </button>

        {lastCheckoutUrl && (
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs">
            <div className="text-slate-400 mb-1">Link generado (copiado al portapapeles):</div>
            <a href={lastCheckoutUrl} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline break-all font-mono">
              {lastCheckoutUrl}
            </a>
          </div>
        )}

        <p className="text-xs text-slate-500">
          El link abre el Checkout de Stripe. Al completarse, el webhook
          <code className="bg-slate-800 px-1 rounded mx-1">/api/webhooks/stripe</code>
          actualiza <code className="bg-slate-800 px-1 rounded">subscriptionStatus</code> automáticamente.
        </p>
      </div>
    </div>
  );
}
