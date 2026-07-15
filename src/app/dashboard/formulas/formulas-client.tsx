"use client";

import { useState, useEffect, useMemo } from "react";
import { Search, FlaskConical, ChevronRight, ArrowLeft } from "lucide-react";
import { Label } from "@/components/ui/label";
import toast from "react-hot-toast";
import { useT } from "@/i18n/i18n-provider";
import styles from "./formulas.module.css";

interface Patient {
  id: string;
  firstName: string;
  lastName: string;
}

interface FormulaRecord {
  id: string;
  type: string;
  formula: Record<string, unknown>;
  notes: string | null;
  appliedAt: string;
  appliedBy: string | null;
}

const TYPE_LABEL_KEYS: Record<string, string> = {
  hair_color: "pages.formulas.typeHairColor",
  lash_extension: "pages.formulas.typeLashExtension",
  brow_tint: "pages.formulas.typeBrowTint",
  herbal: "pages.formulas.typeHerbal",
};

export function FormulasClient({ patients }: { patients: Patient[] }) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [selectedPatient, setSelectedPatient] = useState<string>("");
  const [records, setRecords] = useState<FormulaRecord[]>([]);
  const [loading, setLoading] = useState(false);

  const filteredPatients = useMemo(() => {
    if (!search) return patients;
    const q = search.toLowerCase();
    return patients.filter(p =>
      `${p.firstName} ${p.lastName}`.toLowerCase().includes(q)
    );
  }, [patients, search]);

  useEffect(() => {
    if (!selectedPatient) { setRecords([]); return; }
    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/formulas?patientId=${selectedPatient}`, { signal: ctrl.signal })
      .then(r => { if (!r.ok) throw new Error("Error"); return r.json(); })
      .then(data => setRecords(Array.isArray(data) ? data : []))
      .catch(err => { if (err.name !== "AbortError") toast.error(t("pages.formulas.loadError")); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [selectedPatient]);

  function renderFormula(formula: Record<string, unknown>) {
    return (
      <div className={styles.formulaBox}>
        {Object.entries(formula).map(([key, value]) => (
          <div key={key} className={styles.formulaRow}>
            <span className={styles.formulaKey}>{key}:</span>
            <span className={styles.formulaVal}>{String(value)}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>{t("pages.formulas.title")}</h1>
          <p className={styles.subtitle}>{t("pages.formulas.subtitle")}</p>
        </div>
      </div>

      {/* Patient search */}
      <div className={styles.section}>
        <Label className={styles.fieldLabel}>{t("pages.formulas.searchPatient")}</Label>
        <div className={styles.searchWrap}>
          <Search size={16} strokeWidth={1.75} className={styles.searchIcon} aria-hidden="true" />
          <input
            className={styles.searchInput}
            placeholder={t("pages.formulas.patientNamePlaceholder")}
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Patient list */}
      {!selectedPatient && (
        <div className={styles.patientList}>
          {filteredPatients.slice(0, 20).map((p) => (
            <button
              key={p.id}
              onClick={() => { setSelectedPatient(p.id); setSearch(""); }}
              className={styles.patientRow}
            >
              <span className={styles.patientRowName}>{p.firstName} {p.lastName}</span>
              <ChevronRight size={16} strokeWidth={1.75} className={styles.patientRowChevron} aria-hidden="true" />
            </button>
          ))}
          {filteredPatients.length === 0 && (
            <div className={styles.emptyRow}>{t("common.noResults")}</div>
          )}
        </div>
      )}

      {/* Selected patient header */}
      {selectedPatient && (
        <div className={styles.selectedHead}>
          <button
            onClick={() => setSelectedPatient("")}
            className={styles.backBtn}
          >
            <ArrowLeft size={16} strokeWidth={1.75} aria-hidden="true" /> {t("pages.formulas.backToList")}
          </button>
          <h2 className={styles.selectedName}>
            {patients.find(p => p.id === selectedPatient)?.firstName}{" "}
            {patients.find(p => p.id === selectedPatient)?.lastName}
          </h2>
        </div>
      )}

      {loading && <p className={styles.loading}>{t("pages.formulas.loading")}</p>}

      {/* Formula records */}
      {selectedPatient && !loading && (
        <div className={styles.recordList}>
          {records.map(record => (
            <div key={record.id} className={styles.recordCard}>
              <div className={styles.recordHead}>
                <span className={styles.recordType}>{TYPE_LABEL_KEYS[record.type] ? t(TYPE_LABEL_KEYS[record.type]) : record.type}</span>
                <span className={styles.recordDate}>{new Date(record.appliedAt).toLocaleDateString("es-MX")}</span>
              </div>
              {record.appliedBy && <p className={styles.recordMeta}>{t("pages.formulas.appliedBy")}: {record.appliedBy}</p>}
              {record.notes && <p className={styles.recordNotes}>{record.notes}</p>}
              {renderFormula(record.formula as Record<string, unknown>)}
            </div>
          ))}
          {records.length === 0 && (
            <div className={styles.emptyCard}>
              <span className={styles.emptyIcon} aria-hidden="true">
                <FlaskConical size={22} strokeWidth={1.75} />
              </span>
              <p className={styles.emptyTitle}>{t("pages.formulas.emptyState")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
