import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { getCodigoEmpleado } from '../../utils/empleadoCodigoUtils';

export interface EmpleadoComboboxOption {
    id: string;
    nombre_completo: string;
    codigo: string;
    codigo_empleado_manual?: string | null;
    cargo?: string | null;
}

interface EmpleadoComboboxProps<T extends EmpleadoComboboxOption> {
    empleados: T[];
    value: T | null;
    onChange: (empleado: T | null) => void;
    placeholder?: string;
    noResultsLabel: string;
    maxResults?: number;
    className?: string;
}

/**
 * Combobox de empleado (US-UX-02, fidelidad al prototipo del PM): a diferencia del `<select>`
 * nativo, muestra una lista al hacer foco (sin exigir texto) y escribir solo la filtra — mismo
 * comportamiento que `AnticiposView.tsx` del DEMO. Reemplaza el mismo bloque que estaba
 * duplicado en Vacaciones/Bonificaciones/OtrosIngresos/Anticipos/Incapacidades/Kilometraje/
 * PorRuta, donde el dropdown solo se montaba si había texto escrito.
 *
 * El dropdown se porta a `document.body` (hallazgo UAT, reportes IMPL-157/160/158): un
 * `position: absolute` normal queda recortado por cualquier ancestro con `overflow` distinto de
 * `visible` (ej. el body scrolleable de un modal), aunque tenga z-index alto — no es un problema
 * de capas, es que el overflow del ancestro recorta la caja antes de pintar el hijo. Portarlo
 * fuera del árbol y posicionarlo con `fixed` según `getBoundingClientRect()` del input evita el
 * recorte sin importar en qué contenedor se use el combobox.
 */
export function EmpleadoCombobox<T extends EmpleadoComboboxOption>({
    empleados, value, onChange, placeholder, noResultsLabel, maxResults = 8, className,
}: EmpleadoComboboxProps<T>) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const [posicion, setPosicion] = useState<{ top: number; left: number; width: number } | null>(null);

    useEffect(() => {
        setQuery('');
        setOpen(false);
    }, [value]);

    useEffect(() => {
        if (!open) return;
        const actualizarPosicion = () => {
            const rect = inputRef.current?.getBoundingClientRect();
            if (rect) setPosicion({ top: rect.bottom + 4, left: rect.left, width: rect.width });
        };
        actualizarPosicion();
        // captura=true: se entera de scroll en cualquier contenedor ancestro (ej. el body del
        // modal), no solo en window.
        window.addEventListener('scroll', actualizarPosicion, true);
        window.addEventListener('resize', actualizarPosicion);
        return () => {
            window.removeEventListener('scroll', actualizarPosicion, true);
            window.removeEventListener('resize', actualizarPosicion);
        };
    }, [open]);

    const resultados = useMemo(() => {
        const termino = query.trim().toLowerCase();
        const base = termino
            ? empleados.filter((e) => e.nombre_completo.toLowerCase().includes(termino) || getCodigoEmpleado(e).toLowerCase().includes(termino))
            : empleados;
        return base.slice(0, maxResults);
    }, [query, empleados, maxResults]);

    if (value) {
        return (
            <div className={`flex items-center justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm ${className ?? ''}`}>
                <span className="font-medium text-heading">{value.nombre_completo}{value.cargo ? ` — ${value.cargo}` : ''}</span>
                <button type="button" onClick={() => onChange(null)} className="text-text-secondary hover:text-error">
                    <X size={14} />
                </button>
            </div>
        );
    }

    return (
        <div className={`relative ${className ?? ''}`}>
            <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                onFocus={() => setOpen(true)}
                onBlur={() => setTimeout(() => setOpen(false), 150)}
                placeholder={placeholder}
                className="w-full rounded-md border border-border bg-white px-3 py-2 text-sm"
            />
            {open && posicion && createPortal(
                <div
                    style={{ position: 'fixed', top: posicion.top, left: posicion.left, width: posicion.width }}
                    className="bg-white border border-border rounded-md shadow-cards z-50 max-h-52 overflow-y-auto"
                >
                    {resultados.length === 0 ? (
                        <p className="px-3 py-2 text-[12px] text-text-secondary">{noResultsLabel}</p>
                    ) : (
                        resultados.map((emp) => (
                            <button
                                key={emp.id}
                                type="button"
                                onClick={() => onChange(emp)}
                                className="w-full text-left px-3 py-2 text-[13px] hover:bg-surface"
                            >
                                {emp.nombre_completo}{emp.cargo ? ` — ${emp.cargo}` : ''} <span className="text-text-secondary">({getCodigoEmpleado(emp)})</span>
                            </button>
                        ))
                    )}
                </div>,
                document.body,
            )}
        </div>
    );
}
