// Edge Function: Extracción por IA de vale de Anticipo (IMPL-48 / US-ANT-01, IMPL-50)
// Clon deliberado de extraer-viatico-ia (IMPL-31/32/33) — misma infraestructura de
// seguridad/costo (auth+rol, rate limit vía planilla_ia_invocaciones, validación de tamaño y
// magic bytes, timeout servidor 25s / cliente 30s, tool-use forzado sin SDK), solo cambia el
// tool-schema de extracción (número de vale/empleado/monto en vez de destino/cargo_motivo).
// Migrado de Anthropic a OpenAI (2026-08-15) — Responses API con soporte NATIVO de PDF vía
// input_file (ver _shared/openai.ts y docs/product/planilla-contexto.md). El contrato con el
// cliente NO cambió: recibe { imagen_base64, mime_type } y responde { success, data }.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { Logger } from '../_shared/logger.ts';
import { extraerDatosConOpenAI, OpenAIError, type HerramientaExtraccion } from '../_shared/openai.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TAMANO_MAXIMO_BYTES = 10 * 1024 * 1024; // 10MB, mismo límite del bucket de adjuntos
const LIMITE_DIARIO_POR_USUARIO = 20; // rate limit — cada llamada cuesta dinero real, ajustable

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
  if (mimeType === 'application/pdf') return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF
  if (mimeType === 'image/png') return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return false;
}

const EXTRACCION_TOOL: HerramientaExtraccion = {
  name: 'extraer_datos_anticipo',
  description: 'Extrae los datos de un vale de anticipo fotografiado o escaneado.',
  parameters: {
    type: 'object',
    properties: {
      legible: { type: 'boolean', description: 'false si la imagen/PDF no permite leer los datos con confianza razonable' },
      motivo_no_legible: { type: 'string', description: 'Si legible=false, breve razón (ej. "borroso", "no se distingue el monto")' },
      numero_vale: { type: ['string', 'null'] },
      nombre_completo: { type: ['string', 'null'] },
      codigo_empleado: { type: ['string', 'null'] },
      fecha: { type: ['string', 'null'], description: 'Formato YYYY-MM-DD' },
      monto: { type: ['number', 'null'] },
      confianza: { type: 'number', description: 'Confianza general de la extracción, 0 a 100' },
    },
    required: ['legible', 'confianza'],
  },
};

// Mapea OpenAIError al HTTP status que ya usaba el código con Anthropic (timeout 504, 429→503,
// resto 502) manteniendo los mensajes que el cliente ya conoce.
function responderErrorOpenAI(error: unknown, action: string, userId: string, tenantId: string): Response {
  if (error instanceof OpenAIError) {
    if (error.codigo === 'timeout') {
      Logger.warn('Timeout esperando respuesta de OpenAI', { action, userId, tenantId });
      return jsonResponse({ error: 'No se pudo procesar la imagen a tiempo.' }, 504);
    }
    if (error.codigo === 'saturado') {
      Logger.warn(`OpenAI respondió ${error.status} (saturado/rate-limited)`, { action, userId, tenantId }, { message: error.detalle ?? error.message });
      return jsonResponse({ error: 'El servicio de IA está saturado. Intentá de nuevo en unos minutos, o ingresá manualmente.' }, 503);
    }
    Logger.error(`OpenAI respondió ${error.status ?? 'error'}`, { action, userId, tenantId }, { message: error.detalle ?? error.message });
    return jsonResponse({ error: 'No se pudo procesar la imagen.' }, 502);
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

    // Rate limit — se chequea ANTES de gastar cualquier llamada real. Comparte la misma tabla
    // planilla_ia_invocaciones que Viáticos (genérica, sin dimensión de módulo).
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: invocacionesHoy, error: countError } = await supabaseClient
      .from('planilla_ia_invocaciones')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', caller.id)
      .gte('created_at', desde);
    if (countError) throw countError;
    if ((invocacionesHoy ?? 0) >= LIMITE_DIARIO_POR_USUARIO) {
      return jsonResponse({ error: 'Alcanzaste el límite diario de extracciones por IA. Ingresá el anticipo manualmente.' }, 429);
    }

    // Tamaño estimado (base64 ≈ 4/3 del tamaño real) — rechazar antes de decodificar todo.
    const tamanoEstimado = Math.floor((imagenBase64.length * 3) / 4);
    if (tamanoEstimado > TAMANO_MAXIMO_BYTES) {
      return jsonResponse({ error: 'El archivo supera el máximo de 10MB.' }, 400);
    }

    // Magic bytes — el mime_type declarado por el cliente debe coincidir con el contenido real.
    const prefijo = decodificarPrefijo(imagenBase64, 4);
    if (!magicBytesCoinciden(prefijo, mimeType)) {
      return jsonResponse({ error: 'El contenido del archivo no coincide con el formato declarado.' }, 400);
    }

    // Contabiliza el intento ANTES de llamar a OpenAI (evita bypass del rate limit
    // reintentando tras un rechazo — un intento rechazado igual cuenta).
    const { data: invocacion, error: insertError } = await supabaseClient
      .from('planilla_ia_invocaciones')
      .insert([{ tenant_id: profile.tenant_id, user_id: caller.id, modulo: 'anticipo' }])
      .select('id')
      .single();
    if (insertError) throw insertError;

    // US-OBS-03: registra resultado/legible/confianza/duración del intento ya contabilizado.
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
        tool: EXTRACCION_TOOL,
        instruccion: 'Extraé los datos de este vale de anticipo usando la herramienta extraer_datos_anticipo.',
        base64: imagenBase64,
        mimeType,
      });
    } catch (openAiErr: unknown) {
      const errorResponse = responderErrorOpenAI(openAiErr, 'extraer-anticipo-ia', caller.id, profile.tenant_id);
      const resultado = openAiErr instanceof OpenAIError
        ? (openAiErr.codigo === 'timeout' ? 'timeout' : 'fallo')
        : 'fallo';
      await registrarResultado(resultado);
      return errorResponse;
    }

    await registrarResultado('exito', {
      legible: dataExtraida?.legible ?? null,
      confianza: dataExtraida?.confianza ?? null,
    });
    return jsonResponse({ success: true, data: dataExtraida });
  } catch (err: unknown) {
    Logger.error('Error fatal al procesar la imagen', { action: 'extraer-anticipo-ia' }, err);
    return jsonResponse({ error: 'Error del servidor al procesar la imagen.' }, 500);
  }
});
