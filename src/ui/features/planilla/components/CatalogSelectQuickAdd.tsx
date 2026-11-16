import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';

import type { ColorKey } from '../../../../services/departamentosService';
import { InputField } from '../../../components/InputField';
import { ConfigCrudModal } from './ConfigCrudModal';
import { ColorSwatches } from './ColorSwatches';

interface CatalogItem {
    id: string;
    nombre: string;
    estado: 'activo' | 'inactivo';
}

interface CatalogSelectQuickAddProps {
    id?: string;
    label: string;
    value: string;
    onChange: (nombre: string) => void;
    items: CatalogItem[];
    onCrear: (nombre: string) => Promise<CatalogItem>;
    emptyOptionLabel?: string;
    required?: boolean;
    disabled?: boolean;
    hint?: string;
    quickAddTitle: string;
    quickAddFieldLabel: string;
    duplicadoErrorMessage: string;
    genericErrorMessage: string;
    /** Solo lo pasan catálogos con color (ej. Departamentos) — muestra los swatches en el alta
     * rápida, igual que en Configuración. Sin esto no se ve ningún selector de color. */
    colorPicker?: { value: ColorKey; onChange: (color: ColorKey) => void };
}

/**
 * `<select>` sobre un catálogo administrable + botón "+" que abre un alta rápida en el mismo
 * lugar (IMPL-133, Observación General UAT — requisito explícito: "en cada pantalla donde se
 * use un dropdown de este tipo, debe existir la opción de agregar un registro nuevo al
 * catálogo... sin tener que ir hasta Configuración"). El valor inactivo actualmente
 * seleccionado se sigue mostrando (mismo criterio que el select de Departamento en
 * EmpleadoDetailView) para no perder el dato de un registro viejo.
 */
export const CatalogSelectQuickAdd: React.FC<CatalogSelectQuickAddProps> = ({
    id, label, value, onChange, items, onCrear, emptyOptionLabel, required, disabled, hint,
    quickAddTitle, quickAddFieldLabel, duplicadoErrorMessage, genericErrorMessage, colorPicker,
}) => {
    const { t } = useTranslation();
    const [mostrarModal, setMostrarModal] = useState(false);
    const [nombreNuevo, setNombreNuevo] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const cerrarModal = () => {
        setMostrarModal(false);
        setNombreNuevo('');
        setError(null);
    };

    const handleCrear = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!nombreNuevo.trim()) return;
        setError(null);
        setIsSubmitting(true);
        try {
            const creado = await onCrear(nombreNuevo.trim());
            onChange(creado.nombre);
            cerrarModal();
        } catch (err: unknown) {
            const code = (err as { code?: string } | null)?.code;
            setError(code === '23505' ? duplicadoErrorMessage : genericErrorMessage);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="flex flex-col gap-1.5">
            <label className="text-sm font-semibold text-heading ml-0.5">
                {label} {required && <span className="text-error">*</span>}
            </label>
            <div className="flex gap-2">
                <select
                    id={id}
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    disabled={disabled}
                    className="flex-1 bg-white border border-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-sm appearance-none cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {emptyOptionLabel && <option value="">{emptyOptionLabel}</option>}
                    {items
                        .filter((it) => it.estado === 'activo' || it.nombre === value)
                        .map((it) => (
                            <option key={it.id} value={it.nombre}>
                                {it.nombre}{it.estado === 'inactivo' ? ` (${t('horasExtras.estado_inactivo')})` : ''}
                            </option>
                        ))}
                </select>
                {!disabled && (
                    <button
                        type="button"
                        onClick={() => setMostrarModal(true)}
                        title={quickAddTitle}
                        className="shrink-0 w-10 flex items-center justify-center rounded-xl border border-border text-text-secondary hover:text-primary hover:border-primary transition-colors"
                    >
                        <Plus size={16} />
                    </button>
                )}
            </div>
            {hint && <p className="text-[11px] text-text-secondary italic ml-0.5">{hint}</p>}

            {mostrarModal && (
                <ConfigCrudModal title={quickAddTitle} onClose={cerrarModal} onSave={handleCrear} saving={isSubmitting}>
                    <InputField label={quickAddFieldLabel} value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} />
                    {colorPicker && <ColorSwatches valor={colorPicker.value} onPick={colorPicker.onChange} />}
                    {error && <p className="text-caption text-error">{error}</p>}
                </ConfigCrudModal>
            )}
        </div>
    );
};
