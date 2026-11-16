// Edge Function: Canal de email de las notificaciones de quincena (IMPL-127 / US-CIE-04 CA1/CA3)
// Complementa al canal push ya existente (20260907170000_create_notificaciones.sql +
// 20260907370000_agregar_ejecutor_a_notificaciones_quincena.sql) — mismos 3 eventos, mismos
// destinatarios (CA2), mismo contenido (CA4: quincena, evento, quién lo ejecutó, motivo si
// aplica). Se llama desde el frontend justo después de que el RPC de transición ya tuvo éxito
// (quincenasService.ts) — nunca bloquea ni revierte la transición si el email falla, es un
// canal adicional, no la fuente de verdad del estado de la quincena.
//
// GATE DE CONFIGURACIÓN (mismo patrón que asistente-ia): mientras no esté seteada
// RESEND_API_KEY, la función responde 200 con `no_configurado: true` — no es una falla, es un
// estado esperado hasta que se active el secret en el proyecto de Supabase.
//
// DOS CLIENTES DE SUPABASE, A PROPÓSITO (mismo criterio que asistente-ia): `supabaseService`
// (service role) para verificar el token, leer el perfil del caller y resolver destinatarios —
// necesita ver `user_profiles`/`quincenas` de otros usuarios del tenant para armar el fan-out
// de Aprobadores, cosa que la RLS del caller no permitiría.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { Logger } from '../_shared/logger.ts';
import { enviarEmailATodos } from '../_shared/resend.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

type TipoEvento = 'enviada_aprobacion' | 'aprobada_cerrada' | 'rechazada';

const TITULOS: Record<TipoEvento, string> = {
  enviada_aprobacion: 'Quincena enviada a aprobación',
  aprobada_cerrada: 'Quincena aprobada y cerrada',
  rechazada: 'Quincena rechazada',
};

function construirMensaje(tipo: TipoEvento, etiqueta: string, ejecutorNombre: string, motivo?: string): string {
  if (tipo === 'enviada_aprobacion') {
    return `La quincena "${etiqueta}" está lista para tu revisión. Enviada por ${ejecutorNombre}.`;
  }
  if (tipo === 'aprobada_cerrada') {
    return `La quincena "${etiqueta}" fue aprobada y cerrada por ${ejecutorNombre}.`;
  }
  return `La quincena "${etiqueta}" fue rechazada por ${ejecutorNombre}. Motivo: ${motivo ?? ''}`;
}

function construirHtml(titulo: string, mensaje: string, link: string): string {
  return `<!DOCTYPE html>
<html lang="es">
<body style="margin:0;padding:0;background-color:#f4f5f7;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f5f7;padding:32px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background-color:#1f2937;padding:20px 32px;">
              <span style="color:#ffffff;font-size:16px;font-weight:bold;">Imporfrut · Planilla</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px;font-size:18px;color:#111827;">${titulo}</h1>
              <p style="margin:0 0 24px;font-size:14px;line-height:1.6;color:#374151;">${mensaje}</p>
              <a href="${link}" style="display:inline-block;background-color:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:bold;">Ver quincena</a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:11px;color:#9ca3af;">Este es un correo automático del sistema de Planilla de Imporfrut.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

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

    const { data: perfil, error: perfilError } = await supabaseService
      .from('user_profiles')
      .select('tenant_id, full_name')
      .eq('id', caller.id)
      .single();
    if (perfilError || !perfil) return jsonResponse({ error: 'No se encontró el perfil del solicitante.' }, 403);

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      return jsonResponse({ no_configurado: true, error: 'El canal de email todavía no está configurado.' }, 200);
    }
    const fromAddress = Deno.env.get('RESEND_FROM_EMAIL') ?? 'hernan.osorio@teknergy.com';
    const siteUrl = Deno.env.get('PUBLIC_SITE_URL') ?? 'http://localhost:5173';

    const body = await req.json();
    const tipo = body?.tipo as TipoEvento;
    const quincenaId = body?.quincenaId as string;
    const motivo = body?.motivo as string | undefined;
    if (!tipo || !TITULOS[tipo] || !quincenaId) {
      return jsonResponse({ error: 'Faltan parámetros (tipo, quincenaId).' }, 400);
    }

    const { data: quincena, error: quincenaError } = await supabaseService
      .from('quincenas')
      .select('etiqueta_estandar, enviada_por, tenant_id')
      .eq('id', quincenaId)
      .eq('tenant_id', perfil.tenant_id)
      .single();
    if (quincenaError || !quincena) return jsonResponse({ error: 'Quincena no encontrada.' }, 404);

    // Mismos destinatarios que el canal push (CA2) — ver fn_notificar_aprobadores_planilla /
    // fn_notificar_preparador_y_admins_planilla en 20260907380000_admin_copia_notificaciones_y_
    // restaurar_guard_reapertura.sql. Admin siempre recibe copia; dedup por email en minúsculas
    // porque un mismo usuario puede calificar por más de un motivo (ej. admin que también es
    // aprobador, o admin que es quien envió a aprobación).
    const destinatariosSet = new Set<string>();
    if (tipo === 'enviada_aprobacion') {
      const { data: destinatariosBase, error: destinatariosError } = await supabaseService
        .from('user_profiles')
        .select('email')
        .eq('tenant_id', perfil.tenant_id)
        .eq('is_active', true)
        .overlaps('role', ['aprobador_planilla', 'admin']);
      if (destinatariosError) throw destinatariosError;
      for (const u of destinatariosBase ?? []) {
        if (u.email) destinatariosSet.add(u.email.toLowerCase());
      }
    } else {
      const { data: destinatariosBase, error: destinatariosError } = await supabaseService
        .from('user_profiles')
        .select('email')
        .eq('tenant_id', perfil.tenant_id)
        .eq('is_active', true)
        .or(`id.eq.${quincena.enviada_por ?? '00000000-0000-0000-0000-000000000000'},role.cs.{admin}`);
      if (destinatariosError) throw destinatariosError;
      for (const u of destinatariosBase ?? []) {
        if (u.email) destinatariosSet.add(u.email.toLowerCase());
      }
    }
    const destinatarios = Array.from(destinatariosSet);

    if (destinatarios.length === 0) {
      return jsonResponse({ enviados: 0, fallidos: 0, aviso: 'Sin destinatarios para este evento.' });
    }

    const ejecutorNombre = perfil.full_name || 'un usuario';
    const titulo = TITULOS[tipo];
    const mensaje = construirMensaje(tipo, quincena.etiqueta_estandar, ejecutorNombre, motivo);
    const html = construirHtml(titulo, mensaje, `${siteUrl}/planilla/historial/${quincenaId}`);

    const resultado = await enviarEmailATodos(
      { apiKey: resendApiKey, from: `Imporfrut Planilla <${fromAddress}>`, subject: titulo, html, destinatarios },
      { action: 'notificar-email-quincena', tenantId: perfil.tenant_id, quincenaId, tipo }
    );

    return jsonResponse(resultado);
  } catch (err: unknown) {
    Logger.error('Error fatal en notificar-email-quincena', { action: 'notificar-email-quincena' }, err);
    return jsonResponse({ error: 'Error del servidor al enviar el email.' }, 500);
  }
});
