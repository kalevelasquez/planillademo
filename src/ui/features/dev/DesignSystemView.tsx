import React, { useState } from 'react';
import { Plus, Trash2, AlertTriangle, CheckCircle2, Info, Save, XCircle, LayoutDashboard, Download, Filter, Printer, Calendar, Tag, ShieldCheck, Ruler, Hash, Package } from 'lucide-react';
import { Button } from '../../components/Button';
import { InputField } from '../../components/InputField';
import { NetworkStatusBanner } from '../../components/NetworkStatusBanner';
import { Badge } from '../../components/Badge';
import { PageHeader } from '../../components/PageHeader';
import { IconBox } from '../../components/IconBox';
import { ActionToolbar } from '../../components/ActionToolbar';
import { TableActions } from '../../components/TableActions';
import { FilterBar } from '../../components/FilterBar';
import { SelectField } from '../../components/SelectField';
import { Pagination } from '../../components/Pagination';
import { LoadMoreButton } from '../../components/LoadMoreButton';
import { Banner } from '../../components/Banner';
import { useToast } from '../../../context/ToastContext';

// Helper para mostrar colores
interface ColorSwatchProps {
    label: string;
    variable: string;
    hex?: string;
    usage: string;
    className: string;
}

const ColorSwatch: React.FC<ColorSwatchProps> = ({ label, variable, hex, usage, className }) => (
    <div className="flex items-center gap-3 p-2.5 bg-white rounded-lg border border-border shadow-sm hover:shadow-md transition-shadow">
        <div className={`h-8 w-8 shrink-0 rounded-md shadow-inner border border-black/10 ${className}`}></div>
        <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2">
                <span className="font-bold text-heading text-[13px] truncate">{label}</span>
                <code className="text-[10px] text-primary font-mono bg-primary/5 px-1.5 py-0.5 rounded-sm shrink-0">{variable}</code>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-text-secondary mt-0.5 max-w-full">
                {hex && <span className="font-mono shrink-0">{hex}</span>}
                {hex && <span className="text-border shrink-0">•</span>}
                <span className="truncate" title={usage}>{usage}</span>
            </div>
        </div>
    </div>
);

export const DesignSystemView: React.FC = () => {
    const { showToast } = useToast();
    const [searchValue, setSearchValue] = useState('');
    const [phoneMask, setPhoneMask] = useState('');
    const [duiMask, setDuiMask] = useState('');
    const [toolbarSearch, setToolbarSearch] = useState('');
    const [currentPage, setCurrentPage] = useState(1);

    // Filter states
    const [filterDate, setFilterDate] = useState('');
    const [filterCategory, setFilterCategory] = useState('');
    const [filterQuality, setFilterQuality] = useState('');
    const [filterSize, setFilterSize] = useState('');
    const [filterBrand, setFilterBrand] = useState('');
    const [filterShipment, setFilterShipment] = useState('');

    const resetFilters = () => {
        setFilterDate('');
        setFilterCategory('');
        setFilterQuality('');
        setFilterSize('');
        setFilterBrand('');
        setFilterShipment('');
        showToast('Todos los filtros limpiados', 'success');
    };

    return (
        <div className="p-6 md:p-10 animate-in fade-in duration-300 max-w-7xl mx-auto">
            <div className="mb-10">
                <h1 className="text-3xl font-bold text-heading mb-2">Design System (UI Kit)</h1>
                <p className="text-text-secondary">
                    Galería de componentes base y tokens de diseño de <strong>Teknergy v1.0</strong>.
                </p>
            </div>

            {/* 1. PALETA DE COLORES */}
            <section className="mb-12 bg-surface p-6 rounded-xl border border-border max-w-5xl mx-auto">
                <h2 className="text-xl font-bold text-heading mb-6 flex items-center gap-2">
                    <div className="w-2 h-6 bg-primary rounded-full"></div>
                    1. Paleta de Colores Oficial
                </h2>

                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">A. Marca & Identidad</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    <ColorSwatch label="Primary" variable="bg-primary" usage="Acción Principal" className="bg-primary" />
                    <ColorSwatch label="Primary Dark" variable="bg-primary-dark" usage="Hover / Bordes" className="bg-primary-dark" />
                    <ColorSwatch label="Primary Light" variable="bg-primary-light" usage="Fondos Suaves" className="bg-primary-light" />
                    <ColorSwatch label="Heading (Navy)" variable="bg-heading" usage="Títulos / Logo" className="bg-heading" />
                </div>

                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">B. Semántica (Frutas)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                    <ColorSwatch label="Error (Manzana)" variable="bg-error" usage="Errores / Danger" className="bg-error" />
                    <ColorSwatch label="Warning (Naranja)" variable="bg-warning" usage="Alertas / Pendiente" className="bg-warning" />
                    <ColorSwatch label="Accent (Uva)" variable="bg-accent-purple" usage="Mayoreo / Decorativo" className="bg-accent-purple" />
                    <ColorSwatch label="Info (Azul)" variable="bg-info" usage="Estado Informativo" className="bg-info" />
                </div>

                <h3 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-3">C. Neutros</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <ColorSwatch label="Surface Paper" variable="bg-surface-paper" usage="Cards / Modales" className="bg-surface-paper" />
                    <ColorSwatch label="Surface Base" variable="bg-surface" usage="Fondo App" className="bg-surface" />
                    <ColorSwatch label="Text Navy" variable="text-heading" hex="#172C6B" usage="Títulos (Identidad)" className="bg-heading" />
                    <ColorSwatch label="Text Body" variable="text-text" hex="#1A1A2E" usage="Lectura general" className="bg-text" />
                </div>
            </section>

            {/* 2. BOTONES */}
            <section className="mb-12 bg-surface-paper p-6 rounded-xl border border-border shadow-sm max-w-5xl mx-auto">
                <h2 className="text-xl font-bold text-heading mb-6 flex items-center gap-2">
                    <div className="w-2 h-6 bg-secondary rounded-full"></div>
                    2. Botones & Interacción
                </h2>

                {/* A. Variantes Semánticas */}
                <div className="mb-8">
                    <h4 className="text-xs font-bold text-text-secondary mb-3 uppercase">A. Definición de Variantes</h4>
                    <p className="text-caption text-text-secondary mb-4">
                        Estado actual de los estilos de botones definidos para el sistema.
                    </p>
                    <div className="flex flex-wrap gap-4 items-center">
                        {/* Primary: Ya viene por defecto en el componente */}
                        <Button variant="primary">
                            Primary (Action)
                        </Button>

                        {/* Secondary: Forzamos el Navy como pediste */}
                        <Button variant="secondary">
                            Secondary (Navy)
                        </Button>

                        {/* Info: Forzamos el Azul Info */}
                        <Button variant="info">
                            Info (Blue)
                        </Button>

                        {/* Warning: Forzamos el Naranja (con texto oscuro para contraste) */}
                        <Button variant="warning">
                            Warning (Orange)
                        </Button>

                        {/* Danger: Ya viene por defecto */}
                        <Button variant="danger">
                            Danger (Red)
                        </Button>

                        <Button variant="ghost">
                            Ghost Link
                        </Button>
                    </div>
                </div>

                {/* B. Tamaños */}
                <div className="mb-8">
                    <h4 className="text-xs font-bold text-text-secondary mb-3 uppercase">B. Tamaños</h4>
                    <div className="flex flex-wrap items-end gap-4 p-4 border border-dashed border-border rounded-lg bg-surface">
                        <Button size="sm" variant="primary">Small (sm)</Button>
                        <Button size="md" variant="primary">Medium (md)</Button>
                        <Button size="lg" variant="primary">Large (lg)</Button>
                    </div>
                </div>

                {/* C. Estados e Iconos */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                        <h4 className="text-xs font-bold text-text-secondary mb-3 uppercase">C. Estados</h4>
                        <div className="flex flex-wrap gap-4">
                            <Button isLoading>Cargando...</Button>
                            <Button disabled>Deshabilitado</Button>
                        </div>
                    </div>
                    <div>
                        <h4 className="text-xs font-bold text-text-secondary mb-3 uppercase">D. Con Iconos</h4>
                        <div className="flex flex-wrap gap-4">
                            <Button className="flex items-center gap-2">
                                <Plus size={18} /> Nuevo
                            </Button>
                            {/* Ejemplo Secondary Navy con Icono */}
                            <Button variant="secondary" className="flex items-center gap-2">
                                <Save size={18} /> Guardar
                            </Button>
                            <Button variant="danger" size="sm" className="flex items-center gap-2">
                                <Trash2 size={16} /> Eliminar
                            </Button>
                        </div>
                    </div>
                </div>

                {/* E. Variantes Outline */}
                <div className="mt-8">
                    <h4 className="text-xs font-bold text-text-secondary mb-3 uppercase">E. Variantes Outline (Bordeados)</h4>
                    <div className="flex flex-wrap gap-4">
                        <Button variant="outline-primary">Primary Out</Button>
                        <Button variant="outline-secondary">Secondary Out</Button>
                        <Button variant="outline-info">Info Out</Button>
                        <Button variant="outline-warning">Warning Out</Button>
                        <Button variant="outline-danger">Danger Out</Button>
                    </div>
                </div>
            </section>

            {/* 3. FORMULARIOS & INPUTS */}
            <section className="mb-12 max-w-5xl mx-auto">
                <h2 className="text-xl font-bold text-heading mb-6 flex items-center gap-2">
                    <div className="w-2 h-6 bg-accent-purple rounded-full"></div>
                    3. Inputs & Formularios
                </h2>

                <div className="bg-surface-paper p-6 rounded-xl border border-border shadow-sm">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">

                        {/* Columna A: Estados Visuales */}
                        <div className="space-y-5">
                            <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider border-b border-border pb-2">A. Estados Visuales</h4>

                            <InputField
                                label="1. Estado Default"
                                placeholder="Escribe texto aquí..."
                                name="state_default"
                                onChange={() => { }}
                            />

                            <InputField
                                label="2. Estado Error"
                                placeholder="Input inválido"
                                name="state_error"
                                error="Este campo es requerido y el formato es incorrecto"
                                onChange={() => { }}
                            />

                            <InputField
                                label="3. Estado Deshabilitado (Disabled)"
                                placeholder="No puede editar esto"
                                name="state_disabled"
                                disabled={true}
                                onChange={() => { }}
                            />
                            <div className="opacity-50 pointer-events-none">
                                {/* Simulación visual de ReadOnly si tu componente lo soporta, o simplemente otro disabled con valor */}
                                <InputField
                                    label="4. Deshabilitado con Valor"
                                    value="Hernán (Admin)"
                                    name="state_disabled_value"
                                    disabled={true}
                                    onChange={() => { }}
                                />
                            </div>
                        </div>
                        {/* Columna B: Tipos de Datos */}
                        <div className="space-y-5">
                            <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider border-b border-border pb-2">B. Tipos de Datos HTML</h4>

                            <InputField
                                label="Password"
                                type="password"
                                placeholder="••••••••"
                                name="type_password"
                                onChange={() => { }}
                            />
                            <div className="grid grid-cols-2 gap-4">
                                <InputField
                                    label="Número (Price)"
                                    type="number"
                                    placeholder="0.00"
                                    name="type_number"
                                    onChange={() => { }}
                                />
                                <InputField
                                    label="Fecha (Date)"
                                    type="date"
                                    name="type_date"
                                    onChange={() => { }}
                                />
                            </div>
                            <InputField
                                label="Email"
                                type="email"
                                placeholder="ejemplo@teknergy.com"
                                name="type_email"
                                onChange={() => { }}
                            />
                        </div>
                    </div>

                    {/* Fila separadora: C. Búsqueda y Máscaras */}
                    <div className="mt-8 border-t border-border pt-6">
                        <h4 className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-5">C. Variantes Especiales & Máscaras</h4>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <InputField
                                label="Buscador (isSearch)"
                                placeholder="Buscar productos..."
                                isSearch
                                value={searchValue}
                                onChange={(e) => setSearchValue(e.target.value)}
                                onClear={() => setSearchValue('')}
                            />

                            <div className="flex flex-col gap-1.5">
                                <InputField
                                    label="Teléfono Móvil (Registro)"
                                    placeholder="0000-0000"
                                    mask="phone"
                                    prefix="+503"
                                    value={phoneMask}
                                    onChange={(e) => setPhoneMask(e.target.value)}
                                />
                                {phoneMask && (
                                    <span className="text-[11px] text-text-secondary font-mono tracking-tight bg-surface px-1.5 py-0.5 rounded w-fit">
                                        Valor BD: 503{phoneMask.replace('-', '')}
                                    </span>
                                )}
                            </div>

                            <InputField
                                label="DUI (Mask: dui)"
                                placeholder="00000000-0"
                                mask="dui"
                                value={duiMask}
                                onChange={(e) => setDuiMask(e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* 4. FEEDBACK */}
            <section className="mb-12 bg-surface-paper p-6 rounded-xl border border-border shadow-sm max-w-5xl mx-auto">
                <h2 className="text-xl font-bold text-heading mb-6 flex items-center gap-2">
                    <div className="w-2 h-6 bg-warning rounded-full"></div>
                    4. Feedback & Alertas
                </h2>
                <div className="mb-6">
                    <h4 className="text-xs font-bold text-text-secondary mb-3 uppercase">Toasts (Notificaciones)</h4>
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-wrap gap-3">
                            {/* Success - Green */}
                            <Button size="sm" onClick={() => showToast("Operación realizada con éxito", "success")}>
                                <CheckCircle2 size={16} className="mr-2" /> Trigger Success
                            </Button>
                            {/* Error - Red */}
                            <Button size="sm" variant="danger" onClick={() => showToast("Error al conectar con servidor", "error")}>
                                <XCircle size={16} className="mr-2" /> Trigger Error
                            </Button>
                        </div>
                        <div className="flex flex-wrap gap-3">
                            {/* Info */}
                            <Button size="sm" variant="info" onClick={() => showToast("Nueva versión disponible v1.2", "info")}>
                                <Info size={16} className="mr-2" /> Trigger Info
                            </Button>
                            {/* Warning */}
                            <Button size="sm" variant="warning" onClick={() => showToast("La sesión expirará en 5 minutos", "warning")}>
                                <AlertTriangle size={16} className="mr-2" /> Trigger Warn
                            </Button>
                        </div>
                    </div>
                </div>
                <div>
                    <h4 className="text-xs font-bold text-text-secondary mb-3 uppercase">Network Banner</h4>
                    <div>
                        <NetworkStatusBanner forceVisible={true} isInline={true} />
                    </div>
                </div>

                <div className="mt-8">
                    <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">Banners de Estado</h4>
                    <div className="flex flex-col gap-4">
                        <Banner
                            variant="success"
                            title="Operación exitosa"
                            description="Los cambios se han guardado correctamente en el sistema."
                            action={<Button variant="primary" size="sm">Entendido</Button>}
                        />
                        <Banner
                            variant="warning"
                            title="Atención requerida"
                            description="Tu suscripción está a punto de expirar. Renueva para evitar interrupciones."
                            action={<Button variant="warning" size="sm">Renovar</Button>}
                        />
                        <Banner
                            variant="info"
                            title="Nueva actualización"
                            description="Se ha añadido un nuevo módulo de reportes a tu panel de control."
                            action={<Button variant="info" size="sm">Ver Detalles</Button>}
                        />
                        <Banner
                            variant="error"
                            title="Error de sincronización"
                            description="No se pudo contactar con el servidor. Intenta nuevamente más tarde."
                            action={<Button variant="danger" size="sm">Reintentar</Button>}
                        />
                    </div>
                </div>
            </section>

            {/* 5. IDENTIDAD & ESTADOS */}
            <section className="mb-12 bg-surface-paper p-6 rounded-xl border border-border shadow-sm max-w-5xl mx-auto">
                <h2 className="text-xl font-bold text-heading mb-6 flex items-center gap-2">
                    <div className="w-2 h-6 bg-info rounded-full"></div>
                    5. Identidad & Estados
                </h2>

                <div className="space-y-8">
                    {/* Page Header Example */}
                    <div>
                        <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">Page Header (Estilo TeamViewer)</h4>
                        <div className="border border-border/50 rounded-xl p-6 bg-surface">
                            <PageHeader
                                icon={LayoutDashboard}
                                title="Panel de Control"
                                description="Monitoreo de actividad y métricas en tiempo real"
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-4">
                        {/* Badges Version 1 (Dot) */}
                        <div>
                            <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">Badges (Con Indicador de Estado)</h4>
                            <div className="flex flex-wrap gap-3 mb-6">
                                <Badge variant="success" label="En Línea" dot />
                                <Badge variant="warning" label="Revisión" dot />
                                <Badge variant="error" label="Fallo" dot />
                                <Badge variant="info" label="Actualizando" dot />
                                <Badge variant="accent" label="Prioritario" dot />
                            </div>
                        </div>

                        {/* Badges Version 2 (Solid Pill) */}
                        <div>
                            <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">Badges (Formato Simple)</h4>
                            <div className="flex flex-wrap gap-3 mb-6">
                                <Badge variant="success" label="Completado" />
                                <Badge variant="warning" label="Pendiente" />
                                <Badge variant="error" label="Cancelado" />
                                <Badge variant="info" label="Nuevo" />
                                <Badge variant="accent" label="Especial" />
                            </div>
                        </div>
                    </div>

                    {/* IconBox (Elementos Gráficos) */}
                    <div className="pt-4 border-t border-border">
                        <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">IconBox (Elementos Gráficos)</h4>

                        <div className="space-y-6">
                            <div>
                                <h5 className="text-[11px] font-bold text-text-secondary mb-4 uppercase">Variantes (Colores Oficiales)</h5>
                                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-4">
                                    <div className="flex flex-col items-center justify-center gap-2 p-4 border border-border/50 rounded-xl bg-surface/50">
                                        <IconBox icon={LayoutDashboard} variant="primary" size="md" />
                                        <span className="text-[10px] text-text-secondary font-medium">Primary / Verde</span>
                                    </div>
                                    <div className="flex flex-col items-center justify-center gap-2 p-4 border border-border/50 rounded-xl bg-surface/50">
                                        <IconBox icon={LayoutDashboard} variant="secondary" size="md" />
                                        <span className="text-[10px] text-text-secondary font-medium">Secondary / Navy</span>
                                    </div>
                                    <div className="flex flex-col items-center justify-center gap-2 p-4 border border-border/50 rounded-xl bg-surface/50">
                                        <IconBox icon={LayoutDashboard} variant="accent" size="md" />
                                        <span className="text-[10px] text-text-secondary font-medium">Accent / Uva</span>
                                    </div>
                                    <div className="flex flex-col items-center justify-center gap-2 p-4 border border-border/50 rounded-xl bg-surface/50">
                                        <IconBox icon={LayoutDashboard} variant="success" size="md" />
                                        <span className="text-[10px] text-text-secondary font-medium">Success / Manzana</span>
                                    </div>
                                    <div className="flex flex-col items-center justify-center gap-2 p-4 border border-border/50 rounded-xl bg-surface/50">
                                        <IconBox icon={LayoutDashboard} variant="warning" size="md" />
                                        <span className="text-[10px] text-text-secondary font-medium">Warning / Naranja</span>
                                    </div>
                                    <div className="flex flex-col items-center justify-center gap-2 p-4 border border-border/50 rounded-xl bg-surface/50">
                                        <IconBox icon={LayoutDashboard} variant="error" size="md" />
                                        <span className="text-[10px] text-text-secondary font-medium">Error / Rojo</span>
                                    </div>
                                    <div className="flex flex-col items-center justify-center gap-2 p-4 border border-border/50 rounded-xl bg-surface/50">
                                        <IconBox icon={LayoutDashboard} variant="info" size="md" />
                                        <span className="text-[10px] text-text-secondary font-medium">Info / Azul</span>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h5 className="text-[11px] font-bold text-text-secondary mb-4 uppercase">Estructura de Tamaños (Proporción 2:1)</h5>
                                <div className="flex flex-wrap gap-6 items-end p-6 border border-border/50 rounded-xl bg-surface/50">
                                    <div className="flex flex-col items-center gap-3">
                                        <IconBox icon={LayoutDashboard} variant="secondary" size="sm" />
                                        <span className="text-[10px] text-text-secondary font-medium">SM (36px)</span>
                                    </div>
                                    <div className="flex flex-col items-center gap-3">
                                        <IconBox icon={LayoutDashboard} variant="secondary" size="md" />
                                        <span className="text-[10px] text-text-secondary font-medium">MD (48px)</span>
                                    </div>
                                    <div className="flex flex-col items-center gap-3">
                                        <IconBox icon={LayoutDashboard} variant="secondary" size="lg" />
                                        <span className="text-[10px] text-text-secondary font-medium">LG (64px)</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* 6. GESTIÓN DE DATOS */}
            <section className="mb-12 bg-surface-paper p-6 rounded-xl border border-border shadow-sm max-w-5xl mx-auto">
                <h2 className="text-xl font-bold text-heading mb-6 flex items-center gap-2">
                    <div className="w-2 h-6 bg-success rounded-full"></div>
                    6. Gestión de Datos
                </h2>

                <div className="space-y-6">
                    <div>
                        <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">Action Toolbar (Búsqueda y Acciones Rápidas)</h4>
                        <div className="border border-border/50 rounded-xl p-6 bg-surface">
                            <ActionToolbar
                                searchPlaceholder="Buscar productos, marcas, lotes..."
                                searchValue={toolbarSearch}
                                onSearchChange={setToolbarSearch}
                                theme="secondary"
                                actions={[
                                    {
                                        label: 'Filtros',
                                        icon: Filter,
                                        onClick: () => showToast('Abriendo Filtros Avanzados', 'info')
                                    },
                                    {
                                        label: 'Exportar',
                                        icon: Download,
                                        onClick: () => showToast('Exportando vista a CSV', 'success')
                                    },
                                    {
                                        label: 'Imprimir',
                                        icon: Printer,
                                        onClick: () => showToast('Generando formato de impresión', 'success')
                                    }
                                ]}
                            />

                            {/* Simulador de tabla vacía debajo */}
                            <div className="py-12 flex flex-col items-center justify-center text-text-secondary opacity-50">
                                <span className="text-sm">Área de renderizado de la Tabla</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* 7. ACCIONES DE FILA (PERMISOS) */}
            <section className="mb-12 bg-surface-paper p-6 rounded-xl border border-border shadow-sm max-w-5xl mx-auto">
                <h2 className="text-xl font-bold text-heading mb-6 flex items-center gap-2">
                    <div className="w-2 h-6 bg-info rounded-full"></div>
                    7. Acciones de Fila (Permisos)
                </h2>

                <div className="space-y-8">
                    {/* Admin actions */}
                    <div>
                        <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">Admin (Todas las acciones)</h4>
                        <div className="flex items-center gap-4 bg-surface p-4 rounded-xl border border-border/50">
                            <TableActions
                                visibleActions={[
                                    { type: 'view', onClick: () => showToast('Ver Detalles', 'info') },
                                    { type: 'edit', onClick: () => showToast('Editar Registro', 'info') },
                                    { type: 'reactivate', onClick: () => showToast('Reactivado', 'success') },
                                    { type: 'resend', onClick: () => showToast('Reenviado', 'success') },
                                    { type: 'delete', onClick: () => showToast('Eliminar', 'error') },
                                ]}
                            />
                            <span className="text-xs text-text-secondary">Hover sobre los iconos para desplegar etiquetas (Efecto Acordeón)</span>
                        </div>
                    </div>

                    {/* Vendedor actions */}
                    <div>
                        <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">Vendedor (Solo Ver y Editar)</h4>
                        <div className="flex items-center gap-4 bg-surface p-4 rounded-xl border border-border/50">
                            <TableActions
                                visibleActions={[
                                    { type: 'view', onClick: () => showToast('Ver Detalles', 'info') },
                                    { type: 'edit', onClick: () => showToast('Editar Registro', 'info') },
                                ]}
                            />
                        </div>
                    </div>

                    {/* Solo 1 Acción (Ej: Pedidos) */}
                    <div>
                        <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">Logística (Solo Ver Pedido)</h4>
                        <div className="flex items-center gap-4 bg-surface p-4 rounded-xl border border-border/50">
                            <TableActions
                                visibleActions={[
                                    { type: 'view', onClick: () => showToast('Abriendo Pedido...', 'info') },
                                ]}
                            />
                            <span className="text-xs text-text-secondary">Píldora circular contraída al tener 1 sola acción</span>
                        </div>
                    </div>

                    {/* Locked/Reactivate actions */}
                    <div>
                        <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">Cuenta Bloqueada (Solo Reactivar o Acción Deshabilitada)</h4>
                        <div className="flex items-center gap-4 bg-surface p-4 rounded-xl border border-border/50">
                            <TableActions
                                visibleActions={[
                                    { type: 'reactivate', onClick: () => showToast('Reactivando...', 'success') },
                                    { type: 'delete', onClick: () => { }, disabled: true },
                                ]}
                            />
                        </div>
                    </div>
                </div>
            </section>

            {/* 8. FILTROS Y PAGINACIÓN */}
            <section className="mb-12 bg-surface-paper p-6 rounded-xl border border-border shadow-sm max-w-5xl mx-auto">
                <h2 className="text-xl font-bold text-heading mb-6 flex items-center gap-2">
                    <div className="w-2 h-6 bg-warning rounded-full"></div>
                    8. Filtros y Paginación
                </h2>

                <div className="space-y-8">
                    {/* FilterBar */}
                    <div>
                        <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">FilterBar (Filtros en Cascada)</h4>
                        <div className="border border-border/50 rounded-xl overflow-hidden bg-surface">
                            <FilterBar onReset={resetFilters}>
                                <InputField
                                    type="date"
                                    label="Rango de Fecha"
                                    value={filterDate}
                                    onChange={(e) => setFilterDate(e.target.value)}
                                    icon={<Calendar size={16} />}
                                />
                                <SelectField
                                    label="Categoría"
                                    value={filterCategory}
                                    onChange={(e) => setFilterCategory(e.target.value)}
                                    options={[
                                        { value: 'manzanas', label: 'Manzanas' },
                                        { value: 'uvas', label: 'Uvas' },
                                        { value: 'peras', label: 'Peras' },
                                    ]}
                                    startIcon={<Tag size={16} />}
                                    placeholder="Todas"
                                />
                                <SelectField
                                    label="Calidad"
                                    value={filterQuality}
                                    onChange={(e) => setFilterQuality(e.target.value)}
                                    options={[
                                        { value: 'premium', label: 'Premium' },
                                        { value: 'primera', label: 'Primera' },
                                        { value: 'segunda', label: 'Segunda' },
                                    ]}
                                    startIcon={<ShieldCheck size={16} />}
                                    placeholder="Todas"
                                />
                                <SelectField
                                    label="Calibre"
                                    value={filterSize}
                                    onChange={(e) => setFilterSize(e.target.value)}
                                    options={[
                                        { value: '80', label: '80' },
                                        { value: '100', label: '100' },
                                        { value: '120', label: '120' },
                                    ]}
                                    startIcon={<Ruler size={16} />}
                                    placeholder="Todos"
                                />
                                <SelectField
                                    label="Marca"
                                    value={filterBrand}
                                    onChange={(e) => setFilterBrand(e.target.value)}
                                    options={[
                                        { value: 'marca_a', label: 'Marca A' },
                                        { value: 'marca_b', label: 'Marca B' },
                                    ]}
                                    startIcon={<Hash size={16} />}
                                    placeholder="Todas"
                                />
                                <InputField
                                    label="Embarque"
                                    placeholder="Ej: EMB-001"
                                    value={filterShipment}
                                    onChange={(e) => setFilterShipment(e.target.value)}
                                    icon={<Package size={16} />}
                                />
                            </FilterBar>
                        </div>
                    </div>

                    {/* Pagination */}
                    <div>
                        <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">Pagination (Paginación de Tabla)</h4>
                        <div className="border border-border/50 rounded-xl px-6 bg-white shadow-sm">
                            <Pagination
                                currentPage={currentPage}
                                totalPages={15}
                                totalItems={150}
                                pageSize={10}
                                onPageChange={(page) => setCurrentPage(page)}
                            />
                        </div>
                        <p className="text-xs text-text-secondary mt-2">Prueba interactuar con las páginas para ver cómo funciona el truncado con elipses (...) en largos volúmenes de datos.</p>
                    </div>

                    {/* LoadMoreButton — navegación infinita (Mobile / Scroll) */}
                    <div>
                        <h4 className="text-xs font-bold text-text-secondary mb-4 uppercase">LoadMoreButton (Navegación Infinita — Mobile)</h4>
                        <div className="border border-border/50 rounded-xl bg-surface overflow-hidden">
                            <div className="flex flex-col gap-3 p-4">
                                <LoadMoreButton
                                    onClick={() => showToast('Cargando siguiente página...', 'info')}
                                    label="Cargar más registros"
                                />
                                <LoadMoreButton
                                    onClick={() => { }}
                                    isLoading={true}
                                    loadingLabel="Cargando..."
                                />
                            </div>
                        </div>
                        <p className="text-xs text-text-secondary mt-2">Usado en breakpoints mobile (&lt;lg) como alternativa al componente Pagination numérico.</p>
                    </div>
                </div>
            </section>
        </div>
    );
};