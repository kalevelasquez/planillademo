import React, { useState, useEffect } from 'react';
import { User, Phone, CheckCircle2 } from 'lucide-react';
import { useAuthStore } from '../../../store/authStore';
import { supabase } from '../../../services/authService';
import { Button } from '../../components/Button';
import { useToast } from '../../../context/ToastContext';

export const ProfileView: React.FC = () => {
    const { profile, setAuth } = useAuthStore();
    const { showToast } = useToast();

    const [formData, setFormData] = useState({
        full_name: profile?.full_name || '',
        phone: profile?.phone || '',
    });
    const [isSaving, setIsSaving] = useState(false);
    const [userEmail, setUserEmail] = useState('');

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => {
            if (data?.user?.email) {
                setUserEmail(data.user.email);
            }
        });
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!profile?.id) return;

        setIsSaving(true);
        try {
            const { error } = await supabase
                .from('user_profiles')
                .update({
                    full_name: formData.full_name,
                    phone: formData.phone
                })
                .eq('id', profile.id);

            if (error) {
                console.error("Profile update error:", error);
                throw new Error("No se pudo actualizar el perfil. Verifica la conexión.");
            }

            // Sync con estado local sin necesidad de fetch
            setAuth({
                ...profile,
                full_name: formData.full_name,
                phone: formData.phone
            });
            showToast('Perfil actualizado con éxito', 'success');
        } catch (err: any) {
            showToast(err.message, 'error');
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-lg animate-in fade-in duration-300 pb-24 md:pb-0 max-w-4xl mx-auto w-full px-4 sm:px-6 lg:px-8 mt-md">
            <div className="flex items-center gap-sm border-b border-border pb-md">
                <div className="w-10 h-10 md:w-12 md:h-12 bg-heading/10 rounded-lg flex items-center justify-center text-heading shrink-0">
                    <User size={24} className="w-5 h-5 md:w-6 md:h-6" />
                </div>
                <div className="min-w-0">
                    <h1 className="text-h2 md:text-h1 text-heading truncate">Mi Perfil</h1>
                    <p className="text-caption md:text-body text-text-secondary mt-[2px] truncate">
                        Ajustes y preferencias de tu cuenta
                    </p>
                </div>
            </div>

            <div className="bg-white rounded-lg shadow-cards border border-border p-md md:p-xl w-full">
                <form onSubmit={handleSave} className="flex flex-col gap-lg">
                    {/* Read-Only Fields */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-md bg-surface p-md rounded-md border border-border/50">
                        <div className="flex flex-col gap-xs">
                            <label className="text-caption font-bold text-heading uppercase tracking-wider">Correo Electrónico (Solo Lectura)</label>
                            <input
                                type="email"
                                value={userEmail}
                                disabled
                                className="w-full bg-gray-100 border border-border rounded-md px-4 py-2 text-text-secondary cursor-not-allowed"
                            />
                        </div>
                        <div className="flex flex-col gap-xs">
                            <label className="text-caption font-bold text-heading uppercase tracking-wider">Rol de Acceso</label>
                            <div>
                                <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-heading/10 text-heading border border-heading/20">
                                    {profile?.role || 'Desconocido'}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Editable Fields */}
                    <div className="flex flex-col gap-sm">
                        <label className="text-caption font-bold text-heading">Nombre Completo</label>
                        <div className="relative">
                            <User className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary w-5 h-5 pointer-events-none" />
                            <input
                                type="text"
                                name="full_name"
                                value={formData.full_name}
                                onChange={handleChange}
                                placeholder="Ingresa tu nombre completo"
                                className="w-full border border-border rounded-md pl-10 pr-4 py-2 bg-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm"
                                required
                            />
                        </div>
                    </div>

                    <div className="flex flex-col gap-sm">
                        <label className="text-caption font-bold text-heading">Teléfono (Opcional)</label>
                        <div className="relative">
                            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary w-5 h-5 pointer-events-none" />
                            <input
                                type="tel"
                                name="phone"
                                value={formData.phone}
                                onChange={handleChange}
                                placeholder="+1 234 567 890"
                                className="w-full border border-border rounded-md pl-10 pr-4 py-2 bg-white focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary shadow-sm"
                            />
                        </div>
                    </div>

                    <div className="pt-md border-t border-border flex justify-end">
                        <Button
                            type="submit"
                            isLoading={isSaving}
                            className="w-full md:w-auto flex justify-center items-center gap-2"
                        >
                            <CheckCircle2 size={18} />
                            Guardar Cambios
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};
