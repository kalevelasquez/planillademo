import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Clock, FileCheck, FileMinus2, Scale, Receipt, CalendarCheck, Palmtree, UserCheck, BadgeMinus, Landmark, Banknote,
    FileDown, FileSpreadsheet, FileText, X,
} from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { exportToExcel } from '../../../utils/exportUtils';
import { openTablaReportePDF } from '../../../utils/reportesPlanillaPdfUtils';
import { exportDescuentosPivotToExcel } from '../../../utils/descuentosPivotExcelUtils';
import { useVacacionesReporte } from './reportes/useVacacionesReporte';
import { usePermisosReporte } from './reportes/usePermisosReporte';
import { useDescuentosPivotReporte } from './reportes/useDescuentosPivotReporte';
import { useInstitucionesFinancierasReporte } from './reportes/useInstitucionesFinancierasReporte';
import { usePlanillaContext } from './PlanillaLayout';
import { ReporteFiltroMesModal } from './reportes/ReporteFiltroMesModal';
import { ReferenciaLaboralModal } from './reportes/ReferenciaLaboralModal';
import { ConstanciaSalarioModal } from './reportes/ConstanciaSalarioModal';
import { ReciboSueldoModal } from './reportes/ReciboSueldoModal';
import { ConstanciaRetencionesModal } from './reportes/ConstanciaRetencionesModal';
import { LiquidacionLaboralModal } from './reportes/LiquidacionLaboralModal';
import { FiniquitoModal } from './reportes/FiniquitoModal';
import { Button } from '../../components/Button';

/**
 * Catálogo de Reportes (US-EXP-03 / IMPL-101). CA1 dice "8 reportes" pero lista 9 (error de
 * conteo del propio ticket, confirmado también contra el mock DEMO, que tiene 9 tarjetas) — se
 * documentan los 9 tal cual Jira los describe. Un décimo reporte, "Instituciones Financieras",
 * se agregó después (CA13 de IMPL-106/US-CIE-03: no aparecía en el catálogo original).
 *
 * Hasta septiembre 2026 esta vista era puramente informativa (CA2/DRN §13 bloqueaba cualquier
 * generación real hasta que Imporfrut entregara el formato visual de cada documento). Imporfrut
 * ya entregó los 27 archivos de formato real — a medida que cada reporte se construye
 * (IMPL-159/166/160/167 en este batch), su tarjeta pasa de "Formato pendiente" a botones de
 * generación real. Los que aún no se construyeron mantienen el badge de pendiente.
 */
type ReporteKey =
    | 'constancia_salario' | 'finiquito' | 'liquidacion_laboral' | 'recibo_sueldo' | 'permisos'
    | 'vacaciones_estado' | 'referencia_laboral' | 'descuentos_estado' | 'renta_anual'
    | 'instituciones_financieras';

const REPORTES: { key: ReporteKey; formatos: string[]; icon: React.ElementType; iconBg: string; iconColor: string; disponible?: boolean }[] = [
    { key: 'constancia_salario', formatos: ['PDF', 'Word'], icon: FileCheck, iconBg: 'bg-blue-50', iconColor: 'text-blue-600', disponible: true },
    // IMPL-162 (US-EXP-09): CA1-CA3/CA6 reescritos septiembre 2026, formato de tabla desglosada
    // (ya no prosa legal). Reusa Liquidación Laboral (IMPL-161) como única fuente de verdad —
    // Indemnización/Vacaciones Completas/Aguinaldo Completo/Calzado/Anticipo V&A quedan
    // "PENDIENTE DE DEFINIR" dentro del propio documento, no bloquea la disponibilidad.
    { key: 'finiquito', formatos: ['PDF', 'Word'], icon: FileMinus2, iconBg: 'bg-orange-50', iconColor: 'text-orange-500', disponible: true },
    // IMPL-161 (US-EXP-08): CA2/CA3/CA4/CA9/CA10/CA11 ya se generan — CA1 (Indemnización) queda
    // como "PENDIENTE DE DEFINIR" dentro del propio PDF, no bloquea la disponibilidad del reporte.
    { key: 'liquidacion_laboral', formatos: ['PDF'], icon: Scale, iconBg: 'bg-purple-50', iconColor: 'text-purple-600', disponible: true },
    { key: 'recibo_sueldo', formatos: ['PDF'], icon: Receipt, iconBg: 'bg-primary-light', iconColor: 'text-primary', disponible: true },
    { key: 'permisos', formatos: ['PDF', 'Excel'], icon: CalendarCheck, iconBg: 'bg-amber-50', iconColor: 'text-amber-600', disponible: true },
    { key: 'vacaciones_estado', formatos: ['PDF', 'Excel'], icon: Palmtree, iconBg: 'bg-teal-50', iconColor: 'text-teal-600', disponible: true },
    { key: 'referencia_laboral', formatos: ['PDF'], icon: UserCheck, iconBg: 'bg-pink-50', iconColor: 'text-pink-600', disponible: true },
    { key: 'descuentos_estado', formatos: ['Excel'], icon: BadgeMinus, iconBg: 'bg-red-50', iconColor: 'text-red-500', disponible: true },
    // CA6 (IMPL-169): exportable en Word y PDF — no Excel, a diferencia del resto del catálogo.
    { key: 'renta_anual', formatos: ['PDF', 'Word'], icon: Landmark, iconBg: 'bg-secondary-light', iconColor: 'text-secondary', disponible: true },
    // CA13 (IMPL-106/US-CIE-03) — noveno reporte, no estaba en el catálogo original de US-EXP-03.
    // A diferencia de Descuentos (snapshot completo del tenant), este SÍ depende de la quincena
    // seleccionada en el layout (showQuincena: true en PlanillaLayout ya lo habilita).
    { key: 'instituciones_financieras', formatos: ['Excel'], icon: Banknote, iconBg: 'bg-cyan-50', iconColor: 'text-cyan-600', disponible: true },
];

const FORMATO_CLASES: Record<string, string> = {
    PDF: 'bg-red-50 text-red-600 border-red-200',
    Excel: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Word: 'bg-blue-50 text-blue-700 border-blue-200',
};

const FORMATO_ICONOS: Record<string, React.ElementType> = {
    PDF: FileDown,
    Excel: FileSpreadsheet,
    Word: FileText,
};

/** Modal de Vacaciones (filtro de mes + PDF/Excel) — dueño de su propia carga de datos vía el hook. */
const ModalVacaciones: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { t } = useTranslation();
    const { filasFiltradas, filtroMes, setFiltroMes, isLoading, error } = useVacacionesReporte();

    const columnas = [
        // flex 1.3, no 0.7: el código de empleado (formato EMP-AAAA-NNN, ~12 caracteres) no entra
        // en el mismo ancho que un número de 1 dígito como "Días" — hallazgo UAT, IMPL-159.
        { header: t('reportes.vacaciones_col_codigo'), flex: 1.3 },
        { header: t('reportes.vacaciones_col_nombre'), flex: 2 },
        { header: t('reportes.vacaciones_col_fecha_inicio'), flex: 1 },
        { header: t('reportes.vacaciones_col_fecha_fin'), flex: 1 },
        { header: t('reportes.vacaciones_col_dias'), flex: 0.7, align: 'right' as const },
        { header: t('reportes.vacaciones_col_estado'), flex: 1 },
    ];

    const generarPDF = async () => {
        await openTablaReportePDF(
            {
                titulo: t('reportes.nombre_vacaciones_estado'),
                columnas,
                filas: filasFiltradas.map((f) => [f.codigoEmpleado, f.nombreEmpleado, f.fechaInicio, f.fechaFin, String(f.dias), f.gozada ? t('reportes.vacaciones_gozada') : t('reportes.vacaciones_pendiente')]),
                emptyLabel: t('reportes.sin_datos'),
            },
            'vacaciones_estado.pdf',
        );
    };

    const generarExcel = async () => {
        await exportToExcel(
            filasFiltradas.map((f) => ({
                [t('reportes.vacaciones_col_codigo')]: f.codigoEmpleado,
                [t('reportes.vacaciones_col_nombre')]: f.nombreEmpleado,
                [t('reportes.vacaciones_col_fecha_inicio')]: f.fechaInicio,
                [t('reportes.vacaciones_col_fecha_fin')]: f.fechaFin,
                [t('reportes.vacaciones_col_dias')]: f.dias,
                [t('reportes.vacaciones_col_estado')]: f.gozada ? t('reportes.vacaciones_gozada') : t('reportes.vacaciones_pendiente'),
            })),
            'Vacaciones_Estado',
            'Vacaciones',
            { title: t('reportes.nombre_vacaciones_estado') },
        );
    };

    return (
        <ReporteFiltroMesModal
            icon={Palmtree}
            titulo={t('reportes.nombre_vacaciones_estado')}
            descripcion={t('reportes.desc_vacaciones_estado')}
            filtroMes={filtroMes}
            setFiltroMes={setFiltroMes}
            totalFilas={filasFiltradas.length}
            isLoading={isLoading}
            error={error}
            onGenerarPDF={generarPDF}
            onGenerarExcel={generarExcel}
            onClose={onClose}
        />
    );
};

/** Modal de Permisos (filtro de mes + PDF/Excel) — mismo tratamiento que Vacaciones. */
const ModalPermisos: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { t } = useTranslation();
    const { filasFiltradas, filtroMes, setFiltroMes, isLoading, error } = usePermisosReporte();

    const columnas = [
        // Mismo ajuste que Vacaciones (IMPL-159): flex 1.3 para que EMP-AAAA-NNN no desborde.
        { header: t('reportes.permisos_col_codigo'), flex: 1.3 },
        { header: t('reportes.permisos_col_nombre'), flex: 2 },
        { header: t('reportes.permisos_col_fecha'), flex: 1 },
        { header: t('reportes.permisos_col_tipo'), flex: 1 },
        { header: t('reportes.permisos_col_motivo'), flex: 2 },
    ];

    const tipoLabel = (tipo: 'con_goce' | 'sin_goce') => (tipo === 'con_goce' ? t('permisos.tipo_con_goce') : t('permisos.tipo_sin_goce'));

    const generarPDF = async () => {
        await openTablaReportePDF(
            {
                titulo: t('reportes.nombre_permisos'),
                columnas,
                filas: filasFiltradas.map((f) => [f.codigoEmpleado, f.nombreEmpleado, f.fecha, tipoLabel(f.tipo), f.motivo]),
                emptyLabel: t('reportes.sin_datos'),
            },
            'permisos_estado.pdf',
        );
    };

    const generarExcel = async () => {
        await exportToExcel(
            filasFiltradas.map((f) => ({
                [t('reportes.permisos_col_codigo')]: f.codigoEmpleado,
                [t('reportes.permisos_col_nombre')]: f.nombreEmpleado,
                [t('reportes.permisos_col_fecha')]: f.fecha,
                [t('reportes.permisos_col_tipo')]: tipoLabel(f.tipo),
                [t('reportes.permisos_col_motivo')]: f.motivo,
            })),
            'Permisos_Estado',
            'Permisos',
            { title: t('reportes.nombre_permisos') },
        );
    };

    return (
        <ReporteFiltroMesModal
            icon={CalendarCheck}
            titulo={t('reportes.nombre_permisos')}
            descripcion={t('reportes.desc_permisos')}
            filtroMes={filtroMes}
            setFiltroMes={setFiltroMes}
            totalFilas={filasFiltradas.length}
            isLoading={isLoading}
            error={error}
            onGenerarPDF={generarPDF}
            onGenerarExcel={generarExcel}
            onClose={onClose}
        />
    );
};

/** Modal de Descuentos — sin filtro de mes (snapshot completo del tenant), un solo botón "Generar Excel". */
const ModalDescuentos: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { t } = useTranslation();
    const { profile } = useAuthStore();
    const { grupos, totalFilas, isLoading, error } = useDescuentosPivotReporte();
    const [isGenerando, setIsGenerando] = useState(false);

    const handleGenerar = async () => {
        setIsGenerando(true);
        try {
            await exportDescuentosPivotToExcel(grupos, 'Descuentos_Estado', profile?.full_name ?? 'Sistema');
            onClose();
        } finally {
            setIsGenerando(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 animate-in fade-in duration-200">
            <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={onClose} />
            <div className="absolute inset-x-0 bottom-0 sm:inset-0 sm:flex sm:items-center sm:justify-center sm:p-lg pointer-events-none">
                <div className="pointer-events-auto w-full sm:max-w-[420px] bg-white rounded-t-2xl sm:rounded-2xl shadow-modals flex flex-col max-h-[92dvh] overflow-hidden animate-in slide-in-from-bottom-4 sm:slide-in-from-bottom-0 duration-300">
                    <div className="sm:hidden flex justify-center pt-sm pb-0 shrink-0">
                        <div className="w-10 h-1 rounded-full bg-border" />
                    </div>
                    <div className="flex items-center justify-between px-lg py-md border-b border-border shrink-0">
                        <div className="flex items-center gap-sm">
                            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center">
                                <BadgeMinus size={16} className="text-red-500" />
                            </div>
                            <h3 className="text-body font-bold text-heading">{t('reportes.nombre_descuentos_estado')}</h3>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>
                    <div className="p-lg flex flex-col gap-md">
                        <p className="text-caption text-text-secondary">{t('reportes.desc_descuentos_estado')}</p>
                        {error ? (
                            <p className="text-caption text-error">{t('reportes.error_cargar')}</p>
                        ) : (
                            <p className="text-caption text-text-secondary">
                                {isLoading ? t('common.loading') : t('reportes.contador_filas', { count: totalFilas })}
                            </p>
                        )}
                    </div>
                    <div className="flex px-lg py-md border-t border-border shrink-0">
                        <Button onClick={handleGenerar} isLoading={isGenerando} disabled={isLoading || error} className="flex-1">
                            <FileSpreadsheet size={16} /> {t('reportes.generar_excel')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

/** Modal de Instituciones Financieras (CA13, IMPL-106) — a diferencia de Descuentos (snapshot
 * completo), depende de la quincena seleccionada en el layout (usePlanillaContext). Sin filtro
 * propio: reusa el selector de quincena que ya vive en PlanillaLayout para esta ruta. */
const ModalInstitucionesFinancieras: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const { t } = useTranslation();
    const { quincenaId, quincenaLabel } = usePlanillaContext();
    const { grupos, totalGeneral, totalFilas, isLoading, error } = useInstitucionesFinancierasReporte(quincenaId);
    const [isGenerando, setIsGenerando] = useState(false);

    const handleGenerar = async () => {
        setIsGenerando(true);
        try {
            const filas = grupos.flatMap((g) => g.filas.map((f) => ({
                [t('reportes.instituciones_col_institucion')]: g.institucion,
                [t('reportes.instituciones_col_codigo')]: f.codigoEmpleado,
                [t('reportes.instituciones_col_nombre')]: f.nombreEmpleado,
                [t('reportes.instituciones_col_monto')]: f.monto,
            })));
            await exportToExcel(filas, 'Instituciones_Financieras', 'Instituciones Financieras', { title: t('reportes.nombre_instituciones_financieras') });
            onClose();
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
                            <div className="w-8 h-8 rounded-lg bg-cyan-50 flex items-center justify-center">
                                <Banknote size={16} className="text-cyan-600" />
                            </div>
                            <div>
                                <h3 className="text-body font-bold text-heading">{t('reportes.nombre_instituciones_financieras')}</h3>
                                <p className="text-[11px] text-text-secondary">{quincenaLabel}</p>
                            </div>
                        </div>
                        <button type="button" onClick={onClose} className="text-text-secondary hover:text-heading transition-colors p-xs">
                            <X size={18} />
                        </button>
                    </div>
                    <div className="p-lg flex flex-col gap-md overflow-y-auto">
                        <p className="text-caption text-text-secondary">{t('reportes.desc_instituciones_financieras')}</p>
                        {error ? (
                            <p className="text-caption text-error">{t('reportes.error_cargar')}</p>
                        ) : isLoading ? (
                            <p className="text-caption text-text-secondary">{t('common.loading')}</p>
                        ) : grupos.length === 0 ? (
                            <p className="text-caption text-text-secondary">{t('reportes.sin_datos')}</p>
                        ) : (
                            <div className="flex flex-col gap-sm">
                                {grupos.map((g) => (
                                    <div key={g.institucion} className="flex items-center justify-between bg-surface rounded-lg px-md py-sm">
                                        <div>
                                            <p className="text-caption font-semibold text-heading">{g.institucion}</p>
                                            <p className="text-[11px] text-text-secondary">{t('reportes.contador_filas', { count: g.filas.length })}</p>
                                        </div>
                                        <p className="text-body font-bold text-heading">${g.subtotal.toFixed(2)}</p>
                                    </div>
                                ))}
                                <div className="flex items-center justify-between px-md py-sm border-t border-border">
                                    <p className="text-caption font-bold text-heading">{t('reportes.instituciones_total_general')}</p>
                                    <p className="text-body font-bold text-heading">${totalGeneral.toFixed(2)}</p>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="flex px-lg py-md border-t border-border shrink-0">
                        <Button onClick={handleGenerar} isLoading={isGenerando} disabled={isLoading || error || totalFilas === 0} className="flex-1">
                            <FileSpreadsheet size={16} /> {t('reportes.generar_excel')}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export const ReportesPlanillaView: React.FC = () => {
    const { t } = useTranslation();
    const [modalAbierto, setModalAbierto] = useState<ReporteKey | null>(null);

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <p className="text-caption text-text-secondary bg-white rounded-lg shadow-cards border border-border p-lg">{t('reportes.disclaimer')}</p>

            <p className="text-[11px] font-bold uppercase tracking-widest text-text-secondary">
                {t('reportes.contador_tipos', { count: REPORTES.length })}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-md">
                {REPORTES.map((r) => (
                    <div key={r.key} className="flex flex-col gap-2 bg-white rounded-lg shadow-cards border border-border p-lg">
                        <div className="flex items-start justify-between gap-2">
                            <div className={`w-9 h-9 rounded-xl ${r.iconBg} flex items-center justify-center shrink-0`}>
                                <r.icon size={18} className={r.iconColor} />
                            </div>
                            {!r.disponible && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded-full bg-amber-50 text-amber-700 shrink-0">
                                    <Clock size={11} /> {t('reportes.badge_formato_pendiente')}
                                </span>
                            )}
                        </div>
                        <p className="text-body font-semibold text-heading">{t(`reportes.nombre_${r.key}`)}</p>
                        <p className="text-caption text-text-secondary">{t(`reportes.desc_${r.key}`)}</p>
                        <div className="flex gap-1.5">
                            {r.formatos.map((f) => {
                                const IconoFormato = FORMATO_ICONOS[f] ?? FileSpreadsheet;
                                return (
                                <span key={f} className={`inline-flex items-center gap-1 text-[11px] font-semibold rounded-full px-2 py-0.5 border ${FORMATO_CLASES[f]}`}>
                                    <IconoFormato size={11} /> {f}
                                </span>
                                );
                            })}
                        </div>
                        {r.disponible && (
                            <button
                                type="button"
                                onClick={() => setModalAbierto(r.key)}
                                className="mt-1 self-start text-[12px] font-bold text-primary hover:text-primary-dark transition-colors"
                            >
                                {t('reportes.generar')}
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {modalAbierto === 'vacaciones_estado' && <ModalVacaciones onClose={() => setModalAbierto(null)} />}
            {modalAbierto === 'permisos' && <ModalPermisos onClose={() => setModalAbierto(null)} />}
            {modalAbierto === 'referencia_laboral' && <ReferenciaLaboralModal onClose={() => setModalAbierto(null)} />}
            {modalAbierto === 'descuentos_estado' && <ModalDescuentos onClose={() => setModalAbierto(null)} />}
            {modalAbierto === 'constancia_salario' && <ConstanciaSalarioModal onClose={() => setModalAbierto(null)} />}
            {modalAbierto === 'recibo_sueldo' && <ReciboSueldoModal onClose={() => setModalAbierto(null)} />}
            {modalAbierto === 'renta_anual' && <ConstanciaRetencionesModal onClose={() => setModalAbierto(null)} />}
            {modalAbierto === 'liquidacion_laboral' && <LiquidacionLaboralModal onClose={() => setModalAbierto(null)} />}
            {modalAbierto === 'finiquito' && <FiniquitoModal onClose={() => setModalAbierto(null)} />}
            {modalAbierto === 'instituciones_financieras' && <ModalInstitucionesFinancieras onClose={() => setModalAbierto(null)} />}
        </div>
    );
};
