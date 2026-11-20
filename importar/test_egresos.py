import datetime as dt
import unittest

from egresos import acomodar, Personas, remision_de, banco_de


def r(tipo, desc, suc='AGS'):
    return {'tipo_excel': tipo, 'descripcion': desc, 'sucursal': suc, 'lunes': dt.date(2026, 6, 1), 'monto': 100.0, 'notas': []}


class Acomodar(unittest.TestCase):
    def test_gasto_general(self):
        e = acomodar(r('GASTOS', 'GASOLINA'))
        self.assertEqual((e['tipo'], e['categoria'], e['sale_de'], e['carga_a'], e['por_aclarar']), ('gasto', 'Generales', 'caja-AGS', 'AGS', False))

    def test_descarga_y_garantia(self):
        self.assertEqual(acomodar(r('DESCARGA', 'GRUA'))['categoria'], 'Descarga y grúa')
        self.assertEqual(acomodar(r('', 'TRANSITO'))['categoria'], 'Descarga y grúa')
        g = acomodar(r('GARANTIAS', 'GTIA REM 19 MC 150CC'))
        self.assertEqual((g['categoria'], g['remision']), ('Garantías', '19'))

    def test_deposito_es_traspaso(self):
        e = acomodar(r('DEPOSITO', 'SANTANDER'))
        self.assertEqual((e['tipo'], e['entra_a'], e['carga_a'], e['categoria']), ('traspaso', 'santander', None, None))
        e = acomodar(r('DEPOSITO', 'FACTURA 8075'))
        self.assertEqual((e['entra_a'], e['por_aclarar']), ('por-aclarar', True))

    def test_otro_hebq(self):
        e = acomodar(r('OTRO HEBQ', 'NOMINA PUEBLA'))
        self.assertEqual((e['categoria'], e['carga_a'], e['autorizo']), ('Nómina', 'PUE', 'HEBQ'))
        e = acomodar(r('OTRO HEBQ', 'PRESTAMO SERGIO SUNL'))
        self.assertEqual((e['tipo'], e['persona']), ('prestamo', 'SERGIO'))
        self.assertEqual(acomodar(r('OTRO HEBQ', 'FLETE ACAPULCO HEBQ'))['categoria'], 'Fletes')
        e = acomodar(r('OTRO HEBQ', 'HEBQ BANQUETES'))
        self.assertEqual((e['carga_a'], e['por_aclarar']), ('DIR', False))
        e = acomodar(r('OTRO HEBQ', '* DEP HUMBER J ANTONIO AYON'))
        self.assertEqual((e['carga_a'], e['por_aclarar']), ('DIR', True))

    def test_nomina_y_prestamo(self):
        e = acomodar(r('NOMINA', 'JANETH AGUSTIN (LIMPIEZA)'))
        self.assertEqual((e['categoria'], e['persona'], e['rol_persona']), ('Nómina', 'JANETH AGUSTIN', 'empleado'))
        self.assertEqual(acomodar(r('PRESTAMO', 'FRANCISCO SERRANO'))['tipo'], 'prestamo')

    def test_devolucion(self):
        e = acomodar(r('DEVOLUCIONES', '1 EXTENSION REM 36'))
        self.assertEqual((e['tipo'], e['remision']), ('devolucion', '36'))

    def test_ayudas(self):
        self.assertEqual(remision_de('DEPOSITO NV 021'), '21')
        self.assertIsNone(banco_de('FACTURA'))


class BuscarPersonas(unittest.TestCase):
    def test_reusa_y_crea(self):
        p = Personas([{'id': 'a', 'nombre': 'PAULINA', 'tipos': ['vendedor'], 'sucursal': 'PUE'}])
        self.assertEqual(p.buscar('PAULINA', 'PUE', 'empleado'), 'a')
        self.assertIn(('a', 'empleado'), p.agregar_tipo)
        nuevo = p.buscar('ULISES', 'PUE', 'empleado')
        self.assertEqual(p.buscar('ULISES', 'PUE', 'empleado'), nuevo)
        self.assertEqual(len(p.nuevas), 1)
        self.assertEqual(p.vendedor_en('SUNL PAULINA', 'PUE'), 'a')


if __name__ == '__main__':
    unittest.main()
