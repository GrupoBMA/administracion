"""Lee los Excel de Silvia (FImp<SUC>-2026.xlsx): una pestaña por semana con la lista de cobros.
Las columnas se ubican por su título, nunca por letra. Solo lee: no modifica el archivo."""
import datetime as dt
import re
import unicodedata

import openpyxl

MAX_FILAS = 400
BASE_2026 = dt.date(2025, 12, 29)          # lunes de la semana 1 de 2026
METODOS = {'EFECTIVO': 'efectivo', 'TRANSFERENCIA': 'transferencia', 'TARJETA': 'tarjeta',
           'DEPOSITO': 'deposito', 'MERCADOPAGO': 'mercado_pago', 'CHEQUE': 'cheque', 'PRESTAMO': 'prestamo'}
SIN_DINERO = ('CANCELADA', 'CANCELADO', 'SOLO')                  # solo entrega / factura / envío
LUNES_SEMANA_1 = {25: dt.date(2024, 12, 30), 26: dt.date(2025, 12, 29)}


def norm(v):
    s = '' if v is None else str(v)
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'\s+', ' ', s).strip().upper()


def _sin_punto_cero(v):
    return re.sub(r'\.0$', '', norm(v))


def monto(v):
    if v is None or isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2)
    t = re.sub(r'[$,\s]', '', str(v))
    try:
        return round(float(t), 2) if t else None
    except ValueError:
        return None


def _distancia(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def metodo_catalogo(txt):
    t = re.sub(r'[^A-Z]', '', norm(txt))
    if not t:
        return None
    for k, v in METODOS.items():
        if t.startswith(k):
            return v
    mejor = min(METODOS, key=lambda k: _distancia(t, k))
    return METODOS[mejor] if _distancia(t, mejor) <= 2 else None


def lunes_de_hoja(nombre):
    n = norm(nombre)
    if n.startswith(('HOJA', 'COPIA')):
        return None
    m = re.match(r'^[A-Z]+\s*(\d{1,2})\b', n)
    if not m:
        return None
    sem = int(m.group(1))
    a = re.search(r'[A-Z]{3}\.?\s*(\d{2})\s*$', n)
    anio = int(a.group(1)) if a else 26
    if anio not in LUNES_SEMANA_1:
        return None                     # solo se leen pestañas de 2025 y 2026
    return LUNES_SEMANA_1[anio] + dt.timedelta(days=7 * (sem - 1))


def _fecha(v):
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    return None


def _leer_hoja(ws, sucursal, nombre, lunes):
    filas = list(ws.iter_rows(min_row=1, max_row=MAX_FILAS, values_only=True))
    enc = None
    for i, r in enumerate(filas):
        t = [norm(v) for v in r]
        if 'CATEGORIA' in t and 'PRODUCTO' in t and 'METODO' in t:
            enc = (i, t)
            break
    if not enc:
        return []
    i0, t = enc
    jm = t.index('METODO')
    col = {k: t.index(k) for k in ('CATEGORIA', 'PRODUCTO', 'PAGO', 'CUENTA', 'REMISION', 'FACTURA', 'COLOR',
                                   'G / S', 'VENDEDOR', 'DESCRIPCION') if k in t}
    col['FECHA'] = next((j for j, x in enumerate(t) if x.startswith('FECHA')), None)
    col['MONTO'] = next((j for j, x in enumerate(t) if x == 'MONTO' and j > jm), None)
    desde = min(j for j in col.values() if j is not None)

    def celda(r, k):
        j = col.get(k)
        return r[j] if j is not None and j < len(r) else None

    out = []
    for k, r in enumerate(filas[i0 + 1:], start=i0 + 2):
        tt = [norm(v) for v in r[desde:]]
        if 'INVENTARIO' in tt or any(x.startswith('EGRESOS') for x in tt):
            break
        crudo = celda(r, 'MONTO')
        prod, m, pago = norm(celda(r, 'PRODUCTO')), monto(crudo), norm(celda(r, 'PAGO'))
        ilegible = str(crudo).strip() if m is None and crudo is not None and str(crudo).strip() else ''
        if not prod and m is None:
            continue
        if m is None and not ilegible and not pago.startswith(SIN_DINERO):
            continue
        out.append({
            'sucursal': sucursal, 'lunes': lunes, 'hoja': nombre, 'fila': k,
            'fecha': _fecha(celda(r, 'FECHA')), 'categoria': norm(celda(r, 'CATEGORIA')), 'producto': prod,
            'pago': pago, 'metodo': metodo_catalogo(r[jm] if jm < len(r) else None),
            'ok': norm(r[jm + 1] if jm + 1 < len(r) else None) == 'OK',
            'cuenta': norm(celda(r, 'CUENTA')), 'monto': m, 'monto_ilegible': ilegible,
            'remision': _sin_punto_cero(celda(r, 'REMISION')), 'factura': _sin_punto_cero(celda(r, 'FACTURA')),
            'color': norm(celda(r, 'COLOR')), 'gs': norm(celda(r, 'G / S')), 'vendedor': norm(celda(r, 'VENDEDOR')),
            'descripcion': norm(celda(r, 'DESCRIPCION')),
        })
    return out


def leer_libro(ruta, sucursal):
    wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    out = []
    for nombre in wb.sheetnames:
        lunes = lunes_de_hoja(nombre)
        if lunes is None:
            continue
        out.extend(_leer_hoja(wb[nombre], sucursal, nombre, lunes))
    return out
