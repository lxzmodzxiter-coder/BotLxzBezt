import type { DocumentType } from "./domain";
import { shouldRetryApiPeru } from "./policies";

type ApiPeruResponse = {
  success: boolean;
  code: string;
  retryable: boolean;
  message?: string;
  data?: Record<string, unknown>;
  time?: number;
};

export type ApiPeruLookupResult = ApiPeruResponse & {
  data?: Record<string, unknown>;
  durationMs: number;
};

const API_BASE_URL = "https://api.apiperu.dev";

const wait = (milliseconds: number) =>
  new Promise(resolve => setTimeout(resolve, milliseconds));

async function requestOnce(
  documentType: DocumentType,
  document: string,
  token: string,
): Promise<ApiPeruLookupResult> {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${API_BASE_URL}/${documentType}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ [documentType]: document }),
    });
    const payload = (await response.json().catch(() => null)) as ApiPeruResponse | null;
    if (!payload || typeof payload.code !== "string") {
      return {
        success: false,
        code: "provider_invalid_response",
        retryable: response.status >= 500,
        durationMs: Date.now() - startedAt,
      };
    }
    return { ...payload, durationMs: Date.now() - startedAt };
  } catch {
    return {
      success: false,
      code: "upstream_unavailable",
      retryable: true,
      durationMs: Date.now() - startedAt,
    };
  }
}

/** Retries only the provider state explicitly marked as transient. */
export async function lookupApiPeru(
  documentType: DocumentType,
  document: string,
  token: string,
): Promise<ApiPeruLookupResult> {
  const retryDelays = [0, 1000, 3000];
  let lastResult: ApiPeruLookupResult | undefined;
  for (const delay of retryDelays) {
    if (delay) await wait(delay);
    const result = await requestOnce(documentType, document, token);
    lastResult = result;
    if (!shouldRetryApiPeru(result)) return result;
  }
  return lastResult!;
}

export function getAllowedDniFields(data: Record<string, unknown> | undefined) {
  return {
    numero: typeof data?.numero === "string" ? data.numero : undefined,
    nombreCompleto:
      typeof data?.nombre_completo === "string" ? data.nombre_completo : undefined,
    nombres: typeof data?.nombres === "string" ? data.nombres : undefined,
    apellidoPaterno:
      typeof data?.apellido_paterno === "string" ? data.apellido_paterno : undefined,
    apellidoMaterno:
      typeof data?.apellido_materno === "string" ? data.apellido_materno : undefined,
    codigoVerificacion:
      typeof data?.codigo_verificacion === "number" || typeof data?.codigo_verificacion === "string"
        ? String(data.codigo_verificacion)
        : undefined,
  };
}

export function getAllowedRucFields(data: Record<string, unknown> | undefined) {
  return {
    ruc: typeof data?.ruc === "string" ? data.ruc : undefined,
    razonSocial:
      typeof data?.nombre_o_razon_social === "string"
        ? data.nombre_o_razon_social
        : undefined,
    estado: typeof data?.estado === "string" ? data.estado : undefined,
    condicion: typeof data?.condicion === "string" ? data.condicion : undefined,
    departamento: typeof data?.departamento === "string" ? data.departamento : undefined,
    esAgenteRetencion:
      typeof data?.es_agente_de_retencion === "string"
        ? data.es_agente_de_retencion
        : undefined,
    esBuenContribuyente:
      typeof data?.es_buen_contribuyente === "string"
        ? data.es_buen_contribuyente
        : undefined,
  };
}
