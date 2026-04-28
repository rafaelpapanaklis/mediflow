"use client";
import {
  Users, UserPlus, FileSpreadsheet,
  Calendar, CalendarPlus, CalendarDays,
  CreditCard, FilePlus,
  FileImage, Upload, BookOpen,
  Stethoscope, Play,
  MessageCircle,
  Activity, Plus,
  Clock, SearchX, CheckCircle2,
} from "lucide-react";
import {
  EmptyStateNew,
  type EmptyStateSize,
} from "../empty-state";

interface PresetBaseProps {
  size?: EmptyStateSize;
  className?: string;
}

interface EmptyPatientsProps extends PresetBaseProps {
  onNew?: () => void;
  onImport?: () => void;
}

export function EmptyPatients({ size, className, onNew, onImport }: EmptyPatientsProps) {
  return (
    <EmptyStateNew
      icon={Users} tone="brand"
      title="Sin pacientes todavía"
      description="Registra tu primer paciente o importa tu base desde Excel para empezar."
      primaryCta={{
        label: "Nuevo paciente", icon: UserPlus,
        onClick: onNew,
        href: onNew ? undefined : "/dashboard/patients?new=1",
      }}
      secondaryCta={{
        label: "Importar Excel", icon: FileSpreadsheet,
        onClick: onImport,
        href: onImport ? undefined : "/dashboard/patients?import=1",
      }}
      size={size} className={className}
    />
  );
}

interface EmptyAppointmentsTodayProps extends PresetBaseProps {
  onNew?: () => void;
}

export function EmptyAppointmentsToday({ size, className, onNew }: EmptyAppointmentsTodayProps) {
  return (
    <EmptyStateNew
      icon={Calendar} tone="neutral"
      title="Sin citas hoy"
      description="Disfruta el día libre o aprovecha para agendar la próxima semana."
      primaryCta={{
        label: "Nueva cita", icon: CalendarPlus,
        onClick: onNew,
        href: onNew ? undefined : "/dashboard/appointments?new=1",
      }}
      secondaryCta={{
        label: "Ver agenda semanal", icon: CalendarDays,
        href: "/dashboard/appointments?view=week",
      }}
      size={size} className={className}
    />
  );
}

export function EmptyInvoices({ size, className }: PresetBaseProps) {
  return (
    <EmptyStateNew
      icon={CreditCard} tone="brand"
      title="Sin facturas emitidas"
      description="Cuando cobres una consulta o tratamiento, las facturas aparecerán aquí."
      primaryCta={{ label: "Nueva factura", icon: FilePlus, href: "/dashboard/billing?new=1" }}
      size={size} className={className}
    />
  );
}

interface EmptyXraysProps extends PresetBaseProps {
  onUpload?: () => void;
}

export function EmptyXrays({ size, className, onUpload }: EmptyXraysProps) {
  return (
    <EmptyStateNew
      icon={FileImage} tone="brand"
      title="Sin radiografías subidas"
      description="Sube panorámicas, periapicales o cualquier estudio por imagen. El análisis IA está disponible automáticamente."
      primaryCta={{ label: "Subir radiografía", icon: Upload, onClick: onUpload }}
      size={size} className={className}
    />
  );
}

interface EmptyClinicalRecordsProps extends PresetBaseProps {
  onStartConsult?: () => void;
  patientName?: string;
}

export function EmptyClinicalRecords({
  size, className, onStartConsult, patientName,
}: EmptyClinicalRecordsProps) {
  return (
    <EmptyStateNew
      icon={Stethoscope} tone="brand"
      title="Sin notas clínicas"
      description={
        patientName
          ? `Inicia la primera consulta de ${patientName} para generar notas SOAP, diagnósticos y planes de tratamiento.`
          : "Las notas SOAP, diagnósticos y planes de tratamiento se guardarán aquí."
      }
      primaryCta={
        onStartConsult
          ? { label: "Iniciar consulta", icon: Play, onClick: onStartConsult }
          : undefined
      }
      size={size} className={className}
    />
  );
}

export function EmptyMessages({ size, className }: PresetBaseProps) {
  return (
    <EmptyStateNew
      icon={MessageCircle} tone="neutral"
      title="Sin mensajes"
      description="Los mensajes entrantes de WhatsApp, email o SMS aparecerán aquí."
      size={size} className={className}
    />
  );
}

export function EmptyTreatments({ size, className }: PresetBaseProps) {
  return (
    <EmptyStateNew
      icon={Activity} tone="brand"
      title="Sin tratamientos en catálogo"
      description="Agrega los tratamientos que ofreces para poder asignarlos a citas y facturas."
      primaryCta={{ label: "Agregar tratamiento", icon: Plus, href: "/dashboard/treatments?new=1" }}
      size={size} className={className}
    />
  );
}

interface EmptyWaitlistProps extends PresetBaseProps {
  onAdd?: () => void;
}

export function EmptyWaitlist({ size, className, onAdd }: EmptyWaitlistProps) {
  return (
    <EmptyStateNew
      icon={Clock} tone="neutral"
      title="Lista de espera vacía"
      description="Agrega pacientes que quieran adelantar su cita si hay cancelaciones."
      primaryCta={{ label: "Agregar paciente a espera", icon: Plus, onClick: onAdd }}
      size={size} className={className}
    />
  );
}

interface EmptySearchResultsProps extends PresetBaseProps {
  query: string;
  hint?: string;
}

export function EmptySearchResults({ size, className, query, hint }: EmptySearchResultsProps) {
  return (
    <EmptyStateNew
      icon={SearchX} tone="neutral"
      title={`Sin resultados para "${query}"`}
      description={hint ?? "Prueba con otro nombre, teléfono o folio. La búsqueda ignora acentos."}
      size={size ?? "sm"} className={className}
    />
  );
}

export function EmptyActivity({ size, className }: PresetBaseProps) {
  return (
    <EmptyStateNew
      icon={Activity} tone="neutral"
      title="Sin actividad reciente"
      description="Los eventos de la clínica aparecerán aquí: cobros, nuevos pacientes, consultas completadas."
      size={size} className={className}
    />
  );
}

export function EmptyActionItemsAllClear({ size, className }: PresetBaseProps) {
  return (
    <EmptyStateNew
      icon={CheckCircle2} tone="success"
      title="Todo al día 🎉"
      description="Sin citas sin confirmar, sin facturas pendientes, sin mensajes sin leer."
      size={size ?? "sm"} className={className}
    />
  );
}
