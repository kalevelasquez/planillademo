// supabase/functions/_shared/resend.ts
// Cliente mínimo de la API de Resend (sin SDK — mismo criterio que _shared/openai.ts: un solo
// tipo de request no justifica una dependencia). IMPL-127 (US-CIE-04) CA1/CA3 — canal de email
// de las notificaciones de cambio de estado de quincena.
import { Logger } from './logger.ts';

const RESEND_TIMEOUT_MS = 10000;

export type CodigoErrorResend = 'timeout' | 'api';

export class ResendError extends Error {
  readonly codigo: CodigoErrorResend;
  readonly status?: number;
  readonly detalle?: string;

  constructor(codigo: CodigoErrorResend, message: string, status?: number, detalle?: string) {
    super(message);
    this.codigo = codigo;
    this.status = status;
    this.detalle = detalle;
  }
}

export interface OpcionesEnviarEmail {
  apiKey: string;
  from: string;
  to: string;
  subject: string;
  html: string;
  timeoutMs?: number;
}

/** Envía un email por destinatario (no todos en un solo `to` array — cada aprobador vería la
 * dirección de los demás en la cabecera). Lanza `ResendError` con un `codigo` clasificado. */
export async function enviarEmail(opts: OpcionesEnviarEmail): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs ?? RESEND_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.apiKey}`,
      },
      body: JSON.stringify({
        from: opts.from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
      signal: controller.signal,
    });
  } catch (fetchErr: unknown) {
    if (fetchErr instanceof Error && fetchErr.name === 'AbortError') {
      throw new ResendError('timeout', 'Timeout esperando respuesta de Resend');
    }
    throw new ResendError('api', 'Error de red al llamar a Resend', undefined, fetchErr instanceof Error ? fetchErr.message : '');
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    const textoError = await res.text();
    throw new ResendError('api', `Resend respondió ${res.status}`, res.status, textoError.slice(0, 500));
  }
}

/** Envía a varios destinatarios en paralelo sin que uno solo tumbe a los demás — devuelve
 * cuántos se enviaron y loggea cada falla individual. */
export async function enviarEmailATodos(
  opts: Omit<OpcionesEnviarEmail, 'to'> & { destinatarios: string[] },
  contexto: Record<string, unknown>
): Promise<{ enviados: number; fallidos: number }> {
  const resultados = await Promise.allSettled(
    opts.destinatarios.map((to) => enviarEmail({ ...opts, to }))
  );
  let fallidos = 0;
  resultados.forEach((r, i) => {
    if (r.status === 'rejected') {
      fallidos++;
      Logger.error('Error al enviar email vía Resend', { ...contexto, destinatario: opts.destinatarios[i] }, r.reason);
    }
  });
  return { enviados: resultados.length - fallidos, fallidos };
}
