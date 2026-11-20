"""Pruebas del hilado de ventas. Correr: python -m unittest discover -s importar -v
Renglones armados a mano con datos inventados."""
import datetime as dt
import unittest

from hilar import hilar, linea_de, nota_anticipo, parecido

_fila = [0]


def r(sem=44, dia=0, **c):
    """Un renglón como los de leer_libro. sem = semana de 2026 (52 = dic 2025 si anio=25)."""
    _fila[0] += 1
    lunes = dt.date(2025, 12, 22) if c.pop('anio', 26) == 25 else dt.date(2025, 12, 29) + dt.timedelta(days=7 * (sem - 1))
    base = dict(sucursal='AGS', lunes=lunes, hoja=f'AGS {sem}', fila=_fila[0], fecha=lunes + dt.timedelta(days=dia),
                categoria='ATVS', producto='ATV 125 SPIDER', pago='CONTADO', metodo='efectivo', ok=False, cuenta='',
                monto=1000.0, remision='', factura='', color='', gs='', vendedor='VENDEDORA UNO', descripcion='')
    base.update(c)
    return base


def movs(res, venta):
    return [m for m in res['movimientos'] if m['venta_id'] == venta['id']]


class Ayudas(unittest.TestCase):
    def test_linea_de(self):
        self.assertEqual(linea_de('PASTO', '12 MTS2 PASTO CANCUN'), 'pasto')
        self.assertEqual(linea_de('ENVIO', 'ENVIO GDL A ZACATECAS'), 'otro')
        self.assertEqual(linea_de('ATVS', 'ATV 125'), 'motos')
        self.assertEqual(linea_de('MT', 'MOTO TAXI 125 SEMI AUTOM'), 'motos')
        self.assertEqual(linea_de('MT 200', 'MOTOTAXI 200 MINI'), 'motos')
        self.assertEqual(linea_de('PASTO', '8 M2 PASTO AGATA'), 'pasto')

    def test_nota_anticipo(self):
        self.assertEqual(nota_anticipo('ANT 18 DIC REM 03 $8,000'), {'dia': 18, 'mes': 12, 'remision': '3', 'monto': 8000.0})
        self.assertEqual(nota_anticipo('ANA ANT 12 OCT NV 101'), {'dia': 12, 'mes': 10, 'remision': '101', 'monto': None})
        self.assertIsNone(nota_anticipo('ENTREGADO'))

    def test_parecido(self):
        self.assertGreater(parecido('ATV 125 SPIDER', 'ATV 125 SPIDER LINGSUN'), 0.5)
        self.assertLess(parecido('ATV 125 SPIDER', 'MC 200 PICK UP'), 0.5)


class Hilar(unittest.TestCase):
    def test_contado_es_venta_cerrada(self):
        res = hilar([r(monto=1500.0, remision='10')])
        self.assertEqual(len(res['ventas']), 1)
        v = res['ventas'][0]
        self.assertEqual((v['estado'], v['precio_total']), ('cerrada', 1500.0))
        self.assertEqual(movs(res, v)[0]['tipo'], 'contado')

    def test_anticipo_y_liquidacion_se_unen(self):
        res = hilar([r(sem=40, pago='ANTICIPO', monto=5000.0, remision='101'),
                     r(sem=44, pago='LIQUIDACION', monto=12200.0, remision='101', producto='ATV 125 SPIDER LINGSUN')])
        self.assertEqual(len(res['ventas']), 1)
        v = res['ventas'][0]
        self.assertEqual((v['estado'], v['precio_total']), ('cerrada', 17200.0))
        self.assertEqual([m['tipo'] for m in movs(res, v)], ['anticipo', 'liquidacion'])
        self.assertEqual(res['dudas'], [])

    def test_nota_de_silvia_elige_el_anticipo(self):
        a1 = r(sem=41, dia=0, pago='ANTICIPO', monto=8000.0, remision='87', producto='ATV 125 SPIDER')   # 5 oct
        a2 = r(sem=42, dia=0, pago='ANTICIPO', monto=8000.0, remision='87', producto='ATV 125 XTREME')   # 12 oct
        li = r(sem=45, pago='LIQUIDACION', monto=20000.0, remision='87', producto='ATV 125',
               descripcion='ANT 12 OCT REM 87 $8,000')
        res = hilar([a1, a2, li])
        destino = [m for m in res['movimientos'] if m['tipo'] == 'liquidacion'][0]['venta_id']
        v = [v for v in res['ventas'] if v['id'] == destino][0]
        self.assertEqual(v['producto'], 'ATV 125 XTREME')

    def test_remision_repetida_otro_anio_no_une(self):
        res = hilar([r(sem=52, anio=25, pago='ANTICIPO', remision='87'),
                     r(sem=30, pago='LIQUIDACION', remision='87')])           # unos 200 días después
        self.assertEqual(len(res['ventas']), 2)
        self.assertIn('sin_anticipo', [d['motivo'] for d in res['dudas']])

    def test_remision_repetida_otra_linea_no_une(self):
        res = hilar([r(sem=40, pago='ANTICIPO', remision='87', categoria='PASTO', producto='20 MTS2 PASTO CANCUN'),
                     r(sem=42, pago='LIQUIDACION', remision='87', categoria='MC 200', producto='MC 200 PICK UP')])
        self.assertEqual(len(res['ventas']), 2)

    def test_orden_por_semana_no_por_fecha(self):
        a = r(sem=43, pago='ANTICIPO', remision='76')
        li = r(sem=45, pago='LIQUIDACION', remision='76')
        li['fecha'] = dt.date(2026, 10, 2)                                   # error de captura: antes del anticipo
        res = hilar([li, a])
        self.assertEqual(len(res['ventas']), 1)
        self.assertEqual(res['ventas'][0]['estado'], 'cerrada')

    def test_abono_deja_abierta(self):
        res = hilar([r(sem=40, pago='ANTICIPO', remision='5'), r(sem=41, pago='ABONO', remision='5')])
        v = res['ventas'][0]
        self.assertEqual((len(res['ventas']), v['estado'], v['precio_total']), (1, 'abierta', None))

    def test_complemento_se_suma(self):
        res = hilar([r(pago='CONTADO', remision='124', categoria='PASTO', producto='12 MTS2 PASTO CANCUN', monto=1212.0),
                     r(pago='CONTADO', remision='', categoria='PASTO', producto='COMPLEMENTO CANCUN 2', monto=212.0)])
        self.assertEqual(len(res['ventas']), 1)
        self.assertEqual(res['ventas'][0]['precio_total'], 1424.0)

    def test_prestamo_va_a_apartados(self):
        res = hilar([r(metodo='prestamo', categoria='OTROS', producto='ABONO PRESTAMO EMPLEADO', monto=1500.0)])
        self.assertEqual((len(res['ventas']), len(res['apartados'])), (0, 1))
        self.assertEqual(res['apartados'][0]['tipo'], 'prestamo')

    def test_cancelada_sin_venta(self):
        res = hilar([r(pago='CANCELADA', producto='CANCELADA', monto=None, remision='55')])
        self.assertEqual(res['ventas'][0]['estado'], 'cancelada')
        self.assertIn('cancelada_sin_venta', [d['motivo'] for d in res['dudas']])

    def test_cancelada_cancela_su_venta(self):
        res = hilar([r(sem=40, pago='ANTICIPO', remision='60'), r(sem=41, pago='CANCELADA', monto=None, remision='60')])
        self.assertEqual((len(res['ventas']), res['ventas'][0]['estado']), (1, 'cancelada'))

    def test_folios_consecutivos(self):
        res = hilar([r(sem=45, remision='2'), r(sem=44, remision='1')])
        por_folio = sorted((v['folio'], v['remision']) for v in res['ventas'])
        self.assertEqual(por_folio, [('AGS-2026-0001', '1'), ('AGS-2026-0002', '2')])

    def test_vendedor_parecido(self):
        filas = [r(remision=str(i), vendedor='ANA') for i in range(5)] + \
                [r(remision=str(i + 10), vendedor='ANABEL RUIZ') for i in range(5)]
        res = hilar(filas)
        self.assertEqual(sorted(res['vendedores']), ['ANA', 'ANABEL'])
        self.assertEqual([d['motivo'] for d in res['dudas']].count('vendedor_parecido'), 1)

    def test_vendedor_es_primera_palabra_frecuente(self):
        filas = [r(remision=str(i), vendedor='BETO') for i in range(5)] + \
                [r(remision='50', vendedor='ESTABA REGISTRADA DE JALON')] + \
                [r(remision=str(i + 60), vendedor='PAGO CON TARJETA') for i in range(5)]
        res = hilar(filas)
        self.assertEqual(list(res['vendedores']), ['BETO'])
        rara = [v for v in res['ventas'] if v['remision'] == '50'][0]
        self.assertEqual(rara['vendedor'], '')
        nota = [m for m in res['movimientos'] if m['venta_id'] == rara['id']][0]['nota']
        self.assertIn('ESTABA REGISTRADA DE JALON', nota)

    def test_nota_en_columna_vendedor(self):
        a1 = r(sem=41, pago='ANTICIPO', monto=8000.0, remision='87', producto='ATV 125 SPIDER')
        a2 = r(sem=42, pago='ANTICIPO', monto=8000.0, remision='87', producto='ATV 125 XTREME')
        li = r(sem=45, pago='LIQUIDACION', monto=20000.0, remision='87', producto='ATV 125',
               vendedor='ANA ANT 12 OCT REM 87 $8,000')
        res = hilar([a1, a2, li])
        destino = [m for m in res['movimientos'] if m['tipo'] == 'liquidacion'][0]
        self.assertEqual([v for v in res['ventas'] if v['id'] == destino['venta_id']][0]['producto'], 'ATV 125 XTREME')
        self.assertNotIn('ANA ANT 12 OCT REM 87 $8,000', res['vendedores'])
        self.assertIn('ANT 12 OCT REM 87', destino['nota'])

    def test_nota_con_otra_remision(self):
        res = hilar([r(sem=38, dia=3, pago='ANTICIPO', remision='133', monto=30000.0, producto='MC 200 PICK UP'),
                     r(sem=44, pago='LIQUIDA', remision='183', monto=20000.0, producto='MC 200 PICK UP CON CABINA',
                       vendedor='DANIEL ANT 24 SEP NV 133 $30,000')])
        self.assertEqual(len(res['ventas']), 1)
        self.assertEqual(res['ventas'][0]['estado'], 'cerrada')

    def test_remision_con_prefijo(self):
        res = hilar([r(sem=33, pago='ANTICIPO', remision='NV 21', monto=20000.0),
                     r(sem=38, pago='LIQUIDA', remision='21', monto=30000.0)])
        self.assertEqual(len(res['ventas']), 1)
        self.assertEqual(res['ventas'][0]['remision'], 'NV 21')

    def test_liquidacion_en_dos_renglones(self):
        res = hilar([r(sem=40, pago='ANTICIPO', remision='91', monto=8000.0),
                     r(sem=52, pago='LIQUIDACION', remision='91', monto=10000.0),
                     r(sem=52, pago='LIQUIDACION', remision='91', producto='COMPLEMENTO ATV 125', monto=500.0)])
        self.assertEqual(len(res['ventas']), 1)
        self.assertEqual(res['ventas'][0]['precio_total'], 18500.0)
        self.assertEqual(res['dudas'], [])

    def test_solo_entrega_guarda_el_valor_en_la_nota(self):
        res = hilar([r(sem=40, pago='ANTICIPO', remision='70'),
                     r(sem=41, pago='SOLO ENTREGA', remision='70', metodo=None, monto=32100.0)])
        e = [m for m in res['movimientos'] if m['tipo'] == 'entrega'][0]
        self.assertEqual(e['monto'], 0.0)
        self.assertIn('$32,100.00', e['nota'])

    def test_devolucion_resta_de_su_venta(self):
        res = hilar([r(sem=12, pago='CONTADO', remision='56', producto='ATV 110 Y MINI', monto=30000.0),
                     r(sem=15, pago='', remision='', producto='DEVOLUCION (REM 56) ATV 110 Y MINI', monto=-29300.0,
                       metodo=None, descripcion='DEVOLUCION CLIENTE')])
        self.assertEqual(len(res['ventas']), 1)
        d = [m for m in res['movimientos'] if m['tipo'] == 'devolucion'][0]
        self.assertEqual(d['monto'], 29300.0)
        self.assertEqual(res['ventas'][0]['precio_total'], 700.0)

    def test_devolucion_positiva_queda_en_duda(self):
        res = hilar([r(pago='DEVOLUCION CLIENTE', remision='', producto='MOTO TAXI 125', monto=40000.0, metodo=None)])
        self.assertEqual(res['movimientos'][0]['tipo'], 'contado')
        self.assertIn('sin_tipo_pago', [d['motivo'] for d in res['dudas']])

    def test_entrega_no_usa_remision_reusada_meses_despues(self):
        res = hilar([r(sem=5, remision='137', monto=20000.0),
                     r(sem=33, pago='SOLO ENTREGA', remision='137', monto=None, metodo=None)])
        self.assertFalse(any(m['tipo'] == 'entrega' for m in res['movimientos']))
        self.assertIn('entrega_sin_venta', [d['motivo'] for d in res['dudas']])

    def test_devolucion_no_usa_remision_reusada_meses_despues(self):
        res = hilar([r(sem=5, remision='137', monto=20000.0),
                     r(sem=33, pago='', remision='137', producto='DEVOLUCION', monto=-5000.0, metodo=None)])
        self.assertEqual(res['ventas'][0]['precio_total'], 20000.0)
        self.assertIn('cancelada_sin_venta', [d['motivo'] for d in res['dudas']])

    def test_producto_vacio_no_se_pega_a_la_venta_de_arriba(self):
        res = hilar([r(pago='ANTICIPO', remision='5', monto=5000.0),
                     r(pago='CONTADO', remision='', producto='', monto=900.0)])
        self.assertEqual(len(res['ventas']), 2)
        self.assertIn('sin_producto', [d['motivo'] for d in res['dudas']])

    def test_monto_ilegible_queda_en_duda(self):
        res = hilar([r(pago='CONTADO', remision='8', monto=None, monto_ilegible='($1,500)')])
        self.assertEqual(res['ventas'], [])
        self.assertIn('monto_ilegible', [d['motivo'] for d in res['dudas']])

    def test_liquidacion_sin_remision_ni_nota(self):
        res = hilar([r(pago='LIQUIDACION', remision='')])
        self.assertIn('sin_remision', [d['motivo'] for d in res['dudas']])

    def test_pago_vacio_es_contado_con_duda(self):
        res = hilar([r(pago='', remision='9')])
        self.assertEqual(res['ventas'][0]['estado'], 'cerrada')
        self.assertIn('sin_tipo_pago', [d['motivo'] for d in res['dudas']])

    def test_confirmado_banco_y_origen(self):
        x = r(ok=True, remision='3')
        m = hilar([x])['movimientos'][0]
        self.assertTrue(m['confirmado_banco'])
        self.assertEqual(m['origen_ref'], {'archivo': 'FImpAGS-2026.xlsx', 'hoja': x['hoja'], 'fila': x['fila']})


if __name__ == '__main__':
    unittest.main()
