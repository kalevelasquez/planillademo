import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { RegisterForm } from './RegisterForm';

const setup = (props: Partial<React.ComponentProps<typeof RegisterForm>> = {}) => {
    const onSubmit = vi.fn();
    render(
        <MemoryRouter>
            <RegisterForm onSubmit={onSubmit} {...props} />
        </MemoryRouter>,
    );
    return onSubmit;
};

const fillRequired = async (password = 'Secreta123') => {
    await userEvent.type(screen.getByLabelText('Nombre completo'), '  Ana Perez ');
    await userEvent.type(screen.getByLabelText('Teléfono'), '70001111');
    await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@x.com');
    await userEvent.type(screen.getByLabelText('Contraseña'), password);
};

describe('RegisterForm', () => {
    it('envia los datos (recortados); opcionales vacios van como cadena vacia', async () => {
        const onSubmit = setup();
        await fillRequired();
        await userEvent.type(screen.getByLabelText('Dirección (opcional)'), 'Calle 1');
        await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
        expect(onSubmit).toHaveBeenCalledWith({
            fullName: 'Ana Perez',
            phone: '70001111',
            email: 'ana@x.com',
            password: 'Secreta123',
            address: 'Calle 1',
            department: '',
            municipality: '',
        });
    });

    it('contrasena corta: error y no envia; campos obligatorios vacios tambien', async () => {
        const onSubmit = setup();
        await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
        expect(screen.getAllByText('Este campo es obligatorio').length).toBeGreaterThanOrEqual(4);
        expect(onSubmit).not.toHaveBeenCalled();

        await fillRequired('corta');
        await userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
        expect(screen.getByText('La contraseña debe tener al menos 8 caracteres')).toBeInTheDocument();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('error del servidor como alerta, enlace a ingresar y boton deshabilitado al enviar', () => {
        setup({ errorMessage: 'El registro no está disponible por el momento.', submitting: true });
        expect(screen.getByRole('alert')).toHaveTextContent('El registro no está disponible por el momento.');
        expect(screen.getByRole('link', { name: 'Ingresá' })).toHaveAttribute('href', '/cuenta');
        expect(screen.getByRole('button', { name: 'Creando cuenta…' })).toBeDisabled();
    });
});
