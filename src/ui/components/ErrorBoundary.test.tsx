import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

vi.mock('../../utils/logger', () => ({ Logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

const Boom = () => {
    throw new Error('kaboom');
};

const stubLocation = (pathname: string) => {
    const loc = { pathname, href: '', reload: vi.fn() };
    vi.stubGlobal('location', loc);
    return loc;
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.spyOn(console, 'error').mockRestore();
});

describe('ErrorBoundary > boton "Inicio"', () => {
    it.each([
        ['/inventario', '/inicio'],
        ['/planilla/empleados', '/inicio'],
        ['/tienda', '/'],
        ['/tienda/p/abc', '/'],
        ['/', '/'],
    ])('desde %s navega a %s', (from, to) => {
        vi.spyOn(console, 'error').mockImplementation(() => { });
        const loc = stubLocation(from);
        render(
            <ErrorBoundary>
                <Boom />
            </ErrorBoundary>,
        );
        fireEvent.click(screen.getByRole('button', { name: /Inicio/ }));
        expect(loc.href).toBe(to);
    });
});
