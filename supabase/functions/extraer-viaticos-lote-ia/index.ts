// Edge Function: Extracción por IA de un LOTE de Viáticos por Ruta (mismo pedido de UAT que
// motivó extraer-anticipos-lote-ia — Imporfrut confirmó que en la práctica reciben un solo
// "Control de Viáticos" con varias filas/empleados, no un formulario por persona).
// Clon deliberado de extraer-anticipos-lote-ia — misma infraestructura de seguridad/costo
// (auth+rol, rate limit vía planilla_ia_invocaciones, validación de tamaño y magic bytes,
// tool-use forzado sin SDK). Diferencia real #1: el tool-schema es el de viático (nombre,
// código, fecha, cargo/motivo, destino, monto), no el de anticipo. Diferencia real #2: a
// diferencia de la extracción INDIVIDUAL de viático (extraer-viatico-ia, que nunca extrae
// monto — el Preparador siempre lo tipea a mano), este tool-schema de lote SÍ incluye `monto`
// (nullable) — decisión explícita para el lote: el control de viáticos que Imporfrut entrega
// trae el monto por fila, y no extraerlo obligaría a tipear a mano decenas de montos, justo lo
// que el lote busca evitar. Si una fila puntual no trae monto legible, queda null y el
// Preparador lo completa a mano en la revisión antes de confirmar (mismo criterio que un
// empleado no encontrado).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { Logger } from '../_shared/logger.ts';
import { extraerDatosConOpenAI, OpenAIError, type HerramientaExtraccion } from '../_shared/openai.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024;
const LIMITE_DIARIO_POR_USUARIO = 20;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function decodificarPrefijo(base64: string, numBytes: number): Uint8Array {
  const charsNecesarios = Math.ceil(numBytes / 3) * 4;
  const binario = atob(base64.slice(0, charsNecesarios));
  return Uint8Array.from(binario.slice(0, numBytes), (c) => c.charCodeAt(0));
}

function magicBytesCoinciden(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === 'application/pdf') return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (mimeType === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

const VIATICO_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    legible: { type: 'boolean', description: 'false si este registro puntual no permite leer los datos con confianza razonable' },
    motivo_no_legible: { type: 'string', description: 'Si legible=false, breve razón' },
    nombre_completo: { type: ['string', 'null'], description: 'Nombre de quien hizo el viático' },
    codigo_empleado: { type: ['string', 'null'] },
    fecha: { type: ['string', 'null'], description: 'Formato YYYY-MM-DD' },
    cargo_motivo: { type: ['string', 'null'], description: 'Puesto o cargo del empleado tal como aparece en el formulario (ej. "Auxiliar", "Motorista") — NO el motivo o encargo del viaje' },
    destino: { type: ['string', 'null'] },
    monto: { type: ['number', 'null'] },
    confianza: { type: 'number', description: 'Confianza de la extracción de ESTE registro puntual, 0 a 100' },
  },
  required: ['legible', 'confianza'],
};

const EXTRACCION_LOTE_TOOL: HerramientaExtraccion = {
  name: 'extraer_datos_viaticos_lote',
  description: 'Extrae los datos de TODOS los registros de viático por ruta visibles en el documento — puede haber uno o varios en la misma imagen o PDF (una hoja de control con varias filas/empleados).',
  parameters: {
    type: 'object',
    properties: {
      registros: { type: 'array', description: 'Un elemento por cada viático/fila detectada, en el orden en que aparecen', items: VIATICO_ITEM_SCHEMA },
    },
    required: ['registros'],
  },
};

function responderErrorOpenAI(error: unknown, action: string, userId: string, tenantId: string): Response {
  if (error instanceof OpenAIError) {
    if (error.codigo === 'timeout') {
      Logger.warn('Timeout esperando respuesta de OpenAI', { action, userId, tenantId });
      return jsonResponse({ error: 'No se pudo procesar el documento a tiempo.' }, 504);
    }
    if (error.codigo === 'saturado') {
      Logger.warn(`OpenAI respondió ${error.status} (saturado/rate-limited)`, { action, userId, tenantId }, { message: error.detalle ?? error.message });
      return jsonResponse({ error: 'El servicio de IA está saturado. Intentá de nuevo en unos minutos, o ingresá manualmente.' }, 503);
    }
    Logger.error(`OpenAI respondió ${error.status ?? 'error'}`, { action, userId, tenantId }, { message: error.detalle ?? error.message });
    return jsonResponse({ error: 'No se pudo procesar el documento.' }, 502);
  }
  throw error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Falta cabecera de autorización' }, 401);

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser(token);
    if (authError || !caller) return jsonResponse({ error: 'Token inválido o expirado' }, 401);

    const { data: profile, error: profileError } = await supabaseClient
      .from('user_profiles')
      .select('role, tenant_id')
      .eq('id', caller.id)
      .single();
    if (profileError || !profile) return jsonResponse({ error: 'No se encontró el perfil del solicitante.' }, 403);

    const rawRoles = Array.isArray(profile.role) ? profile.role : (profile.role ? [profile.role] : []);
    const userRoles = rawRoles.map((r: unknown) => String(r || '').toLowerCase().trim()).filter(Boolean);
    if (!userRoles.includes('admin') && !userRoles.includes('preparador_planilla')) {
      return jsonResponse({ error: 'Permisos insuficientes para extraer datos por IA.' }, 403);
    }

    const { imagen_base64: imagenBase64, mime_type: mimeType } = await req.json();
    if (!imagenBase64 || !mimeType) return jsonResponse({ error: 'Faltan imagen_base64 o mime_type.' }, 400);
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(mimeType)) {
      return jsonResponse({ error: 'Formato no soportado. Usá JPG, PNG o PDF.' }, 400);
    }

    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: invocacionesHoy, error: countError } = await supabaseClient
      .from('planilla_ia_invocaciones')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', caller.id)
      .gte('created_at', desde);
    if (countError) throw countError;
    if ((invocacionesHoy ?? 0) >= LIMITE_DIARIO_POR_USUARIO) {
      return jsonResponse({ error: 'Alcanzaste el límite diario de extracciones por IA. Ingresá los viáticos manualmente.' }, 429);
    }

    const tamanoEstimado = Math.floor((imagenBase64.length * 3) / 4);
    if (tamanoEstimado > TAMANO_MAXIMO_BYTES) {
      return jsonResponse({ error: 'El archivo supera el máximo de 10MB.' }, 400);
    }

    const prefijo = decodificarPrefijo(imagenBase64, 4);
    if (!magicBytesCoinciden(prefijo, mimeType)) {
      return jsonResponse({ error: 'El contenido del archivo no coincide con el formato declarado.' }, 400);
    }

    const { data: invocacion, error: insertError } = await supabaseClient
      .from('planilla_ia_invocaciones')
      .insert([{ tenant_id: profile.tenant_id, user_id: caller.id, modulo: 'viatico_lote' }])
      .select('id')
      .single();
    if (insertError) throw insertError;

    const inicioMs = Date.now();
    const registrarResultado = async (resultado: 'exito' | 'fallo' | 'timeout', extra: Record<string, unknown> = {}) => {
      await supabaseClient
        .from('planilla_ia_invocaciones')
        .update({ resultado, duracion_ms: Date.now() - inicioMs, resuelto_at: new Date().toISOString(), ...extra })
        .eq('id', invocacion.id);
    };

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openaiApiKey) throw new Error('OPENAI_API_KEY no configurada.');

    let dataExtraida: Record<string, unknown>;
    try {
      dataExtraida = await extraerDatosConOpenAI({
        apiKey: openaiApiKey,
        model: Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini',
        tool: EXTRACCION_LOTE_TOOL,
        instruccion: 'Extraé TODOS los registros de viático por ruta visibles en este documento usando la herramienta extraer_datos_viaticos_lote. IMPORTANTE: el documento puede tener VARIAS PÁGINAS, y cada página puede tener entre 15 y 30 filas de una tabla de control — el total puede superar las 80-100 filas. Procesá página por página, de arriba hacia abajo en cada una, y extraé CADA fila de CADA página, incluso si la letra es difícil de leer (en ese caso marcá esa fila puntual con legible=false y una confianza baja, pero igual incluila en el arreglo). NO te detengas antes de terminar todas las páginas, NO resumas ni combines filas, y NO omitas ninguna fila por más repetitivo que parezca el documento.',
        base64: imagenBase64,
        mimeType,
        // Un lote de viáticos puede traer 80-100+ registros si el documento tiene varias
        // páginas con muchas filas cada una — 8192 tokens quedaba corto para ese volumen.
        maxOutputTokens: 16384,
        // Defecto real (2026-09-23) — sin esto se hereda el default de OPENAI_TIMEOUT_MS (25s,
        // calibrado para la extracción individual, objeto chico), muy corto para generar un
        // arreglo de 80-100+ filas — el cliente espera hasta 90s (ver TIMEOUT_MS en
        // viaticosLoteIaService.ts). 75s deja margen para que la respuesta 504 con mensaje
        // claro le gane la carrera al timeout ciego del cliente.
        timeoutMs: 75000,
      });
    } catch (openAiErr: unknown) {
      const errorResponse = responderErrorOpenAI(openAiErr, 'extraer-viaticos-lote-ia', caller.id, profile.tenant_id);
      const resultado = openAiErr instanceof OpenAIError
        ? (openAiErr.codigo === 'timeout' ? 'timeout' : 'fallo')
        : 'fallo';
      await registrarResultado(resultado);
      return errorResponse;
    }

    const registros = Array.isArray(dataExtraida?.registros) ? dataExtraida.registros : [];
    await registrarResultado('exito', { legible: registros.length > 0, confianza: null });
    return jsonResponse({ success: true, data: { registros } });
  } catch (err: unknown) {
    Logger.error('Error fatal al procesar el lote', { action: 'extraer-viaticos-lote-ia' }, err);
    return jsonResponse({ error: 'Error del servidor al procesar el documento.' }, 500);
  }
});
