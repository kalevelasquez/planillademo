import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { X, Lock, AlertTriangle, CalendarPlus } from 'lucide-react';

import { useQuincenasStore } from '../../../../store/quincenasStore';
import { quincenasService } from '../../../../services/quincenasService';
import { feriadosService } from '../../../../services/feriadosService';
import { calcularDiasHabiles, generarEtiquetaEstandar, TIPO_QUINCENA_LABEL, type TipoQuincena } from '../../../../utils/quincenaUtils';
import { InputField } from '../../../components/InputField';
import { Button } from '../../../components/Button';
import { Banner } from '../../../components/Banner';
import { useToast } from '../../../../context/ToastContext';
import { Logger } from '../../../../utils/logger';
import { extraerMensajeError } from '../../../../utils/supabaseErrorUtils';

// Deriva las opciones del picker desde TIPO_QUINCENA_LABEL (quincenaUtils.ts) en vez de
// duplicar la lista de tipos acá (7ma pasada QA, hallazgo MINOR #4).
const TIPOS: { value: TipoQuincena; label: string }[] = Object.entries(TIPO_QUINCENA_LABEL).map(
    ([value, label]) => ({ value: value as TipoQuincena, label })
);

interface NuevaQuincenaModalProps {
    onClose: () => void;
}

/**
 * Modal/bottom-sheet para crear una quincena (US-QNA-00), reemplaza a la antigua página
 * /planilla/quincenas/nueva — fidelidad con el DEMO (NuevaQuincenaModal en QuincenasView.tsx),
 * que arma este flujo como overlay disparado desde el dashboard del Preparador, no como ruta propia.
 */
export const NuevaQuincenaModal: React.FC<NuevaQuincenaModalProps> = ({ onClose }) => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { quincenas, addQuincena } = useQuincenasStore();

    const [tipo, setTipo] = useState<TipoQuincena>('normal');
    const [nombre, setNombre] = useState('');
    const [fechaInicio, setFechaInicio] = useState('');
    const [fechaFin, setFechaFin] = useState('');
    const [confirmarIrregular, setConfirmarIrregular] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [feriados, setFeriados] = useState<string[]>([]);

    useEffect(() => {
        feriadosService.getFeriados()
            .then((data) => setFeriados(data.map((f) => f.fecha)))
            .catch((err: unknown) => Logger.error('Error al cargar feriados para calcular días hábiles', {}, err));
    }, []);

    // IMPL-156 (US-QNA-10) CA2 — bloqueo preventivo client-side: solo puede existir una
    // quincena 'en_proceso' por tipo (CA1, garantizado a nivel de datos con un índice único
    // parcial). El array ya está en memoria (PlanillaLayout ya hizo fetchQuincenas), así que
    // esto no dispara ningún fetch adicional — el RPC sigue siendo la autoridad real si de
    // todas formas se llega a enviar (carrera entre dos usuarios, por ejemplo).
    const quincenaEnProcesoDelTipo = useMemo(
        () => quincenas.find((q) => q.tipo === tipo && q.estado === 'en_proceso'),
        [quincenas, tipo]
    );

    const rangoValido = Boolean(fechaInicio && fechaFin && fechaFin >= fechaInicio);
    const diasHabiles = useMemo(
        () => (rangoValido ? calcularDiasHabiles(fechaInicio, fechaFin, feriados) : 0),
        [rangoValido, fechaInicio, fechaFin, feriados]
    );
    const etiquetaResult = useMemo(
        () => (rangoValido ? generarEtiquetaEstandar(tipo, fechaInicio, fechaFin) : { etiqueta: null, advertencia: false }),
        [rangoValido, tipo, fechaInicio, fechaFin]
    );

    // Cambiar cualquier campo relevante invalida una confirmación previa del caso borde.
    const handleTipoChange = (nuevo: TipoQuincena) => { setTipo(nuevo); setConfirmarIrregular(false); };
    const handleFechaInicioChange = (v: string) => { setFechaInicio(v); setConfirmarIrregular(false); };
    const handleFechaFinChange = (v: string) => { setFechaFin(v); setConfirmarIrregular(false); };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSubmitting) return;
        setError(null);

        if (quincenaEnProcesoDelTipo) { setError(null); return; }
        if (!nombre.trim()) { setError(t('quincenas.error_nombre_required')); return; }
        if (!rangoValido) { setError(t('quincenas.error_fechas_invalidas')); return; }
        if (etiquetaResult.advertencia && !confirmarIrregular) {
            setError(t('quincenas.error_confirmar_irregular'));
            return;
        }

        setIsSubmitting(true);
        try {
            const etiqueta = etiquetaResult.etiqueta ?? `${TIPOS.find(x => x.value === tipo)?.label} ${fechaInicio} - ${fechaFin}`;
            const creada = await quincenasService.createQuincena({ tipo, nombre: nombre.trim(), etiquetaEstandar: etiqueta, fechaInicio, fechaFin, diasHabiles });
            addQuincena(creada);
            showToast(t('quincenas.exito_creada', { etiqueta: creada.etiqueta_estandar }), 'success');
            onClose();
        } catch (err: unknown) {
            Logger.error('Error al crear quincena', { tipo, fechaInicio, fechaFin }, err);
            setError(extraerMensajeError(err, t('quincenas.error_crear')));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={onClose} />

            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <form
                    onSubmit={handleSubmit}
                    className="pointer-events-auto bg-white w-full sm:max-w-[480px] sm:rounded-2xl rounded-t-2xl shadow-modals flex flex-col max-h-[90dvh] animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300"
                >
                    <div className="sm:hidden flex justify-center pt-md pb-sm shrink-0">
                        <div className="w-10 h-1 rounded-full bg-border" />
                    </div>

                    <div className="flex items-center justify-between px-lg pb-md sm:pt-lg sm:pb-md border-b border-border shrink-0">
                        <div className="flex items-center gap-2">
                            <CalendarPlus size={18} className="text-primary shrink-0" />
                            <div>
                                <h2 className="text-h3 font-bold text-heading">{t('quincenas.nueva_title')}</h2>
                                <p className="text-[12px] text-text-secondary mt-0.5">{t('quincenas.nueva_desc')}</p>
                            </div>
                        </div>
                        <button type="button" onClick={onClose} className="p-sm rounded-lg text-text-secondary hover:bg-surface transition-colors shrink-0">
                            <X size={20} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto px-lg py-lg flex flex-col gap-lg">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-xs font-bold uppercase tracking-wider text-text-secondary ml-1">{t('quincenas.field_tipo')}</label>
                            <div className="flex gap-xs bg-surface rounded-lg p-1">
                                {TIPOS.map(({ value, label }) => (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => handleTipoChange(value)}
                                        className={`flex-1 px-md py-sm rounded-md text-[13px] font-semibold transition-colors
                                            ${tipo === value ? 'bg-white text-primary shadow-cards' : 'text-text-secondary hover:text-heading'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {quincenaEnProcesoDelTipo && (
                            <Banner
                                variant="error"
                                title={t('quincenas.bloqueo_en_proceso_title', { tipo: TIPOS.find((x) => x.value === tipo)?.label })}
                                description={t('quincenas.bloqueo_en_proceso_desc', { nombre: quincenaEnProcesoDelTipo.nombre })}
                                icon={<AlertTriangle size={18} />}
                                action={
                                    <button
                                        type="button"
                                        onClick={() => { onClose(); navigate(`/planilla/historial/${quincenaEnProcesoDelTipo.id}`); }}
                                        className="px-md py-xs rounded-lg border border-error/30 text-error text-[13px] font-semibold hover:bg-error/10 transition-colors"
                                    >
                                        {t('quincenas.bloqueo_en_proceso_ver')}
                                    </button>
                                }
                            />
                        )}

                        <InputField
                            label={t('quincenas.field_nombre')}
                            placeholder={t('quincenas.field_nombre_placeholder')}
                            value={nombre}
                            onChange={(e) => setNombre(e.target.value)}
                            required
                        />

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <InputField
                                label={t('quincenas.field_fecha_inicio')}
                                type="date" mask="date"
                                value={fechaInicio}
                                onChange={(e) => handleFechaInicioChange(e.target.value)}
                                required
                            />
                            <InputField
                                label={t('quincenas.field_fecha_fin')}
                                type="date" mask="date"
                                value={fechaFin}
                                onChange={(e) => handleFechaFinChange(e.target.value)}
                                required
                            />
                        </div>

                        {rangoValido && (
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-bold uppercase tracking-wider text-text-secondary ml-1">{t('quincenas.field_etiqueta')}</label>
                                <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-4 py-2.5">
                                    <Lock size={14} className="text-text-secondary shrink-0" />
                                    <span className="text-sm font-semibold text-heading">
                                        {etiquetaResult.etiqueta ?? t('quincenas.etiqueta_pendiente')}
                                    </span>
                                </div>
                                <p className="text-[11px] text-text-secondary ml-1">{t('quincenas.field_dias_habiles', { dias: diasHabiles })}</p>
                            </div>
                        )}

                        {etiquetaResult.advertencia && (
                            <div className="flex flex-col gap-2">
                                <Banner
                                    variant="warning"
                                    title={t('quincenas.warning_rango_irregular_title')}
                                    description={t('quincenas.warning_rango_irregular_desc')}
                                    icon={<AlertTriangle size={18} />}
                                />
                                <label className="flex items-center gap-2 ml-1 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={confirmarIrregular}
                                        onChange={(e) => setConfirmarIrregular(e.target.checked)}
                                        className="w-4 h-4 accent-primary"
                                    />
                                    <span className="text-sm text-heading">{t('quincenas.confirmar_rango_irregular')}</span>
                                </label>
                            </div>
                        )}

                        {error && (
                            <div className="p-4 bg-error/10 border border-error/20 rounded-xl text-error text-sm font-medium">{error}</div>
                        )}
                    </div>

                    <div className="px-lg py-lg border-t border-border flex gap-sm shrink-0">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-sm rounded-xl border border-border text-text-secondary text-[13px] font-semibold hover:bg-surface transition-colors"
                        >
                            {t('quincenas.action_cancelar')}
                        </button>
                        <Button type="submit" isLoading={isSubmitting} disabled={!!quincenaEnProcesoDelTipo} className="flex-1 flex items-center justify-center gap-xs">
                            {t('quincenas.action_crear')}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};
