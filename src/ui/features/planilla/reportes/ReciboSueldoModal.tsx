import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Receipt } from 'lucide-react';

import { useReciboSueldoReporte } from './useReciboSueldoReporte';
import { openReciboSueldoPDF } from '../../../../utils/reportesPlanillaPdfUtils';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { Button } from '../../../components/Button';
import { Logger } from '../../../../utils/logger';

type Modo = 'individual' | 'masivo';

interface ReciboSueldoModalProps {
    onClose: () => void;
}

/** Generación de Recibo de Sueldo (US-EXP-05, IMPL-158) — toggle individual/masivo, siempre
 * requiere elegir una quincena ya calculada. */
export const ReciboSueldoModal: React.FC<ReciboSueldoModalProps> = ({ onClose }) => {
    const { t } = useTranslation();
    const { empleados, quincenas, isLoading, generarIndividual, generarMasivo } = useReciboSueldoReporte();
    const [modo, setModo] = useState<Modo>('individual');
    const [quincenaId, setQuincenaId] = useState('');
    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<typeof empleados[number] | null>(null);
    const [isGenerando, setIsGenerando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerar = async () => {
        if (!quincenaId) { setError(t('reportes.field_quincena')); return; }
        if (modo === 'individual' && !empleadoSeleccionado) { setError(t('reportes.referencia_seleccionar_empleado')); return; }
        setError(null);
        setIsGenerando(true);
        try {
            const quincena = quincenas.find((q) => q.id === quincenaId);
            if (modo === 'individual' && empleadoSeleccionado) {
                const datos = await generarIndividual(empleadoSeleccionado, quincenaId);
                if (!datos) { setError(t('reportes.sin_datos')); return; }
                const safeName = empleadoSeleccionado.nombre_completo.replace(/[^a-z0-9]/gi, '_').toLowerCase();
                await openReciboSueldoPDF([datos], `recibo_sueldo_${safeName}.pdf`);
            } else {
                const datos = await generarMasivo(quincenaId);
                if (datos.length === 0) { setError(t('reportes.sin_datos')); return; }
                await openReciboSueldoPDF(datos, `recibo_sueldo_${quincena?.etiqueta_estandar ?? quincenaId}.pdf`);
            }
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al generar Recibo de Sueldo', {}, err);
            setError(t('reportes.error_generar'));
        } finally {
            setIsGenerando(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={onClose} />
            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <div className="pointer-events-auto w-full sm:max-w-[480px] bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[92dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300">
                    <div className="sm:hidden flex justify-center pt-sm pb-0 shrink-0">
                        <div className="w-10 h-1 rounded-full bg-border" />
                    </div>

                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <div className="flex items-center gap-sm">
                            <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center">
                                <Receipt size={16} className="text-primary" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('reportes.nombre_recibo_sueldo')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        <div className="flex gap-xs">
                            <button
                                type="button"
                                onClick={() => { setModo('individual'); setError(null); }}
                                className={`flex-1 px-md py-sm rounded-lg text-[13px] font-semibold border transition-colors ${modo === 'individual' ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border'}`}
                            >
                                {t('reportes.field_modo_individual')}
                            </button>
                            <button
                                type="button"
                                onClick={() => { setModo('masivo'); setError(null); }}
                                className={`flex-1 px-md py-sm rounded-lg text-[13px] font-semibold border transition-colors ${modo === 'masivo' ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border'}`}
                            >
                                {t('reportes.field_modo_masivo')}
                            </button>
                        </div>

                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('reportes.field_quincena')}</label>
                            <select value={quincenaId} onChange={(e) => setQuincenaId(e.target.value)} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
                                <option value="">—</option>
                                {quincenas.map((q) => <option key={q.id} value={q.id}>{q.nombre}</option>)}
                            </select>
                        </div>

                        {modo === 'individual' && (
                            <div className="flex flex-col gap-1">
                                <label className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('reportes.field_empleado')}</label>
                                <EmpleadoCombobox
                                    empleados={empleados}
                                    value={empleadoSeleccionado}
                                    onChange={setEmpleadoSeleccionado}
                                    placeholder={t('reportes.field_empleado_buscar_placeholder')}
                                    noResultsLabel={t('reportes.field_empleado_sin_resultados')}
                                />
                            </div>
                        )}

                        {error && <p className="text-caption text-error">{error}</p>}
                    </div>

                    <div className="flex px-lg py-md border-t border-border shrink-0">
                        <Button onClick={handleGenerar} isLoading={isGenerando} disabled={isLoading} className="flex-1">
                            {t('reportes.generar_pdf')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
