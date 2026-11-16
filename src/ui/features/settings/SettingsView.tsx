import React, { useState, useEffect } from 'react';
import { useAuthStore } from '../../../store/authStore';
import { useDispatcherStore } from '../../../store/dispatcherStore';
import { PageHeader } from '../../components/PageHeader';
import { Settings, Truck, Plus, Trash2, Edit2, Phone, User, X, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '../../components/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import { InputField } from '../../components/InputField';
import { formatPhoneForDB, formatPhoneForInput } from '../../../utils/phoneUtils';
import { useToast } from '../../../context/ToastContext';

export const SettingsView: React.FC = () => {
    const { profile } = useAuthStore();
    const { showToast } = useToast();
    const {
        dispatchers, isLoading, fetchDispatchers,
        addDispatcher, editDispatcher, removeDispatcher
    } = useDispatcherStore();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [editingDispatcher, setEditingDispatcher] = useState<{ id: string, name: string, phone: string } | null>(null);

    const [formData, setFormData] = useState({
        name: '',
        phone: ''
    });

    useEffect(() => {
        if (profile?.tenant_id) {
            fetchDispatchers(profile.tenant_id);
        }
    }, [profile?.tenant_id, fetchDispatchers]);

    const handleOpenCreate = () => {
        setEditingDispatcher(null);
        setFormData({ name: '', phone: '' });
        setIsModalOpen(true);
    };

    const handleOpenEdit = (d: any) => {
        setEditingDispatcher({ id: d.id, name: d.name, phone: formatPhoneForInput(d.phone) });
        setFormData({ name: d.name, phone: formatPhoneForInput(d.phone) });
        setIsModalOpen(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.tenant_id) return;

        const normalizedPhone = formatPhoneForDB(formData.phone);
        if (!normalizedPhone) {
            showToast('Por favor, ingresa un número de teléfono válido de 8 dígitos.', 'error');
            return;
        }

        try {
            if (editingDispatcher) {
                await editDispatcher(editingDispatcher.id, {
                    name: formData.name,
                    phone: normalizedPhone
                });
                showToast('Despachador actualizado correctamente', 'success');
            } else {
                await addDispatcher({
                    tenant_id: profile.tenant_id as string,
                    name: formData.name,
                    phone: normalizedPhone
                });
                showToast('Despachador creado correctamente', 'success');
            }
            setIsModalOpen(false);
        } catch (error) {
            showToast('Error al guardar el despachador', 'error');
        }
    };

    const handleDelete = async (id: string) => {
        setConfirmDeleteId(id);
    };

    const confirmDelete = async () => {
        if (!confirmDeleteId) return;
        const id = confirmDeleteId;
        setConfirmDeleteId(null);
        setIsDeletingId(id);
        try {
            await removeDispatcher(id);
            showToast('Despachador eliminado', 'success');
        } catch (error) {
            showToast('Error al eliminar', 'error');
        } finally {
            setIsDeletingId(null);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <PageHeader
                icon={Settings}
                title="Configuraciones"
                description="Gestiona las preferencias y contactos del sistema."
            />

            <div className="bg-white rounded-lg shadow-cards border border-border overflow-hidden">
                <div className="p-md sm:p-lg border-b border-border flex justify-between items-center gap-2">
                    <div className="flex items-center gap-sm min-w-0">
                        <Truck size={20} className="text-primary shrink-0" />
                        <div className="min-w-0">
                            <h2 className="text-body sm:text-h3 font-bold text-heading truncate">Despachadores</h2>
                            <p className="text-[10px] sm:text-caption text-text-secondary truncate">Contactos WhatsApp</p>
                        </div>
                    </div>
                    <Button onClick={handleOpenCreate} className="flex items-center gap-2 shrink-0 px-3 sm:px-4 h-[36px] sm:h-[42px]">
                        <Plus size={18} />
                        <span className="hidden xs:inline">Nuevo</span>
                        <span className="hidden sm:inline">Despachador</span>
                    </Button>
                </div>

                <div className="overflow-x-auto">
                    {isLoading && dispatchers.length === 0 ? (
                        <div className="p-xl text-center">
                            <Loader2 size={32} className="animate-spin text-primary mx-auto mb-sm" />
                            <p className="text-body text-text-secondary">Cargando despachadores...</p>
                        </div>
                    ) : dispatchers.length === 0 ? (
                        <div className="p-xl text-center">
                            <Truck size={48} className="text-text-secondary/20 mx-auto mb-md" />
                            <p className="text-body text-text-secondary">No hay despachadores registrados.</p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-surface border-b border-border text-caption text-text-secondary uppercase tracking-wider">
                                    <th className="p-md font-semibold">Nombre</th>
                                    <th className="p-md font-semibold">Teléfono</th>
                                    <th className="p-md font-semibold text-right">Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-border/50">
                                {dispatchers.map(d => (
                                    <tr key={d.id} className="hover:bg-surface/50 transition-colors">
                                        <td className="p-md text-heading font-bold">{d.name}</td>
                                        <td className="p-md text-body text-text-secondary">{formatPhoneForInput(d.phone)}</td>
                                        <td className="p-md text-right">
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={() => handleOpenEdit(d)}
                                                    className="p-2 text-text-secondary hover:text-primary transition-colors bg-surface border border-border rounded-md"
                                                >
                                                    <Edit2 size={16} />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(d.id)}
                                                    disabled={isDeletingId === d.id}
                                                    className="p-2 text-text-secondary hover:text-error transition-colors bg-surface border border-border rounded-md disabled:opacity-50"
                                                >
                                                    {isDeletingId === d.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            </div>

            {/* Modal de Creación/Edición */}
            {isModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-md bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-lg shadow-modals w-full max-w-[400px] animate-in zoom-in-95 duration-200 overflow-hidden">
                        <div className="px-lg py-md border-b border-border bg-surface/50 flex justify-between items-center">
                            <h3 className="text-h3 text-heading">{editingDispatcher ? 'Editar Despachador' : 'Nuevo Despachador'}</h3>
                            <button onClick={() => setIsModalOpen(false)} className="text-text-secondary hover:text-error">
                                <X size={20} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-lg flex flex-col gap-md">
                            <InputField
                                label="Nombre del Despachador"
                                placeholder="Ej: Juan Pérez"
                                icon={<User size={18} />}
                                value={formData.name}
                                onChange={e => setFormData({ ...formData, name: e.target.value })}
                                required
                            />
                            <InputField
                                label="Número de Teléfono"
                                icon={<Phone size={18} />}
                                mask="phone"
                                value={formData.phone}
                                onChange={e => setFormData({ ...formData, phone: e.target.value })}
                                required
                            />
                            <div className="flex gap-sm mt-md">
                                <Button variant="ghost" type="button" onClick={() => setIsModalOpen(false)} className="flex-1">Cancelar</Button>
                                <Button type="submit" className="flex-1">Guardar</Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmModal
                isOpen={!!confirmDeleteId}
                onClose={() => setConfirmDeleteId(null)}
                onConfirm={confirmDelete}
                title="¿Eliminar despachador?"
                message="Este contacto ya no aparecerá como opción para enviar pedidos por WhatsApp."
                confirmLabel="Sí, Eliminar"
                variant="danger"
                Icon={AlertCircle}
            />
        </div>
    );
};
