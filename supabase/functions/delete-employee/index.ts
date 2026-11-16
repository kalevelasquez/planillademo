import { serve } from "https://deno.land/std@0.177.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Variables de entorno incompletas (URL/Key).')
    }

    // Client init with Auth Header (to check who is calling)
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Falta encabezado de Authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const token = authHeader.replace('Bearer ', '')
    const supabaseUserClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || '', {
      global: { headers: { Authorization: authHeader } }
    })

    // Validate the Calling User
    const { data: userData, error: userError } = await supabaseUserClient.auth.getUser()
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Token inválido o expirado' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const invokerId = userData.user.id

    // Check invoker Profile Role
    const { data: invokerProfile, error: profileError } = await supabaseUserClient
      .from('user_profiles')
      .select('role')
      .eq('id', invokerId)
      .single()

    if (profileError || !invokerProfile || invokerProfile.role.toLowerCase() !== 'admin') {
      return new Response(JSON.stringify({ error: 'Prohibido: Solo un Administrador puede eliminar empleados' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Extract target user ID and action
    const { userId: targetUserId, action = 'soft-delete' } = await req.json()
    if (!targetUserId) {
      return new Response(JSON.stringify({ error: 'Falta el ID de usuario a gestionar (userId)' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (action !== 'soft-delete' && action !== 'restore') {
      return new Response(JSON.stringify({ error: 'Acción inválida. Utilice "soft-delete" o "restore"' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Safety check: Cannot modify yourself
    if (targetUserId === invokerId) {
      return new Response(JSON.stringify({ error: 'Acción rechazada: No puedes modificar restrictivamente tu propia cuenta' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    if (action === 'soft-delete') {
      // 1. Soft Delete: Ban user in auth.users (100 years = 876000h)
      const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, { ban_duration: '876000h' })
      if (banError) throw new Error(`Error baneando usuario en Auth: ${banError.message}`)

      // 2. Update user_profiles status
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .update({ status: 'DELETED', is_active: false })
        .eq('id', targetUserId)
      if (profileError) throw new Error(`Error actualizando perfil a DELETED: ${profileError.message}`)

      return new Response(
        JSON.stringify({ success: true, message: `Usuario ${targetUserId} desactivado exitosamente.` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    } else {
      // 1. Restore: Unban user in auth.users
      const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(targetUserId, { ban_duration: 'none' })
      if (unbanError) throw new Error(`Error restaurando usuario en Auth: ${unbanError.message}`)

      // 2. Update user_profiles status
      const { error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .update({ status: 'ACTIVE', is_active: true })
        .eq('id', targetUserId)
      if (profileError) throw new Error(`Error actualizando perfil a ACTIVE: ${profileError.message}`)

      return new Response(
        JSON.stringify({ success: true, message: `Usuario ${targetUserId} reactivado exitosamente.` }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

  } catch (error: any) {
    console.error('Error in function:', error.message)
    return new Response(
      JSON.stringify({ error: 'Error del servidor: ' + error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})
