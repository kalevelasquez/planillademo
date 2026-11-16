import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { History, Plus, AlertTriangle } from 'lucide-react';

import { planillaEmpleadosService, type Indemnizacion } from '../../../../services/planillaEmpleadosService';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { ConfirmModal } from '../../../components/ConfirmModal';
import { Logger } from '../../../../utils/logger';

interface IndemnizacionesSectionProps {
    empleadoId: string;
    isReadOnly: boolean;
    /** Fecha de ingreso vigente del empleado — referencia para la advertencia cronológica. */
    fechaIngresoActual: string;
    /** Se llama tras registrar una indemnización, para que el padre recargue fecha_ingreso (CA2). */
    onRegistered: () => void;
}

function fmtFecha(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Historial de indemnizaciones del empleado (US-EMP-03 / IMPL-5). Vive fuera del <form>
 * de perfil porque registrar una indemnización es una acción independiente e inmediata
 * (RPC transaccional), no parte del guardado general del perfil.
 */
export const IndemnizacionesSection: React.FC<IndemnizacionesSectionProps> = ({ empleadoId, isReadOnly, fechaIngresoActual, onRegistered }) => {
    const { t } = useTranslation();
    const [indemnizaciones, setIndemnizaciones] = useState<Indemnizacion[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showForm, setShowForm] = useState(false);
    const [fecha, setFecha] = useState('');
    const [motivo, setMotivo] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showConfirm, setShowConfirm] = useState(false);

    // Advertencia no bloqueante (gap IMPL-5 #1): la fecha nueva debería ser posterior a la
    // indemnización más reciente (si existe) o, en su defecto, a la fecha de ingreso actual.
    const fechaReferencia = indemnizaciones[0]?.fecha ?? fechaIngresoActual;
    const fechaFueraDeOrden = Boolean(fecha && fechaReferencia && fecha <= fechaReferencia);

    const loadIndemnizaciones = async () => {
        setIsLoading(true);
        try {
            const data = await planillaEmpleadosService.getIndemnizaciones(empleadoId);
            setIndemnizaciones(data);
        } catch (err: unknown) {
            Logger.error('Error al cargar indemnizaciones', { empleadoId }, err);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadIndemnizaciones();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [empleadoId]);

    const handleRegister = async () => {
        if (!fecha) {
            setError(t('empleados.indemnizacion_fecha_required'));
            return;
        }
        setIsSubmitting(true);
        setError(null);
        try {
            await planillaEmpleadosService.registrarIndemnizacion(empleadoId, fecha, motivo || null);
            setFecha('');
            setMotivo('');
            setShowForm(false);
            setShowConfirm(false);
            await loadIndemnizaciones();
            onRegistered();
        } catch (err: unknown) {
            Logger.error('Error al registrar indemnización', { empleadoId }, err);
            setError(err instanceof Error ? err.message : t('empleados.indemnizacion_save_error'));
            setShowConfirm(false);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
            <div className="flex items-center justify-between pb-1 border-b border-border/50">
                <div className="flex items-center gap-2">
                    <History size={14} className="text-primary" />
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">{t('empleados.section_indemnizaciones')}</h3>
                </div>
                {!isReadOnly && !showForm && (
                    <button
                        type="button"
                        onClick={() => setShowForm(true)}
                        className="flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
                    >
                        <Plus size={12} /> {t('empleados.indemnizacion_add')}
                    </button>
                )}
            </div>

            {isLoading ? (
                <div className="h-4 bg-surface rounded w-1/3 animate-pulse" />
            ) : indemnizaciones.length === 0 ? (
                <p className="text-caption text-text-secondary italic">{t('empleados.indemnizacion_empty')}</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {indemnizaciones.map((ind) => (
                        <li key={ind.id} className="flex items-center justify-between gap-3 text-sm border-b border-border/40 pb-2 last:border-b-0 last:pb-0">
                            <span className="font-semibold text-heading shrink-0">{fmtFecha(ind.fecha)}</span>
                            <span className="text-text-secondary flex-1 min-w-0 truncate text-right">
                                {ind.motivo || <span className="italic opacity-50">{t('empleados.indemnizacion_no_motivo')}</span>}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {showForm && (
                <div className="flex flex-col gap-3 bg-surface/50 rounded-lg p-md border border-border">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <InputField
                            id="indemnizacion-fecha"
                            label={t('empleados.indemnizacion_fecha')}
                            type="date" mask="date"
                            value={fecha}
                            onChange={(e) => setFecha(e.target.value)}
                        />
                        <InputField
                            id="indemnizacion-motivo"
                            label={t('empleados.indemnizacion_motivo')}
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                        />
                    </div>
                    {fechaFueraDeOrden && (
                        <p className="flex items-center gap-1.5 text-caption text-amber-700">
                            <AlertTriangle size={12} className="shrink-0" /> {t('empleados.indemnizacion_fecha_warning')}
                        </p>
                    )}
                    {error && <p className="text-caption text-error">{error}</p>}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => { setShowForm(false); setError(null); }} disabled={isSubmitting}>
                            {t('common.cancel')}
                        </Button>
                        <Button type="button" size="sm" onClick={() => setShowConfirm(true)}>
                            {t('empleados.indemnizacion_confirm')}
                        </Button>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={showConfirm}
                onClose={() => setShowConfirm(false)}
                onConfirm={handleRegister}
                title={t('empleados.indemnizacion_confirmar_title')}
                message={t('empleados.indemnizacion_confirmar_message')}
                confirmLabel={t('empleados.indemnizacion_confirm')}
                variant={fechaFueraDeOrden ? 'warning' : 'primary'}
                Icon={History}
                isLoading={isSubmitting}
            />
        </section>
    );
};
