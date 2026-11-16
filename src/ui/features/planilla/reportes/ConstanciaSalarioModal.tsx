import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileCheck, FileText } from 'lucide-react';

import { useConstanciaSalarioReporte } from './useConstanciaSalarioReporte';
import { openConstanciaSalarioPDF } from '../../../../utils/reportesPlanillaPdfUtils';
import { openConstanciaSalarioDocx } from '../../../../utils/constanciaSalarioDocxUtils';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { Button } from '../../../components/Button';
import { Logger } from '../../../../utils/logger';

interface ConstanciaSalarioModalProps {
    onClose: () => void;
}

/**
 * Generación de Constancia de Salario (US-EXP-04, IMPL-157) — busca un empleado y genera el PDF
 * con el promedio de 6 meses ya calculado por el hook. Mismo patrón que ReferenciaLaboralModal.tsx.
 */
export const ConstanciaSalarioModal: React.FC<ConstanciaSalarioModalProps> = ({ onClose }) => {
    const { t } = useTranslation();
    const { empleados, isLoading, generarDatos } = useConstanciaSalarioReporte();
    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<typeof empleados[number] | null>(null);
    const [isGenerandoPDF, setIsGenerandoPDF] = useState(false);
    const [isGenerandoDocx, setIsGenerandoDocx] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleGenerarPDF = async () => {
        if (!empleadoSeleccionado) { setError(t('reportes.referencia_seleccionar_empleado')); return; }
        setError(null);
        setIsGenerandoPDF(true);
        try {
            const datos = await generarDatos(empleadoSeleccionado);
            const safeName = empleadoSeleccionado.nombre_completo.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            await openConstanciaSalarioPDF(datos, `constancia_salario_${safeName}.pdf`);
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al generar Constancia de Salario (PDF)', {}, err);
            setError(t('reportes.error_generar'));
        } finally {
            setIsGenerandoPDF(false);
        }
    };

    // CA4 — export editable para el caso de ajuste manual puntual (ej. calificar a un préstamo
    // con una cuota más baja), sin alterar el cálculo base que guarda el sistema.
    const handleGenerarDocx = async () => {
        if (!empleadoSeleccionado) { setError(t('reportes.referencia_seleccionar_empleado')); return; }
        setError(null);
        setIsGenerandoDocx(true);
        try {
            const datos = await generarDatos(empleadoSeleccionado);
            const safeName = empleadoSeleccionado.nombre_completo.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            await openConstanciaSalarioDocx(datos, `constancia_salario_${safeName}.docx`);
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al generar Constancia de Salario (Word)', {}, err);
            setError(t('reportes.error_generar'));
        } finally {
            setIsGenerandoDocx(false);
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
                            <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                <FileCheck size={16} className="text-blue-600" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('reportes.nombre_constancia_salario')}</h3>
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
                        {error && <p className="text-caption text-error">{error}</p>}
                    </div>

                    <div className="flex gap-sm px-lg py-md border-t border-border shrink-0">
                        <Button variant="secondary" onClick={handleGenerarDocx} isLoading={isGenerandoDocx} disabled={isLoading || isGenerandoPDF} className="flex-1">
                            <FileText size={16} /> {t('reportes.generar_word')}
                        </Button>
                        <Button onClick={handleGenerarPDF} isLoading={isGenerandoPDF} disabled={isLoading || isGenerandoDocx} className="flex-1">
                            {t('reportes.generar_pdf')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};
