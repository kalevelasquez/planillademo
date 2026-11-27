/// <reference types="https://deno.land/x/supabase_functions/edge-runtime.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { buildInvitePayload, canAssignRoles, normalizeRoles } from '../_shared/invitePayload.ts';
import { inviteWithInvitation, revokeUserSessions, type AdminLike } from '../_shared/userAdmin.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Manejo de CORS (Preflight)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // 1. Validar Autenticación Manual (Bypassing Gateway Verification)
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Error: Missing Authorization Header');
      return new Response(JSON.stringify({ error: 'Falta cabecera de autorización' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: caller }, error: authError } = await supabaseClient.auth.getUser(token);

    if (authError || !caller) {
      console.error('Error: Invalid or Expired Token', authError);
      return new Response(JSON.stringify({ error: 'Token inválido o expirado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 2. Validar Autorización (Admin o Supervisor)
    // Usamos el Service Role para leer el perfil del que llama (evita RLS issues)
    const { data: profile, error: profileError } = await supabaseClient
      .from('user_profiles')
      .select('role, tenant_id')
      .eq('id', caller.id)
      .single();

    if (profileError || !profile) {
      console.error('Error: Requester profile not found or query failed:', profileError);
      return new Response(JSON.stringify({ error: 'No se encontró el perfil del solicitante en la base de datos.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Lógica Ultra-Robusta de Roles (Maneja string, array y normalización)
    const rawRoles = Array.isArray(profile.role) ? profile.role : (profile.role ? [profile.role] : []);
    const userRoles = rawRoles
      .map((r: any) => String(r || '').toLowerCase().trim())
      .filter(Boolean);

    console.log(`[AUTH] Usuario ${caller.email} intentando acción. Roles detectados: [${userRoles.join(', ')}]`);

    const isAuthorized = userRoles.includes('admin') || userRoles.includes('supervisor');

    if (!isAuthorized) {
      console.warn(`[UNAUTHORIZED] Intento de acceso denegado para ${caller.email}. Roles insuficientes.`);
      return new Response(JSON.stringify({
        error: 'Permisos insuficientes para administrar usuarios.',
        debug: { detected_roles: userRoles }
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 3. Procesar Acción
    const { action, payload } = await req.json();
    const tenantId = profile.tenant_id;

    console.log(`Ejecutando acción: ${action} para tenant: ${tenantId}`);

    // --- VALIDACIÓN DE ANTI-ESCALACIÓN Y AUTO-PROTECCIÓN ---
    if (action === 'CREATE_USER' || action === 'UPDATE_USER') {
      const targetRoles = normalizeRoles(payload.roles);

      // Solo un Admin puede asignar el rol de 'admin'
      if (!canAssignRoles(userRoles, targetRoles)) {
        return new Response(JSON.stringify({ error: 'No tenés permisos para asignar el rol de Administrador.' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Prohibir que un usuario se cambie sus propios roles (Auto-escalación / Auto-protección)
      if (action === 'UPDATE_USER' && payload.id === caller.id) {
        // Obtenemos los roles actuales del usuario en la BD para comparar si intenta cambiarlos
        if (JSON.stringify([...targetRoles].sort()) !== JSON.stringify([...userRoles].sort())) {
          return new Response(JSON.stringify({ error: 'No podés modificar tus propios roles.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    if (action === 'CREATE_USER') {
      const { full_name, phone } = payload;

      // 1. Armar la invitación (valida email/roles/tenant) — roles y tenant salen del SERVIDOR
      //    (perfil del solicitante), nunca de la metadata del usuario invitado.
      let built;
      try {
        built = buildInvitePayload({
          email: payload.email,
          fullName: full_name,
          roles: payload.roles,
          tenantId,
          createdBy: caller.id,
          redirectTo: `${Deno.env.get('PUBLIC_SITE_URL') ?? 'http://localhost:5173'}/login`,
        });
      } catch (validationError: any) {
        return new Response(JSON.stringify({ error: `Datos de invitación inválidos: ${validationError.message}` }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // 2. staff_invitations (email + nonce) con service role ANTES de invitar, luego
      //    inviteUserByEmail con el nonce y app_metadata {tenant_id, roles}. Si la invitación
      //    falla, la fila se limpia y el error se propaga.
      const { user: invitedUser } = await inviteWithInvitation(supabaseClient as unknown as AdminLike, built);
      const userData = { user: invitedUser };
      const email = built.invitationRow.email;
      const roles = built.invitationRow.roles;

      // 3. Sincronización Manual (Blindaje): Usamos .upsert() por si el trigger falló
      const { error: syncError } = await supabaseClient
        .from('user_profiles')
        .upsert({
          id: userData.user.id,
          email,
          full_name,
          role: roles,
          tenant_id: tenantId,
          phone: phone || null,
          is_active: true,
          status: 'PENDING'
        });

      if (syncError) {
        console.error('Error crítico al sincronizar perfil en CREATE_USER:', syncError);
        throw syncError; // Propagar error para que devuelva status 500
      }

      return new Response(JSON.stringify({ success: true, data: userData.user }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'TOGGLE_ACTIVE') {
      const { id, is_active } = payload;

      // PROTECCIÓN: No permitir que un usuario se desactive a sí mismo (mínimo admin protection)
      if (id === caller.id && !is_active) {
        return new Response(JSON.stringify({ error: 'No puedes desactivar tu propio usuario administrador.' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Actualizar en BD
      const { error: dbError } = await supabaseClient
        .from('user_profiles')
        .update({ is_active })
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (dbError) throw dbError;

      // Baneo en Auth para expulsión inmediata
      const { error: authUpdateError } = await supabaseClient.auth.admin.updateUserById(id, {
        ban_duration: is_active ? 'none' : '876000h',
      });

      if (authUpdateError) throw authUpdateError;

      // SI SE DESACTIVA: invalidar TODAS las sesiones (refresh tokens) del usuario.
      // OJO: auth.admin.signOut(jwt, scope) de supabase-js recibe un JWT, NO un user id; la
      // llamada anterior `signOut(id, 'global')` nunca podia funcionar. Se usa el RPC
      // revoke_user_sessions (migración 0c, solo service_role). El baneo de arriba ya impide
      // renovar el token; esto además corta las sesiones existentes. Un access token ya emitido
      // sigue siendo válido hasta su expiración (≤ 1 h): el kill-switch del front cubre ese tramo.
      if (!is_active) {
        const revoked = await revokeUserSessions(supabaseClient as unknown as AdminLike, id);
        if (!revoked.ok) {
          console.error(`[WARN] No se pudieron revocar las sesiones del usuario ${id}:`, revoked.error);
        } else {
          console.log(`[AUTH] Sesiones revocadas (${revoked.revoked}) para usuario: ${id}`);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'UPDATE_USER') {
      const { id, full_name, phone } = payload;
      const roles = normalizeRoles(payload.roles);

      // user_profiles es la fuente de verdad; el trigger sync_user_claims publica role/tenant en app_metadata
      const { error: dbUpdateError } = await supabaseClient
        .from('user_profiles')
        .update({
          full_name,
          role: payload.roles === undefined ? undefined : roles,
          phone
        })
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (dbUpdateError) throw dbUpdateError;

      // app_metadata (lo que lee el JWT) además del trigger. NUNCA roles en user_metadata:
      // esa metadata la puede reescribir el propio usuario.
      const authUpdate: Record<string, unknown> = {};
      if (roles.length > 0) authUpdate.app_metadata = { tenant_id: tenantId, roles };
      if (full_name) authUpdate.user_metadata = { full_name };
      if (Object.keys(authUpdate).length > 0) {
        const { error: authMetaError } = await supabaseClient.auth.admin.updateUserById(id, authUpdate);
        if (authMetaError) {
          console.error(`[WARN] No se pudo actualizar la metadata de auth del usuario ${id}:`, authMetaError.message);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Acción no reconocida' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('Error fatal en manage-users:', err.message);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
