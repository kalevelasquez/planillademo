/// <reference types="https://deno.land/x/supabase_functions/edge-runtime.d.ts" />
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

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
    const isAdmin = userRoles.includes('admin');

    console.log(`Ejecutando acción: ${action} para tenant: ${tenantId}`);

    // --- VALIDACIÓN DE ANTI-ESCALACIÓN Y AUTO-PROTECCIÓN ---
    if (action === 'CREATE_USER' || action === 'UPDATE_USER') {
      const targetRoles = Array.isArray(payload.roles) ? payload.roles : [];

      // Solo un Admin puede asignar el rol de 'admin'
      if (targetRoles.includes('admin') && !isAdmin) {
        return new Response(JSON.stringify({ error: 'No tenés permisos para asignar el rol de Administrador.' }), {
          status: 403,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // Prohibir que un usuario se cambie sus propios roles (Auto-escalación / Auto-protección)
      if (action === 'UPDATE_USER' && payload.id === caller.id) {
        // Obtenemos los roles actuales del usuario en la BD para comparar si intenta cambiarlos
        if (JSON.stringify(targetRoles.sort()) !== JSON.stringify(userRoles.sort())) {
          return new Response(JSON.stringify({ error: 'No podés modificar tus propios roles.' }), {
            status: 403,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      }
    }

    if (action === 'CREATE_USER') {
      const { email, full_name, roles, phone } = payload;

      // 1. Invitar al usuario (Corrección de estructura de API v2)
      const { data: userData, error: inviteError } = await supabaseClient.auth.admin.inviteUserByEmail(email, {
        data: {
          full_name,
          needs_password_change: true,
          tenant_id: tenantId,
          roles: roles
        },
        redirectTo: `${Deno.env.get('PUBLIC_SITE_URL') ?? 'http://localhost:5173'}/login`
      });

      if (inviteError) throw inviteError;

      // 2. Sincronización Manual (Blindaje): Usamos .upsert() por si el trigger falló
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

      // SI SE DESACTIVA: Forzar cierre de sesión global para invalidar JWTs actuales
      if (!is_active) {
        const { error: signOutError } = await supabaseClient.auth.admin.signOut(id, 'global');
        if (signOutError) {
          console.error(`[WARN] No se pudo cerrar la sesión global del usuario ${id}:`, signOutError.message);
        } else {
          console.log(`[AUTH] Sesión global cerrada exitosamente para usuario: ${id}`);
        }
      }

      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'UPDATE_USER') {
      const { id, full_name, roles, phone } = payload;

      const { error: dbUpdateError } = await supabaseClient
        .from('user_profiles')
        .update({
          full_name,
          role: roles,
          phone
        })
        .eq('id', id)
        .eq('tenant_id', tenantId);

      if (dbUpdateError) throw dbUpdateError;

      await supabaseClient.auth.admin.updateUserById(id, {
        user_metadata: { roles, full_name }
      });

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
