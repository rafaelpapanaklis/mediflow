"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import { getInitials, avatarColor } from "@/lib/utils";
import { CardNew }   from "@/components/ui/design-system/card-new";
import { AvatarNew } from "@/components/ui/design-system/avatar-new";
import { BadgeNew }  from "@/components/ui/design-system/badge-new";
import { ButtonNew } from "@/components/ui/design-system/button-new";
import { DentalForm }          from "@/components/clinical/dental-form";
import { NutritionForm }       from "@/components/clinical/nutrition-form";
import { PsychologyForm }      from "@/components/clinical/psychology-form";
import { GeneralMedicineForm } from "@/components/clinical/medicine-form";
import { ClinicalRecordsList } from "@/components/clinical/records-list";

const AestheticMedicineForm = dynamic(() => import("@/components/clinical/aesthetic-medicine-form").then(m => ({ default: m.AestheticMedicineForm })));
const HairRestorationForm = dynamic(() => import("@/components/clinical/hair-restoration-form").then(m => ({ default: m.HairRestorationForm })));
const BeautyCenterForm = dynamic(() => import("@/components/clinical/beauty-center-form").then(m => ({ default: m.BeautyCenterForm })));
const BrowLashForm = dynamic(() => import("@/components/clinical/brow-lash-form").then(m => ({ default: m.BrowLashForm })));
const MassageForm = dynamic(() => import("@/components/clinical/massage-form").then(m => ({ default: m.MassageForm })));
const LaserForm = dynamic(() => import("@/components/clinical/laser-form").then(m => ({ default: m.LaserForm })));
const HairSalonForm = dynamic(() => import("@/components/clinical/hair-salon-form").then(m => ({ default: m.HairSalonForm })));
const AlternativeMedicineForm = dynamic(() => import("@/components/clinical/alternative-medicine-form").then(m => ({ default: m.AlternativeMedicineForm })));
const NailSalonForm = dynamic(() => import("@/components/clinical/nail-salon-form").then(m => ({ default: m.NailSalonForm })));
const SpaForm = dynamic(() => import("@/components/clinical/spa-form").then(m => ({ default: m.SpaForm })));
const PhysiotherapyForm = dynamic(() => import("@/components/clinical/physiotherapy-form").then(m => ({ default: m.PhysiotherapyForm })));
const PodiatryForm = dynamic(() => import("@/components/clinical/podiatry-form").then(m => ({ default: m.PodiatryForm })));
const DermatologyForm = dynamic(() => import("@/components/clinical/dermatology-form").then(m => ({ default: m.DermatologyForm })));

// Map ClinicCategory enum → internal key
const CATEGORY_TO_SPECIALTY: Record<string, string> = {
  DENTAL: "dental", MEDICINE: "medicine", NUTRITION: "nutrition",
  PSYCHOLOGY: "psychology", DERMATOLOGY: "dermatology",
  AESTHETIC_MEDICINE: "aesthetic_medicine", HAIR_RESTORATION: "hair_restoration",
  BEAUTY_CENTER: "beauty_center", BROW_LASH: "brow_lash", MASSAGE: "massage",
  LASER_HAIR_REMOVAL: "laser_hair_removal", HAIR_SALON: "hair_salon",
  ALTERNATIVE_MEDICINE: "alternative_medicine", NAIL_SALON: "nail_salon",
  SPA: "spa", PHYSIOTHERAPY: "physiotherapy", PODIATRY: "podiatry", OTHER: "medicine",
};

// Legacy fuzzy matching fallback
const SPECIALTY_MAP: Record<string, string> = {
  dental: "dental", odontologia: "dental", odontología: "dental",
  nutrition: "nutrition", nutricion: "nutrition", nutrición: "nutrition",
  psychology: "psychology", psicologia: "psychology", psicología: "psychology",
  dermatology: "dermatology", dermatologia: "dermatology",
};

function detectSpecialty(raw: string, clinicCategory?: string): string {
  // Prefer the enum-based category if available
  if (clinicCategory && CATEGORY_TO_SPECIALTY[clinicCategory]) {
    return CATEGORY_TO_SPECIALTY[clinicCategory];
  }
  // Fallback: fuzzy match on legacy specialty string
  const lower = raw.toLowerCase();
  for (const [key, val] of Object.entries(SPECIALTY_MAP)) {
    if (lower.includes(key)) return val;
  }
  return "medicine";
}

interface Props {
  specialty:         string;
  clinicCategory?:   string;
  patients:          any[];
  selectedPatient:   any;
  records:           any[];
  sessionCount:      number;
  currentPatientId?: string;
}

export function ClinicalClient({
  specialty, clinicCategory, patients, selectedPatient: initialPatient,
  records: initialRecords, sessionCount: initialSessionCount,
  currentPatientId,
}: Props) {
  const router  = useRouter();
  const [search, setSearch]         = useState("");
  const [selectedPatient, setSelectedPatient] = useState(initialPatient);
  const [records, setRecords]       = useState(initialRecords);
  const [sessionCount, setSessionCount] = useState(initialSessionCount);
  const [loading, setLoading]       = useState(false);
  const [tab, setTab]               = useState<"new" | "history">("new");

  const detectedSpecialty = detectSpecialty(specialty, clinicCategory);

  // When patient changes via URL, reload records from API
  useEffect(() => {
    if (!currentPatientId) {
      setSelectedPatient(null);
      setRecords([]);
      setSessionCount(0);
      return;
    }

    const ctrl = new AbortController();
    setLoading(true);
    fetch(`/api/clinical?patientId=${currentPatientId}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(data => {
        setRecords(Array.isArray(data) ? data : []);
        setSessionCount((Array.isArray(data) ? data.length : 0) + 1);
      })
      .catch(err => { if (err.name !== "AbortError") setRecords([]); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();

    // Find patient from list
    const patient = patients.find(p => p.id === currentPatientId);
    if (patient) setSelectedPatient(patient);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPatientId]);

  const filtered = patients.filter(p => {
    const q = search.toLowerCase();
    return `${p.firstName} ${p.lastName}`.toLowerCase().includes(q) ||
           p.patientNumber.includes(q);
  });

  function selectPatient(patientId: string) {
    setTab("new");
    router.push(`/dashboard/clinical?patientId=${patientId}`);
  }

  function handleSaved(record: any) {
    setRecords(prev => [record, ...prev]);
    setSessionCount(prev => prev + 1);
    setTab("history");
  }

  return (
    <div style={{ display: "flex", gap: 20, padding: "24px 28px", maxWidth: 1400, margin: "0 auto" }}>
      {/* Patient list sidebar */}
      <div style={{ width: 260, flexShrink: 0 }}>
        <CardNew noPad>
          <div style={{ padding: 12, borderBottom: "1px solid var(--border-soft)" }}>
            <div style={{ fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600, marginBottom: 8 }}>
              Pacientes
            </div>
            <div className="search-field" style={{ width: "100%" }}>
              <Search size={14} />
              <input
                placeholder="Buscar…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div style={{ overflowY: "auto", maxHeight: "calc(100vh - 240px)" }}>
            {filtered.length === 0 ? (
              <div style={{ padding: 16, textAlign: "center", fontSize: 11, color: "var(--text-3)" }}>
                Sin resultados
              </div>
            ) : filtered.map(p => {
              const isSel = currentPatientId === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => selectPatient(p.id)}
                  className="list-row"
                  style={{
                    width: "100%",
                    textAlign: "left",
                    cursor: "pointer",
                    background: isSel ? "var(--brand-soft)" : "transparent",
                    borderLeft: isSel ? "3px solid var(--brand)" : "3px solid transparent",
                    color: "inherit",
                  }}
                >
                  <AvatarNew name={`${p.firstName} ${p.lastName}`} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {p.firstName} {p.lastName}
                    </div>
                    <div className="mono" style={{ fontSize: 10, color: "var(--text-3)" }}>#{p.patientNumber}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </CardNew>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selectedPatient ? (
          <CardNew>
            <div style={{ padding: "80px 24px", textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>
                {{ dental: "🦷", nutrition: "🥗", psychology: "🧠", dermatology: "✨",
                   aesthetic_medicine: "💉", hair_restoration: "💇", beauty_center: "⭐",
                   brow_lash: "👁", massage: "💆", laser_hair_removal: "⚡", hair_salon: "✂️",
                   alternative_medicine: "🌿", nail_salon: "💅", spa: "🧖", physiotherapy: "🏋️",
                   podiatry: "🦶" }[detectedSpecialty] ?? "🩺"}
              </div>
              <h2 style={{ fontSize: 16, color: "var(--text-1)", fontWeight: 600, margin: 0 }}>
                Expediente Clínico
              </h2>
              <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 6 }}>
                Selecciona un paciente de la lista para ver su expediente o registrar una nueva consulta.
              </p>
            </div>
          </CardNew>
        ) : (
          <div>
            {/* Patient header */}
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 18 }}>
              <AvatarNew name={`${selectedPatient.firstName} ${selectedPatient.lastName}`} size="lg" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <h1 style={{ fontSize: 18, color: "var(--text-1)", fontWeight: 600, margin: 0, letterSpacing: "-0.02em" }}>
                    {selectedPatient.firstName} {selectedPatient.lastName}
                  </h1>
                  <BadgeNew tone="brand">{detectedSpecialty}</BadgeNew>
                </div>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>
                  <span className="mono">#{selectedPatient.patientNumber}</span>
                  <span style={{ margin: "0 6px" }}>·</span>
                  {records.length} consulta{records.length !== 1 ? "s" : ""} previas
                </p>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <a href={`/dashboard/patients/${selectedPatient.id}`} style={{ textDecoration: "none" }}>
                  <ButtonNew variant="secondary" size="sm">Ver perfil</ButtonNew>
                </a>
              </div>
            </div>

            {/* Tabs */}
            <div className="tabs-new" style={{ marginBottom: 18 }}>
              <button
                type="button"
                onClick={() => setTab("new")}
                className={`tab-new ${tab === "new" ? "tab-new--active" : ""}`}
              >
                Nueva consulta
              </button>
              <button
                type="button"
                onClick={() => setTab("history")}
                className={`tab-new ${tab === "history" ? "tab-new--active" : ""}`}
              >
                Historial
                <span className="tab__count">{records.length}</span>
              </button>
            </div>

            {loading ? (
              <div className="rounded-xl border border-border bg-card shadow-card p-10 text-center text-sm text-muted-foreground">
                Cargando expediente…
              </div>
            ) : (
              <>
                {tab === "new" && (
                  <div className="rounded-xl border border-border bg-card shadow-card p-5">
                    <h2 className="text-sm font-bold mb-4">
                      {{ dental:"🦷 Consulta dental", nutrition:"🥗 Consulta nutricional",
                         psychology:"🧠 Sesión de psicología", dermatology:"✨ Consulta dermatológica",
                         aesthetic_medicine:"💉 Medicina estética", hair_restoration:"💇 Restauración capilar",
                         beauty_center:"⭐ Centro de estética", brow_lash:"👁 Cejas y pestañas",
                         massage:"💆 Sesión de masaje", laser_hair_removal:"⚡ Depilación láser",
                         hair_salon:"✂️ Peluquería", alternative_medicine:"🌿 Medicina alternativa",
                         nail_salon:"💅 Uñas", spa:"🧖 Spa", physiotherapy:"🏋️ Fisioterapia",
                         podiatry:"🦶 Podología" }[detectedSpecialty] ?? "🩺 Consulta médica"}
                    </h2>
                    {detectedSpecialty === "dental"               && <DentalForm          patientId={selectedPatient.id} isChild={!!selectedPatient.isChild} onSaved={handleSaved} />}
                    {detectedSpecialty === "nutrition"            && <NutritionForm       patientId={selectedPatient.id} patient={selectedPatient} onSaved={handleSaved} />}
                    {detectedSpecialty === "psychology"           && <PsychologyForm      patientId={selectedPatient.id} sessionNum={sessionCount} onSaved={handleSaved} />}
                    {detectedSpecialty === "aesthetic_medicine"   && <AestheticMedicineForm patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "hair_restoration"     && <HairRestorationForm  patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "beauty_center"        && <BeautyCenterForm     patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "brow_lash"            && <BrowLashForm         patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "massage"              && <MassageForm          patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "laser_hair_removal"   && <LaserForm            patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "hair_salon"           && <HairSalonForm        patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "alternative_medicine" && <AlternativeMedicineForm patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "nail_salon"           && <NailSalonForm        patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "spa"                  && <SpaForm              patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "physiotherapy"        && <PhysiotherapyForm    patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "podiatry"             && <PodiatryForm         patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "medicine" && <GeneralMedicineForm patientId={selectedPatient.id} onSaved={handleSaved} />}
                    {detectedSpecialty === "dermatology" && <DermatologyForm patientId={selectedPatient.id} onSaved={handleSaved} />}
                  </div>
                )}

                {tab === "history" && (
                  <div>
                    {records.length === 0 ? (
                      <div className="rounded-xl border border-border bg-card shadow-card p-10 text-center">
                        <p className="text-sm text-muted-foreground mb-3">Sin consultas registradas para este paciente</p>
                        <button onClick={() => setTab("new")} className="text-xs font-semibold text-brand-600 hover:underline">
                          Registrar primera consulta →
                        </button>
                      </div>
                    ) : (
                      <ClinicalRecordsList records={records} />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
