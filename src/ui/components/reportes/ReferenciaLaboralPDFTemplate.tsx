import React from 'react';
import { Document, Page, Text, View, StyleSheet, Image } from '@react-pdf/renderer';
import BrandLogo from '../../../assets/images/logo-imporfrut.png';

const COLOR = { secondary: '#1E293B', muted: '#64748B', border: '#E2E8F0', white: '#FFFFFF' };

const styles = StyleSheet.create({
    page: { padding: 56, paddingTop: 48, fontFamily: 'Helvetica', fontSize: 11, color: COLOR.secondary, backgroundColor: COLOR.white },
    logo: { width: 110, marginBottom: 30 },
    titulo: { fontSize: 13, fontWeight: 'bold', marginBottom: 6, textTransform: 'uppercase' },
    destinatario: { fontSize: 11, fontWeight: 'bold', marginBottom: 20, textTransform: 'uppercase' },
    parrafo: { fontSize: 11, lineHeight: 1.6, marginBottom: 14, textAlign: 'justify' },
    firmaBloque: { marginTop: 60 },
    firmaLinea: { fontSize: 11, fontWeight: 'bold' },
    firmaCargo: { fontSize: 10, color: COLOR.muted, marginTop: 2 },
    brandingFooter: {
        position: 'absolute', bottom: 24, left: 56, right: 56,
        borderTopWidth: 1, borderTopColor: COLOR.border, paddingTop: 8,
    },
    brandingText: { fontSize: 7, color: '#94A3B8', textAlign: 'center' },
});

export interface ReferenciaLaboralPDFProps {
    nombreCompleto: string;
    cargo: string;
    fechaIngreso: string;
    /** "a la fecha" si el empleado sigue activo, o la fecha final capturada manualmente. */
    fechaFinal: string;
}

const fmtFecha = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('es-SV', { day: '2-digit', month: 'long', year: 'numeric' });

/**
 * Carta de Referencia Laboral (US-EXP-07, IMPL-160) — formato confirmado por Imporfrut
 * (`1_7_Referencia_Laboral.docx`). Todos los datos vienen del perfil del empleado, sin cálculo.
 */
export const ReferenciaLaboralPDFTemplate: React.FC<ReferenciaLaboralPDFProps> = ({ nombreCompleto, cargo, fechaIngreso, fechaFinal }) => {
    // "desde X a la fecha" si sigue activo (evita el "...al a la fecha" gramaticalmente inválido);
    // "del X al Y" cuando hay una fecha final real — mismo patrón que usa Constancia de Salario.
    const periodoTexto = fechaFinal === 'a la fecha'
        ? `desde el ${fmtFecha(fechaIngreso)} a la fecha`
        : `del ${fmtFecha(fechaIngreso)} al ${fmtFecha(fechaFinal)}`;

    return (
        <Document title={`Referencia Laboral - ${nombreCompleto}`}>
            <Page size="A4" style={styles.page}>
                <Image src={BrandLogo} style={styles.logo} />
                <Text style={styles.titulo}>Referencia Laboral</Text>
                <Text style={styles.destinatario}>A quien corresponda:</Text>

                {/* Un solo string interpolado, no varios hijos JSX ({nombre}, texto suelto, {cargo}...):
                    react-pdf trata cada hijo de <Text> como un "run" de texto separado, y el quiebre
                    de línea forzado entre dos runs pegados sin espacio (ej. el nombre y la coma que
                    lo sigue) inserta un guión visual ahí — algo que `registerHyphenationCallback`
                    NO controla (ese solo gobierna partir una palabra por sílabas dentro de un mismo
                    run). Hallazgo UAT real: "...ALVARES-" partiendo un apellido. Con un solo string,
                    todo es un único run continuo y el quiebre nunca cae en medio de una palabra. */}
                <Text style={styles.parrafo}>
                    {`Por medio de la presente, hacemos constar que ${nombreCompleto.toUpperCase()}, laboró para Importadora de Frutas S.A. de C.V. desempeñando el cargo de ${cargo.toUpperCase()}, durante el período comprendido ${periodoTexto}.`}
                </Text>

                <Text style={styles.parrafo}>
                    Durante el tiempo que formó parte de nuestra organización, desempeñó las funciones correspondientes a su cargo,
                    demostrando responsabilidad, compromiso y cumplimiento de sus obligaciones laborales.
                </Text>

                <Text style={styles.parrafo}>
                    La presente referencia laboral se extiende a solicitud del interesado, para los fines que estime convenientes.
                </Text>

                <Text style={styles.parrafo}>Sin otro particular, hacemos constar la presente para los efectos correspondientes.</Text>

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
