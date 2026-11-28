import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContactSection } from './ContactSection';
import { BRAND, CONTACT } from '../../../../config/brand';

describe('ContactSection', () => {
    it('usa solo CONTACT: mailto, tel, WhatsApp y direccion', () => {
        render(<ContactSection />);
        expect(screen.getByRole('heading', { level: 2, name: 'Contacto comercial' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: new RegExp(CONTACT.SALES_EMAIL) })).toHaveAttribute(
            'href',
            `mailto:${CONTACT.SALES_EMAIL}`,
        );
        expect(screen.getByRole('link', { name: /^Teléfono/ })).toHaveAttribute('href', `tel:+${CONTACT.SALES_PHONE}`);
        expect(screen.getByRole('link', { name: /^WhatsApp/ })).toHaveAttribute(
            'href',
            `https://wa.me/${CONTACT.SALES_WHATSAPP}`,
        );
        expect(screen.getByText(CONTACT.ADDRESS)).toBeInTheDocument();
    });

    it('nunca expone el contacto interno de BRAND (email de soporte / telefono de bodega)', () => {
        const { container } = render(<ContactSection />);
        expect(container.innerHTML).not.toContain(BRAND.SUPPORT_EMAIL);
        expect(container.innerHTML).not.toContain(BRAND.PHONE_BODEGA);
    });

    it('los links externos abren de forma segura', () => {
        render(<ContactSection />);
        const wa = screen.getByRole('link', { name: /^WhatsApp/ });
        expect(wa).toHaveAttribute('target', '_blank');
        expect(wa).toHaveAttribute('rel', expect.stringContaining('noopener'));
    });
});
