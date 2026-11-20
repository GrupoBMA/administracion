"""Pruebas del lector de los Excel de Silvia. Correr: python -m unittest discover -s importar -v
Los libros de prueba se arman aquí con datos inventados; nunca se usan datos reales."""
import datetime as dt
import os
import tempfile
import unittest

import openpyxl

from lector import leer_libro, lunes_de_hoja, metodo_catalogo, monto

ENC_A = ['FECHA 2026', 'CATEGORIA', 'PRODUCTO', 'PAGO', 'METODO', None, 'CUENTA', 'MONTO', 'REMISION',
         'FACTURA', 'COLOR', 'G / S', 'VENDEDOR', 'DESCRIPCION']
# Mismo encabezado, columnas en otro orden (vendedor antes que remisión, monto al final)
ENC_B = ['FECHA 2026', 'CATEGORIA', 'PRODUCTO', 'PAGO', 'METODO', None, 'CUENTA', 'VENDEDOR', 'REMISION',
         'FACTURA', 'COLOR', 'G / S', 'DESCRIPCION', 'MONTO']


def renglon(enc, **v):
    col = {'FECHA 2026': 'fecha', 'CATEGORIA': 'cat', 'PRODUCTO': 'prod', 'PAGO': 'pago', 'METODO': 'metodo',
           None: 'ok', 'CUENTA': 'cuenta', 'MONTO': 'monto', 'REMISION': 'rem', 'FACTURA': 'fac',
           'COLOR': 'color', 'G / S': 'gs', 'VENDEDOR': 'vend', 'DESCRIPCION': 'desc'}
    return [v.get(col[c]) for c in enc]


def libro(hojas):
    """hojas: lista de (nombre, encabezado, renglones, extra_abajo)."""
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for nombre, enc, filas, extra in hojas:
        ws = wb.create_sheet(nombre)
        ws.append(['XXX SEMANA'])
        ws.append([])
        ws.append([None, None, None] + enc)          # el encabezado de cobros empieza en la columna D
        for f in filas:
            ws.append([None, None, None] + f)
        for f in extra:
            ws.append([None, None, None] + f)
    d = tempfile.mkdtemp()
    ruta = os.path.join(d, 'libro.xlsx')
    wb.save(ruta)
    return ruta


BASE = dict(fecha=dt.datetime(2026, 10, 27), cat='ATVS', prod='ATV 125 PRUEBA', pago='CONTADO', metodo='EFECTIVO',
            monto=1000, rem=101.0, vend='VENDEDORA UNO')


class LunesDeHoja(unittest.TestCase):
    def test_lunes_de_hoja(self):
        self.assertEqual(lunes_de_hoja('AGS 44  26-31oct26'), dt.date(2026, 10, 26))
        self.assertEqual(lunes_de_hoja('AGS 52  22-27dic25'), dt.date(2025, 12, 22))
        self.assertEqual(lunes_de_hoja('AGS 01  29-03ene26'), dt.date(2025, 12, 29))
        self.assertIsNone(lunes_de_hoja('Hoja 3'))
        self.assertEqual(lunes_de_hoja('AGS 51  15-20dic25'), dt.date(2025, 12, 15))
        self.assertIsNone(lunes_de_hoja('AGS 10  04-09mar24'))


class Valores(unittest.TestCase):
    def test_metodo_mal_escrito(self):
        self.assertEqual(metodo_catalogo('EFCTIVO'), 'efectivo')
        self.assertEqual(metodo_catalogo('TRANSFERENCOA'), 'transferencia')
        self.assertEqual(metodo_catalogo('EFECTIVO '), 'efectivo')
        self.assertEqual(metodo_catalogo('Depósito'), 'deposito')
        self.assertEqual(metodo_catalogo('PRESTAMO'), 'prestamo')
        self.assertIsNone(metodo_catalogo(''))

    def test_montos(self):
        self.assertEqual(monto('$1,500'), 1500.0)
        self.assertEqual(monto(1500.0), 1500.0)
        self.assertIsNone(monto(''))
        self.assertIsNone(monto(None))


class LeerLibro(unittest.TestCase):
    def setUp(self):
        self.ruta = libro([
            ('XXX 44  26-31oct26', ENC_A, [
                renglon(ENC_A, **BASE),
                renglon(ENC_A, **dict(BASE, prod='MC 200 PRUEBA', ok='OK', cuenta='HSBC', metodo='TRANSFERENCIA')),
                renglon(ENC_A, **dict(BASE, prod='CANCELADA', pago='CANCELADA', monto=None, rem=55)),
                renglon(ENC_A, **dict(BASE, prod='ILEGIBLE', monto='($1,500)', rem=56)),
                renglon(ENC_A, **dict(BASE, prod='ENVIADO', pago='SOLO ENVIO Y FACT', monto=None, rem=57)),
            ], [[], [None, 'INVENTARIO'], ['ATVS', 'NO DEBE LEERSE', 'CONTADO', 'EFECTIVO', None, None, 99]]),
            ('XXX 52  22-27dic25', ENC_B, [renglon(ENC_B, **dict(BASE, fecha=dt.datetime(2025, 12, 23)))], []),
            ('Hoja 3', ENC_A, [renglon(ENC_A, **BASE)], []),
        ])
        self.r = leer_libro(self.ruta, 'XXX')

    def test_columnas_por_titulo(self):
        a = [x for x in self.r if x['hoja'].startswith('XXX 44')][0]
        b = [x for x in self.r if x['hoja'].startswith('XXX 52')][0]
        for k in ('categoria', 'producto', 'pago', 'metodo', 'monto', 'remision', 'vendedor'):
            self.assertEqual(a[k], b[k], k)
        self.assertEqual(b['lunes'], dt.date(2025, 12, 22))
        self.assertEqual(b['fecha'], dt.date(2025, 12, 23))

    def test_ok_y_cuenta(self):
        x = [x for x in self.r if x['producto'] == 'MC 200 PRUEBA'][0]
        self.assertTrue(x['ok'])
        self.assertEqual(x['cuenta'], 'HSBC')
        self.assertEqual(x['metodo'], 'transferencia')

    def test_cancelada_sin_monto_se_lee(self):
        x = [x for x in self.r if x['pago'] == 'CANCELADA'][0]
        self.assertIsNone(x['monto'])

    def test_monto_ilegible_se_conserva(self):
        x = [x for x in self.r if x['producto'] == 'ILEGIBLE'][0]
        self.assertIsNone(x['monto'])
        self.assertEqual(x['monto_ilegible'], '($1,500)')
        self.assertEqual([x for x in self.r if x['producto'] == 'MC 200 PRUEBA'][0]['monto_ilegible'], '')

    def test_solo_envio_sin_monto_se_lee(self):
        self.assertTrue(any(x['producto'] == 'ENVIADO' for x in self.r))

    def test_termina_en_inventario(self):
        self.assertFalse(any(x['producto'] == 'NO DEBE LEERSE' for x in self.r))

    def test_remision_sin_punto_cero(self):
        self.assertEqual(self.r[0]['remision'], '101')

    def test_ignora_hojas_sin_semana(self):
        self.assertEqual({x['hoja'] for x in self.r}, {'XXX 44  26-31oct26', 'XXX 52  22-27dic25'})

    def test_orden_y_origen(self):
        self.assertEqual(self.r[0]['sucursal'], 'XXX')
        self.assertEqual(self.r[0]['fila'], 4)
        self.assertEqual(self.r[1]['fila'], 5)


if __name__ == '__main__':
    unittest.main()
