import { EMPLEADO_IMPORT_HEADERS, EMPLEADO_IMPORT_HEADERS_OBLIGATORIOS } from '../config/constants';
import { normalizarTexto } from './fuzzyMatchUtils';

/**
 * Carga masiva de Empleados desde Excel — pedido directo del jefe para el arranque de UAT
 * (necesitan cargar muchos empleados de una sola vez, no uno por uno). A diferencia de
 * `excelUtils.ts` (Reloj Marcador, que debe tolerar el formato del archivo REAL de Imporfrut),
 * acá la plantilla es nuestra: no hace falta tolerar variantes de nombre de columna, solo
 * insensibilidad a mayúsculas/tildes por si el usuario retipea el encabezado.
 */

export const DUI_REGEX = /^\d{8}-\d$/;

const TIPO_AFILIACION_LABELS: Record<string, 'afp_crecer' | 'afp_confia' | 'upiss' | 'jubilado' | 'ipsfa'> = {
    [normalizarTexto('AFP Crecer')]: 'afp_crecer',
    [normalizarTexto('AFP Confía')]: 'afp_confia',
    [normalizarTexto('UPISS')]: 'upiss',
    [normalizarTexto('Jubilado')]: 'jubilado',
    [normalizarTexto('IPSFA')]: 'ipsfa',
};

export function validateEmpleadoImportHeaders(headers: string[]): { isValid: boolean; missingHeaders: string[] } {
    const disponibles = headers.map(normalizarTexto);
    const missingHeaders = EMPLEADO_IMPORT_HEADERS_OBLIGATORIOS
        .map((k) => EMPLEADO_IMPORT_HEADERS[k])
        .filter((header) => !disponibles.includes(normalizarTexto(header)));
    return { isValid: missingHeaders.length === 0, missingHeaders };
}

function valorDe(row: Record<string, unknown>, header: string): unknown {
    const headerReal = Object.keys(row).find((h) => normalizarTexto(h) === normalizarTexto(header));
    return headerReal !== undefined ? row[headerReal] : undefined;
}

export interface EmpleadoImportCruda {
    codigoEmpleadoManual: string;
    nombreCompleto: string;
    dui: string;
    /** Alternativa al DUI para empleados extranjeros (2026-10-15) — ver validación de fila. */
    pasaporte: string;
    nit: string;
    nup: string;
    fechaNacimientoRaw: unknown;
    sexo: string;
    telefono: string;
    correo: string;
    direccion: string;
    contactoEmergenciaNombre: string;
    contactoEmergenciaTelefono: string;
    cargo: string;
    departamento: string;
    centroCostos: string;
    ubicacionNombre: string;
    fechaIngresoRaw: unknown;
    sueldoMensualRaw: unknown;
    tipoAfiliacion: string;
    numeroAfiliacionAfp: string;
    numeroAfiliadoIsss: string;
    banco: string;
    numeroCuenta: string;
    tipoContrato: string;
}

export function mapExcelRowToEmpleadoCruda(row: Record<string, unknown>): EmpleadoImportCruda {
    const texto = (header: string) => String(valorDe(row, header) ?? '').trim();
    return {
        codigoEmpleadoManual: texto(EMPLEADO_IMPORT_HEADERS.CODIGO_EMPLEADO),
        nombreCompleto: texto(EMPLEADO_IMPORT_HEADERS.NOMBRE_COMPLETO),
        dui: texto(EMPLEADO_IMPORT_HEADERS.DUI),
        pasaporte: texto(EMPLEADO_IMPORT_HEADERS.PASAPORTE),
        nit: texto(EMPLEADO_IMPORT_HEADERS.NIT),
        nup: texto(EMPLEADO_IMPORT_HEADERS.NUP),
        fechaNacimientoRaw: valorDe(row, EMPLEADO_IMPORT_HEADERS.FECHA_NACIMIENTO),
        sexo: texto(EMPLEADO_IMPORT_HEADERS.SEXO),
        telefono: texto(EMPLEADO_IMPORT_HEADERS.TELEFONO),
        correo: texto(EMPLEADO_IMPORT_HEADERS.CORREO),
        direccion: texto(EMPLEADO_IMPORT_HEADERS.DIRECCION),
        contactoEmergenciaNombre: texto(EMPLEADO_IMPORT_HEADERS.CONTACTO_EMERGENCIA_NOMBRE),
        contactoEmergenciaTelefono: texto(EMPLEADO_IMPORT_HEADERS.CONTACTO_EMERGENCIA_TELEFONO),
        cargo: texto(EMPLEADO_IMPORT_HEADERS.CARGO),
        departamento: texto(EMPLEADO_IMPORT_HEADERS.DEPARTAMENTO),
        centroCostos: texto(EMPLEADO_IMPORT_HEADERS.CENTRO_COSTOS),
        ubicacionNombre: texto(EMPLEADO_IMPORT_HEADERS.UBICACION),
        fechaIngresoRaw: valorDe(row, EMPLEADO_IMPORT_HEADERS.FECHA_INGRESO),
        sueldoMensualRaw: valorDe(row, EMPLEADO_IMPORT_HEADERS.SUELDO_MENSUAL),
        tipoAfiliacion: texto(EMPLEADO_IMPORT_HEADERS.TIPO_AFILIACION),
        numeroAfiliacionAfp: texto(EMPLEADO_IMPORT_HEADERS.NUMERO_AFILIACION_AFP),
        numeroAfiliadoIsss: texto(EMPLEADO_IMPORT_HEADERS.NUMERO_AFILIADO_ISSS),
        banco: texto(EMPLEADO_IMPORT_HEADERS.BANCO),
        numeroCuenta: texto(EMPLEADO_IMPORT_HEADERS.NUMERO_CUENTA),
        tipoContrato: texto(EMPLEADO_IMPORT_HEADERS.TIPO_CONTRATO),
    };
}

/**
 * `xlsx.read` con `cellDates: true` entrega un `Date` (construido en UTC — mismo gotcha ya
 * documentado en `excelUtils.ts.celdaAFecha`) si la celda tiene formato de fecha nativo; si es
 * texto, acepta ISO (`AAAA-MM-DD`) o el formato DD/MM/AAAA que ya es el estándar de toda la app
 * desde IMPL-137. `null` si no es ninguno de los dos, o si la fecha no existe en el calendario
 * (ej. 31/02/2026 pasa la regex pero no el round-trip).
 */
export function celdaAFechaISO(valor: unknown): string | null {
    if (valor instanceof Date) {
        const y = valor.getUTCFullYear();
        const m = String(valor.getUTCMonth() + 1).padStart(2, '0');
        const d = String(valor.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    const texto = String(valor ?? '').trim();
    if (!texto) return null;

    let anio: string, mes: string, dia: string;
    const matchIso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const matchDmy = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (matchIso) {
        [, anio, mes, dia] = matchIso;
    } else if (matchDmy) {
        [, dia, mes, anio] = matchDmy;
    } else {
        return null;
    }

    const fecha = new Date(`${anio}-${mes}-${dia}T00:00:00Z`);
    const valida = fecha.getUTCFullYear() === Number(anio) && fecha.getUTCMonth() + 1 === Number(mes) && fecha.getUTCDate() === Number(dia);
    return valida ? `${anio}-${mes}-${dia}` : null;
}

export interface EmpleadoImportListo {
    codigo_empleado_manual: string;
    nombre_completo: string;
    dui: string | null;
    pasaporte: string | null;
    nit: string | null;
    nup: string | null;
    fecha_nacimiento: string;
    sexo: 'M' | 'F' | null;
    telefono: string | null;
    correo: string | null;
    direccion: string | null;
    contacto_emergencia_nombre: string | null;
    contacto_emergencia_telefono: string | null;
    cargo: string | null;
    departamento: string | null;
    centro_costos: string | null;
    ubicacion_id: string;
    fecha_ingreso: string;
    sueldo_mensual: number;
    tipo_afiliacion: 'afp_crecer' | 'afp_confia' | 'upiss' | 'jubilado' | 'ipsfa' | null;
    numero_afiliacion_afp: string | null;
    numero_afiliado_isss: string | null;
    banco: string | null;
    numero_cuenta: string | null;
    tipo_contrato: string | null;
}

export interface FilaImportacionEmpleado {
    clientId: string;
    /** Fila 1 del Excel son los encabezados — la primera fila de datos es la 2. */
    numeroFilaExcel: number;
    nombreCompleto: string;
    codigoEmpleadoManual: string;
    errores: string[];
    /** `null` mientras haya al menos un error — esta fila no se manda al RPC. */
    listo: EmpleadoImportListo | null;
}

export interface ContextoValidacionImportacionEmpleados {
    ubicacionesActivas: { id: string; nombre: string }[];
    /** DUIs ya registrados en la base (no borrados), tal cual están guardados. */
    duisExistentes: Set<string>;
    /** Códigos de empleado manual ya registrados, normalizados (`normalizarTexto`). */
    codigosExistentesNormalizados: Set<string>;
}

/**
 * Valida CADA fila del archivo — mismas reglas que `useEmpleadoManagement.ts.validate()`
 * (obligatoriedad, formato de DUI, fechas no futuras, sueldo numérico) más lo que solo tiene
 * sentido en un lote: duplicados DENTRO del mismo archivo y contra la base ya existente (DUI y
 * Código Empleado), y que la Ubicación nombrada exista de verdad (única FK real del modelo, no
 * hay alta rápida posible como con Cargo/Departamento/Banco/Tipo de Contrato).
 */
export function validarFilasImportacionEmpleados(
    crudas: EmpleadoImportCruda[],
    contexto: ContextoValidacionImportacionEmpleados
): FilaImportacionEmpleado[] {
    const conteoDui = new Map<string, number>();
    const conteoPasaporte = new Map<string, number>();
    const conteoCodigo = new Map<string, number>();
    for (const c of crudas) {
        if (c.dui) conteoDui.set(c.dui, (conteoDui.get(c.dui) ?? 0) + 1);
        if (c.pasaporte) conteoPasaporte.set(c.pasaporte, (conteoPasaporte.get(c.pasaporte) ?? 0) + 1);
        if (c.codigoEmpleadoManual) {
            const clave = normalizarTexto(c.codigoEmpleadoManual);
            conteoCodigo.set(clave, (conteoCodigo.get(clave) ?? 0) + 1);
        }
    }

    const hoy = new Date().toISOString().slice(0, 10);

    return crudas.map((c, index) => {
        const errores: string[] = [];

        if (!c.codigoEmpleadoManual) {
            errores.push('Código Empleado es obligatorio.');
        } else {
            const clave = normalizarTexto(c.codigoEmpleadoManual);
            if ((conteoCodigo.get(clave) ?? 0) > 1) errores.push('Código Empleado duplicado dentro del archivo.');
            else if (contexto.codigosExistentesNormalizados.has(clave)) errores.push('Ya existe un empleado registrado con ese Código Empleado.');
        }

        if (!c.nombreCompleto) errores.push('Nombre Completo es obligatorio.');

        // 2026-10-15 — DUI o Pasaporte: se exige al menos uno de los dos (mismo criterio que
        // useEmpleadoManagement.ts.validate()), para poder cargar empleados extranjeros sin DUI
        // salvadoreño. Cada uno, si está presente, se valida por separado.
        if (!c.dui && !c.pasaporte) {
            errores.push('DUI o Pasaporte es obligatorio.');
        }

        if (c.dui) {
            if (!DUI_REGEX.test(c.dui)) errores.push('DUI con formato inválido (debe ser NNNNNNNN-N).');
            else if ((conteoDui.get(c.dui) ?? 0) > 1) errores.push('DUI duplicado dentro del archivo.');
            else if (contexto.duisExistentes.has(c.dui)) errores.push('Ya existe un empleado registrado con ese DUI.');
        }

        if (c.pasaporte && (conteoPasaporte.get(c.pasaporte) ?? 0) > 1) {
            errores.push('Pasaporte duplicado dentro del archivo.');
        }

        const fechaNacimientoVacia = c.fechaNacimientoRaw === undefined || c.fechaNacimientoRaw === '';
        const fechaNacimiento = fechaNacimientoVacia ? null : celdaAFechaISO(c.fechaNacimientoRaw);
        if (fechaNacimientoVacia) errores.push('Fecha de Nacimiento es obligatoria.');
        else if (!fechaNacimiento) errores.push('Fecha de Nacimiento con formato inválido (use DD/MM/AAAA).');
        else if (fechaNacimiento > hoy) errores.push('Fecha de Nacimiento no puede ser futura.');

        let sexoResuelto: 'M' | 'F' | null = null;
        if (c.sexo) {
            const s = c.sexo.toUpperCase();
            if (s === 'M' || s === 'F') sexoResuelto = s;
            else errores.push('Sexo debe ser M o F.');
        }

        const ubicacion = c.ubicacionNombre
            ? contexto.ubicacionesActivas.find((u) => normalizarTexto(u.nombre) === normalizarTexto(c.ubicacionNombre))
            : undefined;
        if (!c.ubicacionNombre) errores.push('Ubicación es obligatoria.');
        else if (!ubicacion) errores.push(`Ubicación "${c.ubicacionNombre}" no existe. Verificá el nombre exacto.`);

        const fechaIngresoVacia = c.fechaIngresoRaw === undefined || c.fechaIngresoRaw === '';
        const fechaIngreso = fechaIngresoVacia ? null : celdaAFechaISO(c.fechaIngresoRaw);
        if (fechaIngresoVacia) errores.push('Fecha de Ingreso es obligatoria.');
        else if (!fechaIngreso) errores.push('Fecha de Ingreso con formato inválido (use DD/MM/AAAA).');
        else if (fechaIngreso > hoy) errores.push('Fecha de Ingreso no puede ser futura.');

        const sueldoVacio = c.sueldoMensualRaw === undefined || c.sueldoMensualRaw === '';
        const sueldoNumero = sueldoVacio ? NaN : Number(c.sueldoMensualRaw);
        if (sueldoVacio) errores.push('Sueldo Mensual es obligatorio.');
        else if (isNaN(sueldoNumero)) errores.push('Sueldo Mensual debe ser numérico.');

        let tipoAfiliacionResuelto: EmpleadoImportListo['tipo_afiliacion'] = null;
        if (c.tipoAfiliacion) {
            const resuelto = TIPO_AFILIACION_LABELS[normalizarTexto(c.tipoAfiliacion)];
            if (!resuelto) errores.push('Tipo de Afiliación inválido (use AFP Crecer, AFP Confía, UPISS, Jubilado o IPSFA).');
            else tipoAfiliacionResuelto = resuelto;
        }

        const listo: EmpleadoImportListo | null = errores.length === 0 ? {
            codigo_empleado_manual: c.codigoEmpleadoManual,
            nombre_completo: c.nombreCompleto,
            dui: c.dui || null,
            pasaporte: c.pasaporte || null,
            nit: c.nit || null,
            nup: c.nup || null,
            fecha_nacimiento: fechaNacimiento as string,
            sexo: sexoResuelto,
            telefono: c.telefono || null,
            correo: c.correo || null,
            direccion: c.direccion || null,
            contacto_emergencia_nombre: c.contactoEmergenciaNombre || null,
            contacto_emergencia_telefono: c.contactoEmergenciaTelefono || null,
            cargo: c.cargo || null,
            departamento: c.departamento || null,
            centro_costos: c.centroCostos || null,
            ubicacion_id: (ubicacion as { id: string }).id,
            fecha_ingreso: fechaIngreso as string,
            sueldo_mensual: sueldoNumero,
            tipo_afiliacion: tipoAfiliacionResuelto,
            numero_afiliacion_afp: c.numeroAfiliacionAfp || null,
            numero_afiliado_isss: c.numeroAfiliadoIsss || null,
            banco: c.banco || null,
            numero_cuenta: c.numeroCuenta || null,
            tipo_contrato: c.tipoContrato || null,
        } : null;

        return {
            clientId: `fila-${index}`,
            numeroFilaExcel: index + 2,
            nombreCompleto: c.nombreCompleto,
            codigoEmpleadoManual: c.codigoEmpleadoManual,
            errores,
            listo,
        };
    });
}

export interface ItemCatalogoResoluble {
    nombre: string;
}

/**
 * Resuelve un valor de texto libre (Cargo/Departamento/Banco/Tipo de Contrato) contra el catálogo
 * ya cargado — insensible a mayúsculas/tildes, para no crear "Producción" y "produccion" como dos
 * registros distintos. Si no existe, lo da de alta (decisión explícita del usuario: "auto-registrar
 * como el quick-add del alta individual" — mismo criterio, misma función `crear*` que ya usa
 * `CatalogSelectQuickAdd`, así que hereda exactamente el mismo comportamiento de permisos: si el
 * rol de quien importa no puede crear ese catálogo, falla igual que fallaría el quick-add).
 */
export async function resolverValorCatalogo(
    valorCrudo: string,
    itemsExistentes: ItemCatalogoResoluble[],
    crear: (nombre: string) => Promise<ItemCatalogoResoluble>
): Promise<{ valorCanonico: string | null; error: string | null }> {
    const existente = itemsExistentes.find((it) => normalizarTexto(it.nombre) === normalizarTexto(valorCrudo));
    if (existente) return { valorCanonico: existente.nombre, error: null };

    try {
        const creado = await crear(valorCrudo);
        return { valorCanonico: creado.nombre, error: null };
    } catch (err: unknown) {
        return { valorCanonico: null, error: err instanceof Error ? err.message : 'Error desconocido' };
    }
}
