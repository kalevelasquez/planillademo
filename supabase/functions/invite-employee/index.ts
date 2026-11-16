import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

import { Logger } from "../_shared/logger.ts";

Deno.serve(async (req) => {
  const action = "invite-employee";

  // Manejo de Preflight CORS (OPTIONS)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error("Falta cabecera de Authorization");
    }

    const body = await req.json();
    const { email, full_name, phone, role } = body;

    Logger.info(`Iniciando proceso de invitación para: ${email}`, { action, email, role });

    if (!email || !full_name || !phone || !role) {
      throw new Error("Faltan parámetros requeridos en el cuerpo (email, full_name, phone, role)");
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    // Cliente Maecenas (Service Role) para validaciones administrativas
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Cliente del invocador para validar permisos
    const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authHeader }
      }
    });

    // 1. Validar el usuario invocador
    const { data: userData, error: userError } = await supabaseUserClient.auth.getUser();
    if (userError || !userData?.user) {
      Logger.warn("Intento de acceso no autorizado", { action });
      return new Response(JSON.stringify({ error: 'Unauthorized', message: 'Token JWT inválido o sesión expirada' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Extraer tenant_id y validar rol del solicitante
    const callerId = userData.user.id;
    const { data: callerProfile, error: profileError } = await supabaseUserClient
      .from('user_profiles')
      .select('tenant_id, role')
      .eq('id', callerId)
      .single();

    if (profileError || !callerProfile) {
      Logger.error("No se encontró perfil del invocador", { action, callerId }, profileError);
      return new Response(JSON.stringify({ error: 'Forbidden', message: 'No se encontró perfil válido para quien solicita' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (callerProfile.role !== 'admin' && callerProfile.role !== 'supervisor') {
      Logger.warn("Intento de invitación por usuario sin permisos de Admin", { action, callerId, role: callerProfile.role });
      return new Response(JSON.stringify({ error: 'Forbidden', message: 'No tienes el nivel suficiente (Admin) para invitar nuevos empleados' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const tenantId = callerProfile.tenant_id;

    // 2.1 Validar existencia del rol en el tenant
    const { data: roleExists, error: roleCheckError } = await supabaseAdmin
      .from('roles_definition')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', role.toLowerCase().trim())
      .single();

    if (roleCheckError || !roleExists) {
      Logger.warn("Intento de asignar rol inexistente", { action, tenantId, role });
      return new Response(JSON.stringify({ error: 'BadRequest', message: `El rol '${role}' no existe o no está configurado para este tenant.` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }


    // 4. Crear el usuario (Idempotencia con Delete-then-Invite)
    let inviteData, inviteError;

    const inviteRes = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: {
        full_name,
        role,
        tenant_id: tenantId
      }
    });

    inviteData = inviteRes.data;
    inviteError = inviteRes.error;

    if (inviteError) {
      // Manejar el error HTTP 422: Usuario ya registrado
      if (inviteError.status === 422 || inviteError.message.includes('already registered')) {
        Logger.info(`Usuario ya registrado found: ${email}. Analizando estado...`, { action, tenantId });

        const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
        if (listError) throw listError;

        const existingUser = listData.users.find(u => u.email === email);

        if (!existingUser) {
          throw inviteError;
        }

        if (existingUser.email_confirmed_at !== null) {
          Logger.warn("Intento de invitar a usuario ya activo", { action, email, tenantId });
          return new Response(JSON.stringify({ error: 'BadRequest', message: 'El usuario ya se encuentra activo en el sistema.' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          });
        } else {
          Logger.info(`Regenerando invitación para ${email} (Delete-then-Invite)`, { action, tenantId });
          const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(existingUser.id);
          if (deleteError) {
            Logger.error("Error al borrar usuario pendiente", { action, email }, deleteError);
            throw new Error("No se pudo regenerar la invitación, error al eliminar registro bloqueante.");
          }

          const retryInvite = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
            data: {
              full_name,
              role,
              tenant_id: tenantId
            }
          });

          if (retryInvite.error) throw retryInvite.error;
          inviteData = retryInvite.data;
        }
      } else {
        throw inviteError;
      }
    }

    if (!inviteData?.user) {
      throw new Error("Error interno al recuperar el ID del nuevo usuario desde la Auth.");
    }

    const newUserId = inviteData.user.id;

    // 5. Actualizamos el teléfono (el trigger ya creó el perfil base en user_profiles)
    if (phone) {
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update({
          phone: phone.replace('-', '')
        })
        .eq('id', newUserId);

      if (updateError) {
        throw updateError;
      }
    }

    Logger.info(`Invitación completada exitosamente: ${email}`, { action, tenantId, newUserId });

    return new Response(JSON.stringify({
      success: true,
      message: 'Invitación enviada correctamente',
      user_id: newUserId
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    Logger.error("Error crítico en Edge Function", { action }, error);
    return new Response(JSON.stringify({ error: "BadRequest", message: error.message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
