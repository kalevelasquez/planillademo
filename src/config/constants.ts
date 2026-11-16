


// Grupos de costos de nivel 1 (IMPL-167 CA3 / 20260909120000_agregar_grupo_costos_departamentos),
// exactos a los sembrados en `planilla_departamentos.grupo_costos` y en
// `planilla_catalogo_cuentas_contables.grupo_costos` — `exportacionesContablesService` resuelve
// la cuenta contable real por MATCH EXACTO de este string. Bugfix (hallazgo UAT 2026-11-03): el
// campo era texto libre en Configuración > Departamentos — un typo de singular/plural (ej. escribir
// "GASTOS DE OPERACIONES" en vez de "GASTO DE OPERACIONES") rompía el match en silencio y la
// Partida Diario caía entera a "PENDIENTE_CONFIGURAR" para ese departamento. Ahora es un select
// con estos 3 valores, no texto libre.
export const GRUPOS_COSTOS = ['GASTOS ADMINISTRATIVOS', 'GASTOS DE VENTAS', 'GASTO DE OPERACIONES'] as const;

export const ORDER_STATUS = {
    DRAFT: 'Draft',
    PENDING: 'Pending',
    APPROVED: 'Approved',
    IN_PREPARATION: 'In Preparation',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled',
} as const;

export type OrderStatusValue = typeof ORDER_STATUS[keyof typeof ORDER_STATUS];

// Fuente de verdad visual de estados — colores del design-system (design-system.md §1.4)
export const ORDER_STATUS_CONFIG: Record<string, { label: string; chipBg: string; chipText: string; activeBorder: string }> = {
    [ORDER_STATUS.DRAFT]: { label: 'Borrador', chipBg: 'bg-[#9E9E9E]/10', chipText: 'text-[#616161]', activeBorder: 'border-[#9E9E9E]' },
    [ORDER_STATUS.PENDING]: { label: 'Pendiente', chipBg: 'bg-[#FCAA18]/10', chipText: 'text-[#b37a00]', activeBorder: 'border-[#FCAA18]' },
    [ORDER_STATUS.APPROVED]: { label: 'Aprobado', chipBg: 'bg-[#1976D2]/10', chipText: 'text-[#1565C0]', activeBorder: 'border-[#1976D2]' },
    [ORDER_STATUS.IN_PREPARATION]: { label: 'En Preparación', chipBg: 'bg-[#FCAA18]/15', chipText: 'text-[#b37a00]', activeBorder: 'border-[#FCAA18]' },
    [ORDER_STATUS.DELIVERED]: { label: 'Entregado', chipBg: 'bg-[#02B446]', chipText: 'text-white', activeBorder: 'border-[#02B446]' },
    [ORDER_STATUS.CANCELLED]: { label: 'Cancelado', chipBg: 'bg-[#FC1C27]/10', chipText: 'text-[#c41018]', activeBorder: 'border-[#FC1C27]' },
};

export const ROLES = {
    ADMIN: 'admin',
    SUPERVISOR: 'supervisor',
    VENDEDOR: 'vendedor',
    DESPACHADOR: 'despachador',
    PREPARADOR_PLANILLA: 'preparador_planilla',
    APROBADOR_PLANILLA: 'aprobador_planilla'
} as const;

export const EXCEL_HEADERS = {
    PRODUCTO: 'PRODUCTO',
    CALIBRE: 'CALIBRE',
    MARCA: 'MARCA',
    CALIDAD: 'CALIDAD',
    EMBARQUE: 'EMBARQUE',
    INGRESO: 'INGRESO',
    INVENTARIO: 'INVENTARIO',
    PRECIO: 'PRECIO',
    CATEGORIA: 'CATEGORIA',
    DIAS_EN_BODEGA: 'DÍAS EN BODEGA',  // CA2 US-INV-01 — informacional, no almacenado
} as const;

// US-HEX-02 CA2 — campos mínimos del archivo del reloj marcador. Cualquier columna de
// HEN/HED/Nocturnidad/Corto que el archivo traiga pre-calculada se ignora (no se lee).
export const MARCACION_HEADERS = {
    ID_USUARIO: 'ID DE USUARIO',
    NOMBRE_COMPLETO: 'NOMBRE COMPLETO',
    FECHA: 'FECHA',
    HORA_ENTRADA: 'HORA DE ENTRADA',
    HORA_SALIDA: 'HORA DE SALIDA',
} as const;

// Plantilla descargable ("Descargar plantilla") — réplica EXACTA de las 31 columnas del archivo
// real que comparte Imporfrut (`docs/formatos-reportes/5. Archivo marcaciones planta.xls`, fila de
// encabezado), decisión explícita del usuario para que quien llena el archivo a mano use el mismo
// formato que ya conoce del reloj marcador, en vez de un formato "ideal" de solo 5 columnas.
// El sistema sigue leyendo únicamente los 5 campos de MARCACION_HEADERS (vía los sinónimos de
// MARCACION_HEADER_VARIANTES en excelUtils.ts); el resto son cálculos que el reloj genera solo
// (OT, Corto, sumhr, leavetype, etc.) y se ignoran en silencio, igual que con el archivo real.
// "Trabajo" aparece duplicado dos veces — es así, literal, en el archivo real de Imporfrut.
export const MARCACION_PLANTILLA_COMPLETA_HEADERS = [
    'No.', 'ID de usuario', 'Nombre', 'empno', 'ID de tarjeta', 'Grupo', 'Departamento', 'Sección',
    'Fecha', 'Día de semana', 'Tipo de día', 'Horario', 'Entrada', 'Pausa', 'Resumir', 'Salir',
    'OT', 'Listo', 'Trabajo', 'Trabajo', 'T.E.', 'Dif. TE', 'Corto', 'sumhr', 'sumot', 'sumdiff',
    'sumshort', 'leavetype', 'leavehour', 'leaveday', 'Comentario',
] as const;

// Carga masiva de Empleados (pedido directo del jefe para el arranque de UAT) — plantilla propia
// descargable, a diferencia de MARCACION_HEADERS no necesita tolerar variantes de nombre porque
// no hay un archivo externo preexistente que igualar: es la plantilla que nosotros generamos.
// Obligatorias (mismo criterio que REQUIRED_FIELDS de useEmpleadoManagement.ts): Código Empleado,
// Nombre Completo, DUI, Fecha de Nacimiento, Ubicación, Fecha de Ingreso, Sueldo Mensual.
export const EMPLEADO_IMPORT_HEADERS = {
    CODIGO_EMPLEADO: 'Código Empleado',
    NOMBRE_COMPLETO: 'Nombre Completo',
    DUI: 'DUI',
    PASAPORTE: 'Pasaporte',
    NIT: 'NIT',
    NUP: 'NUP',
    FECHA_NACIMIENTO: 'Fecha de Nacimiento (DD/MM/AAAA)',
    SEXO: 'Sexo (M/F)',
    TELEFONO: 'Teléfono',
    CORREO: 'Correo',
    DIRECCION: 'Dirección',
    CONTACTO_EMERGENCIA_NOMBRE: 'Contacto de Emergencia - Nombre',
    CONTACTO_EMERGENCIA_TELEFONO: 'Contacto de Emergencia - Teléfono',
    CARGO: 'Cargo',
    DEPARTAMENTO: 'Departamento',
    CENTRO_COSTOS: 'Centro de Costos',
    UBICACION: 'Ubicación',
    FECHA_INGRESO: 'Fecha de Ingreso (DD/MM/AAAA)',
    SUELDO_MENSUAL: 'Sueldo Mensual',
    TIPO_AFILIACION: 'Tipo de Afiliación (AFP Crecer/AFP Confía/UPISS/Jubilado/IPSFA)',
    NUMERO_AFILIACION_AFP: 'Número de Afiliación AFP',
    NUMERO_AFILIADO_ISSS: 'Número de Afiliado ISSS',
    BANCO: 'Banco',
    NUMERO_CUENTA: 'Número de Cuenta',
    TIPO_CONTRATO: 'Tipo de Contrato',
} as const;

export const EMPLEADO_IMPORT_HEADERS_OBLIGATORIOS: (keyof typeof EMPLEADO_IMPORT_HEADERS)[] = [
    'CODIGO_EMPLEADO', 'NOMBRE_COMPLETO', 'DUI', 'FECHA_NACIMIENTO', 'UBICACION', 'FECHA_INGRESO', 'SUELDO_MENSUAL',
];

// Carga masiva de Descuentos — mismo patrón que EMPLEADO_IMPORT_HEADERS (plantilla propia
// descargable, no hay archivo externo preexistente que tolerar). "Código Empleado" matchea contra
// el código que ya ve el usuario en el resto de la app (`getCodigoEmpleado`: manual si existe,
// auto-generado si no), nunca por nombre, para evitar ambigüedad entre empleados homónimos.
export const DESCUENTO_IMPORT_HEADERS = {
    CODIGO_EMPLEADO: 'Código Empleado',
    CATEGORIA: 'Categoría',
    INSTITUCION: 'Institución',
    MONTO_QUINCENAL: 'Monto Quincenal',
    MONTO_TOTAL: 'Monto Total',
    NUMERO_CUOTAS: 'Número de Cuotas',
    CUOTA_EXACTA: 'Cuota Exacta',
    FECHA_FIN: 'Fecha Fin (DD/MM/AAAA)',
    SALDO_INICIAL_PAGADO: 'Saldo Inicial Pagado',
} as const;

export const DESCUENTO_IMPORT_HEADERS_OBLIGATORIOS: (keyof typeof DESCUENTO_IMPORT_HEADERS)[] = [
    'CODIGO_EMPLEADO', 'CATEGORIA', 'MONTO_QUINCENAL',
];

export const MESSAGES = {
    SUCCESS: {
        CATALOG_SYNC: (count: number) => `¡Sincronización de Catálogo completada! ${count} SKUs actualizados y productos obsoletos desactivados.`,
        INVITATION_SENT: (email: string) => `¡Invitación enviada con éxito a ${email}!`,
    },
    ERROR: {
        INSUFFICIENT_INVENTORY: 'No hay suficiente inventario para completar este pedido. Revisa las cantidades disponibles en piso.',
        ORDER_SAVE: 'Error al guardar el pedido. Inténtalo de nuevo.',
        EXCEL_READ_CRITICAL: 'Excepción Crítica leyendo el puente de datos Excel.',
        EXCEL_EMPTY: 'El archivo Excel está vacío o no contiene filas de datos (solo encabezados).',
        EXCEL_MISSING_HEADERS: (missing: string) => `Estructura inválida. La primera fila (encabezados) no coincide con la plantilla. Faltan estas columnas exactas: ${missing}`,
        EXCEL_BUSINESS_RULES: "Violación de Reglas de Negocio: No se encontraron Lotes válidos para sincronizar. Verifique que estén usando las cabeceras obligatorias (PRODUCTO, CALIBRE, MARCA, CALIDAD, CATEGORIA).",
        SESSION_INVALID: 'Sesión no válida o tenant_id faltante para la sincronización.',
        FETCH_ORDERS: 'Error al cargar los pedidos.',
        FETCH_PRODUCTS: 'Error al cargar productos',
        PWD_REQUIREMENTS: 'Por favor, cumpla con todos los requisitos de la contraseña.',
        RESET_PWD_REQUIREMENTS: 'Por favor, asegúrese de que su nueva contraseña cumpla con todos los requisitos.',
        FULLNAME_REQUIRED: 'El nombre completo es requerido.',
        PHONE_8_DIGITS: 'El teléfono debe tener 8 dígitos.',
        SETUP_PROFILE_SAVING: 'Su contraseña fue actualizada, pero hubo un error al guardar su perfil. Intente de nuevo.',
        SETUP_ACCOUNT: 'Error al configurar la cuenta.',
        FIELDS_REQUIRED: 'Por favor, complete todos los campos requeridos.',
        INVITE_SEND: 'Ocurrió un error al enviar la invitación.',
        FORGOT_PWD: 'Error al solicitar el cambio de contraseña.',
        UPDATE_PWD: 'Error al actualizar la contraseña.',
        NO_TENANT: 'Error crítico: La sesión no tiene un tenant_id válido.',
        CUSTOMER_SAVE: 'Error al guardar el cliente en la base de datos.',
        EMPLOYEE_SAVE: 'Error al guardar el perfil del empleado en la base de datos.',
        EMPLOYEE_CODIGO_DUPLICADO: 'Ya existe un empleado registrado con ese código. Verificá el número e intentá de nuevo.',
        EMPLOYEE_DUI_DUPLICADO: 'Ya existe un empleado registrado con ese DUI. Verificá el número e intentá de nuevo.',
        EMPLOYEE_IMPORT_ERROR: 'No se pudo completar la importación. No se guardó ningún empleado de este lote — corregí el archivo e intentá de nuevo.',
        DESCUENTO_IMPORT_ERROR: 'No se pudo completar la importación. No se guardó ningún descuento de este lote — corregí el archivo e intentá de nuevo.',
        LOGIN_FAILED: 'Credenciales inválidas o error de conexión.',
        FETCH_ORDER_DETAIL: 'Error al cargar el detalle del pedido. Intenta de nuevo.'
    }
} as const;
