// Contrato del WhatsApp Embedded Signup (autoservicio por clínica).
export const WA_GRAPH_VERSION = "v19.0";

export interface WaEmbeddedExchangeRequest {
  code: string;          // authorization code del popup de Meta (FB.login response_type=code)
  wabaId: string;        // WhatsApp Business Account id (evento WA_EMBEDDED_SIGNUP)
  phoneNumberId: string; // phone number id (evento WA_EMBEDDED_SIGNUP)
}

export interface WaEmbeddedExchangeResponse {
  success: boolean;
  displayName?: string;  // número/nombre verificado para mostrar
  subscribed?: boolean;  // si quedó suscrito el webhook al WABA
  error?: string;
}
