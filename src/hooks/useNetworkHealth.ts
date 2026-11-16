import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../config/supabaseClient';

const PING_INTERVAL_MS = 30_000; // 30 segundos entre pings
const PING_TIMEOUT_MS = 8_000;   // 8 segundos máximo para respuesta

export interface NetworkHealthState {
    isOnline: boolean;
    isRetrying: boolean;
    retryNow: () => void;
}

async function pingSupabase(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    try {
        const { error, status } = await supabase
            .from('tenants')
            .select('id')
            .limit(1)
            .abortSignal(controller.signal);

        clearTimeout(timeout);

        // Estar "Online" significa que el HOST responde.
        if (error && status === 0) {
            // Un status 0 suele indicar fallo de red o timeouts (no alcanzó el server)
            return false;
        }

        return true;
    } catch (err: any) {
        clearTimeout(timeout);
        return false;
    }
}

export function useNetworkHealth(): NetworkHealthState {
    const [isOnline, setIsOnline] = useState(true);
    const [isRetrying, setIsRetrying] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const isMountedRef = useRef(true);

    const checkConnection = useCallback(async () => {
        if (!isMountedRef.current) return;

        // Primero: la network del dispositivo
        if (!navigator.onLine) {
            setIsOnline(false);
            return;
        }

        // Segundo: si hay red, verificamos que Supabase responda
        setIsRetrying(true);
        const alive = await pingSupabase();
        if (!isMountedRef.current) return;
        setIsRetrying(false);

        if (alive && !isOnline) {
            // Conexión recuperada!
            setIsOnline(true);
            // Ya no hacemos reload forzado para evitar interrumpir el trabajo del usuario.
        } else {
            setIsOnline(alive);
        }
    }, [isOnline]);

    const retryNow = useCallback(() => {
        checkConnection();
    }, [checkConnection]);

    useEffect(() => {
        isMountedRef.current = true;

        const handleOnline = () => checkConnection();
        const handleOffline = () => setIsOnline(false);

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        // Ping periódico solo cuando detectamos problema
        intervalRef.current = setInterval(() => {
            if (!isOnline) {
                checkConnection();
            }
        }, PING_INTERVAL_MS);

        return () => {
            isMountedRef.current = false;
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [isOnline, checkConnection]);

    return { isOnline, isRetrying, retryNow };
}
