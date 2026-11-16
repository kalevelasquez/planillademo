import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, UserCheck } from 'lucide-react';

import { planillaEmpleadosService } from '../../../../services/planillaEmpleadosService';
import { openReferenciaLaboralPDF } from '../../../../utils/reportesPlanillaPdfUtils';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { Logger } from '../../../../utils/logger';

type EmpleadoReporte = Awaited<ReturnType<typeof planillaEmpleadosService.getEmpleadosParaReportes>>[number];

interface ReferenciaLaboralModalProps {
    onClose: () => void;
}

/**
 * Generación de Referencia Laboral (US-EXP-07, IMPL-160) — busca un empleado y genera la carta.
 * Si el empleado está inactivo, pide la fecha final como input manual: el sistema no tiene un
 * campo "fecha de baja" (solo activo/inactivo), y restringir el reporte a solo empleados activos
 * dejaría fuera el caso más común (ex-empleado pidiendo su referencia) — decisión confirmada con
 * el usuario en la planificación de este batch.
 */
export const ReferenciaLaboralModal: React.FC<ReferenciaLaboralModalProps> = ({ onClose }) => {
    const { t } = useTranslation();
    const [empleados, setEmpleados] = useState<EmpleadoReporte[]>([]);
    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<EmpleadoReporte | null>(null);
    const [fechaFinalManual, setFechaFinalManual] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isGenerando, setIsGenerando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        planillaEmpleadosService.getEmpleadosParaReportes()
            .then(setEmpleados)
            .catch((err: unknown) => Logger.error('Error al cargar empleados para Referencia Laboral', {}, err))
            .finally(() => setIsLoading(false));
    }, []);

    const handleGenerar = async () => {
        if (!empleadoSeleccionado) { setError(t('reportes.referencia_seleccionar_empleado')); return; }
        if (empleadoSeleccionado.estado === 'inactivo' && !fechaFinalManual) {
            setError(t('reportes.referencia_fecha_final_manual'));
            return;
        }
        setError(null);
        setIsGenerando(true);
        try {
            const fechaFinal = empleadoSeleccionado.estado === 'activo' ? 'a la fecha' : fechaFinalManual;
            const safeName = empleadoSeleccionado.nombre_completo.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            await openReferenciaLaboralPDF(
                {
                    nombreCompleto: empleadoSeleccionado.nombre_completo,
                    cargo: empleadoSeleccionado.cargo ?? '—',
                    fechaIngreso: empleadoSeleccionado.fecha_ingreso,
                    fechaFinal,
                },
                `referencia_laboral_${safeName}.pdf`,
            );
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al generar Referencia Laboral', {}, err);
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
                            <div className="w-8 h-8 rounded-lg bg-pink-50 flex items-center justify-center">
                                <UserCheck size={16} className="text-pink-600" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('reportes.nombre_referencia_laboral')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
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

                        {empleadoSeleccionado?.estado === 'inactivo' && (
                            <InputField
                                label={t('reportes.referencia_fecha_final')}
                                type="date"
                                value={fechaFinalManual}
                                onChange={(e) => setFechaFinalManual(e.target.value)}
                            />
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
