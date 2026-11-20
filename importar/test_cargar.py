"""Pruebas de la carga a Supabase. Correr: python -m unittest discover -s importar -v
Datos inventados."""
import datetime as dt
import json
import re
import unittest

from cargar import literal, lotes, resumen, sql_por_partes


def resultado(n_ventas=1, producto='ATV 125'):
    ventas, movs = [], []
    for i in range(n_ventas):
        vid = f'00000000-0000-0000-0000-{i:012d}'
        ventas.append({'id': vid, 'folio': f'AGS-2026-{i + 1:04d}', 'sucursal': 'AGS', 'fecha': dt.date(2026, 10, 26),
                       'producto': producto, 'categoria': 'ATVS', 'linea': 'motos', 'remision': str(i), 'factura': '',
                       'color': '', 'vendedor': 'BETO', 'precio_total': 1000.0, 'estado': 'cerrada'})
        movs.append({'id': f'10000000-0000-0000-0000-{i:012d}', 'venta_id': vid, 'fecha': dt.date(2026, 10, 26),
                     'lunes': dt.date(2026, 10, 26), 'tipo': 'contado', 'monto': 1000.0, 'metodo': 'efectivo',
                     'cuenta': '', 'confirmado_banco': True, 'nota': None,
                     'origen_ref': {'archivo': 'FImpAGS-2026.xlsx', 'hoja': 'AGS 44', 'fila': i + 4}})
    return {'ventas': ventas, 'movimientos': movs, 'apartados': [], 'dudas': [],
            'vendedores': {'BETO': '20000000-0000-0000-0000-000000000001'}}


class Cargar(unittest.TestCase):
    def test_primera_parte_borra_e_importa(self):
        p = sql_por_partes(resultado())[0]
        self.assertTrue(p.startswith("select set_config('bma.importando','si',true);\nselect public.bma_borrar_importado();"))

    def test_cada_parte_marca_importando(self):
        partes = sql_por_partes(resultado(50), max_bytes=2000)
        self.assertGreater(len(partes), 1)
        for p in partes:
            self.assertTrue(p.startswith("select set_config('bma.importando','si',true);"))

    def test_escapa_comillas(self):
        self.assertIn("'O''HARA'", sql_por_partes(resultado(producto="O'HARA"))[0])

    def test_partes_no_pasan_el_limite(self):
        partes = sql_por_partes(resultado(50), max_bytes=2000)
        self.assertTrue(all(len(p.encode('utf-8')) <= 2000 for p in partes))
        renglones_ventas = sum(len(re.findall(r"\('00000000-", p)) for p in partes)
        self.assertEqual(renglones_ventas, 50)

    def test_origen_importada(self):
        todo = '\n'.join(sql_por_partes(resultado(3)))
        for tabla in ('bma.ventas', 'bma.movimientos', 'bma.personas'):
            bloque = [s for s in todo.split(';\n') if s.startswith(f'insert into {tabla} ')]
            self.assertTrue(bloque, tabla)
            self.assertTrue(all("'importada'" in s for s in bloque), tabla)

    def test_vendedor_ligado_a_la_venta(self):
        todo = '\n'.join(sql_por_partes(resultado()))
        self.assertIn("'20000000-0000-0000-0000-000000000001'", [s for s in todo.split(';\n') if s.startswith('insert into bma.ventas ')][0])

    def test_resumen_no_cuenta_solo_entrega_como_dinero(self):
        res = resultado()
        renglones = [{'sucursal': 'AGS', 'pago': 'CONTADO', 'monto': 1000.0},
                     {'sucursal': 'AGS', 'pago': 'SOLO ENTREGA', 'monto': 32100.0}]
        linea = resumen(res, renglones).splitlines()[0]
        self.assertIn('suma 1000.00', linea)
        self.assertIn('= 1000.00', linea)

    def test_lotes_json(self):
        L = lotes(resultado(2))
        self.assertEqual(list(L), ['personas', 'ventas', 'movimientos', 'apartados', 'dudas_importacion'])
        v = L['ventas'][0]
        self.assertEqual(v['folio'], 'AGS-2026-0001')
        self.assertEqual(v['fecha'], '2026-10-26')
        self.assertEqual(v['vendedor_id'], '20000000-0000-0000-0000-000000000001')
        self.assertIsNone(v['factura'])                       # texto vacío -> null
        m = L['movimientos'][0]
        self.assertEqual((m['venta_id'], m['monto'], m['confirmado_banco']), (v['id'], 1000.0, True))
        self.assertEqual(L['personas'][0]['tipos'], ['vendedor'])
        json.dumps(L)                                          # se puede escribir como JSON

    def test_resumen_resta_devoluciones(self):
        res = resultado()
        res['movimientos'].append(dict(res['movimientos'][0], id='x', tipo='devolucion', monto=300.0))
        renglones = [{'sucursal': 'AGS', 'pago': 'CONTADO', 'monto': 1000.0},
                     {'sucursal': 'AGS', 'pago': '', 'monto': -300.0}]
        linea = resumen(res, renglones).splitlines()[0]
        self.assertIn('suma 700.00', linea)
        self.assertIn('= 700.00', linea)

    def test_literales(self):
        self.assertEqual(literal(None), 'null')
        self.assertEqual(literal(True), 'true')
        self.assertEqual(literal(12.5), '12.5')
        self.assertEqual(literal(dt.date(2026, 1, 2)), "'2026-01-02'")
        self.assertEqual(literal({'a': "x'y"}), """'{"a": "x''y"}'::jsonb""")
        self.assertEqual(literal(['vendedor']), "'{vendedor}'")


if __name__ == '__main__':
    unittest.main()
