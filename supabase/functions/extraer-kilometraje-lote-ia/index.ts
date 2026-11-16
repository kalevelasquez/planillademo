// Edge Function: Extracción por IA de un LOTE de Viáticos por Kilometraje — mismo patrón que
// extraer-viaticos-lote-ia (Por Ruta) y extraer-fijos-variables-lote-ia, replicado a pedido
// explícito del usuario para que "Importar por lote" también esté disponible en esta pestaña.
// Diferencia real: el tool-schema es el de kilometraje (fecha, KM recorridos, tarifa por KM si
// el documento la trae). A diferencia del formulario individual (KilometrajeModal, donde el
// monto SIEMPRE se calcula como KM × tarifa, nunca se tipea a mano), acá tampoco se extrae
// "monto" como campo propio — se recalcula en el cliente al confirmar, para no romper esa
// invariante con un valor que el documento pueda traer inconsistente con KM×tarifa.
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

const KILOMETRAJE_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    legible: { type: 'boolean', description: 'false si este registro puntual no permite leer los datos con confianza razonable' },
    motivo_no_legible: { type: 'string', description: 'Si legible=false, breve razón' },
    nombre_completo: { type: ['string', 'null'], description: 'Nombre del empleado' },
    codigo_empleado: { type: ['string', 'null'] },
    fecha: { type: ['string', 'null'], description: 'Formato YYYY-MM-DD' },
    km_recorridos: { type: ['number', 'null'] },
    tarifa_km: { type: ['number', 'null'], description: 'Solo si el documento trae explícitamente la tarifa por KM de esa fila; si no aparece, dejar null (se completa con la tarifa configurada para el cargo del empleado)' },
    confianza: { type: 'number', description: 'Confianza de la extracción de ESTE registro puntual, 0 a 100' },
  },
  required: ['legible', 'confianza'],
};

const EXTRACCION_LOTE_TOOL: HerramientaExtraccion = {
  name: 'extraer_datos_kilometraje_lote',
  description: 'Extrae los datos de TODOS los registros de kilometraje visibles en el documento — puede haber uno o varios en la misma imagen o PDF (una hoja de control con varias filas/empleados).',
  parameters: {
    type: 'object',
    properties: {
      registros: { type: 'array', description: 'Un elemento por cada registro/fila detectada, en el orden en que aparecen', items: KILOMETRAJE_ITEM_SCHEMA },
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
      return jsonResponse({ error: 'Alcanzaste el límite diario de extracciones por IA. Ingresá los registros manualmente.' }, 429);
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
      .insert([{ tenant_id: profile.tenant_id, user_id: caller.id, modulo: 'kilometraje_lote' }])
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
        instruccion: 'Extraé TODOS los registros de kilometraje visibles en este documento usando la herramienta extraer_datos_kilometraje_lote. IMPORTANTE: el documento puede tener VARIAS PÁGINAS, y cada página puede tener entre 15 y 30 filas de una tabla de control — el total puede superar las 80-100 filas. Procesá página por página, de arriba hacia abajo en cada una, y extraé CADA fila de CADA página, incluso si la letra es difícil de leer (en ese caso marcá esa fila puntual con legible=false y una confianza baja, pero igual incluila en el arreglo). NO te detengas antes de terminar todas las páginas, NO resumas ni combines filas, y NO omitas ninguna fila por más repetitivo que parezca el documento.',
        base64: imagenBase64,
        mimeType,
        // Un lote puede traer 80-100+ registros si el documento tiene varias páginas con
        // muchas filas cada una — 8192 tokens quedaba corto para ese volumen.
        maxOutputTokens: 16384,
        // Defecto real (2026-09-23, viáticos) — sin esto se hereda el default de
        // OPENAI_TIMEOUT_MS (25s, calibrado para la extracción individual, objeto chico), muy
        // corto para generar un arreglo de 80-100+ filas — el cliente espera hasta 90s (ver
        // TIMEOUT_MS en kilometrajeLoteIaService.ts). 75s deja margen para que la respuesta 504
        // con mensaje claro le gane la carrera al timeout ciego del cliente.
        timeoutMs: 75000,
      });
    } catch (openAiErr: unknown) {
      const errorResponse = responderErrorOpenAI(openAiErr, 'extraer-kilometraje-lote-ia', caller.id, profile.tenant_id);
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
    Logger.error('Error fatal al procesar el lote', { action: 'extraer-kilometraje-lote-ia' }, err);
    return jsonResponse({ error: 'Error del servidor al procesar el documento.' }, 500);
  }
});
