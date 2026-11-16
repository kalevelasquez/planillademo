import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, Scale } from 'lucide-react';

import { useLiquidacionLaboralReporte } from './useLiquidacionLaboralReporte';
import { openLiquidacionLaboralPDF } from '../../../../utils/reportesPlanillaPdfUtils';
import type { TipoRetiro, MetodoPago } from '../../../../utils/liquidacionLaboralUtils';
import { EmpleadoCombobox } from '../../../components/EmpleadoCombobox';
import { InputField } from '../../../components/InputField';
import { SelectField } from '../../../components/SelectField';
import { Button } from '../../../components/Button';
import { Logger } from '../../../../utils/logger';

interface LiquidacionLaboralModalProps {
    onClose: () => void;
}

/**
 * Generación de Liquidación Laboral (US-EXP-08, IMPL-161) — a diferencia de otros reportes de
 * este catálogo, acá el método de pago y el tipo de retiro NO son datos permanentes del perfil
 * del empleado: Imporfrut confirmó que se eligen/acuerdan caso por caso en el momento de generar
 * la liquidación (CA2/CA9), así que este formulario los captura como parte de la generación, no
 * los busca en `planilla_empleados`.
 *
 * El PDF generado (`LiquidacionLaboralPDFTemplate`) trae 3 secciones en un solo documento:
 * Liquidación, Solicitud de Transferencia/Cheque y Partida Contable — la Indemnización (CA1) se
 * calcula si la empresa tiene el sector económico configurado (Datos Fiscales); si no, queda
 * "PENDIENTE DE DEFINIR" (ver banner condicional más abajo).
 */
export const LiquidacionLaboralModal: React.FC<LiquidacionLaboralModalProps> = ({ onClose }) => {
    const { t } = useTranslation();
    const { empleados, isLoading, generarDatos, sectorEconomico, razonSocialEmpresa, nitEmpresa } = useLiquidacionLaboralReporte();

    const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState<typeof empleados[number] | null>(null);
    const [fechaRetiro, setFechaRetiro] = useState('');
    const [tipoRetiro, setTipoRetiro] = useState<TipoRetiro | ''>('');
    const [porcentajeMutuoAcuerdo, setPorcentajeMutuoAcuerdo] = useState('');
    const [metodoPago, setMetodoPago] = useState<MetodoPago | ''>('');
    const [bancoEmisor, setBancoEmisor] = useState('');
    const [observaciones, setObservaciones] = useState('');

    const [isGenerando, setIsGenerando] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const opcionesTipoRetiro = [
        { value: 'despido', label: t('reportes.liquidacion_tipo_retiro_despido') },
        { value: 'renuncia', label: t('reportes.liquidacion_tipo_retiro_renuncia') },
        { value: 'mutuo_acuerdo', label: t('reportes.liquidacion_tipo_retiro_mutuo_acuerdo') },
    ];

    const opcionesMetodoPago = [
        { value: 'transferencia', label: t('reportes.liquidacion_metodo_pago_transferencia') },
        { value: 'cheque', label: t('reportes.liquidacion_metodo_pago_cheque') },
    ];

    const handleGenerar = async () => {
        if (!empleadoSeleccionado) { setError(t('reportes.referencia_seleccionar_empleado')); return; }
        if (!fechaRetiro) { setError(t('reportes.liquidacion_error_fecha_retiro')); return; }
        if (!tipoRetiro) { setError(t('reportes.liquidacion_error_tipo_retiro')); return; }
        const porcentaje = porcentajeMutuoAcuerdo === '' ? undefined : Number(porcentajeMutuoAcuerdo);
        if (tipoRetiro === 'mutuo_acuerdo' && (porcentaje === undefined || Number.isNaN(porcentaje) || porcentaje < 0 || porcentaje > 100)) {
            setError(t('reportes.liquidacion_error_porcentaje_mutuo_acuerdo'));
            return;
        }
        if (!metodoPago) { setError(t('reportes.liquidacion_error_metodo_pago')); return; }
        if (!bancoEmisor.trim()) { setError(t('reportes.liquidacion_error_banco_emisor')); return; }

        setError(null);
        setIsGenerando(true);
        try {
            const datos = await generarDatos(empleadoSeleccionado, {
                fechaRetiro,
                tipoRetiro,
                porcentajeMutuoAcuerdo: porcentaje,
                metodoPago,
                bancoEmisor: bancoEmisor.trim(),
                observaciones: observaciones.trim() || undefined,
            });
            const safeName = empleadoSeleccionado.nombre_completo.replace(/[^a-z0-9]/gi, '_').toLowerCase();
            await openLiquidacionLaboralPDF({ datos, razonSocialEmpresa, nitEmpresa }, `liquidacion_laboral_${safeName}.pdf`);
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al generar Liquidación Laboral', {}, err);
            setError(t('reportes.error_generar'));
        } finally {
            setIsGenerando(false);
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
                                <Scale size={16} className="text-purple-600" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('reportes.nombre_liquidacion_laboral')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>

                    <div className="overflow-y-auto p-lg flex flex-col gap-md">
                        {!sectorEconomico && (
                            <p className="text-caption text-text-secondary bg-amber-50 border border-amber-200 rounded-lg p-sm">
                                {t('reportes.liquidacion_aviso_indemnizacion_pendiente')}
                            </p>
                        )}

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

                        <SelectField
                            label={t('reportes.liquidacion_field_metodo_pago')}
                            options={opcionesMetodoPago}
                            value={metodoPago}
                            onChange={(e) => setMetodoPago(e.target.value as MetodoPago)}
                        />

                        <InputField
                            label={t('reportes.liquidacion_field_banco_emisor')}
                            value={bancoEmisor}
                            onChange={(e) => setBancoEmisor(e.target.value)}
                            placeholder={t('reportes.liquidacion_field_banco_emisor_placeholder')}
                        />

                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider ml-1 text-text-secondary">
                                {t('reportes.liquidacion_field_observaciones')}
                            </label>
                            <textarea
                                value={observaciones}
                                onChange={(e) => setObservaciones(e.target.value)}
                                rows={2}
                                className="w-full py-2.5 px-4 rounded-lg text-sm font-medium text-heading transition-all duration-200 outline-none shadow-sm bg-white border border-gray-200 placeholder:text-text-secondary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 hover:border-gray-300 resize-none"
                            />
                        </div>

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
