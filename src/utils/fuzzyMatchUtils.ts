// US-VIA-01 CA2 — cascada de verificación de empleado: fuzzy match de nombre ≥80% cuando el
// código extraído por IA no viene o no coincide. Coeficiente de Dice sobre bigramas de
// caracteres (algoritmo simple y bien conocido para nombres propios) — no hay ninguna
// librería de fuzzy-matching en el proyecto, se implementa a mano en vez de agregar una
// dependencia nueva para un solo uso.

export function normalizarTexto(texto: string): string {
    return texto
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim()
        .replace(/\s+/g, ' ');
}

function bigramas(texto: string): string[] {
    const limpio = normalizarTexto(texto);
    if (limpio.length < 2) return limpio.length === 1 ? [limpio] : [];
    const pares: string[] = [];
    for (let i = 0; i < limpio.length - 1; i++) {
        pares.push(limpio.slice(i, i + 2));
    }
    return pares;
}

/** Coeficiente de Dice: 2 * bigramas en común / (total de bigramas de a + de b). 0 a 1. */
export function similitudDice(a: string, b: string): number {
    const bigramasA = bigramas(a);
    const bigramasB = bigramas(b);
    if (bigramasA.length === 0 || bigramasB.length === 0) return 0;

    const disponiblesB = new Map<string, number>();
    for (const bg of bigramasB) disponiblesB.set(bg, (disponiblesB.get(bg) ?? 0) + 1);

    let coincidencias = 0;
    for (const bg of bigramasA) {
        const restantes = disponiblesB.get(bg) ?? 0;
        if (restantes > 0) {
            coincidencias++;
            disponiblesB.set(bg, restantes - 1);
        }
    }

    return (2 * coincidencias) / (bigramasA.length + bigramasB.length);
}

export const UMBRAL_FUZZY_NOMBRE = 0.8;

export interface EmpleadoParaMatch {
    nombre_completo: string;
}

/** Generaliza la cascada de fuzzy-match por nombre (antes hardcodeada a `nombre_completo` de
 * empleado) para reusarla con cualquier catálogo con nombre (ej. Destinos, IMPL-170 CA5) sin
 * duplicar el algoritmo. Devuelve el ítem con mayor similitud si supera el umbral, o null. */
export function buscarPorNombreSimilar<T>(nombre: string, items: T[], obtenerNombre: (item: T) => string, umbral: number = UMBRAL_FUZZY_NOMBRE): T | null {
    let mejor: T | null = null;
    let mejorScore = 0;
    for (const item of items) {
        const score = similitudDice(nombre, obtenerNombre(item));
        if (score > mejorScore) {
            mejorScore = score;
            mejor = item;
        }
    }
    return mejorScore >= umbral ? mejor : null;
}

/** Devuelve el empleado con mayor similitud si supera el umbral, o null si ninguno califica. */
export function buscarEmpleadoPorNombre<T extends EmpleadoParaMatch>(nombre: string, empleados: T[], umbral: number = UMBRAL_FUZZY_NOMBRE): T | null {
    return buscarPorNombreSimilar(nombre, empleados, (e) => e.nombre_completo, umbral);
}
