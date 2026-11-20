"""Hila los cobros de los Excel de Silvia en ventas con su historial de movimientos.
Entrada: renglones de lector.leer_libro. Salida: ventas, movimientos, apartados, dudas y vendedores."""
import datetime as dt
import difflib
import re
import uuid

MESES = {'ENE': 1, 'FEB': 2, 'MAR': 3, 'ABR': 4, 'MAY': 5, 'JUN': 6, 'JUL': 7, 'AGO': 8, 'SEP': 9,
         'OCT': 10, 'NOV': 11, 'DIC': 12}
DIAS_LIQUIDAR = 180        # una liquidación busca su anticipo hasta 180 días antes
DIAS_OTRO_ANTICIPO = 120   # un segundo anticipo se suma a la venta si el primero fue hace menos de 120 días
PARECIDO_MIN = 0.5
PARECIDO_ANTICIPO = 0.8
VECES_VENDEDOR = 5         # una palabra cuenta como vendedor si aparece en al menos 5 renglones
INVENTARIO = ('SALIDA DE MERCANCIA', 'ENTRADA DE MERCANCIA', 'TRASPASO')


def _id():
    return str(uuid.uuid4())


def linea_de(categoria, producto):
    t = f'{categoria} {producto}'
    if re.search(r'PASTO|\bMTS2?\b|\bM2\b|PASTITO', t):       # MTS/MTS2/M2 = metros; "MT" solo es mototaxi
        return 'pasto'
    if re.search(r'ENVIO|FLETE', t):
        return 'otro'
    return 'motos'


def nota_anticipo(descripcion):
    m = re.search(r'ANT\w*\s+(\d{1,2})\s+([A-Z]{3})\w*\s+(?:REM|NV|NOTA)\.?\s*(\d+)(?:\s*\$\s*([\d,]+(?:\.\d+)?))?',
                  descripcion or '')
    if not m or m.group(2) not in MESES:
        return None
    monto = float(m.group(4).replace(',', '')) if m.group(4) else None
    return {'dia': int(m.group(1)), 'mes': MESES[m.group(2)], 'remision': str(int(m.group(3))), 'monto': monto}


CORTE_VENDEDOR = {'ANT', 'ANTICIPO', 'ABO', 'ABONO', 'LIQ', 'LIQUIDA', 'LIQUIDACION', 'REM', 'NV', 'PENDIENTE',
                  'ENVIO', 'FACT', 'FACTURA', 'SOLO', 'DEVOLUCION', 'ENTREGA', 'SEGUNDO', 'PAGO', 'CANCELADA',
                  'CANCELADO', 'LIQUIDADO', 'LIQUIDO', 'INSTALADOR', 'INSTAL', 'COTIZACION', 'ESTABA'}


def separar_vendedor(texto):
    """Silvia escribe notas en la columna VENDEDOR ("ARGE ANT 03 JUL REM 137 $20,000"):
    el nombre son las primeras palabras, hasta una palabra clave o algo con número."""
    palabras = (texto or '').split()
    for i, p in enumerate(palabras):
        if p in CORTE_VENDEDOR or re.search(r'[\d$;]', p):
            return ' '.join(palabras[:i]), ' '.join(palabras[i:])
    return ' '.join(palabras), ''


def parecido(a, b):
    return difflib.SequenceMatcher(None, a or '', b or '').ratio()


def _tipo_pago(pago):
    for pre, tipo in (('CONT', 'contado'), ('ANTI', 'anticipo'), ('LIQU', 'liquidacion'), ('ABON', 'abono'),
                      ('CANCEL', 'cancelada'), ('SOLO', 'entrega')):
        if pago.startswith(pre):
            return tipo
    return '' if not pago else 'otro'


class _Hilo:
    def __init__(self, renglones):
        self.ventas, self.movimientos, self.apartados, self.dudas = [], [], [], []
        self.por_llave = {}            # (sucursal, linea, remision) -> [venta]
        self.ultima_de_hoja = {}       # (sucursal, hoja) -> venta del renglón anterior
        self.movs_de = {}              # venta id -> [movimiento]
        # Vendedor = primera palabra de la columna, si se repite al menos VECES_VENDEDOR veces en los
        # renglones; lo demás de la columna es nota (Silvia escribe ahí texto libre).
        partes = [separar_vendedor(x['vendedor']) for x in renglones]
        veces = {}
        for nombre, _ in partes:
            if nombre:
                veces[nombre.split()[0]] = veces.get(nombre.split()[0], 0) + 1
        limpios = []
        for x, (nombre, nota) in zip(renglones, partes):
            primera = nombre.split()[0] if nombre else ''
            vendedor = primera if veces.get(primera, 0) >= VECES_VENDEDOR else ''
            resto = x['vendedor'][len(primera):].strip() if vendedor else x['vendedor']
            limpios.append(dict(x, vendedor=vendedor, descripcion=' '.join(t for t in (x['descripcion'], resto) if t)))
        self.renglones = sorted(limpios, key=lambda x: (x['lunes'], x['hoja'], x['fila']))

    # ---- piezas
    def duda(self, motivo, x, venta=None, mov=None):
        self.dudas.append({'id': _id(), 'venta_id': venta['id'] if venta else None,
                           'movimiento_id': mov['id'] if mov else None, 'motivo': motivo,
                           'detalle': f"{x['hoja']} fila {x['fila']}: {x['pago'] or 'sin pago'} · {x['producto']} · "
                                      f"{x['monto'] if x['monto'] is not None else 'sin monto'}"})

    def llave(self, x, remision=None):
        """(sucursal, línea, número de remisión). "NV 21", "R-21" y "021" dan el mismo número."""
        rem = remision if remision is not None else x['remision']
        dig = re.sub(r'\D', '', rem or '')
        num = (dig.lstrip('0') or '0') if dig else (rem or '')
        return (x['sucursal'], linea_de(x['categoria'], x['producto']), num) if num else None

    def nueva_venta(self, x, estado):
        f = x['fecha']
        fecha = f if f and x['lunes'] - dt.timedelta(days=7) <= f <= x['lunes'] + dt.timedelta(days=13) else x['lunes']
        v = {'id': _id(), 'folio': None, 'sucursal': x['sucursal'], 'fecha': fecha, 'producto': x['producto'] or 'SIN PRODUCTO',
             'categoria': x['categoria'], 'linea': linea_de(x['categoria'], x['producto']), 'remision': x['remision'],
             'factura': x['factura'], 'color': x['color'], 'vendedor': x['vendedor'], 'precio_total': None,
             'estado': estado, '_lunes': x['lunes']}
        self.ventas.append(v)
        self.movs_de[v['id']] = []
        k = self.llave(x)
        if k:
            self.por_llave.setdefault(k, []).append(v)
        return v

    def mover(self, v, x, tipo, monto=None):
        m = {'id': _id(), 'venta_id': v['id'], 'fecha': x['fecha'] or x['lunes'], 'lunes': x['lunes'], 'tipo': tipo,
             'monto': (x['monto'] or 0.0) if monto is None else monto,
             'metodo': x['metodo'] if x['metodo'] != 'prestamo' else None, 'cuenta': x['cuenta'],
             'confirmado_banco': x['ok'], 'nota': x['descripcion'] or None,
             'origen_ref': {'archivo': f"FImp{x['sucursal']}-2026.xlsx", 'hoja': x['hoja'], 'fila': x['fila']}}
        self.movimientos.append(m)
        self.movs_de[v['id']].append(m)
        if not v['factura'] and x['factura']:
            v['factura'] = x['factura']
        self.ultima_de_hoja[(x['sucursal'], x['hoja'])] = v
        return m

    def candidatas(self, k, x, dias, liquidando=False):
        """Ventas abiertas con esa llave. Al liquidar también cuenta la que se cerró con una liquidación
        en esta misma semana: es la misma liquidación partida en dos renglones."""
        out = []
        for v in self.por_llave.get(k, []):
            ms = self.movs_de[v['id']]
            misma_semana = liquidando and v['estado'] == 'cerrada' and ms and ms[-1]['tipo'] == 'liquidacion' \
                and ms[-1]['lunes'] == x['lunes']
            if v['estado'] != 'abierta' and not misma_semana:
                continue
            if 0 <= (x['lunes'] - v['_lunes']).days <= dias:
                out.append(v)
        return out

    # ---- reglas
    def liquidar(self, x, tipo):
        nota = nota_anticipo(x['descripcion'])
        # Primero la remisión que dice la nota de Silvia (en Morelia la liquidación lleva una remisión
        # nueva y la nota dice la del anticipo); luego la del renglón.
        llaves = []
        for k in ((self.llave(x, nota['remision']) if nota else None), self.llave(x)):
            if k and k not in llaves:
                llaves.append(k)
        if not llaves:
            v = self.nueva_venta(x, 'cerrada' if tipo == 'liquidacion' else 'abierta')
            self.duda('sin_remision', x, v, self.mover(v, x, tipo))
            return
        cand = []
        for k in llaves:
            cand = self.candidatas(k, x, DIAS_LIQUIDAR, liquidando=True)
            if cand:
                break
        elegida, dudosa = None, False
        if nota:
            for v in cand:
                for m in self.movs_de[v['id']]:
                    f = m['fecha']
                    if m['tipo'] == 'anticipo' and f.day == nota['dia'] and f.month == nota['mes'] and \
                            (nota['monto'] is None or abs(m['monto'] - nota['monto']) <= 1):
                        elegida = v
        if not elegida and len(cand) == 1:
            elegida = cand[0]
        if not elegida and cand:
            orden = sorted(cand, key=lambda v: (parecido(v['producto'], x['producto']), v['_lunes']), reverse=True)
            elegida = orden[0]
            p0 = parecido(orden[0]['producto'], x['producto'])
            dudosa = p0 < PARECIDO_MIN or (len(orden) > 1 and abs(p0 - parecido(orden[1]['producto'], x['producto'])) < 1e-9)
        if not elegida:
            v = self.nueva_venta(x, 'cerrada' if tipo == 'liquidacion' else 'abierta')
            self.duda('sin_anticipo', x, v, self.mover(v, x, tipo))
            return
        m = self.mover(elegida, x, tipo)
        if tipo == 'liquidacion':
            elegida['estado'] = 'cerrada'
        if dudosa:
            self.duda('varias_candidatas', x, elegida, m)

    def anticipar(self, x):
        k = self.llave(x)
        if k:
            for v in reversed(self.candidatas(k, x, DIAS_OTRO_ANTICIPO)):
                if parecido(v['producto'], x['producto']) >= PARECIDO_ANTICIPO or 'SEGUNDO' in x['descripcion']:
                    self.mover(v, x, 'anticipo')
                    return
        self.mover(self.nueva_venta(x, 'abierta'), x, 'anticipo')

    def complemento(self, x):
        k = self.llave(x)
        v = None
        if k:
            v = next((v for v in reversed(self.por_llave.get(k, [])) if v['_lunes'] == x['lunes']), None)
        if not v:
            v = self.ultima_de_hoja.get((x['sucursal'], x['hoja']))
        if v:
            self.mover(v, x, 'contado')
        else:
            self.mover(self.nueva_venta(x, 'cerrada'), x, 'contado')

    def cancelar(self, x):
        k = self.llave(x)
        cand = self.candidatas(k, x, DIAS_LIQUIDAR) if k else []
        if cand:
            v = cand[-1]
            self.mover(v, x, 'cancelacion', 0.0)
            v['estado'] = 'cancelada'
            return
        v = self.nueva_venta(x, 'cancelada')
        self.duda('cancelada_sin_venta', x, v, self.mover(v, x, 'cancelacion', 0.0))

    def reciente(self, k, x):
        """La venta más reciente con esa llave, en cualquier estado, de los últimos 180 días
        (las remisiones se reusan meses después)."""
        for v in reversed(self.por_llave.get(k, []) if k else []):
            if 0 <= (x['lunes'] - v['_lunes']).days <= DIAS_LIQUIDAR:
                return v
        return None

    def entregar(self, x):
        v = self.reciente(self.llave(x), x)
        if v:
            m = self.mover(v, x, 'entrega', 0.0)
            if x['monto']:      # en "solo entrega" el monto es el valor de lo entregado, no dinero cobrado
                m['nota'] = ' · '.join(t for t in (f"{x['pago']}: valor en el Excel ${x['monto']:,.2f}", m['nota']) if t)
        else:
            self.duda('entrega_sin_venta', x)

    def devolver(self, x):
        """Dinero que se le regresa al cliente: se guarda en positivo como 'devolucion' y resta del total."""
        rem = x['remision']
        if not rem:
            m = re.search(r'REM\.?\s*(\d+)', f"{x['producto']} {x['descripcion']}")
            rem = m.group(1) if m else ''
        v = self.reciente(self.llave(x, rem) if rem else None, x)
        monto = abs(x['monto'] or 0.0)
        if v:
            self.mover(v, x, 'devolucion', monto)
        else:
            v = self.nueva_venta(x, 'cancelada')
            self.duda('cancelada_sin_venta', x, v, self.mover(v, x, 'devolucion', monto))

    def correr(self):
        for x in self.renglones:
            texto = f"{x['categoria']} {x['producto']}"
            if x['monto'] is None and x.get('monto_ilegible'):
                self.duda('monto_ilegible', x)       # no se inventa el monto: Silvia lo revisa
                continue
            if (x['monto'] or 0) < 0:      # el signo manda: solo un monto negativo es dinero regresado
                self.devolver(x)
                continue
            if x['metodo'] == 'prestamo' or 'PRESTAMO' in texto:
                self.apartar('prestamo', x)
                continue
            if any(w in texto for w in INVENTARIO) and not x['monto']:
                self.apartar('inventario', x)
                continue
            tipo = _tipo_pago(x['pago'])
            es_complemento = x['producto'].startswith('COMPLEMENTO')
            if not x['producto'] and tipo in ('contado', ''):
                v = self.nueva_venta(x, 'cerrada')
                self.duda('sin_producto', x, v, self.mover(v, x, 'contado'))
                continue
            if tipo in ('liquidacion', 'abono'):
                self.liquidar(x, tipo)
            elif tipo == 'anticipo':
                self.anticipar(x)
            elif tipo == 'cancelada':
                self.cancelar(x)
            elif tipo == 'entrega':
                self.entregar(x)
            elif es_complemento and tipo in ('contado', ''):
                self.complemento(x)
            else:
                v = self.nueva_venta(x, 'cerrada')
                m = self.mover(v, x, 'contado')
                if tipo != 'contado':
                    self.duda('sin_tipo_pago', x, v, m)
        self.cerrar()

    def apartar(self, tipo, x):
        self.apartados.append({'id': _id(), 'tipo': tipo, 'sucursal': x['sucursal'], 'fecha': x['fecha'],
                               'lunes': x['lunes'], 'monto': x['monto'],
                               'datos': {k: x[k] for k in ('categoria', 'producto', 'pago', 'metodo', 'cuenta',
                                                            'remision', 'vendedor', 'descripcion')},
                               'origen_ref': {'archivo': f"FImp{x['sucursal']}-2026.xlsx", 'hoja': x['hoja'],
                                              'fila': x['fila']}})

    def cerrar(self):
        for v in self.ventas:
            if v['estado'] == 'cerrada':
                v['precio_total'] = round(sum(-m['monto'] if m['tipo'] == 'devolucion' else m['monto']
                                              for m in self.movs_de[v['id']]), 2)
        cuenta = {}
        for v in sorted(self.ventas, key=lambda v: (v['sucursal'], v['fecha'], v['_lunes'])):
            k = (v['sucursal'], v['fecha'].year)
            cuenta[k] = cuenta.get(k, 0) + 1
            v['folio'] = f'{k[0]}-{k[1]}-{cuenta[k]:04d}'
        for v in self.ventas:
            v.pop('_lunes', None)


def _vendedores(renglones, dudas):
    nombres = sorted({x['vendedor'] for x in renglones if x['vendedor'] and len(x['vendedor']) > 1})
    ids = {n: _id() for n in nombres}
    for a in nombres:
        for b in nombres:
            if a != b and b.startswith(a):
                dudas.append({'id': _id(), 'venta_id': None, 'movimiento_id': None, 'motivo': 'vendedor_parecido',
                              'detalle': f'¿"{a}" y "{b}" son la misma persona?'})
    return ids


def hilar(renglones):
    h = _Hilo(renglones)
    h.correr()
    vendedores = _vendedores(h.renglones, h.dudas)
    return {'ventas': h.ventas, 'movimientos': h.movimientos, 'apartados': h.apartados, 'dudas': h.dudas,
            'vendedores': vendedores}
