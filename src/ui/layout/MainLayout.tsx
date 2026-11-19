import React, { useEffect, useState, useMemo } from 'react';
import { NavLink, useLocation, Outlet } from 'react-router-dom';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Logger } from '../../utils/logger';
import ShoppingCart from 'lucide-react/dist/esm/icons/shopping-cart';
import Users from 'lucide-react/dist/esm/icons/users';
import Package from 'lucide-react/dist/esm/icons/package';
import LayoutDashboard from 'lucide-react/dist/esm/icons/layout-dashboard';
import Palette from 'lucide-react/dist/esm/icons/palette';
import Truck from 'lucide-react/dist/esm/icons/truck';
import Settings from 'lucide-react/dist/esm/icons/settings';
import UserCheck from 'lucide-react/dist/esm/icons/user-check';
import Shield from 'lucide-react/dist/esm/icons/shield';
import History from 'lucide-react/dist/esm/icons/history';
import Menu from 'lucide-react/dist/esm/icons/menu';
import X from 'lucide-react/dist/esm/icons/x';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3';
import Activity from 'lucide-react/dist/esm/icons/activity';
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock';
import Clock8 from 'lucide-react/dist/esm/icons/clock-8';
import Wallet from 'lucide-react/dist/esm/icons/wallet';
import Wallet2 from 'lucide-react/dist/esm/icons/wallet-2';
import HeartPulse from 'lucide-react/dist/esm/icons/heart-pulse';
import HandCoins from 'lucide-react/dist/esm/icons/hand-coins';
import Landmark from 'lucide-react/dist/esm/icons/landmark';
import CalendarRange from 'lucide-react/dist/esm/icons/calendar-range';
import CalendarOff from 'lucide-react/dist/esm/icons/calendar-off';
import Gift from 'lucide-react/dist/esm/icons/gift';
import Calculator from 'lucide-react/dist/esm/icons/calculator';
import FileSpreadsheet from 'lucide-react/dist/esm/icons/file-spreadsheet';
import ClipboardList from 'lucide-react/dist/esm/icons/clipboard-list';
import ClipboardCheck from 'lucide-react/dist/esm/icons/clipboard-check';
import ShieldCheck from 'lucide-react/dist/esm/icons/shield-check';
import Bot from 'lucide-react/dist/esm/icons/bot';
import BrandLogo from '../../assets/images/logo-teknergy.png';
import { useAuthStore } from '../../store/authStore';
import { ROLES } from '../../config/constants';
import { Navbar } from './Navbar';
import { permissionService, type Permission } from '../../services/permissionService';

interface MainLayoutProps {
    children?: React.ReactNode;
}

interface NavLeaf {
    icon: React.ReactElement;
    label: string;
    path: string;
}

interface NavGroup {
    icon: React.ReactElement;
    label: string;
    children: NavLeaf[];
}

type NavEntry = NavLeaf | NavGroup;

const isGroup = (entry: NavEntry): entry is NavGroup => 'children' in entry;

const isLeafActive = (pathname: string, leafPath: string) =>
    pathname === leafPath || pathname.startsWith(`${leafPath}/`);

export const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
    const { profile } = useAuthStore();
    const location = useLocation();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    // El Guardián de Actividad y Sincronización Realtime se ha centralizado en App.tsx (US-OBS-02)
    // para evitar duplicidad de conexiones y fugas de memoria.

    // ── GESTIÓN DE PERMISOS DINÁMICOS ──────────
    const [myPermissions, setMyPermissions] = useState<Permission[]>([]);

    useEffect(() => {
        const fetchMyPerms = async () => {
            if (!profile?.id || !profile?.tenant_id) return;
            try {
                const perms = await permissionService.getMyPermissions(
                    profile.tenant_id,
                    profile.roles || (profile.role ? [profile.role] : [])
                );
                setMyPermissions(perms);
            } catch (error) {
                Logger.error('Error al cargar permisos para el menú', { tenantId: profile.tenant_id }, error);
            }
        };
        fetchMyPerms();
    }, [profile?.id, profile?.tenant_id, JSON.stringify(profile?.roles)]);

    // ── ESTRUCTURA DEL MENÚ (IMPL-119, reorganización del menú) ──────────
    // "Pedidos" y "Planilla" pasan de ítem único a grupo padre/hijo colapsable — el resto de
    // ítems top-level quedan como antes (hojas planas). El click en la etiqueta del padre solo
    // expande/colapsa, nunca navega (decisión explícita) — por eso el listado de pedidos en sí
    // (antes la página del padre) pasa a ser su primer hijo, "Pedidos".
    const navItems = useMemo(() => {
        const items: NavEntry[] = [
            { icon: <LayoutDashboard size={24} />, label: 'Inicio', path: '/' },
        ];

        const canView = (resource: string) => myPermissions.find(p => p.resource === resource)?.can_view;
        const roles = Array.isArray(profile?.roles) ? profile.roles : profile?.role ? [profile.role] : [];
        const isAdmin = roles.includes(ROLES.ADMIN);

        const pedidosChildren: NavLeaf[] = [];
        if (canView('pedidos')) pedidosChildren.push({ icon: <ShoppingCart size={20} />, label: 'Pedidos', path: '/pedidos' });
        if (canView('clientes')) pedidosChildren.push({ icon: <Users size={20} />, label: 'Clientes', path: '/clientes' });
        if (canView('inventario')) pedidosChildren.push({ icon: <Package size={20} />, label: 'Productos', path: '/inventario' });
        if (canView('despacho')) pedidosChildren.push({ icon: <Truck size={20} />, label: 'Despacho', path: '/despacho' });
        if (pedidosChildren.length > 0) {
            items.push({ icon: <ShoppingCart size={24} />, label: 'Pedidos', children: pedidosChildren });
        }

        if (canView('planilla_empleados')) {
            const planillaChildren: NavLeaf[] = [
                { icon: <Users size={20} />, label: 'Empleados', path: '/planilla/empleados' },
                { icon: <CalendarClock size={20} />, label: 'Quincenas', path: '/planilla' },
                { icon: <History size={20} />, label: 'Historial de Quincenas', path: '/planilla/historial' },
                { icon: <Clock8 size={20} />, label: 'Horas Extra', path: '/planilla/horas-extras' },
                { icon: <Wallet size={20} />, label: 'Viáticos', path: '/planilla/viaticos' },
                { icon: <HeartPulse size={20} />, label: 'Incapacidades', path: '/planilla/incapacidades' },
                { icon: <HandCoins size={20} />, label: 'Anticipos', path: '/planilla/anticipos' },
                { icon: <Landmark size={20} />, label: 'Descuentos', path: '/planilla/descuentos' },
                { icon: <CalendarRange size={20} />, label: 'Vacaciones', path: '/planilla/vacaciones' },
                { icon: <CalendarOff size={20} />, label: 'Permisos', path: '/planilla/permisos-empleados' },
                { icon: <Gift size={20} />, label: 'Bonificaciones', path: '/planilla/bonificaciones' },
                { icon: <Wallet2 size={20} />, label: 'Otros Ingresos', path: '/planilla/otros-ingresos' },
                { icon: <Calculator size={20} />, label: 'Cálculo de Planilla', path: '/planilla/calculo' },
                { icon: <FileSpreadsheet size={20} />, label: 'Exportaciones', path: '/planilla/exportaciones' },
                { icon: <ClipboardList size={20} />, label: 'Reportes de Planilla', path: '/planilla/reportes' },
                // Config. de Planilla no es admin-only desde IMPL-168: Preparador/Aprobador
                // necesitan leer "Empresa" para sus reportes (ver ConfiguracionLayout.tsx) — sin
                // esta entrada de menú, esos roles solo podían llegar escribiendo la URL a mano.
                ...(isAdmin || roles.includes(ROLES.PREPARADOR_PLANILLA) || roles.includes(ROLES.APROBADOR_PLANILLA) ? [
                    { icon: <Settings size={20} />, label: 'Configuración de Planilla', path: '/planilla/configuracion' },
                ] : []),
                ...(isAdmin ? [
                    { icon: <ClipboardCheck size={20} />, label: 'Go-Live Checklist', path: '/planilla/go-live' },
                ] : []),
                { icon: <ShieldCheck size={20} />, label: 'Matriz de Permisos', path: '/planilla/permisos' },
                { icon: <Bot size={20} />, label: 'Asistente de IA', path: '/planilla/asistente' },
            ];
            items.push({ icon: <Users size={24} />, label: 'Planilla', children: planillaChildren });
        }

        if (canView('usuarios')) {
            items.push({ icon: <UserCheck size={24} />, label: 'Usuarios', path: '/administrar/usuarios' });
        }
        if (canView('roles')) {
            items.push({ icon: <Shield size={24} />, label: 'Roles y Permisos', path: '/administrar/roles' });
        }
        if (canView('auditoria')) {
            items.push({ icon: <History size={24} />, label: 'Auditoría', path: '/administrar/auditoria' });
        }
        if (canView('monitoreo')) {
            items.push({ icon: <Activity size={24} />, label: 'Estado del Sistema', path: '/administrar/monitoreo' });
        }
        if (canView('reportes')) {
            items.push({ icon: <BarChart3 size={24} />, label: 'Reportes BI', path: '/administrar/reportes' });
        }
        if (canView('config')) {
            items.push({ icon: <Settings size={24} />, label: 'Configuraciones', path: '/configuracion' });
        }
        if (import.meta.env.DEV) {
            items.push({ icon: <Palette size={24} />, label: 'UI Kit (Dev)', path: '/design-system' });
        }
        return items;
    }, [myPermissions, profile?.roles, profile?.role]);

    // Expande automáticamente el grupo que contiene la ruta activa (ej. entrar directo a
    // /planilla/viaticos por URL ya muestra "Planilla" abierto con "Viáticos" resaltado).
    useEffect(() => {
        const activeGroup = navItems.find(entry => isGroup(entry) && entry.children.some(c => isLeafActive(location.pathname, c.path)));
        if (activeGroup) {
            setExpandedGroups(prev => (prev.has(activeGroup.label) ? prev : new Set(prev).add(activeGroup.label)));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname, navItems]);

    const toggleGroup = (label: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(label)) next.delete(label); else next.add(label);
            return next;
        });
    };

    // --- Lógica de Navegación Móvil (Agrupación) ---
    // Un grupo va al bottom-nav "principal" solo si TODOS sus hijos están en mainPaths (hoy,
    // exclusivamente "Pedidos") — en ese caso desaparece del drawer secundario, porque ya es
    // 100% accesible desde abajo. "Planilla" (ningún hijo en mainPaths) queda entero en el
    // drawer, como grupo colapsable igual que en el sidebar de escritorio.
    const mainPaths = ['/', '/pedidos', '/clientes', '/inventario', '/despacho'];
    const flattenLeaves = (entries: NavEntry[]): NavLeaf[] =>
        entries.flatMap(entry => (isGroup(entry) ? entry.children : [entry]));

    const mainMobileItems = flattenLeaves(navItems).filter(leaf => mainPaths.includes(leaf.path));
    const secondaryEntries = navItems.filter(entry =>
        isGroup(entry) ? !entry.children.every(c => mainPaths.includes(c.path)) : !mainPaths.includes(entry.path)
    );

    const isSecondaryActive = flattenLeaves(secondaryEntries).some(leaf => isLeafActive(location.pathname, leaf.path));

    const getViewTitle = () => {
        const activeLeaf = flattenLeaves(navItems).find(leaf => location.pathname === leaf.path);
        if (activeLeaf) return activeLeaf.label;
        if (location.pathname === '/perfil') return 'Mi Perfil';
        if (location.pathname === '/catalogo') return 'Catálogo Rápido';
        if (location.pathname.startsWith('/pedidos/')) return 'Detalle de Pedido';
        return '';
    };

    const navLinkClasses = ({ isActive }: { isActive: boolean }) => `flex items-center gap-md px-lg py-md mx-sm rounded-r-md transition-colors text-left font-sans font-medium hover:bg-surface
        ${isActive
            ? 'bg-primary-light text-primary border-l-4 border-primary'
            : 'text-text-secondary border-l-4 border-transparent'
        }`;

    return (
        <div className="min-h-screen flex bg-surface w-full max-w-[100vw] overflow-x-clip">
            {/* Sidebar (Desktop Only) */}
            <aside className="print:hidden hidden md:flex flex-col w-64 bg-white border-r border-border fixed inset-y-0 left-0 z-40">
                <div className="h-16 px-xl border-b border-border flex items-center gap-sm shrink-0">
                    <img src={BrandLogo} alt="Logo Teknergy" className="h-10 w-auto object-contain shrink-0" />
                </div>

                <div className="flex-1 py-lg flex flex-col gap-xs overflow-y-auto">
                    {navItems.map(entry => isGroup(entry) ? (
                        <div key={entry.label}>
                            <button
                                type="button"
                                onClick={() => toggleGroup(entry.label)}
                                className="w-full flex items-center gap-md px-lg py-md mx-sm rounded-r-md transition-colors text-left font-sans font-medium hover:bg-surface text-text-secondary border-l-4 border-transparent"
                            >
                                {React.cloneElement(entry.icon as any, { size: 20 })}
                                <span className="text-body flex-1">{entry.label}</span>
                                <ChevronDown size={16} className={`shrink-0 transition-transform ${expandedGroups.has(entry.label) ? 'rotate-180' : ''}`} />
                            </button>
                            {expandedGroups.has(entry.label) && (
                                <div className="flex flex-col gap-xs mt-xs ml-lg pl-xs border-l-2 border-border">
                                    {entry.children.map(child => (
                                        <NavLink key={child.path} to={child.path} end={child.path === '/planilla'} className={navLinkClasses}>
                                            {React.cloneElement(child.icon as any, { size: 18 })}
                                            <span className="text-caption">{child.label}</span>
                                        </NavLink>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <NavLink key={entry.path} to={entry.path} className={navLinkClasses}>
                            {React.cloneElement(entry.icon as any, { size: 20 })}
                            <span className="text-body">{entry.label}</span>
                        </NavLink>
                    ))}
                </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 md:ml-64 flex flex-col min-h-screen pb-[120px] md:pb-0 animate-in fade-in duration-300 w-full min-w-0 overflow-x-clip relative">
                <Navbar title={getViewTitle()} />
                <div className="flex-1 w-full px-md md:px-lg lg:px-xl">
                    <ErrorBoundary>
                        {children || <Outlet />}
                    </ErrorBoundary>
                </div>
            </main>

            {/* Bottom Navigation (Mobile Only) */}
            <nav className="print:hidden md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-border flex justify-around shadow-modals z-40 pb-safe">
                {mainMobileItems.map((item) => (
                    <NavLink
                        key={item.path}
                        to={item.path}
                        className={({ isActive }) => `flex-1 flex flex-col items-center gap-1 py-sm px-xs transition-colors relative
                            ${isActive ? 'text-primary' : 'text-text-secondary hover:text-heading'}`}
                    >
                        {({ isActive }) => (
                            <>
                                {isActive && <div className="absolute top-0 w-10 h-1 bg-primary rounded-b-pill"></div>}
                                {React.cloneElement(item.icon as any, { size: 22 })}
                                <span className="text-[10px] font-medium uppercase mt-xs">{item.label}</span>
                            </>
                        )}
                    </NavLink>
                ))}

                {secondaryEntries.length > 0 && (
                    <button
                        onClick={() => setIsMobileMenuOpen(true)}
                        className={`flex-1 flex flex-col items-center gap-1 py-sm px-xs transition-colors relative
                            ${isSecondaryActive || isMobileMenuOpen ? 'text-primary' : 'text-text-secondary'}`}
                    >
                        {(isSecondaryActive || isMobileMenuOpen) && <div className="absolute top-0 w-10 h-1 bg-primary rounded-b-pill"></div>}
                        <Menu size={22} />
                        <span className="text-[10px] font-medium uppercase mt-xs">Más</span>
                    </button>
                )}
            </nav>

            {/* Mobile Drawer (Administration Menu) */}
            {isMobileMenuOpen && (
                <div className="md:hidden fixed inset-0 z-50 animate-in fade-in duration-200">
                    <div className="absolute inset-0 bg-heading/40 backdrop-blur-xs" onClick={() => setIsMobileMenuOpen(false)} />
                    <div className="absolute inset-y-0 right-0 w-[280px] bg-white shadow-modals flex flex-col animate-in slide-in-from-right duration-300">
                        <div className="h-16 px-lg border-b border-border flex items-center justify-between shrink-0">
                            <span className="text-h3 font-bold text-heading">Administración</span>
                            <button onClick={() => setIsMobileMenuOpen(false)} className="p-sm text-text-secondary hover:text-heading transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 py-lg flex flex-col gap-xs overflow-y-auto">
                            {secondaryEntries.map(entry => isGroup(entry) ? (
                                <div key={entry.label}>
                                    <button
                                        type="button"
                                        onClick={() => toggleGroup(entry.label)}
                                        className="w-full flex items-center justify-between px-lg py-md mx-sm rounded-md transition-colors font-medium text-text-secondary border-l-4 border-transparent hover:bg-surface"
                                    >
                                        <div className="flex items-center gap-md">
                                            {React.cloneElement(entry.icon as any, { size: 20 })}
                                            <span className="text-body">{entry.label}</span>
                                        </div>
                                        <ChevronDown size={16} className={`shrink-0 transition-transform ${expandedGroups.has(entry.label) ? 'rotate-180' : ''}`} />
                                    </button>
                                    {expandedGroups.has(entry.label) && (
                                        <div className="flex flex-col gap-xs mt-xs ml-lg pl-xs border-l-2 border-border">
                                            {entry.children.map(child => (
                                                <NavLink
                                                    key={child.path}
                                                    to={child.path}
                                                    end={child.path === '/planilla'}
                                                    onClick={() => setIsMobileMenuOpen(false)}
                                                    className={({ isActive }) => `flex items-center gap-md px-lg py-md mx-sm rounded-md transition-colors
                                                        ${isActive
                                                            ? 'bg-primary-light text-primary border-l-4 border-primary'
                                                            : 'text-text-secondary border-l-4 border-transparent hover:bg-surface'
                                                        }`}
                                                >
                                                    {React.cloneElement(child.icon as any, { size: 18 })}
                                                    <span className="text-caption">{child.label}</span>
                                                </NavLink>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <NavLink
                                    key={entry.path}
                                    to={entry.path}
                                    onClick={() => setIsMobileMenuOpen(false)}
                                    className={({ isActive }) => `flex items-center justify-between px-lg py-md mx-sm rounded-md transition-colors font-medium
                                        ${isActive
                                            ? 'bg-primary-light text-primary border-l-4 border-primary'
                                            : 'text-text-secondary border-l-4 border-transparent hover:bg-surface'
                                        }`}
                                >
                                    <div className="flex items-center gap-md">
                                        {React.cloneElement(entry.icon as any, { size: 20 })}
                                        <span className="text-body">{entry.label}</span>
                                    </div>
                                    <ChevronRight size={16} className="text-text-secondary opacity-50" />
                                </NavLink>
                            ))}
                        </div>
                        <div className="p-lg border-t border-border mt-auto">
                            <p className="text-[10px] text-text-secondary text-center uppercase tracking-wider font-semibold">Teknergy v1.0</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
