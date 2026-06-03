"use client";
import { ClinicLandingClient } from "../landing-client";
import type { TemplateProps } from "../_shared/types";

export function TemplateFuturista({ clinic, highlights }: TemplateProps) {
  return <ClinicLandingClient clinic={clinic as any} highlights={highlights} />;
}
