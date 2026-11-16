import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import BrandLogo from '../../../assets/images/logo-imporfrut.png';
import { construirFilasIngresosConstanciaSalario, construirFilasDeduccionesConstanciaSalario, type ConstanciaSalarioDatos } from '../../../utils/constanciaSalarioUtils';

const COLOR = { primary: '#10B981', secondary: '#1E293B', muted: '#64748B', light: '#F8FAFC', border: '#E2E8F0', white: '#FFFFFF' };

const styles = StyleSheet.create({
    page: { padding: 56, paddingTop: 48, fontFamily: 'Helvetica', fontSize: 10, color: COLOR.secondary, backgroundColor: COLOR.white },
    logo: { width: 110, marginBottom: 24 },
    titulo: { fontSize: 13, fontWeight: 'bold', marginBottom: 6, textTransform: 'uppercase' },
    destinatario: { fontSize: 11, fontWeight: 'bold', marginBottom: 16, textTransform: 'uppercase' },
    parrafo: { fontSize: 10, lineHeight: 1.5, marginBottom: 12, textAlign: 'justify' },
    tablaTitulo: { fontSize: 9, fontWeight: 'bold', color: COLOR.muted, textTransform: 'uppercase', marginTop: 14, marginBottom: 4 },
    tablaHeader: { flexDirection: 'row', backgroundColor: COLOR.light, paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: COLOR.border },
    tablaHeaderTexto: { fontSize: 8, fontWeight: 'bold', color: COLOR.muted, textTransform: 'uppercase' },
    fila: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: COLOR.light },
    filaTotal: { flexDirection: 'row', paddingVertical: 6, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: COLOR.secondary, marginTop: 2 },
    celdaConcepto: { flex: 3, fontSize: 9.5 },
    celdaMonto: { flex: 1, fontSize: 9.5, textAlign: 'right' },
    celdaConceptoBold: { flex: 3, fontSize: 9.5, fontWeight: 'bold' },
    celdaMontoBold: { flex: 1, fontSize: 9.5, fontWeight: 'bold', textAlign: 'right' },
    firmaBloque: { marginTop: 36 },
    firmaLinea: { fontSize: 11, fontWeight: 'bold' },
    firmaCargo: { fontSize: 10, color: COLOR.muted, marginTop: 2 },
    brandingFooter: { position: 'absolute', bottom: 24, left: 56, right: 56, borderTopWidth: 1, borderTopColor: COLOR.light, paddingTop: 8 },
    brandingText: { fontSize: 7, color: '#94A3B8', textAlign: 'center' },
});

const fmt = (v: number) => `$${v.toLocaleString('es-SV', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface FilaTabla { concepto: string; monto: number }

const Tabla: React.FC<{ titulo: string; filas: FilaTabla[]; totalLabel: string; total: number }> = ({ titulo, filas, totalLabel, total }) => (
    <View>
        <Text style={styles.tablaTitulo}>{titulo}</Text>
        <View style={styles.tablaHeader}>
            <Text style={[styles.tablaHeaderTexto, { flex: 3 }]}>Concepto</Text>
            <Text style={[styles.tablaHeaderTexto, { flex: 1, textAlign: 'right' }]}>Monto (US$)</Text>
        </View>
        {filas.map((f, i) => (
            <View key={i} style={styles.fila}>
                <Text style={styles.celdaConcepto}>{f.concepto}</Text>
                <Text style={styles.celdaMonto}>{fmt(f.monto)}</Text>
            </View>
        ))}
        <View style={styles.filaTotal}>
            <Text style={styles.celdaConceptoBold}>{totalLabel}</Text>
            <Text style={styles.celdaMontoBold}>{fmt(total)}</Text>
        </View>
    </View>
);

/**
 * Constancia de Salario (US-EXP-04, IMPL-157) — formato confirmado por Imporfrut
 * (`1_1_Constancia_de_salario.docx`). Bonificación/Horas Extras/Viáticos variable son promedios
 * de 6 meses; ISSS/AFP/Renta/descuentos son de las 2 quincenas más recientes (ver
 * `constanciaSalarioUtils.ts` — este componente solo presenta el DTO ya calculado).
 */
export const ConstanciaSalarioPDFTemplate: React.FC<{ datos: ConstanciaSalarioDatos }> = ({ datos }) => {
    return (
        <Document title={`Constancia de Salario - ${datos.nombreCompleto}`}>
            <Page size="A4" style={styles.page}>
                <Image src={BrandLogo} style={styles.logo} />
                <Text style={styles.titulo}>Constancia de Salario</Text>
                <Text style={styles.destinatario}>A quien interese:</Text>

                {/* Un solo string interpolado, no varios hijos JSX: react-pdf trata cada hijo de
                    <Text> como un "run" separado, y puede insertar un guión visual justo en el
                    quiebre forzado entre dos runs pegados sin espacio (nombre/cargo largos) —
                    `registerHyphenationCallback` no cubre ese caso, solo el de partir una palabra
                    dentro de un mismo run. Mismo hallazgo UAT que en Referencia Laboral (IMPL-160). */}
                <Text style={styles.parrafo}>
                    {`Por medio de la presente se hace constar que ${datos.nombreCompleto.toUpperCase()} presta sus servicios para Importadora de Frutas, S.A. de C.V., donde ocupa el cargo de ${datos.cargo.toUpperCase()} desde el ${new Date(`${datos.fechaIngreso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })} a la fecha.`}
                </Text>
                <Text style={styles.parrafo}>Actualmente devenga un ingreso mensual integrado, conforme al siguiente detalle:</Text>

                <Tabla
                    titulo="Ingresos"
                    filas={construirFilasIngresosConstanciaSalario(datos)}
                    totalLabel="Total de ingresos"
                    total={datos.totalIngresos}
                />

                <Text style={[styles.parrafo, { marginTop: 14 }]}>Sobre los ingresos se realizan las deducciones correspondientes, según el siguiente detalle:</Text>

                <Tabla
                    titulo="Deducciones"
                    filas={construirFilasDeduccionesConstanciaSalario(datos)}
                    totalLabel="Total de deducciones"
                    total={datos.totalDeducciones}
                />

                <Text style={[styles.parrafo, { marginTop: 20 }]}>
                    En virtud de lo anterior, se extiende la presente constancia para los usos que estime convenientes, el{' '}
                    {new Date().toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' })}.
                </Text>

                <View style={styles.firmaBloque}>
                    <Text style={styles.firmaLinea}>Gilda Montiel</Text>
                    <Text style={styles.firmaCargo}>Recursos Humanos</Text>
                </View>

                <View style={styles.brandingFooter} fixed>
                    <Text style={styles.brandingText}>Importadora de Frutas S.A. de C.V. • El Salvador</Text>
                </View>
            </Page>
        </Document>
    );
};
