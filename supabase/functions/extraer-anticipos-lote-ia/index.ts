// Edge Function: Extracción por IA de un LOTE de vales de Anticipo (feature agregada en UAT —
// Imporfrut confirmó que en la práctica reciben una sola foto/PDF con el "Control de Viáticos"
// o varios "Vale de Caja Chica" escaneados juntos, no un documento por persona).
// Clon deliberado de extraer-anticipo-ia — misma infraestructura de seguridad/costo (auth+rol,
// rate limit vía planilla_ia_invocaciones, validación de tamaño y magic bytes, tool-use forzado
// sin SDK) — la única diferencia real es el tool-schema: devuelve un ARREGLO `vales`, uno por
// cada vale/registro detectado en el documento, en vez de un objeto plano de un solo registro.
// Cada intento de lote sigue contando como UNA sola invocación contra el rate limit diario,
// aunque adentro traiga muchos vales — es una sola llamada real a la API de OpenAI.
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

const VALE_ITEM_SCHEMA = {
  type: 'object',
  properties: {
    legible: { type: 'boolean', description: 'false si este vale puntual no permite leer los datos con confianza razonable' },
    motivo_no_legible: { type: 'string', description: 'Si legible=false, breve razón' },
    numero_vale: { type: ['string', 'null'] },
    nombre_completo: { type: ['string', 'null'], description: 'Nombre de quien recibió el vale/hizo el viático' },
    fecha: { type: ['string', 'null'], description: 'Formato YYYY-MM-DD' },
    monto: { type: ['number', 'null'] },
    concepto: { type: ['string', 'null'], description: 'Texto del concepto tal como aparece (ej. "Anticipo de salario de la 2da quincena de abril")' },
    confianza: { type: 'number', description: 'Confianza de la extracción de ESTE vale puntual, 0 a 100' },
  },
  required: ['legible', 'confianza'],
};

const EXTRACCION_LOTE_TOOL: HerramientaExtraccion = {
  name: 'extraer_datos_anticipos_lote',
  description: 'Extrae los datos de TODOS los vales de anticipo/caja chica visibles en el documento — puede haber uno o varios en la misma imagen o PDF (varios vales escaneados juntos, o una hoja con varias filas).',
  parameters: {
    type: 'object',
    properties: {
      vales: { type: 'array', description: 'Un elemento por cada vale/registro detectado, en el orden en que aparecen', items: VALE_ITEM_SCHEMA },
    },
    required: ['vales'],
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
      return jsonResponse({ error: 'Alcanzaste el límite diario de extracciones por IA. Ingresá los anticipos manualmente.' }, 429);
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
      .insert([{ tenant_id: profile.tenant_id, user_id: caller.id, modulo: 'anticipo_lote' }])
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
        instruccion: 'Extraé TODOS los vales/registros visibles en este documento usando la herramienta extraer_datos_anticipos_lote — puede haber uno solo o varios (una hoja con muchas filas, o varios vales escaneados juntos). No te saltés ninguno.',
        base64: imagenBase64,
        mimeType,
        // Un lote típico trae 15-30 vales; 1024 tokens (default de un vale individual) no
        // alcanza para un arreglo de ese tamaño.
        maxOutputTokens: 8192,
        // Defecto real (2026-09-23, viáticos): el timeout de OpenAI por defecto (25s,
        // OPENAI_TIMEOUT_MS en _shared/openai.ts) está calibrado para la extracción INDIVIDUAL
        // (objeto chico, 1024 tokens, cliente espera 30s) — para el lote, el cliente espera
        // hasta 90s (ver TIMEOUT_MS en anticiposLoteIaService.ts) porque generar un arreglo de
        // decenas de filas tarda más, y ninguna de las 4 funciones de lote (anticipos/viáticos/
        // kilometraje/fijos-variables) sobreescribía este valor — el servidor cortaba a los 25s
        // igual, mucho antes de que el cliente se diera por vencido. Se deja en 75s (menor a los
        // 90s del cliente, para que la respuesta 504 con mensaje claro le gane la carrera al
        // timeout ciego del cliente).
        timeoutMs: 75000,
      });
    } catch (openAiErr: unknown) {
      const errorResponse = responderErrorOpenAI(openAiErr, 'extraer-anticipos-lote-ia', caller.id, profile.tenant_id);
      const resultado = openAiErr instanceof OpenAIError
        ? (openAiErr.codigo === 'timeout' ? 'timeout' : 'fallo')
        : 'fallo';
      await registrarResultado(resultado);
      return errorResponse;
    }

    const vales = Array.isArray(dataExtraida?.vales) ? dataExtraida.vales : [];
    await registrarResultado('exito', { legible: vales.length > 0, confianza: null });
    return jsonResponse({ success: true, data: { vales } });
  } catch (err: unknown) {
    Logger.error('Error fatal al procesar el lote', { action: 'extraer-anticipos-lote-ia' }, err);
    return jsonResponse({ error: 'Error del servidor al procesar el documento.' }, 500);
  }
});
