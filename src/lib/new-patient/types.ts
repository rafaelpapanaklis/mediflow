export interface OpenNewPatientParams {
  initialName?: string;
  initialPhone?: string;
  initialEmail?: string;
  onCreated?: (patient: { id: string; name: string }) => void;
}

export interface NewPatientContextValue {
  open: (params?: OpenNewPatientParams) => void;
  close: () => void;
}
