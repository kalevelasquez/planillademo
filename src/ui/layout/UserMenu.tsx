import React, { useState, useRef, useEffect } from 'react';
import { User, LogOut } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { authService } from '../../services/authService';
import { useNavigate } from 'react-router-dom';

interface UserMenuProps { }

export const UserMenu: React.FC<UserMenuProps> = () => {
    const navigate = useNavigate();
    const { profile, logout } = useAuthStore();
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    const getInitials = (name?: string) => {
        if (!name) return 'U';
        const parts = name.split(' ');
        if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
        return name.substring(0, 2).toUpperCase();
    };

    const handleLogout = async () => {
        setIsOpen(false);
        try {
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error('Logout network timeout')), 5000)
            );
            await Promise.race([authService.logout(), timeout]);
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            logout();
        }
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-8 h-8 rounded-full bg-heading text-white flex items-center justify-center text-sm font-bold cursor-pointer hover:opacity-90 transition-opacity shrink-0"
                aria-label="User menu"
            >
                {getInitials(profile?.full_name || undefined)}
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-modals border border-border py-1 z-50 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="px-4 py-3 border-b border-border">
                        <p className="text-sm font-bold text-heading truncate">{profile?.full_name}</p>
                        <p className="text-xs text-text-secondary uppercase truncate mt-0.5">{profile?.role}</p>
                    </div>

                    <div className="py-1">
                        <button
                            onClick={() => { setIsOpen(false); navigate('/perfil'); }}
                            className="flex items-center gap-3 px-4 py-2 text-body text-text-secondary hover:bg-surface hover:text-heading transition-colors w-full text-left"
                        >
                            <User size={18} />
                            <span>Mi Perfil</span>
                        </button>
                    </div>

                    <div className="border-t border-border py-1">
                        <button
                            onClick={handleLogout}
                            className="flex items-center gap-3 px-4 py-2 text-body text-error hover:bg-error/10 transition-colors w-full text-left"
                        >
                            <LogOut size={18} />
                            <span>Cerrar Sesión</span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};
