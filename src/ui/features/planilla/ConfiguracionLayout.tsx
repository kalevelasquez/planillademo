import React from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { CalendarDays, MapPin, Building2, Briefcase, Landmark, FileSignature, Clock, Gauge, Tags, LineChart, Percent, Droplets, Navigation } from 'lucide-react';

import { useAuthStore } from '../../../store/authStore';
import { ROLES } from '../../../config/constants';

interface CatalogoMeta {
    key: string;
    path: string;
    icon: React.ElementType;
    labelKey: string;
    /** Roles con acceso a este catálogo — si no se define, es admin-only (comportamiento por defecto). */
    roles?: string[];
}

interface GrupoMeta {
    key: string;
    labelKey: string;
    icon: React.ElementType;
    catalogos: CatalogoMeta[];
}

const GRUPOS: GrupoMeta[] = [
    {
        key: 'estructura', labelKey: 'configuracion.grupo_estructura', icon: Building2,
        catalogos: [
            { key: 'empresa', path: 'empresa', icon: Building2, labelKey: 'configuracion.empresa_title', roles: [ROLES.ADMIN, ROLES.PREPARADOR_PLANILLA, ROLES.APROBADOR_PLANILLA] },
            { key: 'ubicaciones', path: 'ubicaciones', icon: MapPin, labelKey: 'horasExtras.ubicaciones_title' },
            { key: 'departamentos', path: 'departamentos', icon: Building2, labelKey: 'empleados.departamentos_title' },
            { key: 'cargos', path: 'cargos', icon: Briefcase, labelKey: 'empleados.cargos_title' },
            { key: 'bancos', path: 'bancos', icon: Landmark, labelKey: 'empleados.bancos_title' },
            { key: 'tipos-contrato', path: 'tipos-contrato', icon: FileSignature, labelKey: 'empleados.tiposContrato_title' },
        ],
    },
    {
        key: 'ingresos', labelKey: 'configuracion.grupo_ingresos', icon: Gauge,
        catalogos: [
            { key: 'jornadas', path: 'jornadas', icon: Clock, labelKey: 'horasExtras.jornadas_title' },
            { key: 'tarifas-km', path: 'tarifas-km', icon: Gauge, labelKey: 'viaticos.tarifas_km_title' },
            { key: 'lavado-gasolina', path: 'lavado-gasolina', icon: Droplets, labelKey: 'viaticos.lavado_gasolina_config_title' },
            { key: 'destinos', path: 'destinos', icon: Navigation, labelKey: 'viaticos.destinos_config_title' },
            { key: 'otros-ingresos-conceptos', path: 'otros-ingresos-conceptos', icon: Tags, labelKey: 'otrosIngresos.conceptos_config_title' },
            { key: 'tablas-incentivos', path: 'tablas-incentivos', icon: LineChart, labelKey: 'bonificaciones.tablas_incentivos_title' },
        ],
    },
    {
        key: 'descuentos', labelKey: 'configuracion.grupo_descuentos', icon: Percent,
        catalogos: [
            { key: 'descuento-categorias', path: 'descuento-categorias', icon: Percent, labelKey: 'descuentoCategorias.categorias_config_title' },
        ],
    },
    {
        key: 'calendario', labelKey: 'configuracion.grupo_calendario', icon: CalendarDays,
        catalogos: [
            { key: 'feriados', path: 'feriados', icon: CalendarDays, labelKey: 'quincenas.feriados_title' },
        ],
    },
];

const ALL_CATALOGOS = GRUPOS.flatMap((g) => g.catalogos.map((c) => ({ ...c, grupoLabelKey: g.labelKey })));

/**
 * Layout maestro-detalle de Configuración de Planilla (fidelidad al DEMO) — reemplaza el hub
 * de tarjetas por un sidebar de categorías (desktop) / chips horizontales (mobile) que
 * envuelve las 13 rutas de catálogo vía `<Outlet/>`.
 * A diferencia del DEMO (una sola vista con estado en memoria, sin persistencia), acá cada
 * catálogo sigue siendo su propia ruta real — se preserva el deep-linking y los permisos por
 * ruta ya existentes, solo se cambia el tratamiento visual a master-detail.
 * Desde IMPL-168, la ruta padre ya no es admin-only (Preparador/Aprobador necesitan leer
 * "Empresa" para sus reportes) — cada catálogo admin-only sigue protegido individualmente en
 * App.tsx, y acá se filtra por `roles` para que Preparador/Aprobador solo vean lo suyo.
 */
export const ConfiguracionLayout: React.FC = () => {
    const { t } = useTranslation();
    const location = useLocation();
    const { profile } = useAuthStore();
    const activo = ALL_CATALOGOS.find((c) => location.pathname.endsWith(`/${c.path}`));

    const puedeVer = (cat: CatalogoMeta) => (cat.roles ?? [ROLES.ADMIN]).includes(profile?.role ?? '');
    const gruposVisibles = GRUPOS
        .map((grupo) => ({ ...grupo, catalogos: grupo.catalogos.filter(puedeVer) }))
        .filter((grupo) => grupo.catalogos.length > 0);

    return (
        <div className="flex flex-col lg:flex-row gap-0 min-h-full max-w-7xl mx-auto w-full">
            {/* Sidebar desktop */}
            <aside className="hidden lg:flex flex-col w-60 border-r border-border shrink-0 py-lg">
                {gruposVisibles.map((grupo) => (
                    <div key={grupo.key} className="flex flex-col">
                        <div className="flex items-center gap-xs px-lg py-sm">
                            <grupo.icon size={14} className="text-text-secondary" />
                            <span className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t(grupo.labelKey as any)}</span>
                        </div>
                        {grupo.catalogos.map((cat) => (
                            <NavLink
                                key={cat.key}
                                to={cat.path}
                                className={({ isActive }) => `flex items-center px-lg py-sm text-left text-[13px] font-semibold transition-colors border-l-2 pl-md
                                    ${isActive ? 'bg-primary-light text-primary border-primary' : 'text-text-secondary border-transparent hover:bg-surface hover:text-heading'}`}
                            >
                                {t(cat.labelKey as any)}
                            </NavLink>
                        ))}
                        <div className="my-sm mx-lg border-b border-border" />
                    </div>
                ))}
            </aside>

            {/* Chips mobile */}
            <div className="lg:hidden overflow-x-auto border-b border-border bg-white sticky top-0 z-10 -mx-4 px-4 sm:-mx-6 sm:px-6">
                <div className="flex gap-xs py-sm whitespace-nowrap">
                    {gruposVisibles.map((grupo) => (
                        <div key={grupo.key} className="flex gap-xs">
                            {grupo.catalogos.map((cat) => (
                                <NavLink
                                    key={cat.key}
                                    to={cat.path}
                                    className={({ isActive }) => `shrink-0 px-md py-xs rounded-full text-[12px] font-semibold transition-colors border
                                        ${isActive ? 'bg-primary text-white border-primary' : 'bg-surface text-text-secondary border-border hover:border-primary/30'}`}
                                >
                                    {t(cat.labelKey as any)}
                                </NavLink>
                            ))}
                            <div className="w-px bg-border mx-xs" />
                        </div>
                    ))}
                </div>
            </div>

            <div className="flex-1 min-w-0 px-4 sm:px-6 lg:px-8 py-lg">
                {activo && (
                    <div className="mb-lg">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-text-secondary">{t(activo.grupoLabelKey as any)}</p>
                        <h2 className="text-h2 font-bold text-heading">{t(activo.labelKey as any)}</h2>
                    </div>
                )}
                <Outlet />
            </div>
        </div>
    );
};
