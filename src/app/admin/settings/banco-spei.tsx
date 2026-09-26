"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { CardNew } from "@/components/ui/design-system/card-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { clabeAgrupada, clabeValida, cuentaUsable, normalizarClabe } from "@/lib/billing/spei-directo-core";

export interface CuentaGuardada {
  banco?: string;
  beneficiario?: string;
  clabe?: string;
  updatedAt?: string | null;
}

/**
 * «Datos banco»: la cuenta de la PLATAFORMA a la que las clínicas transfieren
 * por SPEI desde su pantalla de pago. Se guarda en la base (no en el código) y
 * aplica de inmediato, sin redeploy. Mientras no haya banco, beneficiario y una
 * CLABE válida, la pantalla de pago NO ofrece SPEI.
 */
export function BancoSpeiEditor({ inicial }: { inicial: CuentaGuardada | null }) {
  const [banco, setBanco] = useState(inicial?.banco ?? "");
  const [beneficiario, setBeneficiario] = useState(inicial?.beneficiario ?? "");
  const [clabe, setClabe] = useState(inicial?.clabe ? clabeAgrupada(inicial.clabe) : "");
  const [guardando, setGuardando] = useState(false);
  const [guardada, setGuardada] = useState<CuentaGuardada | null>(inicial);

  const limpia = normalizarClabe(clabe);
  const clabeMal = limpia.length === 18 && !clabeValida(limpia);
  const configurada = cuentaUsable(guardada);
  const sinCambios =
    !!guardada && banco.trim() === (guardada.banco ?? "") && beneficiario.trim() === (guardada.beneficiario ?? "") && limpia === (guardada.clabe ?? "");

  async function guardar() {
    setGuardando(true);
    try {
      const res = await fetch("/api/admin/banco-spei", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ banco, beneficiario, clabe: limpia }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; cuenta?: CuentaGuardada };
      if (!res.ok) throw new Error(data.error ?? "No se pudo guardar");
      setGuardada(data.cuenta ?? { banco, beneficiario, clabe: limpia });
      setClabe(clabeAgrupada(limpia));
      toast.success("Datos bancarios guardados. Ya se ofrece SPEI en la pantalla de pago.");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <CardNew
      title="Datos bancarios SPEI"
      sub="La cuenta a la que las clínicas transfieren desde su pantalla de pago. Aplica al guardar, sin redeploy."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 520 }}>
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            fontSize: 12,
            background: configurada ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)",
            border: `1px solid ${configurada ? "rgba(16,185,129,0.3)" : "rgba(245,158,11,0.3)"}`,
            color: configurada ? "var(--success)" : "var(--warning)",
          }}
        >
          {configurada
            ? "Configurada: las clínicas ven la opción SPEI con estos datos."
            : "Sin configurar: mientras falten estos datos, la pantalla de pago NO ofrece SPEI."}
        </div>

        <div className="field-new">
          <label className="field-new__label" htmlFor="banco-spei-banco">Banco</label>
          <input id="banco-spei-banco" className="input-new" value={banco} maxLength={120} onChange={(e) => setBanco(e.target.value)} placeholder="Nombre del banco" />
        </div>
        <div className="field-new">
          <label className="field-new__label" htmlFor="banco-spei-beneficiario">Nombre del beneficiario</label>
          <input id="banco-spei-beneficiario" className="input-new" value={beneficiario} maxLength={120} onChange={(e) => setBeneficiario(e.target.value)} placeholder="Como aparece en la cuenta" />
        </div>
        <div className="field-new">
          <label className="field-new__label" htmlFor="banco-spei-clabe">CLABE interbancaria (18 dígitos)</label>
          <input
            id="banco-spei-clabe"
            className="input-new"
            inputMode="numeric"
            value={clabe}
            onChange={(e) => setClabe(e.target.value.replace(/[^\d\s]/g, ""))}
            placeholder="000 000 000 000 000 000"
            aria-invalid={clabeMal}
            style={clabeMal ? { borderColor: "var(--danger)" } : undefined}
          />
          {clabeMal && (
            <div style={{ fontSize: 11, color: "var(--danger)", marginTop: 4 }}>
              Esta CLABE no es válida (falla el dígito verificador): revisa los números.
            </div>
          )}
        </div>

        <div>
          <ButtonNew variant="primary" onClick={guardar} disabled={guardando || sinCambios || !banco.trim() || !beneficiario.trim() || limpia.length !== 18 || clabeMal}>
            {guardando ? "Guardando…" : "Guardar datos bancarios"}
          </ButtonNew>
        </div>

        <div
          style={{
            padding: "10px 14px",
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: 10,
            fontSize: 12,
            color: "var(--text-2)",
            lineHeight: 1.5,
          }}
        >
          Estos datos solo alimentan la pantalla de pago (/dashboard/suspended) y la de espera. Cada cambio queda en
          la bitácora con tu usuario (la CLABE va enmascarada). Las transferencias que las clínicas declaran aparecen
          en <strong>Pagos</strong>, arriba, para que las confirmes.
        </div>
      </div>
    </CardNew>
  );
}
