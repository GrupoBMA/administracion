"""Importación de 2026: lee los Excel de Silvia, hila las ventas y genera el SQL para Supabase por partes.
Correr desde la raíz del repo: python -I importar/cargar.py
Lee .local/silvia/FImp<SUC>-2026.xlsx y escribe .local/importacion/parte-NN.sql y resumen.txt.
Nada de esto se sube al repo (.local/ está ignorada)."""
import collections
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from hilar import hilar          # noqa: E402
from lector import leer_libro    # noqa: E402

SUCURSALES = ['AGS', 'MAZ', 'MLM', 'PUE', 'QRO', 'TEP']
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRADA = os.path.join(RAIZ, '.local', 'silvia')
SALIDA = os.path.join(RAIZ, '.local', 'importacion')
INICIO = "select set_config('bma.importando','si',true);\n"   # cada parte es su propia sesión


def literal(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(round(v, 2)) if isinstance(v, float) else str(v)
    if isinstance(v, (dt.date, dt.datetime)):
        return f"'{v.isoformat()}'"
    if isinstance(v, dict):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    if isinstance(v, (list, tuple)):
        return "'{" + ','.join(str(x) for x in v) + "}'"
    return "'" + str(v).replace("'", "''") + "'"


def _texto(v):
    return v if v else None


def _filas(res):
    """(tabla, columnas, [valores]) en orden de dependencias."""
    vid = res['vendedores']
    suc_de = collections.defaultdict(collections.Counter)
    for v in res['ventas']:
        if v['vendedor'] in vid:
            suc_de[v['vendedor']][v['sucursal']] += 1
    personas = [(i, n, ['vendedor'], suc_de[n].most_common(1)[0][0] if suc_de[n] else None, 'importada')
                for n, i in sorted(vid.items())]
    ventas = [(v['id'], v['folio'], v['sucursal'], v['fecha'], vid.get(v['vendedor']), v['producto'], _texto(v['categoria']),
               v['linea'], _texto(v['remision']), _texto(v['factura']), _texto(v['color']), v['precio_total'], v['estado'],
               'importada') for v in res['ventas']]
    movs = [(m['id'], m['venta_id'], m['fecha'], m['lunes'], m['tipo'], m['monto'], m['metodo'], _texto(m['cuenta']),
             m['confirmado_banco'], m['nota'], 'importada', m['origen_ref']) for m in res['movimientos']]
    aps = [(a['id'], a['tipo'], a['sucursal'], a['fecha'], a['lunes'], a['monto'], a['datos'], a['origen_ref'])
           for a in res['apartados']]
    dudas = [(d['id'], d['venta_id'], d['movimiento_id'], d['motivo'], d['detalle']) for d in res['dudas']]
    return [
        ('bma.personas', 'id, nombre, tipos, sucursal, origen', personas),
        ('bma.ventas', 'id, folio, sucursal, fecha, vendedor_id, producto, categoria, linea, remision, factura, color, '
                       'precio_total, estado, origen', ventas),
        ('bma.movimientos', 'id, venta_id, fecha, lunes, tipo, monto, metodo, cuenta, confirmado_banco, nota, origen, '
                            'origen_ref', movs),
        ('bma.apartados', 'id, tipo, sucursal, fecha, lunes, monto, datos, origen_ref', aps),
        ('bma.dudas_importacion', 'id, venta_id, movimiento_id, motivo, detalle', dudas),
    ]


def _json(v):
    return v.isoformat() if isinstance(v, (dt.date, dt.datetime)) else v


def lotes(res):
    """{tabla: [renglón con nombres de columna]} para importar/subir.html (bma_importar_lote).
    No lleva 'origen': la función de Supabase siempre pone 'importada'."""
    out = {}
    for tabla, cols, filas in _filas(res):
        nombres = [c.strip() for c in cols.split(',')]
        out[tabla.split('.', 1)[1]] = [{k: _json(v) for k, v in zip(nombres, f) if k != 'origen'} for f in filas]
    return out


def sql_por_partes(res, max_bytes=900_000):
    partes, actual = [], INICIO + 'select public.bma_borrar_importado();\n'
    for tabla, cols, filas in _filas(res):
        cab = f'insert into {tabla} ({cols}) values\n'
        bloque = []
        for f in filas:
            renglon = '(' + ', '.join(literal(x) for x in f) + ')'
            prueba = actual + cab + ',\n'.join(bloque + [renglon]) + ';\n'
            if len(prueba.encode('utf-8')) > max_bytes and (bloque or actual != INICIO):
                if bloque:
                    actual += cab + ',\n'.join(bloque) + ';\n'
                partes.append(actual)
                actual, bloque = INICIO, []
            bloque.append(renglon)
        if bloque:
            actual += cab + ',\n'.join(bloque) + ';\n'
    partes.append(actual)
    return partes


def resumen(res, renglones):
    movs_de = collections.defaultdict(list)
    for m in res['movimientos']:
        movs_de[m['venta_id']].append(m)
    out = []
    for s in SUCURSALES:
        V = [v for v in res['ventas'] if v['sucursal'] == s]
        est = collections.Counter(v['estado'] for v in V)
        M = [m for v in V for m in movs_de[v['id']]]
        ap = sum(a['monto'] or 0 for a in res['apartados'] if a['sucursal'] == s)
        # Dinero del Excel: "solo entrega/factura/envío" y canceladas traen el valor, no un cobro
        excel = sum(x['monto'] or 0 for x in renglones
                    if x['sucursal'] == s and not x['pago'].startswith(('SOLO', 'CANCEL')))
        out.append(f"{s}: ventas {len(V)} (cerradas {est['cerrada']}, abiertas {est['abierta']}, canceladas {est['cancelada']}) "
                   f"| movimientos {len(M)} | suma {sum(-m['monto'] if m['tipo'] == 'devolucion' else m['monto'] for m in M):.2f} "
                   f"| Excel {excel:.2f} - apartados {ap:.2f} = {excel - ap:.2f}")
    out.append('dudas: ' + json.dumps(dict(collections.Counter(d['motivo'] for d in res['dudas'])), ensure_ascii=False))
    out.append(f"vendedores: {len(res['vendedores'])} · apartados: {len(res['apartados'])}")
    return '\n'.join(out)


def main():
    renglones = []
    for s in SUCURSALES:
        renglones += leer_libro(os.path.join(ENTRADA, f'FImp{s}-2026.xlsx'), s)
    res = hilar(renglones)
    os.makedirs(SALIDA, exist_ok=True)
    for f in os.listdir(SALIDA):
        if f.startswith('parte-'):
            os.remove(os.path.join(SALIDA, f))
    partes = sql_por_partes(res)
    for i, p in enumerate(partes, 1):
        with open(os.path.join(SALIDA, f'parte-{i:02d}.sql'), 'w', encoding='utf-8') as fh:
            fh.write(p)
    with open(os.path.join(SALIDA, 'lotes.json'), 'w', encoding='utf-8') as fh:
        json.dump(lotes(res), fh, ensure_ascii=False, separators=(',', ':'))
    texto = resumen(res, renglones)
    with open(os.path.join(SALIDA, 'resumen.txt'), 'w', encoding='utf-8') as fh:
        fh.write(texto + '\n')
    print(f'{len(partes)} partes, {sum(len(p.encode()) for p in partes)} bytes')
    print(texto)


if __name__ == '__main__':
    main()
