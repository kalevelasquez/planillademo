import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileDown, FileSpreadsheet, CheckCircle2, AlertCircle, Lock, Check, Loader2, Landmark } from 'lucide-react';

import { usePlanillaContext } from './PlanillaLayout';
import { exportacionesContablesService, type LineaPartidaDiario, type FilaCuotaPatronal } from '../../../services/exportacionesContablesService';
import { generarFilasPlanillaUnica } from '../../../services/planillaUnicaService';
import { quincenasService, type Quincena } from '../../../services/quincenasService';
import { resolverMesCompletoPlanillaUnica, calcularDiasCalendarioMes, type FilaPlanillaUnica } from '../../../utils/planillaUnicaUtils';
import { exportToCSV, exportToExcel } from '../../../utils/exportUtils';
import { PageLoader } from '../../components/PageLoader';
import { Logger } from '../../../utils/logger';

type TipoExportacion = 'planilla_unica' | 'partida' | 'cuotas_patronales';

/**
 * Exportaciones Contables (US-EXP-00/IMPL-98, US-EXP-02/IMPL-100, US-EXP-01/IMPL-99). CA1 de
 * IMPL-98/IMPL-100 dice "al cerrar una quincena" — la partida se habilita cuando
 * `quincena.estado === 'aprobada_cerrada'`.
 *
 * IMPL-99 fue rediseñado por Imporfrut (septiembre 2026): las 3 tarjetas viejas (ISSS/AFP Crecer/
 * AFP Confía, una por quincena) quedaron obsoletas — ahora es UNA sola "Planilla Única ISSS/AFP",
 * habilitada solo al cerrar la 2DA quincena del mes, que consolida ambas quincenas
 * (`resolverMesCompletoPlanillaUnica`). Columnas 9-13 (nombres/apellidos separados) y 15 (Pago
 * adicional) quedan vacías a propósito — no existen esos datos en el sistema, ver
 * `planillaUnicaUtils.ts`.
 *
 * Los nombres de cuenta de la partida contable son PROPUESTA INICIAL (IMPL-98 CA3/CA4) — Jira
 * exige validarlos contra el sistema contable real de Imporfrut antes de un uso real.
 */
export const ExportacionesContablesView: React.FC = () => {
    const { t } = useTranslation();
    const { quincenaId, quincena, quincenaLabel, quincenaCerrada } = usePlanillaContext();

    const [partida, setPartida] = useState<LineaPartidaDiario[]>([]);
    const [cuotasPatronales, setCuotasPatronales] = useState<FilaCuotaPatronal[]>([]);
    const [quincenas, setQuincenas] = useState<Quincena[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isExportando, setIsExportando] = useState<TipoExportacion | null>(null);
    const [descargado, setDescargado] = useState<TipoExportacion | null>(null);

    useEffect(() => {
        if (!quincenaId) return;
        setIsLoading(true);
        setError(null);
        Promise.all([
            exportacionesContablesService.generarPartidaDiario(quincenaId),
            exportacionesContablesService.generarFilasCuotasPatronales(quincenaId),
            quincenasService.getQuincenas(),
        ])
            .then(([lineasPartida, filasCuotasPatronales, todasLasQuincenas]) => {
                setPartida(lineasPartida);
                setCuotasPatronales(filasCuotasPatronales);
                setQuincenas(todasLasQuincenas);
            })
            .catch((err: unknown) => {
                Logger.error('Error al cargar exportaciones contables', { quincenaId }, err);
                setError(t('exportaciones.error_cargar'));
            })
            .finally(() => setIsLoading(false));
    }, [quincenaId, t]);

    const estadoMesCompleto = quincena
        ? resolverMesCompletoPlanillaUnica(quincena, quincenas)
        : { habilitado: false as const, motivo: '' };

    const lineasDebito = partida.filter((l) => l.tipo === 'debito');
    const lineasCredito = partida.filter((l) => l.tipo === 'credito');
    const totalDebito = lineasDebito.reduce((s, l) => s + l.monto, 0);
    const totalCredito = lineasCredito.reduce((s, l) => s + l.monto, 0);
    const partidaCuadrada = Math.abs(totalDebito - totalCredito) < 0.01;

    const marcarDescargado = (tipo: TipoExportacion) => {
        setDescargado(tipo);
        setTimeout(() => setDescargado((actual) => (actual === tipo ? null : actual)), 2500);
    };

    const filaPlanillaUnicaACsv = (f: FilaPlanillaUnica) => ({
        'Núm. Documento Empleador': f.nitDuiEmpleador,
        'Núm. Patronal ISSS': f.numeroPatronalIsss,
        Periodo: f.periodo,
        'Correlativo Centro de Trabajo': f.correlativoCentroTrabajo,
        'Núm. Documento Afiliado': f.numeroDocumentoAfiliado,
        'Tipo Documento Afiliado': f.tipoDocumentoAfiliado,
        'Núm. ISSS Afiliado': f.numeroIsssAfiliado,
        'Institución Previsional': f.institucionPrevisional,
        'Primer Nombre': f.primerNombre,
        'Segundo Nombre': f.segundoNombre,
        'Primer Apellido': f.primerApellido,
        'Segundo Apellido': f.segundoApellido,
        'Apellido de Casada': f.apellidoCasada,
        Salario: f.salario.toFixed(2),
        'Pago Adicional': f.pagoAdicional,
        'Monto Vacación': f.montoVacacion.toFixed(2),
        Días: f.dias,
        Horas: f.horas,
        'Días Vacación': f.diasVacacion,
        'Código Observación 1': f.codigoObservacion1,
        'Código Observación 2': f.codigoObservacion2,
    });

    const handleExportarPlanillaUnica = async () => {
        if (!estadoMesCompleto.habilitado || !estadoMesCompleto.primeraQuincenaId || !estadoMesCompleto.segundaQuincenaId) return;
        setIsExportando('planilla_unica');
        try {
            const { mes0, anio, primeraQuincenaId, segundaQuincenaId } = estadoMesCompleto;
            const fechaInicioMes = `${anio}-${String((mes0 ?? 0) + 1).padStart(2, '0')}-01`;
            const fechaFinMes = `${anio}-${String((mes0 ?? 0) + 1).padStart(2, '0')}-${String(calcularDiasCalendarioMes(mes0 ?? 0, anio ?? 0)).padStart(2, '0')}`;
            const filas = await generarFilasPlanillaUnica(primeraQuincenaId, segundaQuincenaId, {
                mes0: mes0 ?? 0, anio: anio ?? 0, fechaInicioMes, fechaFinMes,
            });
            await exportToCSV(filas.map(filaPlanillaUnicaACsv), `planilla_unica_isss_afp_${anio}_${String((mes0 ?? 0) + 1).padStart(2, '0')}`);
            marcarDescargado('planilla_unica');
        } catch (err: unknown) {
            Logger.error('Error al exportar Planilla Única ISSS/AFP', { quincenaId }, err);
            setError(t('exportaciones.error_exportar'));
        } finally {
            setIsExportando(null);
        }
    };

    const handleExportarPartida = async () => {
        setIsExportando('partida');
        try {
            const data = partida.map((l) => ({
                Cuenta: l.cuenta,
                Concepto: l.concepto,
                Débito: l.tipo === 'debito' ? l.monto.toFixed(2) : '',
                Crédito: l.tipo === 'credito' ? l.monto.toFixed(2) : '',
            }));
            await exportToExcel(data, `Partida_Diario_${quincenaLabel}`, 'Partida de Diario', { title: `Partida de Diario Contable — ${quincenaLabel}` });
            marcarDescargado('partida');
        } catch (err: unknown) {
            Logger.error('Error al exportar partida de diario', { quincenaId }, err);
            setError(t('exportaciones.error_exportar'));
        } finally {
            setIsExportando(null);
        }
    };

    /** CA14 (US-CIE-03/IMPL-106) — vista separada de la partida contable, mismos montos
     * desglosados por empleado (ver comentario en exportacionesContablesService). */
    const handleExportarCuotasPatronales = async () => {
        setIsExportando('cuotas_patronales');
        try {
            const data = cuotasPatronales.map((f) => ({
                [t('exportaciones.cuotas_patronales_col_codigo')]: f.codigoEmpleado,
                [t('exportaciones.cuotas_patronales_col_nombre')]: f.nombreEmpleado,
                [t('exportaciones.cuotas_patronales_col_isss')]: f.isssPatronal.toFixed(2),
                [t('exportaciones.cuotas_patronales_col_afp')]: f.afpPatronal.toFixed(2),
                [t('exportaciones.cuotas_patronales_col_insaforp')]: f.insaforpPatronal.toFixed(2),
                [t('exportaciones.cuotas_patronales_col_total')]: f.totalPatronal.toFixed(2),
            }));
            await exportToExcel(data, `Cuotas_Patronales_${quincenaLabel}`, 'Cuotas Patronales', { title: `Cuotas Patronales — ${quincenaLabel}` });
            marcarDescargado('cuotas_patronales');
        } catch (err: unknown) {
            Logger.error('Error al exportar cuotas patronales', { quincenaId }, err);
            setError(t('exportaciones.error_exportar'));
        } finally {
            setIsExportando(null);
        }
    };

    const totalIsssPatronal = cuotasPatronales.reduce((s, f) => s + f.isssPatronal, 0);
    const totalAfpPatronal = cuotasPatronales.reduce((s, f) => s + f.afpPatronal, 0);
    const totalInsaforpPatronal = cuotasPatronales.reduce((s, f) => s + f.insaforpPatronal, 0);
    const totalPatronalGeneral = totalIsssPatronal + totalAfpPatronal + totalInsaforpPatronal;

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {error && <p className="text-caption text-error">{error}</p>}

            {isLoading ? (
                <PageLoader label={t('common.loading')} />
            ) : (
                <>
                    {/* Estado de la quincena (único gate real — sin checklist de módulos fabricado) */}
                    <div className="bg-white rounded-2xl border border-border shadow-cards px-lg py-md flex items-center gap-sm">
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${quincenaCerrada ? 'bg-emerald-50' : 'bg-amber-50'}`}>
                            {quincenaCerrada ? <CheckCircle2 size={18} className="text-emerald-600" /> : <Lock size={18} className="text-amber-500" />}
                        </div>
                        <div>
                            <p className="text-body font-bold text-heading">{t('exportaciones.estado_title')}</p>
                            <p className="text-[11px] text-text-secondary">{quincenaCerrada ? t('exportaciones.estado_lista') : t('exportaciones.estado_bloqueada')}</p>
                        </div>
                    </div>

                    {/* Partida de Diario */}
                    <div className="bg-white rounded-2xl border border-border shadow-cards flex flex-col overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-sm px-lg py-md border-b border-border">
                            <div className="flex items-center gap-sm">
                                <div className="w-9 h-9 rounded-xl bg-primary-light flex items-center justify-center shrink-0">
                                    <FileSpreadsheet size={18} className="text-primary" />
                                </div>
                                <div>
                                    <h2 className="text-body font-bold text-heading">{t('exportaciones.partida_title')}</h2>
                                    <p className="text-[11px] text-text-secondary">{t('exportaciones.partida_disclaimer')}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handleExportarPartida}
                                disabled={!quincenaCerrada || isExportando === 'partida'}
                                className={`flex items-center justify-center gap-xs px-lg py-sm rounded-xl font-semibold text-body transition-all shadow-cards shrink-0 disabled:cursor-not-allowed disabled:opacity-60
                                    ${descargado === 'partida' ? 'bg-emerald-500 text-white' : 'bg-primary text-white hover:bg-primary-dark'}`}
                            >
                                {isExportando === 'partida' ? (
                                    <><Loader2 size={16} className="animate-spin" /> {t('exportaciones.action_generando')}</>
                                ) : descargado === 'partida' ? (
                                    <><Check size={16} /> {t('exportaciones.action_descargado')}</>
                                ) : (
                                    <><FileSpreadsheet size={16} /> {t('exportaciones.action_exportar_partida')}</>
                                )}
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="bg-surface border-b border-border">
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('exportaciones.col_cuenta')}</th>
                                        <th className="px-md py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('exportaciones.col_concepto')}</th>
                                        <th className="px-md py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('exportaciones.col_debito')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('exportaciones.col_credito')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td colSpan={4} className="px-lg py-xs bg-surface/60">
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('exportaciones.separador_debitos')}</span>
                                        </td>
                                    </tr>
                                    {lineasDebito.map((l) => (
                                        <tr key={l.cuenta} className="border-b border-border/60 hover:bg-surface/40 transition-colors">
                                            <td className="px-lg py-sm font-mono text-[12px] text-text-secondary">{l.cuenta}</td>
                                            <td className="px-md py-sm text-heading font-medium">{l.concepto}</td>
                                            <td className="px-md py-sm text-right font-bold text-heading whitespace-nowrap">${l.monto.toFixed(2)}</td>
                                            <td className="px-lg py-sm text-right text-text-secondary">—</td>
                                        </tr>
                                    ))}
                                    <tr>
                                        <td colSpan={4} className="px-lg py-xs bg-surface/60 border-t border-border/60">
                                            <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('exportaciones.separador_creditos')}</span>
                                        </td>
                                    </tr>
                                    {lineasCredito.map((l) => (
                                        <tr key={l.cuenta} className="border-b border-border/60 hover:bg-surface/40 transition-colors">
                                            <td className="px-lg py-sm font-mono text-[12px] text-text-secondary">{l.cuenta}</td>
                                            <td className="px-md py-sm text-heading font-medium pl-xl">{l.concepto}</td>
                                            <td className="px-md py-sm text-right text-text-secondary">—</td>
                                            <td className="px-lg py-sm text-right font-bold text-error whitespace-nowrap">${l.monto.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-surface border-t-2 border-border">
                                        <td colSpan={2} className="px-lg py-sm text-[12px] font-bold text-heading">{t('calculoPlanilla.fila_totales')}</td>
                                        <td className="px-md py-sm text-right font-bold text-heading whitespace-nowrap">${totalDebito.toFixed(2)}</td>
                                        <td className="px-lg py-sm text-right font-bold text-error whitespace-nowrap">${totalCredito.toFixed(2)}</td>
                                    </tr>
                                    <tr className="border-t border-border/60">
                                        <td colSpan={4} className="px-lg py-xs text-right">
                                            <span className={`inline-flex items-center gap-xs text-[11px] font-bold ${partidaCuadrada ? 'text-emerald-600' : 'text-error'}`}>
                                                {partidaCuadrada ? <><CheckCircle2 size={13} /> {t('exportaciones.partida_cuadrada')}</> : <><AlertCircle size={13} /> {t('exportaciones.partida_descuadrada')}</>}
                                            </span>
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        <div className="px-lg py-xs border-t border-border bg-surface">
                            <p className="text-[11px] text-text-secondary">
                                {t('exportaciones.footer_periodo')} <span className="font-semibold text-heading">{quincenaLabel}</span>
                            </p>
                        </div>
                    </div>

                    {/* Cuotas Patronales (CA14, IMPL-106/US-CIE-03) — vista separada de la partida,
                        mismos totales desglosados por empleado en vez de un solo monto por cuenta. */}
                    <div className="bg-white rounded-2xl border border-border shadow-cards flex flex-col overflow-hidden">
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-sm px-lg py-md border-b border-border">
                            <div className="flex items-center gap-sm">
                                <div className="w-9 h-9 rounded-xl bg-secondary-light flex items-center justify-center shrink-0">
                                    <Landmark size={18} className="text-secondary" />
                                </div>
                                <div>
                                    <h2 className="text-body font-bold text-heading">{t('exportaciones.cuotas_patronales_title')}</h2>
                                    <p className="text-[11px] text-text-secondary">{t('exportaciones.cuotas_patronales_disclaimer')}</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={handleExportarCuotasPatronales}
                                disabled={cuotasPatronales.length === 0 || isExportando === 'cuotas_patronales'}
                                className={`flex items-center justify-center gap-xs px-lg py-sm rounded-xl font-semibold text-body transition-all shadow-cards shrink-0 disabled:cursor-not-allowed disabled:opacity-60
                                    ${descargado === 'cuotas_patronales' ? 'bg-emerald-500 text-white' : 'bg-primary text-white hover:bg-primary-dark'}`}
                            >
                                {isExportando === 'cuotas_patronales' ? (
                                    <><Loader2 size={16} className="animate-spin" /> {t('exportaciones.action_generando')}</>
                                ) : descargado === 'cuotas_patronales' ? (
                                    <><Check size={16} /> {t('exportaciones.action_descargado')}</>
                                ) : (
                                    <><FileSpreadsheet size={16} /> {t('exportaciones.action_exportar_cuotas_patronales')}</>
                                )}
                            </button>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead>
                                    <tr className="bg-surface border-b border-border">
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('exportaciones.cuotas_patronales_col_codigo')}</th>
                                        <th className="px-md py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('exportaciones.cuotas_patronales_col_nombre')}</th>
                                        <th className="px-md py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('exportaciones.cuotas_patronales_col_isss')}</th>
                                        <th className="px-md py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('exportaciones.cuotas_patronales_col_afp')}</th>
                                        <th className="px-md py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('exportaciones.cuotas_patronales_col_insaforp')}</th>
                                        <th className="px-lg py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary text-right">{t('exportaciones.cuotas_patronales_col_total')}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {cuotasPatronales.map((f) => (
                                        <tr key={f.codigoEmpleado} className="border-b border-border/60 hover:bg-surface/40 transition-colors">
                                            <td className="px-lg py-sm font-mono text-[12px] text-text-secondary">{f.codigoEmpleado}</td>
                                            <td className="px-md py-sm text-heading font-medium">{f.nombreEmpleado}</td>
                                            <td className="px-md py-sm text-right text-heading">${f.isssPatronal.toFixed(2)}</td>
                                            <td className="px-md py-sm text-right text-heading">${f.afpPatronal.toFixed(2)}</td>
                                            <td className="px-md py-sm text-right text-heading">${f.insaforpPatronal.toFixed(2)}</td>
                                            <td className="px-lg py-sm text-right font-bold text-heading whitespace-nowrap">${f.totalPatronal.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-surface border-t-2 border-border">
                                        <td colSpan={2} className="px-lg py-sm text-[12px] font-bold text-heading">{t('calculoPlanilla.fila_totales')}</td>
                                        <td className="px-md py-sm text-right font-bold text-heading whitespace-nowrap">${totalIsssPatronal.toFixed(2)}</td>
                                        <td className="px-md py-sm text-right font-bold text-heading whitespace-nowrap">${totalAfpPatronal.toFixed(2)}</td>
                                        <td className="px-md py-sm text-right font-bold text-heading whitespace-nowrap">${totalInsaforpPatronal.toFixed(2)}</td>
                                        <td className="px-lg py-sm text-right font-bold text-heading whitespace-nowrap">${totalPatronalGeneral.toFixed(2)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                        <div className="px-lg py-xs border-t border-border bg-surface">
                            <p className="text-[11px] text-text-secondary">
                                {t('exportaciones.footer_periodo')} <span className="font-semibold text-heading">{quincenaLabel}</span>
                            </p>
                        </div>
                    </div>

                    {/* Planilla Única ISSS/AFP (IMPL-99, rediseño septiembre 2026) */}
                    <section className="flex flex-col gap-sm">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('exportaciones.planilla_unica_title')}</p>
                        <p className="text-caption text-text-secondary">{t('exportaciones.planilla_unica_disclaimer')}</p>
                        {(() => {
                            const bloqueado = !estadoMesCompleto.habilitado;
                            const loading = isExportando === 'planilla_unica';
                            const done = descargado === 'planilla_unica';
                            return (
                                <div className={`flex flex-col gap-md p-lg rounded-2xl border transition-all max-w-md
                                    ${bloqueado ? 'bg-surface border-border opacity-70' : done ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-border hover:border-primary/30 hover:shadow-cards'}`}
                                >
                                    <div className="flex items-start justify-between gap-sm">
                                        <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0
                                            ${bloqueado ? 'bg-surface border border-border' : done ? 'bg-emerald-100' : 'bg-primary-light'}`}>
                                            <Download size={22} className={bloqueado ? 'text-text-secondary' : done ? 'text-emerald-600' : 'text-primary'} />
                                        </div>
                                        {bloqueado ? (
                                            <span className="inline-flex items-center gap-xs px-sm py-xs text-[11px] font-bold rounded-full bg-red-50 text-red-600 border border-red-200">
                                                <AlertCircle size={12} /> {t('exportaciones.badge_bloqueada')}
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-xs px-sm py-xs text-[11px] font-bold rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                <CheckCircle2 size={12} /> {t('exportaciones.badge_lista')}
                                            </span>
                                        )}
                                    </div>

                                    <div className="flex flex-col gap-xs">
                                        <h3 className="text-body font-bold text-heading">{t('exportaciones.action_exportar_planilla_unica')}</h3>
                                        <p className="text-[11px] font-semibold text-text-secondary">{t('exportaciones.csv_entidad_planilla_unica')}</p>
                                        <p className="text-[11px] text-text-secondary">{bloqueado ? estadoMesCompleto.motivo : quincenaLabel}</p>
                                    </div>

                                    <button
                                        type="button"
                                        onClick={handleExportarPlanillaUnica}
                                        disabled={bloqueado || loading}
                                        className={`flex items-center justify-center gap-xs w-full py-sm rounded-xl font-semibold text-body transition-all
                                            ${bloqueado
                                                ? 'bg-surface text-text-secondary border border-border cursor-not-allowed'
                                                : done
                                                    ? 'bg-emerald-500 text-white'
                                                    : loading
                                                        ? 'bg-primary/70 text-white cursor-wait'
                                                        : 'bg-primary text-white hover:bg-primary-dark shadow-cards'}`}
                                    >
                                        {loading ? (
                                            <><Loader2 size={16} className="animate-spin" /> {t('exportaciones.action_generando')}</>
                                        ) : done ? (
                                            <><Check size={16} /> {t('exportaciones.action_descargado')}</>
                                        ) : bloqueado ? (
                                            <><AlertCircle size={16} /> {t('exportaciones.badge_bloqueada')}</>
                                        ) : (
                                            <><FileDown size={16} /> {t('exportaciones.action_descargar_csv')}</>
                                        )}
                                    </button>
                                </div>
                            );
                        })()}
                    </section>
                </>
            )}
        </div>
    );
};
