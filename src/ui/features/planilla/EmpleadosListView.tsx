import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from 'react-i18next';
import { Users, Search, Plus, ChevronRight, Loader2, AlertCircle, X, Upload } from 'lucide-react';

import { useDebounce } from '../../../hooks/useDebounce';
import { usePermission } from '../../../hooks/usePermission';
import { usePlanillaEmpleadosStore } from '../../../store/planillaEmpleadosStore';
import { usePlanillaContext } from './PlanillaLayout';
import { useDepartamentosStore } from '../../../store/departamentosStore';
import { getColorClasses } from '../../../utils/departamentoColorUtils';
import { getCodigoEmpleado } from '../../../utils/empleadoCodigoUtils';
import { fmtSueldo } from '../../../utils/sueldoUtils';
import { PAGE_SIZE } from '../../../services/planillaEmpleadosService';
import type { Empleado, EmpleadoFilters } from '../../../services/planillaEmpleadosService';

import { InputField } from '../../components/InputField';
import { Button } from '../../components/Button';
import { StatusBadge } from '../../components/StatusBadge';
import { Pagination } from '../../components/Pagination';
import { LoadMoreButton } from '../../components/LoadMoreButton';
import { Banner } from '../../components/Banner';
import { PageLoader } from '../../components/PageLoader';
import { ImportarEmpleadosModal } from './components/ImportarEmpleadosModal';

function initials(nombre: string): string {
    return nombre.split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function fmtFecha(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'short', year: 'numeric' });
}

function estadoBadgeStatus(estado: 'activo' | 'inactivo' | 'liquidado'): string {
    if (estado === 'activo') return 'Approved';
    if (estado === 'liquidado') return 'Delivered';
    return 'Cancelled';
}

type FiltroEstado = 'Todos' | 'Activo' | 'Inactivo' | 'Liquidado';

const FILTRO_TO_ESTADO: Record<FiltroEstado, EmpleadoFilters['estado']> = {
    Todos: undefined,
    Activo: 'activo',
    Inactivo: 'inactivo',
    Liquidado: 'liquidado',
};

export const EmpleadosListView: React.FC = () => {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const permission = usePermission('planilla_empleados');

    const {
        empleados, isLoading, error, hasMore,
        page, totalCount, totalPages,
        indicadores, indicadoresError,
        storedSearchQuery, storedFilters,
        fetchEmpleados, fetchPage, setFilters, fetchIndicadores,
    } = usePlanillaEmpleadosStore(
        useShallow(state => ({
            empleados: state.empleados,
            isLoading: state.isLoading,
            error: state.error,
            hasMore: state.hasMore,
            page: state.page,
            totalCount: state.totalCount,
            totalPages: state.totalPages,
            indicadores: state.indicadores,
            indicadoresError: state.indicadoresError,
            storedSearchQuery: state.searchQuery,
            storedFilters: state.filters,
            fetchEmpleados: state.fetchEmpleados,
            fetchPage: state.fetchPage,
            setFilters: state.setFilters,
            fetchIndicadores: state.fetchIndicadores,
        }))
    );

    // QA-Empleados gap #7 — searchTerm/filtroEstado vivían solo en useState local: al volver de
    // /planilla/empleados/:id, esta vista remonta desde cero y perdía la búsqueda/filtro que el
    // usuario tenía activos. El store (searchQuery/filters) ya sobrevive el remount — se usa como
    // fuente de verdad inicial, mismo patrón que el resto del estado de paginación de esta store.
    // Nota: se lee una sola vez como valor inicial de useState (no como fuente reactiva) — el
    // usuario sigue editando estos campos localmente para no re-renderizar en cada tecla tipeada.
    const [searchTerm, setSearchTerm] = useState(storedSearchQuery ?? '');
    const debouncedSearch = useDebounce(searchTerm, 300);
    const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>(() => {
        const estado = storedFilters?.estado;
        return estado === 'activo' ? 'Activo' : estado === 'inactivo' ? 'Inactivo' : estado === 'liquidado' ? 'Liquidado' : 'Todos';
    });

    // CA5 (IMPL-2) — "Nuevos" cuenta altas dentro de la quincena seleccionada, no una ventana fija
    // de 30 días. El selector vive en el header compartido (PlanillaLayout, US-UX-02) — antes
    // era un select local pegado a esta tarjeta, ahora consume la misma quincena que el resto
    // del módulo, sin filtrar el listado completo de empleados (solo esta tarjeta usa el rango).
    const { quincena: quincenaSeleccionada } = usePlanillaContext();

    // IMPL-2 gap #2 (RESUELTO, revisión historia por historia) — el color del badge ya no se
    // asigna por hash del nombre, viene del catálogo real de planilla_departamentos.
    const { departamentos, fetchDepartamentos } = useDepartamentosStore();
    useEffect(() => { fetchDepartamentos(); }, [fetchDepartamentos]);
    const colorPorDepartamento = useMemo(
        () => new Map(departamentos.map((d) => [d.nombre, d.color_key])),
        [departamentos]
    );
    const getDepartamentoColor = (departamento: string | null) => getColorClasses(departamento ? colorPorDepartamento.get(departamento) : undefined);

    useEffect(() => {
        fetchIndicadores(
            quincenaSeleccionada
                ? { fechaInicio: quincenaSeleccionada.fecha_inicio, fechaFin: quincenaSeleccionada.fecha_fin }
                : undefined
        );
    }, [fetchIndicadores, quincenaSeleccionada]);

    useEffect(() => {
        const filters: EmpleadoFilters = { estado: FILTRO_TO_ESTADO[filtroEstado] };
        setFilters(filters);
        fetchEmpleados(1, debouncedSearch, filters);
    }, [debouncedSearch, filtroEstado, fetchEmpleados, setFilters]);

    const handleLoadMore = useCallback(() => {
        fetchEmpleados(page + 1, debouncedSearch, { estado: FILTRO_TO_ESTADO[filtroEstado] });
    }, [fetchEmpleados, page, debouncedSearch, filtroEstado]);

    const handlePageChange = useCallback((newPage: number) => {
        fetchPage(newPage, debouncedSearch, { estado: FILTRO_TO_ESTADO[filtroEstado] });
        document.getElementById('empleados-table-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, [fetchPage, debouncedSearch, filtroEstado]);

    // QA-Empleados gap #2 — un fetch fallido no puede quedar indistinguible de una lista
    // realmente vacía. "Reintentar" repite la misma llamada que ya dispara el efecto de montaje
    // (fetchEmpleados a la página 1, con la búsqueda y el filtro de estado actuales).
    const handleRetry = useCallback(() => {
        fetchEmpleados(1, debouncedSearch, { estado: FILTRO_TO_ESTADO[filtroEstado] });
    }, [fetchEmpleados, debouncedSearch, filtroEstado]);

    // QA-Empleados gap #4 — mismo criterio que handleRetry de arriba, pero para las 4 tarjetas de
    // indicadores: repite la misma llamada que dispara el efecto de montaje (quincena seleccionada
    // actual, o sin período si todavía no hay ninguna).
    const handleRetryIndicadores = useCallback(() => {
        fetchIndicadores(
            quincenaSeleccionada
                ? { fechaInicio: quincenaSeleccionada.fecha_inicio, fechaFin: quincenaSeleccionada.fecha_fin }
                : undefined
        );
    }, [fetchIndicadores, quincenaSeleccionada]);

    const [mostrarImportar, setMostrarImportar] = useState(false);
    const handleImportado = useCallback(() => {
        fetchEmpleados(1, debouncedSearch, { estado: FILTRO_TO_ESTADO[filtroEstado] });
        fetchIndicadores(
            quincenaSeleccionada
                ? { fechaInicio: quincenaSeleccionada.fecha_inicio, fechaFin: quincenaSeleccionada.fecha_fin }
                : undefined
        );
    }, [fetchEmpleados, debouncedSearch, filtroEstado, fetchIndicadores, quincenaSeleccionada]);

    const canCreate = permission?.can_create ?? false;
    const hayFiltrosActivos = searchTerm.trim() !== '' || filtroEstado !== 'Todos';
    const handleLimpiarFiltros = () => {
        setSearchTerm('');
        setFiltroEstado('Todos');
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            {/* ── Indicadores ── */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-md">
                {/* QA-Empleados gap #4 — un fetch fallido de indicadores no puede quedar
                    indistinguible de un tenant genuinamente sin empleados: mismo criterio que el
                    banner de error de la tabla (abajo), en versión compacta para no romper el
                    layout de las 4 tarjetas. Los valores caen a "—" (no 0) mientras dure el error. */}
                {indicadoresError && (
                    <div className="col-span-2 lg:col-span-4 flex items-center justify-between gap-sm bg-error/5 border border-error/20 rounded-lg px-md py-sm">
                        <div className="flex items-center gap-sm text-error min-w-0">
                            <AlertCircle size={16} className="shrink-0" />
                            <span className="text-caption font-medium truncate">{t('empleados.error_cargar_indicadores')}</span>
                        </div>
                        <Button variant="secondary" onClick={handleRetryIndicadores} className="h-7 px-sm text-[12px] shrink-0">
                            {t('common.retry')}
                        </Button>
                    </div>
                )}
                {[
                    { label: t('empleados.stat_total'), value: indicadoresError ? '—' : indicadores?.total ?? 0, color: 'text-heading' },
                    { label: t('empleados.stat_active'), value: indicadoresError ? '—' : indicadores?.activos ?? 0, color: 'text-primary' },
                    { label: t('empleados.stat_inactive'), value: indicadoresError ? '—' : indicadores?.inactivos ?? 0, color: 'text-text-secondary' },
                ].map(s => (
                    <div key={s.label} className="bg-white rounded-lg shadow-cards border border-border p-md">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{s.label}</p>
                        <p className={`text-[1.75rem] font-bold mt-xs ${s.color}`}>{s.value}</p>
                    </div>
                ))}

                {/* CA5 (IMPL-2) — cuenta altas de la quincena seleccionada en el header compartido
                    ("Nuevos"), no filtra el resto de la pantalla (el listado sigue mostrando
                    todos los empleados sin importar la quincena elegida). */}
                <div className="bg-white rounded-lg shadow-cards border border-border p-md">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t('empleados.stat_new')}</p>
                    <p className="text-[1.75rem] font-bold mt-xs text-secondary-dark">{indicadoresError ? '—' : indicadores?.nuevos ?? 0}</p>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-cards border border-border flex flex-col w-full flex-1 min-h-0 overflow-hidden relative">

                {/* ── Toolbar: Búsqueda + Filtro rápido + Nuevo empleado ── */}
                <div className="sticky top-0 z-20 bg-surface/80 backdrop-blur-sm border-b border-border p-md flex flex-col sm:flex-row gap-sm items-stretch sm:items-center justify-between">
                    <InputField
                        isSearch
                        placeholder={t('empleados.search_placeholder')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        onClear={() => setSearchTerm('')}
                        className="flex-1 min-w-0"
                    />
                    <div className="flex gap-sm items-center shrink-0">
                        <div className="flex gap-xs bg-surface rounded-lg p-1">
                            {(['Todos', 'Activo', 'Inactivo', 'Liquidado'] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setFiltroEstado(f)}
                                    className={`px-md py-sm rounded-md text-[13px] font-semibold transition-colors
                                        ${filtroEstado === f ? 'bg-white text-primary shadow-cards' : 'text-text-secondary hover:text-heading'}`}
                                >
                                    {f === 'Todos' ? t('empleados.filter_all')
                                        : f === 'Activo' ? t('empleados.filter_active')
                                            : f === 'Inactivo' ? t('empleados.filter_inactive')
                                                : t('empleados.filter_liquidado')}
                                </button>
                            ))}
                        </div>
                        {hayFiltrosActivos && (
                            <button
                                type="button"
                                onClick={handleLimpiarFiltros}
                                className="flex items-center gap-xs px-md py-2 text-[13px] font-semibold text-text-secondary hover:text-heading transition-colors shrink-0"
                            >
                                <X size={14} /> {t('empleados.action_limpiar_filtros')}
                            </button>
                        )}
                        {canCreate && (
                            <Button
                                variant="secondary"
                                onClick={() => setMostrarImportar(true)}
                                className="flex items-center justify-center p-sm md:px-md shadow-sm shrink-0 h-[42px] w-auto"
                            >
                                <Upload size={20} className="sm:mr-2" />
                                <span className="hidden sm:inline-block">{t('empleados.importacion_action_abrir')}</span>
                            </Button>
                        )}
                        {canCreate && (
                            <Button
                                onClick={() => navigate('/planilla/empleados/nuevo')}
                                className="flex items-center justify-center p-sm md:px-md shadow-sm shrink-0 h-[42px] w-auto"
                            >
                                <Plus size={20} className="sm:mr-2" />
                                <span className="hidden sm:inline-block">{t('empleados.new_employee')}</span>
                            </Button>
                        )}
                    </div>
                </div>

                {/* ── Contenido Principal ── */}
                {isLoading && empleados.length === 0 ? (
                    <>
                        {/* QA-Empleados gap #3 — el skeleton de tabla es desktop-only; sin este
                            bloque, mobile (<lg) no muestra nada durante la primera carga. */}
                        <div className="lg:hidden">
                            <PageLoader label={t('common.loading')} />
                        </div>
                        <div className="hidden lg:flex flex-col overflow-hidden animate-pulse w-full">
                            <table className="w-full text-left border-collapse">
                                <tbody className="divide-y divide-border/50">
                                    {[1, 2, 3, 4, 5].map(i => (
                                        <tr key={i}>
                                            <td className="p-md"><div className="h-4 bg-surface rounded w-40"></div></td>
                                            <td className="p-md"><div className="h-4 bg-surface rounded w-28"></div></td>
                                            <td className="p-md"><div className="h-4 bg-surface rounded w-24"></div></td>
                                            <td className="p-md"><div className="h-4 bg-surface rounded w-20"></div></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                ) : error && empleados.length === 0 ? (
                    // QA-Empleados gap #2 — un fetch fallido no puede quedar indistinguible de
                    // una lista realmente vacía: banner de error distinto del empty-state, con
                    // acción para reintentar la misma carga.
                    <div className="p-xl flex flex-col items-center justify-center min-h-[400px]">
                        <Banner
                            variant="error"
                            title={t('empleados.error_cargar')}
                            description={error}
                            action={
                                <Button variant="secondary" onClick={handleRetry}>
                                    {t('common.retry')}
                                </Button>
                            }
                            className="max-w-112"
                        />
                    </div>
                ) : empleados.length === 0 ? (
                    <div className="p-xl text-center flex flex-col items-center justify-center min-h-[400px]">
                        <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mb-md">
                            {searchTerm
                                ? <Search size={32} className="text-text-secondary/50" />
                                : <Users size={32} className="text-text-secondary/50" />}
                        </div>
                        <h3 className="text-h3 text-heading">
                            {searchTerm ? `${t('common.no_results')} "${searchTerm}"` : t('empleados.no_employees')}
                        </h3>
                        <p className="text-body text-text-secondary mt-xs max-w-[300px]">
                            {searchTerm ? t('empleados.no_employees_desc_search') : t('empleados.no_employees_desc_empty')}
                        </p>
                        {searchTerm && (
                            <Button variant="secondary" className="mt-md" onClick={() => setSearchTerm('')}>
                                {t('common.clear_search')}
                            </Button>
                        )}
                    </div>
                ) : (
                    <>
                        {/* ── Mobile: cards + Load More ── */}
                        <div className="lg:hidden">
                            <div className="grid grid-cols-1 gap-md p-md bg-surface/10">
                                {empleados.map((emp: Empleado) => (
                                    <button
                                        key={emp.id}
                                        onClick={() => navigate(`/planilla/empleados/${emp.id}`)}
                                        className="text-left bg-white rounded-lg shadow-cards border border-border p-md flex items-center gap-sm w-full"
                                    >
                                        <div className="w-10 h-10 rounded-full bg-primary-light flex items-center justify-center font-bold text-primary shrink-0">
                                            {initials(emp.nombre_completo)}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-heading truncate">{emp.nombre_completo}</p>
                                            <p className="text-caption text-text-secondary truncate">{emp.cargo || '—'}</p>
                                            <div className="flex flex-wrap gap-1 mt-xs">
                                                {emp.departamento && (
                                                    <span className={`text-[10px] font-bold px-sm py-0.5 rounded-full ${getDepartamentoColor(emp.departamento)}`}>
                                                        {emp.departamento}
                                                    </span>
                                                )}
                                                <StatusBadge status={estadoBadgeStatus(emp.estado)} customLabel={
                                                    emp.estado === 'activo' ? t('empleados.filter_active')
                                                        : emp.estado === 'liquidado' ? t('empleados.filter_liquidado')
                                                            : t('empleados.filter_inactive')
                                                } />
                                            </div>
                                        </div>
                                        <ChevronRight size={18} className="text-text-secondary/40 shrink-0" />
                                    </button>
                                ))}
                            </div>

                            {hasMore && (
                                <LoadMoreButton
                                    onClick={handleLoadMore}
                                    isLoading={isLoading}
                                    label={t('empleados.load_more')}
                                    loadingLabel={t('common.loading')}
                                />
                            )}
                        </div>

                        {/* ── Desktop: tabla + Pagination ── */}
                        <div className="hidden lg:flex flex-col overflow-hidden w-full">
                            <div id="empleados-table-top" />
                            <div className="relative">
                                {isLoading && empleados.length > 0 && (
                                    <div className="absolute inset-0 z-10 bg-white/70 flex items-center justify-center rounded-sm">
                                        <Loader2 size={28} className="animate-spin text-primary" />
                                    </div>
                                )}

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-surface border-b border-border text-caption text-text-secondary uppercase tracking-wider">
                                                <th className="p-md font-semibold w-[30%]">{t('empleados.table_employee')}</th>
                                                <th className="p-md font-semibold w-[18%]">{t('empleados.table_position')}</th>
                                                <th className="p-md font-semibold w-[16%]">{t('empleados.table_department')}</th>
                                                <th className="p-md font-semibold w-[12%]">{t('empleados.table_hire_date')}</th>
                                                <th className="p-md font-semibold w-[10%] text-right">{t('empleados.table_salary')}</th>
                                                <th className="p-md font-semibold w-[10%] text-center">{t('empleados.table_status')}</th>
                                                <th className="p-md w-[4%]"></th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-border/50">
                                            {empleados.map((emp: Empleado) => (
                                                <tr
                                                    key={emp.id}
                                                    onClick={() => navigate(`/planilla/empleados/${emp.id}`)}
                                                    className="hover:bg-surface/50 cursor-pointer transition-colors group"
                                                >
                                                    <td className="p-md">
                                                        <div className="flex items-center gap-sm">
                                                            <div className="w-9 h-9 rounded-full bg-primary-light flex items-center justify-center font-bold text-primary shrink-0">
                                                                {initials(emp.nombre_completo)}
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="font-semibold text-heading truncate">{emp.nombre_completo}</p>
                                                                <p className="text-[11px] text-text-secondary truncate">{getCodigoEmpleado(emp)}</p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-md text-body text-text-secondary">{emp.cargo || '—'}</td>
                                                    <td className="p-md">
                                                        {emp.departamento ? (
                                                            <span className={`text-[11px] font-bold px-sm py-1 rounded-full ${getDepartamentoColor(emp.departamento)}`}>
                                                                {emp.departamento}
                                                            </span>
                                                        ) : <span className="opacity-30 italic text-caption">—</span>}
                                                    </td>
                                                    <td className="p-md text-caption text-text-secondary">{fmtFecha(emp.fecha_ingreso)}</td>
                                                    <td className="p-md text-right font-semibold text-heading">{fmtSueldo(emp.sueldo_mensual)}</td>
                                                    <td className="p-md text-center">
                                                        <StatusBadge status={estadoBadgeStatus(emp.estado)} customLabel={
                                                            emp.estado === 'activo' ? t('empleados.filter_active')
                                                                : emp.estado === 'liquidado' ? t('empleados.filter_liquidado')
                                                                    : t('empleados.filter_inactive')
                                                        } />
                                                    </td>
                                                    <td className="p-md">
                                                        <ChevronRight size={16} className="text-text-secondary/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {totalPages > 1 && (
                                <div className="border-t border-border p-md">
                                    <Pagination
                                        currentPage={page}
                                        totalPages={totalPages}
                                        totalItems={totalCount}
                                        pageSize={PAGE_SIZE}
                                        onPageChange={handlePageChange}
                                    />
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>

            {mostrarImportar && (
                <ImportarEmpleadosModal
                    onClose={() => setMostrarImportar(false)}
                    onImportado={handleImportado}
                />
            )}
        </div>
    );
};
