import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { LoginForm } from './LoginForm';

const setup = (props: Partial<React.ComponentProps<typeof LoginForm>> = {}) => {
    const onSubmit = vi.fn();
    render(
        <MemoryRouter>
            <LoginForm onSubmit={onSubmit} {...props} />
        </MemoryRouter>,
    );
    return onSubmit;
};

describe('LoginForm', () => {
    it('envia email y contrasena', async () => {
        const onSubmit = setup();
        await userEvent.type(screen.getByLabelText('Correo electrónico'), 'ana@x.com');
        await userEvent.type(screen.getByLabelText('Contraseña'), 'Secreta123');
        await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
        expect(onSubmit).toHaveBeenCalledWith({ email: 'ana@x.com', password: 'Secreta123' });
    });

    it('vacio o email invalido: muestra validacion y NO envia', async () => {
        const onSubmit = setup();
        await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
        expect(screen.getAllByText('Este campo es obligatorio')).toHaveLength(2);
        expect(onSubmit).not.toHaveBeenCalled();

        await userEvent.type(screen.getByLabelText('Correo electrónico'), 'no-es-correo');
        await userEvent.type(screen.getByLabelText('Contraseña'), 'x');
        await userEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
        expect(screen.getByText('Ingresá un correo válido')).toBeInTheDocument();
        expect(onSubmit).not.toHaveBeenCalled();
    });

    it('muestra el error del servidor como alerta y enlaza a crear cuenta', () => {
        setup({ errorMessage: 'Correo o contraseña incorrectos.' });
        expect(screen.getByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
        expect(screen.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute('href', '/cuenta/registro');
    });

    it('mientras envia deshabilita el boton', () => {
        setup({ submitting: true });
        expect(screen.getByRole('button', { name: 'Ingresando…' })).toBeDisabled();
    });
});
