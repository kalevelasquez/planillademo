// Edge Function: Asistente de IA de Planilla (IMPL-115 / US-IA-02, US-IA-03)
// Orquesta un loop de tool-use sobre el catálogo de solo lectura de US-IA-01
// (20260830090000_create_ia_herramientas_consulta.sql) — nunca genera SQL libre ni tiene
// acceso directo a la base de datos (CA4 de US-IA-02).
//
// Migrado de Anthropic a OpenAI (2026-08-15) — ver docs/product/planilla-contexto.md.
// Usa la API de Responses de OpenAI con function calling de múltiples turnos (el equivalente
// del loop tool_use/tool_result de Anthropic): el output de cada ronda se reenvía como input
// de la siguiente junto con los function_call_output. Reutiliza el cliente compartido
// _shared/openai.ts (mismo contrato de errores que las 2 funciones de extracción).
//
// GATE DE CONFIGURACIÓN (US-IA-02): mientras no estén seteadas OPENAI_API_KEY y
// ASISTENTE_IA_HABILITADO, la función responde con un error claro y NO registra
// auditoría/rate-limit — no hubo ninguna consulta real. Activar el asistente es solo setear
// esas 2 env vars, sin tocar código ni la UI.
//
// DOS CLIENTES DE SUPABASE, A PROPÓSITO (US-IA-01 CA1/CA4): `supabaseService` (service role)
// solo para verificar el token y para bookkeeping (rate-limit, auditoría) — NUNCA para
// ejecutar las herramientas de consulta. `supabaseUser` (con el JWT del caller) es el que
// ejecuta las 13 RPCs `ia_*`, para que la RLS de cada tabla aplique exactamente igual que si
// el usuario estuviera navegando la UI — un Preparador nunca recibe, vía el asistente, un
// dato que no vería en pantalla.
//
// PERSISTENCIA DEL HISTORIAL (asistente_ia_sesiones/asistente_ia_mensajes): el historial ya no
// lo manda el cliente en cada request — se lee/escribe con `supabaseUser` desde una sesión
// única y continua por usuario (una sola fuente de verdad, sobrevive a recargar la página).
// El cliente solo manda `mensaje`.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { Logger } from '../_shared/logger.ts';
import { llamarOpenAI, OpenAIError } from '../_shared/openai.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const LIMITE_DIARIO_POR_USUARIO = 50; // conversacional — más llamadas por interacción que una extracción puntual
const MAX_RONDAS_TOOL_USE = 4; // tope duro contra un loop de herramientas que nunca converge

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Catálogo de herramientas (US-IA-01 CA2 + 2 de resolución de referencias + 5 agregadas de
// 20260907280000, ver migraciones). `rpc` es el nombre exacto de la función Postgres;
// `params` mapea el nombre de propiedad del `parameters` (JSON Schema) al nombre del
// parámetro posicional de la RPC.
const HERRAMIENTAS = [
  {
    name: 'buscar_empleado',
    rpc: 'ia_buscar_empleado',
    params: { busqueda: 'p_busqueda' },
    description: 'Busca empleados por nombre completo o código. Usar SIEMPRE primero cuando la pregunta menciona un empleado por nombre, para resolver su ID antes de llamar otra herramienta.',
    parameters: {
      type: 'object',
      properties: { busqueda: { type: 'string', description: 'Nombre completo o parcial, o código del empleado' } },
      required: ['busqueda'],
    },
  },
  {
    name: 'consultar_quincena_actual',
    rpc: 'ia_consultar_quincena_actual',
    params: {},
    description: 'Devuelve el estado de la quincena activa actual (la más reciente que no esté Aprobada y Cerrada). Usar cuando la pregunta se refiere a "la quincena actual" o no menciona una quincena específica.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_estado_quincena',
    rpc: 'ia_consultar_estado_quincena',
    params: { quincena_id: 'p_quincena_id' },
    description: 'Devuelve el estado, checklist de módulos y datos de auditoría (enviada/aprobada/rechazada) de una quincena específica por su ID.',
    parameters: {
      type: 'object',
      properties: { quincena_id: { type: 'string', description: 'UUID de la quincena' } },
      required: ['quincena_id'],
    },
  },
  {
    name: 'consultar_estado_vacaciones',
    rpc: 'ia_consultar_estado_vacaciones',
    params: { empleado_id: 'p_empleado_id' },
    description: 'Devuelve los períodos de vacaciones ya registrados de un empleado y los días gozados en el año actual. NO calcula días pendientes por ley (el sistema no lleva ese cálculo todavía).',
    parameters: {
      type: 'object',
      properties: { empleado_id: { type: 'string', description: 'UUID del empleado (resolver primero con buscar_empleado si viene un nombre)' } },
      required: ['empleado_id'],
    },
  },
  {
    name: 'consultar_descuentos_activos',
    rpc: 'ia_consultar_descuentos_activos',
    params: { empleado_id: 'p_empleado_id' },
    description: 'Devuelve los descuentos activos o pausados de un empleado con su saldo pendiente.',
    parameters: {
      type: 'object',
      properties: { empleado_id: { type: 'string', description: 'UUID del empleado' } },
      required: ['empleado_id'],
    },
  },
  {
    name: 'consultar_anticipos_activos',
    rpc: 'ia_consultar_anticipos_activos',
    params: { empleado_id: 'p_empleado_id' },
    description: 'Devuelve los anticipos activos de un empleado con su saldo pendiente.',
    parameters: {
      type: 'object',
      properties: { empleado_id: { type: 'string', description: 'UUID del empleado' } },
      required: ['empleado_id'],
    },
  },
  {
    name: 'consultar_incapacidades_periodo',
    rpc: 'ia_consultar_incapacidades_periodo',
    params: { empleado_id: 'p_empleado_id', quincena_id: 'p_quincena_id' },
    description: 'Devuelve las incapacidades registradas de un empleado. Si se da quincena_id, limita a esa quincena; si no, devuelve todo el historial.',
    parameters: {
      type: 'object',
      properties: {
        empleado_id: { type: 'string', description: 'UUID del empleado' },
        quincena_id: { type: ['string', 'null'], description: 'UUID de la quincena, opcional' },
      },
      required: ['empleado_id'],
    },
  },
  {
    name: 'consultar_resumen_financiero_quincena',
    rpc: 'ia_consultar_resumen_financiero_quincena',
    params: { quincena_id: 'p_quincena_id' },
    description: 'Devuelve el resumen financiero agregado (sueldos, deducciones, neto total) de una quincena, si ya tiene el Cálculo de Planilla corrido.',
    parameters: {
      type: 'object',
      properties: { quincena_id: { type: 'string', description: 'UUID de la quincena' } },
      required: ['quincena_id'],
    },
  },
  // --- Herramientas agregadas (20260907280000) — responden preguntas tipo "¿cuántos...?" ---
  {
    name: 'consultar_resumen_empleados',
    rpc: 'ia_consultar_resumen_empleados',
    params: {},
    description: 'Devuelve el total de empleados del tenant (activos, inactivos) y el conteo por departamento. Usar SIEMPRE para preguntas que piden contar empleados o saber cuántos hay, con o sin desglose por departamento.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_anticipos_descuentos_pendientes',
    rpc: 'ia_consultar_anticipos_descuentos_pendientes',
    params: {},
    description: 'Devuelve el saldo pendiente total y el detalle de anticipos y descuentos activos (por empleado). Usar para preguntas sobre cuánto se debe en anticipos o descuentos.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'consultar_horas_extras_quincena',
    rpc: 'ia_consultar_horas_extras_quincena',
    params: { quincena_id: 'p_quincena_id' },
    description: 'Devuelve el total de horas (HED/HEN/nocturnidad/feriado) y monto de horas extras registradas en una quincena. Si no se da quincena_id, usa la quincena activa actual.',
    parameters: {
      type: 'object',
      properties: { quincena_id: { type: ['string', 'null'], description: 'UUID de la quincena, opcional (default: la activa)' } },
      required: [],
    },
  },
  {
    name: 'consultar_proximos_feriados',
    rpc: 'ia_consultar_proximos_feriados',
    params: { limite: 'p_limite' },
    description: 'Devuelve los próximos feriados del calendario del tenant (desde hoy). Usar para preguntas sobre feriados próximos o días festivos.',
    parameters: {
      type: 'object',
      properties: { limite: { type: 'number', description: 'Cantidad de feriados a devolver (default 5)' } },
      required: [],
    },
  },
  {
    name: 'consultar_incapacidades_quincena',
    rpc: 'ia_consultar_incapacidades_quincena',
    params: { quincena_id: 'p_quincena_id' },
    description: 'Devuelve el total de incapacidades y días registrados en una quincena, con desglose por tipo. Si no se da quincena_id, usa la quincena activa actual.',
    parameters: {
      type: 'object',
      properties: { quincena_id: { type: ['string', 'null'], description: 'UUID de la quincena, opcional (default: la activa)' } },
      required: [],
    },
  },
];

const SYSTEM_PROMPT = `Sos el asistente de IA del módulo de Planilla de Imporfrut. Respondés preguntas sobre datos reales de nómina usando EXCLUSIVAMENTE las herramientas de consulta disponibles — nunca inventás datos ni generás SQL.

Reglas obligatorias:
1. Si ninguna herramienta puede responder la pregunta, decilo explícitamente ("No tengo una herramienta para consultar eso todavía") en vez de inventar una respuesta.
2. Nunca respondas con cifras, conteos o totales (empleados, horas, saldos, días, montos) sin haber llamado una herramienta que las devuelva. Si la pregunta pide un número y no llamaste ninguna herramienta, decilo explícitamente en vez de dar un valor.
3. Cuando muestres un dato, citá siempre de qué quincena y/o registro viene (ej. "según la quincena 2da de Enero 2026...").
4. Si una pregunta menciona un empleado por nombre, usá buscar_empleado primero para resolver su ID. Si hay varios resultados, pedí que aclare cuál.
5. Respondé en español, de forma breve y concreta.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseService = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ error: 'Falta cabecera de autorización' }, 401);
    const token = authHeader.replace('Bearer ', '');

    const { data: { user: caller }, error: authError } = await supabaseService.auth.getUser(token);
    if (authError || !caller) return jsonResponse({ error: 'Token inválido o expirado' }, 401);

    const { data: profile, error: profileError } = await supabaseService
      .from('user_profiles')
      .select('role, tenant_id')
      .eq('id', caller.id)
      .single();
    if (profileError || !profile) return jsonResponse({ error: 'No se encontró el perfil del solicitante.' }, 403);

    const rawRoles = Array.isArray(profile.role) ? profile.role : (profile.role ? [profile.role] : []);
    const userRoles = rawRoles.map((r: unknown) => String(r || '').toLowerCase().trim()).filter(Boolean);
    if (!userRoles.includes('admin') && !userRoles.includes('preparador_planilla') && !userRoles.includes('aprobador_planilla')) {
      return jsonResponse({ error: 'Permisos insuficientes para usar el asistente de IA.' }, 403);
    }

    // Gate de configuración — ver comentario de cabecera. Ninguna consulta real ocurrió, así
    // que NO se toca audit_log ni planilla_ia_invocaciones. Responde 200 (no un código de
    // error) a propósito: `supabase-js` no garantiza que el cliente pueda leer el body en
    // respuestas no-2xx (`functions.invoke` las trata como FunctionsHttpError) — este es un
    // estado esperado durante el rollout, no una falla, y la UI necesita poder distinguirlo
    // de forma confiable vía `data.no_configurado`.
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const habilitado = Deno.env.get('ASISTENTE_IA_HABILITADO') === 'true';
    if (!openaiApiKey || !habilitado) {
      return jsonResponse({ no_configurado: true, error: 'El asistente de IA todavía no está configurado.' }, 200);
    }

    const { mensaje } = await req.json();
    if (!mensaje || typeof mensaje !== 'string') return jsonResponse({ error: 'Falta el mensaje.' }, 400);

    // Rate limit — CA2 de US-IA-03, mismo patrón que extraer-anticipo-ia/extraer-viatico-ia.
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: invocacionesHoy, error: countError } = await supabaseService
      .from('planilla_ia_invocaciones')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', caller.id)
      .eq('modulo', 'asistente_ia')
      .gte('created_at', desde);
    if (countError) throw countError;
    if ((invocacionesHoy ?? 0) >= LIMITE_DIARIO_POR_USUARIO) {
      return jsonResponse({ error: 'Alcanzaste el límite diario de consultas al asistente de IA.' }, 429);
    }

    const { data: invocacion, error: insertError } = await supabaseService
      .from('planilla_ia_invocaciones')
      .insert([{ tenant_id: profile.tenant_id, user_id: caller.id, modulo: 'asistente_ia' }])
      .select('id')
      .single();
    if (insertError) throw insertError;

    const inicioMs = Date.now();
    const registrarResultado = async (resultado: 'exito' | 'fallo' | 'timeout', extra: Record<string, unknown> = {}) => {
      await supabaseService
        .from('planilla_ia_invocaciones')
        .update({ resultado, duracion_ms: Date.now() - inicioMs, resuelto_at: new Date().toISOString(), ...extra })
        .eq('id', invocacion.id);
    };

    // Cliente con el JWT del caller — las 13 RPCs ia_* corren con SUS privilegios, la RLS de
    // cada tabla decide qué ve (US-IA-01 CA1/CA4).
    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Sesión única y continua por usuario (persistencia del historial — antes solo vivía en
    // el estado de React del navegador y se perdía al recargar la página). El historial se
    // lee siempre desde acá, nunca de lo que mande el cliente — una sola fuente de verdad.
    const { data: sesionExistente, error: sesionSelectError } = await supabaseUser
      .from('asistente_ia_sesiones')
      .select('id')
      .maybeSingle();
    if (sesionSelectError) throw sesionSelectError;

    let sesionId: string;
    if (sesionExistente) {
      sesionId = sesionExistente.id;
    } else {
      const { data: nuevaSesion, error: sesionInsertError } = await supabaseUser
        .from('asistente_ia_sesiones')
        .insert([{ tenant_id: profile.tenant_id, user_id: caller.id }])
        .select('id')
        .single();
      if (sesionInsertError) throw sesionInsertError;
      sesionId = nuevaSesion.id;
    }

    const { data: mensajesPrevios, error: historialError } = await supabaseUser
      .from('asistente_ia_mensajes')
      .select('role, content')
      .eq('sesion_id', sesionId)
      .order('created_at', { ascending: false })
      .limit(20); // tope de contexto
    if (historialError) throw historialError;
    const historialPrevio = (mensajesPrevios ?? []).reverse();

    const openaiTools = HERRAMIENTAS.map((h) => ({
      type: 'function',
      name: h.name,
      description: h.description,
      parameters: h.parameters,
    }));
    const input: unknown[] = [
      ...historialPrevio.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
      { role: 'user', content: mensaje },
    ];
    const herramientasUsadas: Array<{ nombre: string; input: unknown }> = [];

    let respuestaFinal = '';
    for (let ronda = 0; ronda < MAX_RONDAS_TOOL_USE; ronda++) {
      let resultado: Awaited<ReturnType<typeof llamarOpenAI>>;
      try {
        resultado = await llamarOpenAI({
          apiKey: openaiApiKey,
          model: Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini',
          instructions: SYSTEM_PROMPT,
          input,
          tools: openaiTools,
          maxOutputTokens: 1024,
        });
      } catch (openAiErr: unknown) {
        if (openAiErr instanceof OpenAIError && openAiErr.codigo === 'timeout') {
          await registrarResultado('timeout');
          Logger.warn('Timeout esperando respuesta de OpenAI', { action: 'asistente-ia', userId: caller.id, tenantId: profile.tenant_id, ronda });
          return jsonResponse({ error: 'El asistente no pudo responder a tiempo. Intentá de nuevo.' }, 504);
        }
        if (openAiErr instanceof OpenAIError && openAiErr.codigo === 'saturado') {
          await registrarResultado('fallo');
          Logger.warn(`OpenAI respondió ${openAiErr.status} (saturado/rate-limited)`, { action: 'asistente-ia', userId: caller.id, tenantId: profile.tenant_id }, { message: openAiErr.detalle ?? openAiErr.message });
          return jsonResponse({ error: 'El servicio de IA está saturado. Intentá de nuevo en unos minutos.' }, 503);
        }
        if (openAiErr instanceof OpenAIError) {
          await registrarResultado('fallo');
          Logger.error(`OpenAI respondió ${openAiErr.status ?? 'error'}`, { action: 'asistente-ia', userId: caller.id, tenantId: profile.tenant_id }, { message: openAiErr.detalle ?? openAiErr.message });
          return jsonResponse({ error: 'No se pudo procesar la consulta.' }, 502);
        }
        throw openAiErr;
      }

      const functionCalls = resultado.output.filter((item) => item.type === 'function_call');

      if (functionCalls.length === 0) {
        respuestaFinal = resultado.outputText;
        break;
      }

      // Preservar el output del modelo (los function_call) para el siguiente turno, igual que
      // el patrón de la guía de function calling de la Responses API.
      input.push(...resultado.output);

      for (const call of functionCalls) {
        const nombre = String(call.name ?? '');
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(String(call.arguments ?? '{}')) as Record<string, unknown>;
        } catch {
          Logger.warn('function_call con arguments que no son JSON válido', { action: 'asistente-ia', userId: caller.id, tenantId: profile.tenant_id, herramienta: nombre });
        }
        herramientasUsadas.push({ nombre, input: args });

        const herramienta = HERRAMIENTAS.find((h) => h.name === nombre);
        let salida: string;
        if (!herramienta) {
          salida = 'Herramienta desconocida.';
        } else {
          try {
            const rpcParams: Record<string, unknown> = {};
            for (const [inputKey, rpcParam] of Object.entries(herramienta.params)) {
              rpcParams[rpcParam] = args[inputKey] ?? null;
            }
            const { data: rpcData, error: rpcError } = await supabaseUser.rpc(herramienta.rpc, rpcParams);
            if (rpcError) throw rpcError;
            salida = JSON.stringify(rpcData);
          } catch (toolErr: unknown) {
            Logger.error(`Error ejecutando herramienta ${nombre}`, { action: 'asistente-ia', userId: caller.id, tenantId: profile.tenant_id }, toolErr);
            salida = JSON.stringify({ error: 'Error al consultar los datos.' });
          }
        }
        input.push({ type: 'function_call_output', call_id: String(call.call_id ?? ''), output: salida });
      }
    }

    if (!respuestaFinal) {
      respuestaFinal = 'No pude completar la consulta con las herramientas disponibles — probá reformular la pregunta.';
    }

    // Persiste el turno real (no bloquea la respuesta al usuario si falla — la conversación
    // ya se resolvió, perder este guardado es preferible a perder la respuesta).
    const { error: mensajesInsertError } = await supabaseUser
      .from('asistente_ia_mensajes')
      .insert([
        { tenant_id: profile.tenant_id, sesion_id: sesionId, role: 'user', content: mensaje },
        { tenant_id: profile.tenant_id, sesion_id: sesionId, role: 'assistant', content: respuestaFinal, herramientas_usadas: herramientasUsadas },
      ]);
    if (mensajesInsertError) {
      Logger.error('Error al guardar mensajes del asistente de IA', { action: 'asistente-ia', userId: caller.id, tenantId: profile.tenant_id }, mensajesInsertError);
    }

    // US-IA-03 CA1: se audita la pregunta + qué herramientas/datos consultó, reutilizando
    // log_custom_audit (US-AUD-06). SECURITY DEFINER, corre con el service client sin problema.
    await supabaseService.rpc('log_custom_audit', {
      p_action: 'CONSULTA_IA',
      p_resource_type: 'asistente_ia',
      p_resource_id: null,
      p_details: { pregunta: mensaje, herramientas_usadas: herramientasUsadas },
    });

    await registrarResultado('exito');
    return jsonResponse({ respuesta: respuestaFinal, herramientas_usadas: herramientasUsadas });
  } catch (err: unknown) {
    Logger.error('Error fatal en el asistente de IA', { action: 'asistente-ia' }, err);
    return jsonResponse({ error: 'Error del servidor al procesar la consulta.' }, 500);
  }
});
