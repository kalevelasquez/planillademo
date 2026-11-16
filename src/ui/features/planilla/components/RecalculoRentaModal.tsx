import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw, X, Info, CheckCircle2, Check } from 'lucide-react';

interface RecalculoRentaModalProps {
    totalEmpleados: number;
    onEjecutar: () => Promise<number>;
    onClose: () => void;
}

/**
 * US-CALC-08 (fidelidad al DEMO) — a diferencia del mock, el real ya determina automáticamente
 * si la quincena es elegible para recálculo semestral (`esElegibleRecalculoRenta` en
 * CalculoPlanillaView.tsx, por fecha) — no hace falta pedirle al usuario que elija "mitad/fin
 * de año" a mano. El paso que sí faltaba (y este modal agrega) es la confirmación explícita
 * antes de ejecutar y el resumen de resultado, en vez de disparar el RPC directo con solo un
 * toast. El resumen solo muestra ajustados vs. sin cambio — no "positivos/negativos" como el
 * DEMO, porque el servicio real no devuelve esa dirección (no se inventa un dato que no existe).
 */
export const RecalculoRentaModal: React.FC<RecalculoRentaModalProps> = ({ totalEmpleados, onEjecutar, onClose }) => {
    const { t } = useTranslation();
    const [isRunning, setIsRunning] = useState(false);
    const [resultado, setResultado] = useState<number | null>(null);

    const handleRun = async () => {
        setIsRunning(true);
        try {
            const count = await onEjecutar();
            setResultado(count);
        } catch {
            // El caller ya deja el error visible en su propio banner — cerrar el modal para
            // que se vea, en vez de dejarlo atascado en el estado "ejecutando".
            onClose();
        } finally {
            setIsRunning(false);
        }
    };

    const done = resultado !== null;

    return (
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={done ? onClose : undefined} />
            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <div className="pointer-events-auto w-full sm:max-w-[480px] bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[90dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300">
                    <div className="sm:hidden flex justify-center pt-sm shrink-0">
                        <div className="w-10 h-1 rounded-full bg-border" />
                    </div>

                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <div className="flex items-center gap-sm">
                            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                                <RefreshCw size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('calculoPlanilla.recalculo_modal_title')}</h3>
                        </div>
                        {done && (
                            <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading p-xs"><X size={18} /></button>
                        )}
                    </div>

                    <div className="overflow-y-auto flex flex-col gap-md p-lg">
                        {!done ? (
                            <div className="flex items-start gap-sm px-md py-sm bg-primary-light rounded-xl border border-primary/20">
                                <Info size={14} className="text-primary shrink-0 mt-0.5" />
                                <p className="text-[12px] text-primary">{t('calculoPlanilla.recalculo_modal_intro')}</p>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center gap-md py-lg text-center">
                                <div className="w-16 h-16 rounded-full bg-primary-light flex items-center justify-center">
                                    <CheckCircle2 size={32} className="text-primary" />
                                </div>
                                <div>
                                    <p className="text-body font-bold text-heading">{t('calculoPlanilla.recalculo_modal_resultado_title')}</p>
                                    <p className="text-[12px] text-text-secondary mt-xs">{t('calculoPlanilla.recalculo_modal_resultado_desc')}</p>
                                </div>
                                <div className="w-full bg-surface rounded-xl border border-border p-md text-left flex flex-col gap-xs">
                                    <div className="flex items-center gap-sm text-[12px] text-text-secondary">
                                        <Check size={13} className="text-primary shrink-0" /> {t('calculoPlanilla.recalculo_modal_resultado_ajustados', { count: resultado })}
                                    </div>
                                    <div className="flex items-center gap-sm text-[12px] text-text-secondary">
                                        <Check size={13} className="text-primary shrink-0" /> {t('calculoPlanilla.recalculo_modal_resultado_sin_cambio', { count: Math.max(0, totalEmpleados - resultado) })}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="px-lg py-md border-t border-border flex gap-sm shrink-0">
                        {!done ? (
                            <>
                                <button
                                    type="button"
                                    onClick={handleRun}
                                    disabled={isRunning}
                                    className="flex-1 flex items-center justify-center gap-xs px-lg py-sm bg-primary text-white rounded-xl font-semibold text-body hover:bg-primary-dark transition-colors shadow-cards disabled:opacity-70"
                                >
                                    <RefreshCw size={16} className={isRunning ? 'animate-spin' : ''} />
                                    {isRunning ? t('calculoPlanilla.recalculo_modal_ejecutando') : t('calculoPlanilla.recalculo_modal_action_ejecutar')}
                                </button>
                                <button type="button" onClick={onClose} disabled={isRunning} className="px-lg py-sm border border-border rounded-xl text-body text-text-secondary hover:bg-surface transition-colors disabled:opacity-50">
                                    {t('calculoPlanilla.action_cancelar')}
                                </button>
                            </>
                        ) : (
                            <button type="button" onClick={onClose} className="flex-1 px-lg py-sm bg-primary text-white rounded-xl font-semibold text-body hover:bg-primary-dark transition-colors">
                                {t('calculoPlanilla.action_cerrar')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
