import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Eye, EyeOff, Search, X, AlertCircle, Phone, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';

// Tipos de máscara soportados
type MaskType = 'phone' | 'dui' | 'currency' | 'date' | undefined;

// ── Helpers de fecha (mask="date") ───────────────────────────────────
// IMPL-137 (Observación General UAT): un <input type="date"> nativo muestra el formato
// MM/DD/YYYY o DD/MM/YYYY según el idioma del navegador/SO del usuario, no algo que el código
// de la app controle. Se reemplaza por un selector propio (calendario en popup) que siempre
// muestra DD/MM/AAAA sin importar la configuración del cliente. El contrato externo (value/
// onChange) sigue siendo el mismo string ISO `YYYY-MM-DD` que ya usa todo el proyecto (min/max,
// comparaciones de string, envío directo a Supabase) — cero cambios en los formularios que ya
// usan `type="date"`, solo cambian a `mask="date"`.
const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MESES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

function parseISO(iso: string | undefined | null): { anio: number; mes0: number; dia: number } | null {
    if (!iso) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    if (!m) return null;
    return { anio: Number(m[1]), mes0: Number(m[2]) - 1, dia: Number(m[3]) };
}

function toISO(anio: number, mes0: number, dia: number): string {
    return `${anio}-${String(mes0 + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function formatearDDMMAAAA(iso: string | undefined | null): string {
    const p = parseISO(iso);
    if (!p) return '';
    return `${String(p.dia).padStart(2, '0')}/${String(p.mes0 + 1).padStart(2, '0')}/${p.anio}`;
}

// Enmascara dígitos sueltos como DD/MM/AAAA a medida que se tipean (máximo 8 dígitos).
function enmascararEntradaFecha(raw: string): string {
    const digitos = raw.replace(/\D/g, '').slice(0, 8);
    if (digitos.length > 4) return `${digitos.slice(0, 2)}/${digitos.slice(2, 4)}/${digitos.slice(4)}`;
    if (digitos.length > 2) return `${digitos.slice(0, 2)}/${digitos.slice(2)}`;
    return digitos;
}

// Valida que dia/mes0/anio formen una fecha real (rechaza 31/02, mes 13, etc.) usando el
// round-trip de Date: si el motor "corrige" la fecha (ej. 31 feb → 3 mar), no coincide.
function esFechaValida(anio: number, mes0: number, dia: number): boolean {
    const d = new Date(anio, mes0, dia);
    return d.getFullYear() === anio && d.getMonth() === mes0 && d.getDate() === dia;
}

function generarRangoAnios(min?: string, max?: string): number[] {
    const anioActual = new Date().getFullYear();
    const anioMin = (min && parseISO(min)?.anio) || anioActual - 100;
    const anioMax = (max && parseISO(max)?.anio) || anioActual + 10;
    const anios: number[] = [];
    for (let a = anioMax; a >= anioMin; a--) anios.push(a);
    return anios;
}

interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    icon?: React.ReactNode;
    prefix?: string;        // Prefijo visual flotante (ej: "+503" sin máscara phone)
    isSearch?: boolean;     // Activa modo búsqueda con icono + botón clear
    onClear?: () => void;   // Acción para la X del modo búsqueda
    mask?: MaskType;        // Activa lógica de enmascarado automático
}

interface DateMaskCalendarProps {
    id?: string;
    value: string | undefined;
    min?: string;
    max?: string;
    disabled?: boolean;
    error?: boolean;
    onChange: (iso: string) => void;
}

/** Calendario en popup para `mask="date"` — ver comentario de cabecera. `min`/`max` (ISO) se
 * comparan como string, mismo criterio ya usado en todo el proyecto para fechas ISO.
 * IMPL-137-bis (reporte UAT): el trigger original era un <button> (no se podía escribir la
 * fecha) y el popup solo navegaba de a un mes con flechas (llegar a una fecha de hace décadas,
 * ej. una fecha de nacimiento, exigía cientos de clicks). Se reemplaza por un <input> de texto
 * enmascarado DD/MM/AAAA (tipeable) + selects de mes/año en el header del popup para saltar
 * directo a un año lejano.
 * IMPL-137-ter (reporte UAT, Horas Extras/Reloj Marcador): el popup era `position: absolute`
 * dentro del propio contenedor — cuando ese contenedor vive dentro de un ancestro con
 * `overflow-x-auto` (ej. una tabla scrollable), el navegador computa `overflow-y: auto` también
 * (regla del spec CSS: si un eje no es `visible`, el otro deja de serlo), recortando el popup
 * en los dos ejes y dejándolo invisible aunque `abierto` esté en `true`. Se renderiza vía
 * `createPortal` a `document.body` con `position: fixed`, calculando la posición desde el
 * `getBoundingClientRect` del input — así escapa de cualquier ancestro con overflow, no solo de
 * este caso puntual.
 * IMPL-137-quater (observación UAT, Quincenas): el portal ya escapaba del overflow, pero su
 * `z-index` (20) seguía siendo MENOR al de los modales que lo contienen (`fixed inset-0 z-50`,
 * patrón usado en prácticamente todos los modales de Planilla — ver NuevaQuincenaModal.tsx).
 * Dos elementos `position: fixed` compiten por stacking global sin importar dónde los monte el
 * portal en el DOM — con z-20 < z-50, el popup del calendario quedaba renderizado DETRÁS del
 * propio modal, invisible, aunque técnicamente estuviera "abierto". Subido a z-60 (mayor al
 * z-50 más alto usado por cualquier modal del proyecto) para que el calendario gane siempre,
 * se abra desde una tabla o desde un formulario dentro de un modal. */
const DateMaskCalendar: React.FC<DateMaskCalendarProps> = ({ id, value, min, max, disabled, error, onChange }) => {
    const [abierto, setAbierto] = useState(false);
    const contenedorRef = useRef<HTMLDivElement>(null);
    const popupRef = useRef<HTMLDivElement>(null);
    const [posicion, setPosicion] = useState<{ top: number; left: number } | null>(null);
    const seleccionado = parseISO(value);
    const [vista, setVista] = useState(() => seleccionado ?? { anio: new Date().getFullYear(), mes0: new Date().getMonth(), dia: 1 });
    const [texto, setTexto] = useState(() => formatearDDMMAAAA(value));
    const anios = generarRangoAnios(min, max);

    // El valor tipeado sigue al value externo (selección desde el calendario, reset del form,
    // etc.) — sin esto, elegir un día en el popup no actualizaría el texto del input.
    useEffect(() => {
        setTexto(formatearDDMMAAAA(value));
    }, [value]);

    useEffect(() => {
        if (abierto && seleccionado) setVista(seleccionado);
    }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!abierto) return;
        const actualizarPosicion = () => {
            const rect = contenedorRef.current?.getBoundingClientRect();
            if (rect) setPosicion({ top: rect.bottom + 4, left: rect.left });
        };
        actualizarPosicion();
        // `true` (fase de captura) — un scroll dentro de un ancestro con overflow (ej. la
        // tabla de Horas Extras) no burbujea, pero sí se puede capturar en su camino hacia
        // abajo desde window/document antes de llegar al target.
        window.addEventListener('scroll', actualizarPosicion, true);
        window.addEventListener('resize', actualizarPosicion);
        return () => {
            window.removeEventListener('scroll', actualizarPosicion, true);
            window.removeEventListener('resize', actualizarPosicion);
        };
    }, [abierto]);

    useEffect(() => {
        if (!abierto) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            if (contenedorRef.current?.contains(target)) return;
            if (popupRef.current?.contains(target)) return;
            setAbierto(false);
        };
        const handlerEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setAbierto(false); };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', handlerEsc);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', handlerEsc);
        };
    }, [abierto]);

    const diasEnMes = new Date(vista.anio, vista.mes0 + 1, 0).getDate();
    const primerDiaSemana = new Date(vista.anio, vista.mes0, 1).getDay();
    const celdas: (number | null)[] = [
        ...Array.from({ length: primerDiaSemana }, () => null),
        ...Array.from({ length: diasEnMes }, (_, i) => i + 1),
    ];

    const irMesAnterior = () => setVista((v) => (v.mes0 === 0 ? { ...v, anio: v.anio - 1, mes0: 11 } : { ...v, mes0: v.mes0 - 1 }));
    const irMesSiguiente = () => setVista((v) => (v.mes0 === 11 ? { ...v, anio: v.anio + 1, mes0: 0 } : { ...v, mes0: v.mes0 + 1 }));

    const fueraDeRango = (dia: number): boolean => {
        const iso = toISO(vista.anio, vista.mes0, dia);
        if (min && iso < min) return true;
        if (max && iso > max) return true;
        return false;
    };

    const seleccionarDia = (dia: number) => {
        onChange(toISO(vista.anio, vista.mes0, dia));
        setAbierto(false);
    };

    const manejarTexto = (e: React.ChangeEvent<HTMLInputElement>) => {
        const formateado = enmascararEntradaFecha(e.target.value);
        setTexto(formateado);

        const digitos = formateado.replace(/\D/g, '');
        if (digitos.length !== 8) return;
        const dia = Number(digitos.slice(0, 2));
        const mes0 = Number(digitos.slice(2, 4)) - 1;
        const anio = Number(digitos.slice(4, 8));
        if (!esFechaValida(anio, mes0, dia)) return;

        setVista({ anio, mes0, dia });
        onChange(toISO(anio, mes0, dia));
    };

    const manejarBlur = () => {
        // Si lo tipeado no cerró en una fecha válida de 8 dígitos, se descarta y se vuelve
        // a mostrar el último valor confirmado — no se deja al usuario con texto a medias.
        setTexto(formatearDDMMAAAA(value));
    };

    return (
        <div ref={contenedorRef} className="relative">
            <div className="relative">
                <Calendar size={15} className="absolute left-4 top-1/2 -translate-y-1/2 shrink-0 text-text-secondary pointer-events-none" />
                <input
                    id={id}
                    type="text"
                    inputMode="numeric"
                    placeholder="DD/MM/AAAA"
                    value={texto}
                    onChange={manejarTexto}
                    onFocus={() => !disabled && setAbierto(true)}
                    onBlur={manejarBlur}
                    disabled={disabled}
                    autoComplete="off"
                    className={`w-full py-2.5 pl-10 pr-4 rounded-lg text-sm font-medium text-heading transition-all duration-200 outline-none shadow-sm bg-white border placeholder:text-text-secondary/40
                        ${error ? 'border-error text-error focus:ring-4 focus:ring-error/10' : 'border-gray-200 focus:border-primary focus:ring-4 focus:ring-primary/10 hover:border-gray-300'}
                        disabled:bg-gray-50 disabled:border-transparent disabled:text-text-secondary/50 disabled:cursor-not-allowed disabled:shadow-none`}
                />
            </div>

            {abierto && posicion && createPortal(
                <div ref={popupRef} style={{ top: posicion.top, left: posicion.left }} className="fixed z-60 bg-white border border-border rounded-lg shadow-modals p-sm w-64">
                    <div className="flex items-center justify-between mb-2 gap-1">
                        <button type="button" onClick={irMesAnterior} aria-label="Mes anterior" className="p-1 rounded-md hover:bg-surface text-text-secondary shrink-0">
                            <ChevronLeft size={16} />
                        </button>
                        <div className="flex items-center gap-1 min-w-0">
                            <select
                                value={vista.mes0}
                                onChange={(e) => setVista((v) => ({ ...v, mes0: Number(e.target.value) }))}
                                aria-label="Mes"
                                className="text-[12px] font-bold text-heading bg-transparent outline-none cursor-pointer rounded hover:bg-surface"
                            >
                                {MESES.map((m, i) => <option key={m} value={i}>{m}</option>)}
                            </select>
                            <select
                                value={vista.anio}
                                onChange={(e) => setVista((v) => ({ ...v, anio: Number(e.target.value) }))}
                                aria-label="Año"
                                className="text-[12px] font-bold text-heading bg-transparent outline-none cursor-pointer rounded hover:bg-surface"
                            >
                                {anios.map((a) => <option key={a} value={a}>{a}</option>)}
                            </select>
                        </div>
                        <button type="button" onClick={irMesSiguiente} aria-label="Mes siguiente" className="p-1 rounded-md hover:bg-surface text-text-secondary shrink-0">
                            <ChevronRight size={16} />
                        </button>
                    </div>
                    <div className="grid grid-cols-7 gap-0.5 mb-1">
                        {DIAS_SEMANA.map((d) => (
                            <span key={d} className="text-[9px] font-bold uppercase text-text-secondary text-center py-1">{d}</span>
                        ))}
                    </div>
                    <div className="grid grid-cols-7 gap-0.5">
                        {celdas.map((dia, i) => {
                            if (dia === null) return <span key={`vacio-${i}`} />;
                            const esSeleccionado = !!seleccionado && seleccionado.anio === vista.anio && seleccionado.mes0 === vista.mes0 && seleccionado.dia === dia;
                            const deshabilitado = fueraDeRango(dia);
                            return (
                                <button
                                    key={dia}
                                    type="button"
                                    disabled={deshabilitado}
                                    onClick={() => seleccionarDia(dia)}
                                    className={`text-[12px] rounded-md py-1.5 transition-colors
                                        ${esSeleccionado ? 'bg-primary text-white font-bold' : deshabilitado ? 'text-text-secondary/30 cursor-not-allowed' : 'text-heading hover:bg-surface'}`}
                                >
                                    {dia}
                                </button>
                            );
                        })}
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export const InputField: React.FC<InputFieldProps> = ({
    label,
    error,
    icon,
    className = '',
    id,
    type = 'text',
    isSearch,
    onClear,
    mask,
    prefix,
    onChange,
    value,
    disabled,
    placeholder,
    required,
    min,
    max,
    ...props
}) => {
    const [showPassword, setShowPassword] = useState(false);
    const isPassword = type === 'password';
    const currentType = isPassword ? (showPassword ? 'text' : 'password') : type;
    const isPhoneMask = mask === 'phone';
    const isDateMask = mask === 'date';

    // ── Lógica de Máscaras ──────────────────────────────────────
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value;

        if (mask === 'phone') {
            // 1. Solo dígitos, máximo 8
            val = val.replace(/\D/g, '').substring(0, 8);
            // 2. Insertar guion después del 4° dígito → XXXX-XXXX
            if (val.length > 4) {
                val = val.slice(0, 4) + '-' + val.slice(4);
            }
            e.target.value = val;
        }
        else if (mask === 'dui') {
            // Formato: 00000000-0 (9 dígitos con guion en posición 8)
            val = val.replace(/\D/g, '').substring(0, 9);
            if (val.length > 8) val = val.slice(0, 8) + '-' + val.slice(8);
            e.target.value = val;
        }
        else if (mask === 'currency') {
            // Solo números y un punto decimal
            val = val.replace(/[^0-9.]/g, '');
            // Colapsar a un único punto decimal — se conserva el primero y se descartan los
            // siguientes (ej. pegar "1.234.56" quedaría "1.23456"). Sin esto, un valor con dos
            // puntos pasa el check de "campo no vacío" pero Number(...) da NaN, que se guarda
            // como sueldo_mensual: null en silencio (ver useEmpleadoManagement.validate()).
            const firstDot = val.indexOf('.');
            if (firstDot !== -1) {
                val = val.slice(0, firstDot + 1) + val.slice(firstDot + 1).replace(/\./g, '');
            }
            e.target.value = val;
        }

        if (onChange) onChange(e);
    };

    // ── Icono dinámico (search sustituye al icono prop) ─────────
    const startIcon = isSearch ? <Search size={18} /> : icon;

    // ── Clases comunes del <input> ──────────────────────────────
    const inputBaseClass = `
        w-full py-2.5 rounded-lg text-sm font-medium text-heading
        transition-all duration-200 ease-in-out outline-none shadow-sm
        bg-white border placeholder:text-text-secondary/40
        ${error
            ? 'border-error text-error focus:ring-4 focus:ring-error/10 focus:border-error bg-error/5'
            : 'border-gray-200 focus:border-primary focus:ring-4 focus:ring-primary/10 hover:border-gray-300'
        }
        disabled:bg-gray-50 disabled:border-transparent disabled:text-text-secondary/50 disabled:cursor-not-allowed disabled:shadow-none
    `;

    // ══════════════════════════════════════════════════════════════
    // RENDER ESPECIAL: mask="phone" → Addon fijo +503 integrado
    // ══════════════════════════════════════════════════════════════
    if (isPhoneMask) {
        return (
            <div className={`flex flex-col gap-1.5 ${className}`}>
                {label && (
                    <label
                        htmlFor={id}
                        className={`text-xs font-bold uppercase tracking-wider ml-1 ${error ? 'text-error' : 'text-text-secondary'}`}
                    >
                        {label}{required && <span className="text-error"> *</span>}
                    </label>
                )}

                {/* Input Group con addon fijo */}
                <div className={`
                    flex w-full items-stretch rounded-lg overflow-hidden shadow-sm
                    border transition-all duration-200
                    focus-within:ring-4
                    ${error
                        ? 'border-error focus-within:ring-error/10 focus-within:border-error'
                        : 'border-gray-200 focus-within:border-primary focus-within:ring-primary/10 hover:border-gray-300'
                    }
                    ${disabled ? 'opacity-60 cursor-not-allowed' : ''}
                `}>
                    {/* Prefijo — sin borde divisor, fondo blanco compartido, no editable */}
                    <div translate="no" className={`
                        flex items-center gap-1.5 pl-3 pr-1
                        bg-white select-none pointer-events-none shrink-0
                        ${error ? 'text-error' : 'text-text-secondary'}
                    `}>
                        <Phone size={16} className="shrink-0" />
                        <span className="font-mono text-[13px] font-semibold tracking-wide">+503</span>
                    </div>

                    {/* Input sin bordes propios (los hereda del wrapper) */}
                    <input
                        id={id}
                        type="tel"
                        value={value}
                        onChange={handleChange}
                        disabled={disabled}
                        required={required}
                        placeholder={placeholder ?? 'XXXX-XXXX'}
                        className={`
                            flex-1 min-w-0 pl-2 pr-4 py-2.5 text-sm font-medium text-heading
                            bg-white outline-none placeholder:text-text-secondary/40
                            disabled:bg-gray-50 disabled:text-text-secondary/50 disabled:cursor-not-allowed
                            ${error ? 'text-error' : ''}
                        `}
                        {...props}
                    />
                </div>

                {/* Mensaje de error */}
                {error && (
                    <div className="flex items-center gap-1 mt-1 ml-1 animate-in fade-in slide-in-from-top-1">
                        <AlertCircle size={12} className="text-error" />
                        <span className="text-[11px] text-error font-medium">{error}</span>
                    </div>
                )}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // RENDER ESPECIAL: mask="date" → calendario propio, siempre DD/MM/AAAA
    // ══════════════════════════════════════════════════════════════
    if (isDateMask) {
        return (
            <div className={`flex flex-col gap-1.5 ${className}`}>
                {label && (
                    <label htmlFor={id} className={`text-xs font-bold uppercase tracking-wider ml-1 ${error ? 'text-error' : 'text-text-secondary'}`}>
                        {label}{required && <span className="text-error"> *</span>}
                    </label>
                )}
                <DateMaskCalendar
                    id={id}
                    value={typeof value === 'string' ? value : undefined}
                    min={typeof min === 'string' ? min : undefined}
                    max={typeof max === 'string' ? max : undefined}
                    disabled={disabled}
                    error={!!error}
                    onChange={(iso) => onChange?.({ target: { value: iso, name: props.name } } as React.ChangeEvent<HTMLInputElement>)}
                />
                {error && (
                    <div className="flex items-center gap-1 mt-1 ml-1 animate-in fade-in slide-in-from-top-1">
                        <AlertCircle size={12} className="text-error" />
                        <span className="text-[11px] text-error font-medium">{error}</span>
                    </div>
                )}
            </div>
        );
    }

    // ══════════════════════════════════════════════════════════════
    // RENDER ESTÁNDAR: todos los demás tipos
    // ══════════════════════════════════════════════════════════════
    return (
        <div className={`flex flex-col gap-1.5 ${className}`}>
            {label && (
                <label
                    htmlFor={id}
                    className={`text-xs font-bold uppercase tracking-wider ml-1 ${error ? 'text-error' : 'text-text-secondary'}`}
                >
                    {label}{required && <span className="text-error"> *</span>}
                </label>
            )}

            <div className="relative group">
                {/* Elementos izquierdos: icono y/o prefijo flotante */}
                {(startIcon || prefix) && (
                    <div translate="no" className={`absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none flex items-center gap-1.5 transition-colors ${error ? 'text-error' : 'text-text-secondary group-focus-within:text-primary'}`}>
                        {startIcon}
                        {prefix && <span className="font-mono text-[13px] tracking-wide mt-[1px] font-medium">{prefix}</span>}
                    </div>
                )}

                <input
                    id={id}
                    type={currentType}
                    value={value}
                    onChange={mask ? handleChange : onChange}
                    disabled={disabled}
                    required={required}
                    placeholder={placeholder}
                    className={`
                        ${inputBaseClass}
                        px-4
                        ${startIcon && prefix ? 'pl-[5.5rem]' : prefix ? 'pl-[3.5rem]' : startIcon ? 'pl-10' : ''}
                        ${isPassword || (isSearch && value) ? 'pr-10' : ''}
                    `}
                    {...props}
                />

                {/* Acciones derecha: toggle password / clear search */}
                <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
                    {isSearch && value && onClear && (
                        <button
                            type="button"
                            onClick={onClear}
                            className="text-text-secondary hover:text-error transition-colors p-1 rounded-full hover:bg-gray-100"
                        >
                            <X size={16} />
                        </button>
                    )}
                    {isPassword && (
                        <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            disabled={disabled}
                            className="text-text-secondary hover:text-heading focus:text-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed outline-none"
                            tabIndex={-1}
                        >
                            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    )}
                </div>
            </div>

            {/* Mensaje de error */}
            {error && (
                <div className="flex items-center gap-1 mt-1 ml-1 animate-in fade-in slide-in-from-top-1">
                    <AlertCircle size={12} className="text-error" />
                    <span className="text-[11px] text-error font-medium">{error}</span>
                </div>
            )}
        </div>
    );
};
