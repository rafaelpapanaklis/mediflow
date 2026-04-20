"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import { getInitials, avatarColor } from "@/lib/utils";
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

    setLoading(true);
    // Load patient records
    fetch(`/api/clinical?patientId=${currentPatientId}`)
      .then(r => r.json())
      .then(data => {
        setRecords(Array.isArray(data) ? data : []);
        setSessionCount((Array.isArray(data) ? data.length : 0) + 1);
      })
      .catch(() => setRecords([]))
      .finally(() => setLoading(false));

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
    <div className="flex gap-5 h-full">
      {/* Patient list sidebar */}
      <div className="w-64 flex-shrink-0">
        <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
          <div className="p-3 border-b border-border">
            <h2 className="text-sm font-bold mb-2">Pacientes</h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                className="flex h-8 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs focus:outline-none focus:ring-2 focus:ring-brand-600/20"
                placeholder="Buscar…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="overflow-y-auto max-h-[calc(100vh-200px)]">
            {filtered.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground text-center">Sin resultados</div>
            ) : filtered.map(p => (
              <button
                key={p.id}
                onClick={() => selectPatient(p.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-muted/30 transition-colors border-b border-border/50 last:border-0 ${currentPatientId === p.id ? "bg-brand-600/15 text-foreground" : ""}`}
              >
                <div className={`w-8 h-8 rounded-full ${avatarColor(p.id)} flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0`}>
                  {getInitials(p.firstName, p.lastName)}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold truncate">{p.firstName} {p.lastName}</div>
                  <div className="text-[10px] text-muted-foreground">#{p.patientNumber}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        {!selectedPatient ? (
          <div className="rounded-xl border border-border bg-card shadow-card p-16 text-center">
            <div className="text-4xl mb-4">
              {{ dental:"🦷", nutrition:"🥗", psychology:"🧠", dermatology:"✨",
                 aesthetic_medicine:"💉", hair_restoration:"💇", beauty_center:"⭐",
                 brow_lash:"👁", massage:"💆", laser_hair_removal:"⚡", hair_salon:"✂️",
                 alternative_medicine:"🌿", nail_salon:"💅", spa:"🧖", physiotherapy:"🏋️",
                 podiatry:"🦶" }[detectedSpecialty] ?? "🩺"}
            </div>
            <h2 className="text-lg font-bold mb-2">Expediente Clínico</h2>
            <p className="text-sm text-muted-foreground">
              Selecciona un paciente de la lista para ver su expediente o registrar una nueva consulta.
            </p>
          </div>
        ) : (
          <div>
            {/* Patient header */}
            <div className="flex items-center gap-3 mb-5">
              <div className={`w-12 h-12 rounded-full ${avatarColor(selectedPatient.id)} flex items-center justify-center text-sm font-bold text-white`}>
                {getInitials(selectedPatient.firstName, selectedPatient.lastName)}
              </div>
              <div>
                <h1 className="text-lg font-extrabold">
                  {selectedPatient.firstName} {selectedPatient.lastName}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Expediente #{selectedPatient.patientNumber} · {records.length} consulta{records.length !== 1 ? "s" : ""} previas
                </p>
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
