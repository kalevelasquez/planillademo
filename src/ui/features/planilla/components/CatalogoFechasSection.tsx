import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Trash2, Plus, Pencil } from 'lucide-react';
import { InputField } from '../../../components/InputField';
import { ConfirmModal } from '../../../components/ConfirmModal';
import { PageLoader } from '../../../components/PageLoader';
import { ConfigCrudModal } from './ConfigCrudModal';
import { useToast } from '../../../../context/ToastContext';
import { Logger } from '../../../../utils/logger';

export interface ItemCatalogoFecha {
    id: string;
    fecha: string;
    texto: string | null;
}

interface CatalogoFechasSectionProps {
    titulo: string;
    icono: React.ElementType;
    items: ItemCatalogoFecha[];
    isLoading: boolean;
    campoTextoLabel: string;
    campoTextoPlaceholder: string;
    emptyLabel: string;
    onAdd: (fecha: string, texto: string) => Promise<void>;
    onEdit: (id: string, fecha: string, texto: string) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    headerAction?: React.ReactNode;
}

function fmtFecha(iso: string): string {
    return new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });
}

/**
 * Sección genérica de catálogo fecha+texto con alta/baja — reusada por Feriados
 * Nacionales y Días Exentos de Penalización (US-QNA-05), que son catálogos
 * independientes pero con la misma forma de datos y las mismas acciones (CA4).
 * Fidelidad al DEMO: tabla desktop + cards mobile en vez de lista plana, alta vía modal
 * bottom-sheet en vez de formulario inline, contador junto al título.
 */
export const CatalogoFechasSection: React.FC<CatalogoFechasSectionProps> = ({
    titulo, icono: Icono, items, isLoading, campoTextoLabel, campoTextoPlaceholder, emptyLabel, onAdd, onEdit, onDelete, headerAction,
}) => {
    const { t } = useTranslation();
    const { showToast } = useToast();
    const [mostrarModal, setMostrarModal] = useState(false);
    const [editTarget, setEditTarget] = useState<ItemCatalogoFecha | null>(null);
    const [fecha, setFecha] = useState('');
    const [texto, setTexto] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [eliminandoId, setEliminandoId] = useState<string | null>(null);
    const [itemAEliminar, setItemAEliminar] = useState<ItemCatalogoFecha | null>(null);

    const cerrarModal = () => { setMostrarModal(false); setEditTarget(null); setFecha(''); setTexto(''); setError(null); };

    const abrirAlta = () => { setEditTarget(null); setFecha(''); setTexto(''); setError(null); setMostrarModal(true); };

    const abrirEdicion = (item: ItemCatalogoFecha) => {
        setEditTarget(item);
        setFecha(item.fecha);
        setTexto(item.texto ?? '');
        setError(null);
        setMostrarModal(true);
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!fecha) { setError('La fecha es obligatoria.'); return; }
        setError(null);
        setIsSubmitting(true);
        try {
            if (editTarget) {
                await onEdit(editTarget.id, fecha, texto.trim());
            } else {
                await onAdd(fecha, texto.trim());
            }
            cerrarModal();
        } catch (err: unknown) {
            // Bugfix (auditoría): antes se mostraba err.message crudo — un duplicado filtraba
            // el texto nativo de Postgres ("duplicate key value violates unique constraint...").
            const code = (err as { code?: string } | null)?.code;
            setError(code === '23505' ? t('quincenas.catalogo_fecha_duplicada') : t('quincenas.catalogo_fecha_error_guardar'));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleConfirmarEliminar = async () => {
        if (!itemAEliminar) return;
        setEliminandoId(itemAEliminar.id);
        try {
            await onDelete(itemAEliminar.id);
            setItemAEliminar(null);
        } catch (err: unknown) {
            // Bugfix (auditoría): antes no había catch — un rechazo dejaba el modal de
            // confirmación abierto para siempre, sin mensaje, solo el spinner se detenía.
            Logger.error('Error al eliminar item de catálogo de fechas', { id: itemAEliminar.id }, err);
            showToast(t('quincenas.catalogo_fecha_error_eliminar'), 'error');
        } finally {
            setEliminandoId(null);
        }
    };

    return (
        <section className="flex flex-col gap-4 bg-white rounded-lg shadow-cards border border-border p-lg">
            <div className="flex items-center justify-between pb-1 border-b border-border/50 flex-wrap gap-2">
                <div className="flex items-center gap-2">
                    <Icono size={14} className="text-primary" />
                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-secondary">
                        {titulo} · {t('configuracion.contador_registros', { count: items.length })}
                    </h3>
                </div>
                <div className="flex items-center gap-1.5">
                    {headerAction}
                    <button
                        type="button"
                        onClick={abrirAlta}
                        className="flex items-center gap-1.5 px-md py-xs bg-primary text-white rounded-lg font-semibold text-[12px] hover:bg-primary-dark transition-colors shadow-cards"
                    >
                        <Plus size={14} /> Agregar
                    </button>
                </div>
            </div>

            {isLoading ? (
                <PageLoader label={t('common.loading')} />
            ) : items.length === 0 ? (
                <p className="text-caption text-text-secondary italic">{emptyLabel}</p>
            ) : (
                <div className="bg-white rounded-xl border border-border overflow-hidden">
                    {/* Desktop */}
                    <div className="hidden sm:block overflow-x-auto max-h-72 overflow-y-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="bg-surface border-b border-border">
                                    <th className="px-md py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">Fecha</th>
                                    <th className="px-md py-sm text-[10px] font-bold uppercase tracking-widest text-text-secondary">{campoTextoLabel}</th>
                                    <th className="w-20 px-md py-sm" />
                                </tr>
                            </thead>
                            <tbody>
                                {items.map((item) => (
                                    <tr key={item.id} className="border-b border-border last:border-0 hover:bg-surface/60 transition-colors">
                                        <td className="px-md py-sm text-[13px] font-semibold text-heading">{fmtFecha(item.fecha)}</td>
                                        <td className="px-md py-sm text-[13px] text-text-secondary">{item.texto || '—'}</td>
                                        <td className="px-md py-sm">
                                            <div className="flex items-center justify-end gap-1">
                                                <button
                                                    type="button"
                                                    onClick={() => abrirEdicion(item)}
                                                    className="p-1.5 text-text-secondary hover:text-primary transition-colors rounded-lg hover:bg-primary/10"
                                                >
                                                    <Pencil size={14} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setItemAEliminar(item)}
                                                    disabled={eliminandoId === item.id}
                                                    className="p-1.5 text-text-secondary hover:text-error transition-colors rounded-lg hover:bg-error/10 disabled:opacity-50"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile cards */}
                    <div className="sm:hidden flex flex-col divide-y divide-border max-h-72 overflow-y-auto">
                        {items.map((item) => (
                            <div key={item.id} className="flex items-center gap-md px-md py-sm">
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-heading text-[13px]">{fmtFecha(item.fecha)}</p>
                                    {item.texto && <p className="text-[11px] text-text-secondary truncate">{item.texto}</p>}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => abrirEdicion(item)}
                                        className="p-1.5 text-text-secondary hover:text-primary rounded-lg"
                                    >
                                        <Pencil size={14} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setItemAEliminar(item)}
                                        disabled={eliminandoId === item.id}
                                        className="p-1.5 text-text-secondary hover:text-error rounded-lg disabled:opacity-50"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {mostrarModal && (
                <ConfigCrudModal title={editTarget ? `Editar — ${titulo}` : `Agregar — ${titulo}`} onClose={cerrarModal} onSave={handleSave} saving={isSubmitting}>
                    <InputField label="Fecha" type="date" mask="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
                    <InputField label={campoTextoLabel} placeholder={campoTextoPlaceholder} value={texto} onChange={(e) => setTexto(e.target.value)} />
                    {error && <p className="text-caption text-error">{error}</p>}
                </ConfigCrudModal>
            )}

            <ConfirmModal
                isOpen={itemAEliminar !== null}
                onClose={() => setItemAEliminar(null)}
                onConfirm={handleConfirmarEliminar}
                title={t('quincenas.catalogo_fecha_eliminar_title')}
                message={t('quincenas.catalogo_fecha_eliminar_message', { fecha: itemAEliminar ? fmtFecha(itemAEliminar.fecha) : '' })}
                confirmLabel={t('quincenas.catalogo_fecha_eliminar_confirm')}
                variant="danger"
                Icon={Trash2}
                isLoading={eliminandoId === itemAEliminar?.id}
            />
        </section>
    );
};
