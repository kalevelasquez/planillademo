/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import type { ReactNode } from 'react';
import { Toast, type ToastAction } from '../ui/components/Toast/Toast';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastContextValue {
    showToast: (message: string, type: ToastType, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

/**
 * Puente para disparar toasts desde código que no es un componente React (ej. `chunkImportRetry`,
 * que corre dentro de un generador de reporte, no de un hook) — `useToast()` exige estar dentro
 * de un `<ToastProvider>`, así que acá se guarda una referencia mutable a `showToast` mientras el
 * provider esté montado. Si se llama antes de que monte (raro, solo en el primer render inicial),
 * se ignora en silencio — no hay nada crítico que dependa de este puente durante el arranque.
 */
let toastBridge: ToastContextValue['showToast'] | null = null;

export function showGlobalToast(message: string, type: ToastType, action?: ToastAction): void {
    toastBridge?.(message, type, action);
}

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [toast, setToast] = useState<{ message: string; type: ToastType; action?: ToastAction } | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showToast = useCallback((message: string, type: ToastType, action?: ToastAction) => {
        setToast({ message, type, action });

        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }

        // UX: duración adaptativa según tipo y longitud del mensaje (US-OBS-01 / UX-Ajuste)
        // Si hay una acción, el toast persiste más tiempo para dar oportunidad al clic
        const isHighPriority = type === 'error' || type === 'warning' || !!action;
        const baseTime = isHighPriority ? 8000 : 4000;
        const extraChars = Math.max(0, message.length - 30);
        const duration = Math.min(baseTime + extraChars * 80, 20000);

        timerRef.current = setTimeout(() => {
            setToast(null);
        }, duration);
    }, []);

    const handleClose = useCallback(() => {
        setToast(null);
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }
    }, []);

    useEffect(() => {
        toastBridge = showToast;
        return () => { toastBridge = null; };
    }, [showToast]);

    return (
        <ToastContext.Provider value={{ showToast }}>
            {children}
            {toast && (
                <Toast
                    message={toast.message}
                    type={toast.type}
                    action={toast.action}
                    onClose={handleClose}
                />
            )}
        </ToastContext.Provider>
    );
};

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};
