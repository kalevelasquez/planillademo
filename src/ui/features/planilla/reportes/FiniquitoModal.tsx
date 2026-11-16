import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, FileSignature, FileText } from 'lucide-react';

import { useFiniquitoReporte } from './useFiniquitoReporte';
import { openFiniquitoPDF } from '../../../../utils/reportesPlanillaPdfUtils';
import { openFiniquitoDocx } from '../../../../utils/finiquitoDocxUtils';
import type { TipoRetiro } from '../../../../utils/liquidacionLaboralUtils';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { InputField } from '../../../components/InputField';
import { SelectField } from '../../../components/SelectField';
import { Button } from '../../../components/Button';
import { Logger } from '../../../../utils/logger';

interface FiniquitoModalProps {
    onClose: () => void;
}

/**
 * Generación de Finiquito (US-EXP-09, IMPL-162 — CA1 reescrito septiembre 2026). Mismo criterio
 * que Liquidación Laboral: Tipo de Retiro se captura al generar, no es un dato permanente del
 * empleado. A diferencia de Liquidación Laboral, acá SÍ hace falta Word (CA6, "para poder
 * firmarse físicamente").
 */
export const FiniquitoModal: React.FC<FiniquitoModalProps> = ({ onClose }) => {
    const { t } = useTranslation();
    const { empleados, isLoading, generarDatos, razonSocialEmpresa, nitEmpresa } = useFiniquitoReporte();

    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<typeof empleados[number] | null>(null);
    const [fechaRetiro, setFechaRetiro] = useState('');
    const [tipoRetiro, setTipoRetiro] = useState<TipoRetiro | ''>('');
    const [porcentajeMutuoAcuerdo, setPorcentajeMutuoAcuerdo] = useState('');
    const [fechaFirma, setFechaFirma] = useState('');

    const [isGenerandoPDF, setIsGenerandoPDF] = useState(false);
    const [isGenerandoDocx, setIsGenerandoDocx] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const opcionesTipoRetiro = [
        { value: 'despido', label: t('reportes.liquidacion_tipo_retiro_despido') },
        { value: 'renuncia', label: t('reportes.liquidacion_tipo_retiro_renuncia') },
        { value: 'mutuo_acuerdo', label: t('reportes.liquidacion_tipo_retiro_mutuo_acuerdo') },
    ];

    const validar = (): boolean => {
        if (!empleadoSeleccionado) { setError(t('reportes.referencia_seleccionar_empleado')); return false; }
        if (!fechaRetiro) { setError(t('reportes.liquidacion_error_fecha_retiro')); return false; }
        if (!tipoRetiro) { setError(t('reportes.liquidacion_error_tipo_retiro')); return false; }
        const porcentaje = porcentajeMutuoAcuerdo === '' ? undefined : Number(porcentajeMutuoAcuerdo);
        if (tipoRetiro === 'mutuo_acuerdo' && (porcentaje === undefined || Number.isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100)) {
            setError(t('reportes.liquidacion_error_porcentaje_mutuo_acuerdo'));
            return false;
        }
        setError(null);
        return true;
    };

    const handleGenerarPDF = async () => {
        if (!validar() || !empleadoSeleccionado || !tipoRetiro) return;
        setIsGenerandoPDF(true);
        try {
            const porcentaje = porcentajeMutuoAcuerdo === '' ? undefined : Number(porcentajeMutuoAcuerdo);
            const datos = await generarDatos(empleadoSeleccionado, { fechaRetiro, tipoRetiro, porcentajeMutuoAcuerdo: porcentaje, fechaFirma: fechaFirma || undefined });
            const safeName = empleadoSeleccionado.nombre_completo.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            await openFiniquitoPDF({ datos, razonSocialEmpresa, nitEmpresa }, `finiquito_${safeName}.pdf`);
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al generar Finiquito (PDF)', {}, err);
            setError(t('reportes.error_generar'));
        } finally {
            setIsGenerandoPDF(false);
        }
    };

    const handleGenerarDocx = async () => {
        if (!validar() || !empleadoSeleccionado || !tipoRetiro) return;
        setIsGenerandoDocx(true);
        try {
            const porcentaje = porcentajeMutuoAcuerdo === '' ? undefined : Number(porcentajeMutuoAcuerdo);
            const datos = await generarDatos(empleadoSeleccionado, { fechaRetiro, tipoRetiro, porcentajeMutuoAcuerdo: porcentaje, fechaFirma: fechaFirma || undefined });
            const safeName = empleadoSeleccionado.nombre_completo.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            await openFiniquitoDocx(datos, `finiquito_${safeName}.docx`, razonSocialEmpresa, nitEmpresa);
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al generar Finiquito (Word)', {}, err);
            setError(t('reportes.error_generar'));
        } finally {
            setIsGenerandoDocx(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={onClose} />
            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <div className="pointer-events-auto w-full sm:max-w-[520px] bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[92dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300">
                    <div className="sm:hidden flex justify-center pt-sm pb-0 shrink-0">
                        <div className="w-10 h-1 rounded-full bg-border" />
                    </div>

                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <div className="flex items-center gap-sm">
                            <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                                <FileSignature size={16} className="text-purple-600" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('reportes.nombre_finiquito')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        <p className="text-caption text-text-secondary bg-amber-50 border border-amber-200 rounded-lg p-sm">
                            {t('reportes.finiquito_aviso_pendientes')}
                        </p>

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

                        <InputField
                            label={t('reportes.liquidacion_field_fecha_retiro')}
                            mask="date"
                            value={fechaRetiro}
                            onChange={(e) => setFechaRetiro(e.target.value)}
                        />

                        <SelectField
                            label={t('reportes.liquidacion_field_tipo_retiro')}
                            options={opcionesTipoRetiro}
                            value={tipoRetiro}
                            onChange={(e) => setTipoRetiro(e.target.value as TipoRetiro)}
                        />

                        {tipoRetiro === 'mutuo_acuerdo' && (
                            <InputField
                                label={t('reportes.liquidacion_field_porcentaje_mutuo_acuerdo')}
                                type="number"
                                min={0}
                                max={100}
                                value={porcentajeMutuoAcuerdo}
                                onChange={(e) => setPorcentajeMutuoAcuerdo(e.target.value)}
                                placeholder="0-100"
                            />
                        )}

                        <InputField
                            label={t('reportes.finiquito_field_fecha_firma')}
                            mask="date"
                            value={fechaFirma}
                            onChange={(e) => setFechaFirma(e.target.value)}
                            placeholder={t('reportes.finiquito_field_fecha_firma_placeholder')}
                        />

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
