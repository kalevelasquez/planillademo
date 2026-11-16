/**
 * src/ui/components/ErrorBoundary.tsx
 * ─────────────────────────────────────────────────────────────────
 * Componente de orden superior para captura de excepciones de React (US-OBS-01 CA2).
 * Muestra el mensaje traducido al español en lugar del stack trace (CA3).
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCcw, Home } from 'lucide-react';
import { Logger } from '../../utils/logger';
import { getFriendlyError } from '../../utils/errorMapper';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        // Actualiza el estado para que el siguiente renderizado muestre la interfaz de repuesto
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        // Registro del error estructurado
        Logger.error('In-Component UI Crash', {
            componentStack: errorInfo.componentStack,
        }, error);
    }

    private handleReset = () => {
        this.setState({ hasError: false, error: null });
        window.location.reload();
    };

    private handleGoHome = () => {
        this.setState({ hasError: false, error: null });
        window.location.href = '/';
    };

    public render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;

            const friendlyDetails = getFriendlyError(this.state.error);

            return (
                <div className="fixed inset-0 z-[999] flex items-center justify-center p-xl bg-slate-900/40 backdrop-blur-xl animate-in fade-in duration-500">
                    <div className="w-full max-w-[480px] bg-white rounded-3xl shadow-[0_32px_64px_-16px_rgba(0,0,0,0.2)] border border-slate-200/60 p-10 flex flex-col items-center text-center animate-in zoom-in-95 slide-in-from-bottom-10 duration-500 ease-out">

                        <div className="relative mb-8">
                            <div className="absolute inset-0 bg-red-500/10 blur-2xl rounded-full scale-150 animate-pulse" />
                            <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-br from-red-500 to-red-600 flex items-center justify-center text-white shadow-lg shadow-red-500/20 rotate-3">
                                <AlertCircle size={44} strokeWidth={1.5} />
                            </div>
                        </div>

                        <div className="flex flex-col gap-3 mb-10">
                            <h1 className="text-3xl font-bold text-slate-900 tracking-tight leading-tight">
                                Algo salió de control
                            </h1>
                            <p className="text-lg text-slate-500 font-medium leading-relaxed max-w-[320px] mx-auto">
                                {friendlyDetails.friendlyMessage}
                            </p>

                            {friendlyDetails.actionSuggestion && (
                                <div className="mt-4 p-4 rounded-xl bg-slate-50 border border-slate-100/80">
                                    <p className="text-sm text-slate-400 italic">
                                        <span className="text-slate-600 font-semibold uppercase text-[11px] tracking-wider not-italic block mb-1">Sugerencia</span>
                                        {friendlyDetails.actionSuggestion}
                                    </p>
                                </div>
                            )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
                            <button
                                onClick={this.handleReset}
                                className="group h-14 bg-slate-900 text-white rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95 hover:bg-slate-800 hover:shadow-xl hover:shadow-slate-900/10"
                            >
                                <RefreshCcw size={20} className="group-hover:rotate-180 transition-transform duration-500" />
                                Reintentar
                            </button>
                            <button
                                onClick={this.handleGoHome}
                                className="h-14 bg-white text-slate-600 border border-slate-200 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all active:scale-95 hover:bg-slate-50 hover:border-slate-300"
                            >
                                <Home size={20} />
                                Inicio
                            </button>
                        </div>

                        <div className="mt-12 pt-8 border-t border-slate-100 w-full flex flex-col items-center gap-1">
                            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-[0.2em]">Diagnostic Payload</span>
                            <span className="text-[9px] text-slate-300 font-mono">
                                {new Date().getTime().toString(36).toUpperCase()} • v{import.meta.env.VITE_APP_VERSION || '1.1.2'}
                            </span>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
