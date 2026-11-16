// supabase/functions/_shared/openai.ts
// Cliente mínimo de la API de Responses de OpenAI (sin SDK — un solo tipo de request no lo
// justifica, mismo criterio que el resto de las Edge Functions del proyecto). Reemplaza a
// Anthropic (api.anthropic.com/v1/messages) — ver la decisión de migración en
// docs/product/planilla-contexto.md (sección "Asistente de IA — posible mismatch de proveedor").
//
// POR QUÉ RESPONSES API Y NO CHAT COMPLETIONS: la API de Chat Completions de OpenAI NO acepta
// PDF de forma nativa (habría que convertir PDF→imagen antes de mandarlo). La API de Responses
// acepta el PDF como input_file con base64 y extrae texto + imágenes de página automáticamente
// — resuelve el gap de PDF sin dependencias de conversión. Soporta también function calling
// forzado (tool_choice), que es lo que usan las 2 funciones de extracción.
//
// El contrato con el cliente NO cambia: las Edge Functions siguen recibiendo
// `{ imagen_base64, mime_type }` y respondiendo `{ success: true, data }`.
import { Logger } from './logger.ts';

const OPENAI_TIMEOUT_MS = 25000; // menor a los 30s del cliente — el servidor corta primero
const MODELO_POR_DEFECTO = 'gpt-4o-mini';

// Reintentos ante 429 (defecto real, 2026-09-04: "se repite seguido" según el cliente — la
// cuenta de OpenAI se comparte entre Anticipos/Viáticos/Kilometraje por lote + el asistente de
// IA, así que un pico de uso concurrente entre esos consumidores agota el rate limit aunque
// cada import individual haga UNA sola llamada). Un 429 responde casi instantáneo (no consume
// el timeout de generación), así que 2 reintentos con backoff corto son baratos en tiempo —
// se acotan igual a un presupuesto total para no superar los 30s de timeout del cliente.
const MAX_REINTENTOS_429 = 2;
const BACKOFF_MS_POR_INTENTO = [400, 900]; // ms de espera antes del reintento 1 y 2
const PRESUPUESTO_TOTAL_MS = 20000; // no arrancar otro intento si ya no queda margen razonable

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type CodigoErrorOpenAI = 'timeout' | 'saturado' | 'api' | 'sin_tool_call' | 'json_invalido';

export class OpenAIError extends Error {
  readonly codigo: CodigoErrorOpenAI;
  readonly status?: number;
  readonly detalle?: string;

  constructor(codigo: CodigoErrorOpenAI, message: string, status?: number, detalle?: string) {
    super(message);
    this.codigo = codigo;
    this.status = status;
    this.detalle = detalle;
  }
}

export interface OpcionesLlamadaOpenAI {
  apiKey: string;
  model?: string;
  instructions?: string;
  input: unknown[];
  tools?: unknown[];
  toolChoice?: unknown;
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface ResultadoOpenAI {
  output: Array<Record<string, unknown>>;
  outputText: string;
}

// Extrae el texto de los items `message` del output (content con bloques `output_text`). Se usa
// como fuente primaria porque es la representación canónica del texto del modelo en la
// Responses API — el campo de conveniencia `output_text` del JSON no siempre viene poblado.
function extraerTextoDeOutput(output: Array<Record<string, unknown>>): string {
  const textos: string[] = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const bloque of content) {
      const b = bloque as { type?: unknown; text?: unknown };
      if (b.type === 'output_text' && typeof b.text === 'string' && b.text) {
        textos.push(b.text);
      }
    }
  }
  return textos.join('\n');
}

/** Un solo intento contra `POST /v1/responses` — sin reintentos, eso lo maneja `llamarOpenAI`. */
async function intentarLlamadaOpenAI(opts: OpcionesLlamadaOpenAI): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? OPENAI_TIMEOUT_MS);
  try {
    return await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model ?? MODELO_POR_DEFECTO,
        instructions: opts.instructions,
        input: opts.input,
        tools: opts.tools,
        tool_choice: opts.toolChoice,
        max_output_tokens: opts.maxOutputTokens,
      }),
      signal: controller.signal,
    });
  } catch (fetchErr: unknown) {
    if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
      throw new OpenAIError('timeout', 'Timeout esperando respuesta de OpenAI');
    }
    throw new OpenAIError('api', 'Error de red al llamar a OpenAI', undefined, fetchErr instanceof Error ? fetchErr.message : '');
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Llamada a `POST /v1/responses` con reintento corto ante 429 (ver comentario de
 * `MAX_REINTENTOS_429`). Lanza `OpenAIError` con un `codigo` clasificado para que cada Edge
 * Function mapee al HTTP status que ya usaba con Anthropic: timeout → 504, saturado (429,
 * tras agotar los reintentos) → 503, api (cualquier otro no-2xx o error de red) → 502.
 */
export async function llamarOpenAI(opts: OpcionesLlamadaOpenAI): Promise<ResultadoOpenAI> {
  const inicio = Date.now();
  let res: Response;

  for (let intento = 0; ; intento++) {
    res = await intentarLlamadaOpenAI(opts);

    if (res.status !== 429) break;

    // Cuerpo real del 429 (`error.type`/`error.code` de OpenAI) — distingue un rate-limit
    // transitorio (`rate_limit_exceeded`, ayuda reintentar) de una cuenta sin cupo/crédito
    // (`insufficient_quota`, reintentar NUNCA ayuda). Sin esto solo se veía el status 429 en los
    // logs, indistinguible entre ambos casos (defecto real, 2026-09-04).
    const textoError429 = await res.text();

    const quedanReintentos = intento < MAX_REINTENTOS_429;
    const transcurrido = Date.now() - inicio;
    const alcanzaElPresupuesto = transcurrido < PRESUPUESTO_TOTAL_MS;
    if (!quedanReintentos || !alcanzaElPresupuesto) {
      throw new OpenAIError(
        'saturado',
        `OpenAI respondió ${res.status} (rate-limited) tras ${intento + 1} intento(s)`,
        res.status,
        textoError429.slice(0, 500)
      );
    }

    Logger.warn(
      `OpenAI respondió 429 (rate-limited) — reintentando (intento ${intento + 2}/${MAX_REINTENTOS_429 + 1})`,
      { action: 'openai-shared' },
      { message: textoError429.slice(0, 500) }
    );
    await esperar(BACKOFF_MS_POR_INTENTO[intento] ?? BACKOFF_MS_POR_INTENTO[BACKOFF_MS_POR_INTENTO.length - 1]);
  }

  if (!res.ok) {
    const textoError = await res.text();
    throw new OpenAIError('api', `OpenAI respondió ${res.status}`, res.status, textoError.slice(0, 500));
  }

  const data = await res.json() as { output?: unknown[]; output_text?: string };
  const output = (data.output ?? []) as Array<Record<string, unknown>>;
  return { output, outputText: extraerTextoDeOutput(output) || data.output_text || '' };
}

/**
 * Arma el bloque de contenido según el tipo de archivo:
 * - PDF → input_file con file_data base64 (soporte NATIVO de la Responses API, sin conversión).
 *   `detail: 'high'` preserva la letra manuscrita de formularios físicos — el default 'auto'
 *   usaría 'low' en gpt-4o-mini. Costo mayor en tokens, compensado por el rate limit diario.
 * - JPG/PNG → input_image con data URL.
 */
export function construirContenidoArchivo(base64: string, mimeType: string): Array<Record<string, unknown>> {
  if (mimeType === 'application/pdf') {
    return [{
      type: 'input_file',
      filename: 'documento.pdf',
      file_data: `data:application/pdf;base64,${base64}`,
      detail: 'high',
    }];
  }
  return [{ type: 'input_image', image_url: `data:${mimeType};base64,${base64}` }];
}

export interface HerramientaExtraccion {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface OpcionesExtraccion {
  apiKey: string;
  model?: string;
  tool: HerramientaExtraccion;
  instruccion: string;
  base64: string;
  mimeType: string;
  timeoutMs?: number;
  /** Default 1024 — insuficiente para herramientas que devuelven un arreglo de varios
   * registros (ej. extracción por lote de un documento con muchas filas). */
  maxOutputTokens?: number;
}

/**
 * Extracción de un solo turno con tool_choice FORZADO (mismo contrato que el tool_choice
 * obligatorio de Anthropic que reemplaza): el modelo está obligado a responder con la
 * herramienta y su `arguments` es el JSON estructurado que el cliente espera.
 */
export async function extraerDatosConOpenAI(opts: OpcionesExtraccion): Promise<Record<string, unknown>> {
  const { output } = await llamarOpenAI({
    apiKey: opts.apiKey,
    model: opts.model,
    input: [{
      role: 'user',
      content: [
        ...construirContenidoArchivo(opts.base64, opts.mimeType),
        { type: 'input_text', text: opts.instruccion },
      ],
    }],
    tools: [{
      type: 'function',
      name: opts.tool.name,
      description: opts.tool.description,
      parameters: opts.tool.parameters,
    }],
    toolChoice: { type: 'function', name: opts.tool.name },
    maxOutputTokens: opts.maxOutputTokens ?? 1024,
    timeoutMs: opts.timeoutMs,
  });

  const toolCall = output.find((item) => item.type === 'function_call');
  if (!toolCall) {
    Logger.error('Respuesta de OpenAI sin function_call', { action: 'openai-shared' }, {});
    throw new OpenAIError('sin_tool_call', 'Respuesta de OpenAI sin function_call');
  }

  try {
    return JSON.parse(String(toolCall.arguments ?? '')) as Record<string, unknown>;
  } catch {
    throw new OpenAIError('json_invalido', 'Los arguments del function_call no son JSON válido');
  }
}
