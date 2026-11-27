import { createClient } from "@supabase/supabase-js";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

import { Logger } from "../_shared/logger.ts";
import { buildInvitePayload, canAssignRoles, isAdminOrSupervisor, normalizeRoles } from "../_shared/invitePayload.ts";
import { inviteWithInvitation, type AdminLike } from "../_shared/userAdmin.ts";

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

    // `role` es text[]: comparar el array contra un string siempre daba "no autorizado".
    if (!isAdminOrSupervisor(callerProfile.role)) {
      Logger.warn("Intento de invitación por usuario sin permisos de Admin", { action, callerId, role: callerProfile.role });
      return new Response(JSON.stringify({ error: 'Forbidden', message: 'No tienes el nivel suficiente (Admin) para invitar nuevos empleados' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const tenantId = callerProfile.tenant_id;
    const roleName = normalizeRoles(role)[0] ?? '';

    // Anti-escalación: solo un admin puede invitar con el rol admin
    if (!canAssignRoles(callerProfile.role, [roleName])) {
      Logger.warn("Intento de invitar con rol admin sin ser admin", { action, callerId, role: roleName });
      return new Response(JSON.stringify({ error: 'Forbidden', message: 'Solo un administrador puede asignar el rol de Administrador.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2.1 Validar existencia del rol en el tenant
    const { data: roleExists, error: roleCheckError } = await supabaseAdmin
      .from('roles_definition')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('name', roleName)
      .single();

    if (roleCheckError || !roleExists) {
      Logger.warn("Intento de asignar rol inexistente", { action, tenantId, role });
      return new Response(JSON.stringify({ error: 'BadRequest', message: `El rol '${role}' no existe o no está configurado para este tenant.` }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }


    // 4. Crear el usuario (Idempotencia con Delete-then-Invite)
    //    Cada intento escribe una invitación NUEVA en staff_invitations (email + nonce) con service
    //    role ANTES de invitar; el trigger handle_new_user crea el perfil con los datos de ESA
    //    invitación (no de la metadata). roles y tenant salen del servidor, nunca del cliente.
    const built = buildInvitePayload({
      email,
      fullName: full_name,
      roles: [roleName],
      tenantId,
      createdBy: callerId,
    });
    const admin = supabaseAdmin as unknown as AdminLike;

    let inviteData: { user: { id: string } } | null = null;

    try {
      const first = await inviteWithInvitation(admin, built);
      inviteData = { user: first.user };
    } catch (inviteError: any) {
      // Manejar el error HTTP 422: Usuario ya registrado
      if (inviteError?.status === 422 || String(inviteError?.message ?? '').includes('already registered')) {
        Logger.info(`Usuario ya registrado found: ${email}. Analizando estado...`, { action, tenantId });

        const { data: listData, error: listError } = await supabaseAdmin.auth.admin.listUsers();
        if (listError) throw listError;

        const existingUser = listData.users.find((u: { email?: string }) => u.email?.toLowerCase() === built.invitationRow.email);

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

          // Invitación NUEVA (nuevo nonce): la anterior fue limpiada al fallar el primer intento
          const retry = await inviteWithInvitation(admin, built);
          inviteData = { user: retry.user };
        }
      } else {
        throw inviteError;
      }
    }

    if (!inviteData?.user) {
      throw new Error("Error interno al recuperar el ID del nuevo usuario desde la Auth.");
    }

    const newUserId = inviteData.user.id;

    // 5. Sincronización manual (blindaje, igual que manage-users): el trigger ya creó el perfil
    //    base desde la invitación; el upsert con service role lo completa (teléfono) y cubre el
    //    caso de que el trigger haya fallado (nunca bloquea el alta en auth.users).
    const { error: upsertError } = await supabaseAdmin
      .from('user_profiles')
      .upsert({
        id: newUserId,
        email: built.invitationRow.email,
        full_name: built.invitationRow.full_name ?? full_name,
        role: built.invitationRow.roles,
        tenant_id: tenantId,
        phone: phone ? String(phone).replace('-', '') : null,
        is_active: true,
        status: 'PENDING'
      });

    if (upsertError) {
      throw upsertError;
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
