"use client";

import { useState } from "react";
import toast from "react-hot-toast";
import { Plus, X, Sparkles, Loader2 } from "lucide-react";
import { useT } from "@/i18n/i18n-provider";

interface Remedy {
  name: string;
  score: number;
  potency: string;
  rationale: string;
}

interface RepertorizationProps {
  constitutional?: string;
  onRemedySelect?: (remedy: Remedy) => void;
}

export function Repertorization({ constitutional, onRemedySelect }: RepertorizationProps) {
  const t = useT();
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [newSymptom, setNewSymptom] = useState("");
  const [remedies, setRemedies] = useState<Remedy[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  const addSymptom = () => {
    const s = newSymptom.trim();
    if (!s) return;
    setSymptoms(prev => [...prev, s]);
    setNewSymptom("");
  };

  const removeSymptom = (i: number) => {
    setSymptoms(prev => prev.filter((_, idx) => idx !== i));
  };

  async function suggestRemedies() {
    if (symptoms.length < 2) {
      toast.error(t("clinical.repertorization.minSymptoms"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/homeopatia/suggest-remedies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symptoms, constitutional }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setRemedies(data.remedies ?? []);
    } catch (err: any) {
      toast.error(err.message ?? t("clinical.repertorization.suggestError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontFamily: "var(--font-sans, system-ui, sans-serif)", fontWeight: 600, fontSize: 15, color: "var(--text-1)" }}>
            {t("clinical.repertorization.title")}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>{t("clinical.repertorization.subtitle")}</div>
        </div>
        <button
          className="btn-new"
          onClick={suggestRemedies}
          disabled={loading || symptoms.length < 2}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#7c3aed", color: "#fff", borderColor: "#7c3aed" }}
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {t("clinical.repertorization.suggest")}
        </button>
      </div>

      <div>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-2)", fontFamily: "ui-monospace, monospace", marginBottom: 8 }}>
          {t("clinical.repertorization.rubricSymptoms")}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
          {symptoms.map((s, i) => (
            <span key={i} className="tag-new" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {s}
              <button onClick={() => removeSymptom(i)} style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, display: "flex" }}>
                <X size={11} />
              </button>
            </span>
          ))}
          {symptoms.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-2)", fontStyle: "italic" }}>
              {t("clinical.repertorization.symptomsHint")}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input-new"
            style={{ flex: 1 }}
            placeholder={t("clinical.repertorization.symptomPlaceholder")}
            value={newSymptom}
            onChange={e => setNewSymptom(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSymptom(); } }}
          />
          <button className="btn-new" onClick={addSymptom} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Plus size={13} /> {t("common.add")}
          </button>
        </div>
      </div>

      {remedies.length > 0 && (
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-2)", fontFamily: "ui-monospace, monospace", marginBottom: 8 }}>
            {t("clinical.repertorization.suggestedRemedies")}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {remedies.map((r, i) => {
              const isTop = i === 0;
              const isSel = selected === r.name;
              return (
                <button
                  key={r.name}
                  onClick={() => {
                    setSelected(r.name);
                    onRemedySelect?.(r);
                  }}
                  style={{
                    textAlign: "left",
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: isTop ? "rgba(251,191,36,0.1)" : isSel ? "rgba(124,58,237,0.08)" : "rgba(255,255,255,0.02)",
                    border: `1px solid ${isTop ? "rgba(251,191,36,0.4)" : isSel ? "rgba(124,58,237,0.4)" : "var(--border)"}`,
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontFamily: "var(--font-sans, system-ui, sans-serif)", fontWeight: 600, fontSize: 13, color: isTop ? "#fbbf24" : "var(--text-1)" }}>{r.name}</span>
                      <span className="badge-new" style={{ fontSize: 10 }}>{r.potency}</span>
                      {isTop && <span className="badge-new" style={{ fontSize: 10, background: "rgba(251,191,36,0.15)", color: "#fbbf24", borderColor: "rgba(251,191,36,0.4)" }}>{t("clinical.repertorization.topBadge")}</span>}
                    </div>
                    <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, color: "var(--text-2)" }}>{r.score}/100</div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-2)" }}>{r.rationale}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
