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
import { useT } from "@/i18n/i18n-provider";

interface PresetBaseProps {
  size?: EmptyStateSize;
  className?: string;
}

interface EmptyPatientsProps extends PresetBaseProps {
  onNew?: () => void;
  onImport?: () => void;
}

export function EmptyPatients({ size, className, onNew, onImport }: EmptyPatientsProps) {
  const t = useT();
  return (
    <EmptyStateNew
      icon={Users} tone="brand"
      title={t("clinical.emptyStates.patientsTitle")}
      description={t("clinical.emptyStates.patientsDesc")}
      primaryCta={{
        label: t("clinical.emptyStates.patientsNewCta"), icon: UserPlus,
        onClick: onNew,
        href: onNew ? undefined : "/dashboard/patients?new=1",
      }}
      secondaryCta={{
        label: t("clinical.emptyStates.patientsImportCta"), icon: FileSpreadsheet,
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
  const t = useT();
  return (
    <EmptyStateNew
      icon={Calendar} tone="neutral"
      title={t("clinical.emptyStates.apptsTodayTitle")}
      description={t("clinical.emptyStates.apptsTodayDesc")}
      primaryCta={{
        label: t("clinical.emptyStates.apptsNewCta"), icon: CalendarPlus,
        onClick: onNew,
        href: onNew ? undefined : "/dashboard/appointments?new=1",
      }}
      secondaryCta={{
        label: t("clinical.emptyStates.apptsWeekCta"), icon: CalendarDays,
        href: "/dashboard/appointments?view=week",
      }}
      size={size} className={className}
    />
  );
}

export function EmptyInvoices({ size, className }: PresetBaseProps) {
  const t = useT();
  return (
    <EmptyStateNew
      icon={CreditCard} tone="brand"
      title={t("clinical.emptyStates.invoicesTitle")}
      description={t("clinical.emptyStates.invoicesDesc")}
      primaryCta={{ label: t("clinical.emptyStates.invoicesNewCta"), icon: FilePlus, href: "/dashboard/billing?new=1" }}
      size={size} className={className}
    />
  );
}

interface EmptyXraysProps extends PresetBaseProps {
  onUpload?: () => void;
}

export function EmptyXrays({ size, className, onUpload }: EmptyXraysProps) {
  const t = useT();
  return (
    <EmptyStateNew
      icon={FileImage} tone="brand"
      title={t("clinical.emptyStates.xraysTitle")}
      description={t("clinical.emptyStates.xraysDesc")}
      primaryCta={{ label: t("clinical.emptyStates.xraysUploadCta"), icon: Upload, onClick: onUpload }}
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
  const t = useT();
  return (
    <EmptyStateNew
      icon={Stethoscope} tone="brand"
      title={t("clinical.emptyStates.recordsTitle")}
      description={
        patientName
          ? t("clinical.emptyStates.recordsDescNamed", { patientName })
          : t("clinical.emptyStates.recordsDesc")
      }
      primaryCta={
        onStartConsult
          ? { label: t("clinical.emptyStates.recordsStartCta"), icon: Play, onClick: onStartConsult }
          : undefined
      }
      size={size} className={className}
    />
  );
}

export function EmptyMessages({ size, className }: PresetBaseProps) {
  const t = useT();
  return (
    <EmptyStateNew
      icon={MessageCircle} tone="neutral"
      title={t("clinical.emptyStates.messagesTitle")}
      description={t("clinical.emptyStates.messagesDesc")}
      size={size} className={className}
    />
  );
}

export function EmptyTreatments({ size, className }: PresetBaseProps) {
  const t = useT();
  return (
    <EmptyStateNew
      icon={Activity} tone="brand"
      title={t("clinical.emptyStates.treatmentsTitle")}
      description={t("clinical.emptyStates.treatmentsDesc")}
      primaryCta={{ label: t("clinical.emptyStates.treatmentsAddCta"), icon: Plus, href: "/dashboard/treatments?new=1" }}
      size={size} className={className}
    />
  );
}

interface EmptyWaitlistProps extends PresetBaseProps {
  onAdd?: () => void;
}

export function EmptyWaitlist({ size, className, onAdd }: EmptyWaitlistProps) {
  const t = useT();
  return (
    <EmptyStateNew
      icon={Clock} tone="neutral"
      title={t("clinical.emptyStates.waitlistTitle")}
      description={t("clinical.emptyStates.waitlistDesc")}
      primaryCta={{ label: t("clinical.emptyStates.waitlistAddCta"), icon: Plus, onClick: onAdd }}
      size={size} className={className}
    />
  );
}

interface EmptySearchResultsProps extends PresetBaseProps {
  query: string;
  hint?: string;
}

export function EmptySearchResults({ size, className, query, hint }: EmptySearchResultsProps) {
  const t = useT();
  return (
    <EmptyStateNew
      icon={SearchX} tone="neutral"
      title={t("clinical.emptyStates.searchTitle", { query })}
      description={hint ?? t("clinical.emptyStates.searchDesc")}
      size={size ?? "sm"} className={className}
    />
  );
}

export function EmptyActivity({ size, className }: PresetBaseProps) {
  const t = useT();
  return (
    <EmptyStateNew
      icon={Activity} tone="neutral"
      title={t("clinical.emptyStates.activityTitle")}
      description={t("clinical.emptyStates.activityDesc")}
      size={size} className={className}
    />
  );
}

export function EmptyActionItemsAllClear({ size, className }: PresetBaseProps) {
  const t = useT();
  return (
    <EmptyStateNew
      icon={CheckCircle2} tone="success"
      title={t("clinical.emptyStates.allClearTitle")}
      description={t("clinical.emptyStates.allClearDesc")}
      size={size ?? "sm"} className={className}
    />
  );
}
