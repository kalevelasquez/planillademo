import React from 'react';
import BrandLogo from '../../assets/images/logo-imporfrut.png';
import { UserMenu } from './UserMenu';
import { NotificationBell } from './NotificationBell';

interface NavbarProps {
    title?: string;
    onNavigate?: (view: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ title }) => {
    return (
        <nav className="print:hidden h-16 border-b border-border bg-white flex items-center justify-between px-6 sticky top-0 z-40 w-full shadow-sm">
            <div className="flex items-center gap-4">
                <img src={BrandLogo} alt="Teknergy ImporFrut" className="md:hidden h-10 max-h-10 w-auto object-contain shrink-0" />
                {title && (
                    <span className="hidden sm:inline-block text-h3 text-heading md:ml-0 md:pl-0 md:border-l-0 ml-4 pl-4 border-l border-border">
                        {title}
                    </span>
                )}
            </div>

            <div className="flex items-center gap-4">
                <NotificationBell />
                <UserMenu />
            </div>
        </nav>
    );
};
