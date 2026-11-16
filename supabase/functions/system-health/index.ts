/**
 * supabase/functions/health/index.ts
 * ─────────────────────────────────────────────────────────────────
 * Sonda de diagnóstico del sistema (US-OBS-02 CA1).
 * Valida la conectividad con Postgres y devuelve el estado general.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const APP_VERSION = '1.0.0-PROD';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    const start = Date.now();
    let dbStatus = 'online';
    let latency = 0;

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
        const supabase = createClient(supabaseUrl, supabaseKey);

        // Ping a la base de datos
        const { error } = await supabase.from('tenants').select('id').limit(1);

        latency = Date.now() - start;

        if (error) {
            dbStatus = 'offline';
            throw error;
        }

        const response = {
            status: 'UP',
            version: APP_VERSION,
            timestamp: new Date().toISOString(),
            services: {
                database: {
                    status: dbStatus,
                    latency_ms: latency,
                },
                edge_runtime: 'healthy',
            }
        };

        return new Response(JSON.stringify(response), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });

    } catch (error) {
        const errorResponse = {
            status: 'DEGRADED',
            version: APP_VERSION,
            timestamp: new Date().toISOString(),
            services: {
                database: {
                    status: 'offline',
                    error: error.message
                },
                edge_runtime: 'healthy'
            }
        };

        return new Response(JSON.stringify(errorResponse), {
            status: 503,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
    }
});
