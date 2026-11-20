"""Egresos de 2026: lee la sección "EGRESOS / DEPÓSITO" de los Excel de Silvia, acomoda cada renglón en su tipo
(gasto, traspaso, préstamo o devolución) y genera el SQL para Supabase.
Correr desde la raíz del repo: python -I importar/egresos.py
Lee .local/silvia/FImp<SUC>-2026.xlsx y .local/importacion/personas.json (las personas que ya existen en la base:
[{id, nombre, tipos, sucursal}]) y escribe .local/importacion/egresos-NN.sql y egresos-resumen.txt.
Nada de esto va al repo (.local/ está ignorada): trae nombres reales."""
import collections
import datetime as dt
import json
import os
import re
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lector import norm, monto, lunes_de_hoja   # noqa: E402

SUCURSALES = ['AGS', 'MAZ', 'MLM', 'PUE', 'QRO', 'TEP']
DESDE = dt.date(2025, 12, 29)                     # lunes de la semana 1 de 2026
MAX_FILAS = 400
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENTRADA = os.path.join(RAIZ, '.local', 'silvia')
SALIDA = os.path.join(RAIZ, '.local', 'importacion')
ESPACIO = uuid.UUID('6f1d2c3e-6b0a-4c55-9d8e-2a7f0b1c9e44')   # para que las personas nuevas tengan siempre el mismo id

BANCOS = [('SANTANDER', 'santander'), ('SANTADER', 'santander'), ('SANT ', 'santander'), ('BANAMEX', 'banamex'),
          ('BBVA', 'bbva'), ('BANCOMER', 'bbva'), ('BANORTE', 'banorte'), ('BAJIO', 'bajio'), ('HSBC', 'hsbc')]
CIUDADES = {'AGUASCALIENTES': 'AGS', 'GUADALAJARA': 'GDL', 'MAZATLAN': 'MAZ', 'MORELIA': 'MLM', 'PUEBLA': 'PUE',
            'QUERETARO': 'QRO', 'TEPIC': 'TEP', 'ZAPOPAN': 'ZAP', 'NAUCALPAN': 'NAU', 'LA PAZ': 'LPZ', 'TIJUANA': 'TIJ'}


# ---------------------------------------------------------------- Leer
def leer_egresos(ruta, sucursal):
    """Renglones de egresos de cada pestaña semanal desde 2026. Los renglones de puro texto (notas de Silvia)
    se pegan a la nota del renglón anterior; los que no traen tipo ni descripción (subtotales) se ignoran."""
    import openpyxl
    wb = openpyxl.load_workbook(ruta, read_only=True, data_only=True)
    out = []
    for nombre in wb.sheetnames:
        lunes = lunes_de_hoja(nombre)
        if lunes is None or lunes < DESDE:
            continue
        filas = list(wb[nombre].iter_rows(min_row=1, max_row=MAX_FILAS, values_only=True))
        ini = None
        for i, f in enumerate(filas):
            for j, c in enumerate(f):
                if norm(c).startswith('EGRESO'):          # "EGRESOS / DEPOSITO"; en Morelia "EGRESO/ DEPOSITO"
                    ini = (i, j)
                    break
            if ini:
                break
        if not ini:
            continue
        i0, j0 = ini
        cab = [norm(c) for c in filas[i0]]
        jm = next((j for j in range(j0 + 1, len(cab)) if cab[j] == 'MONTO'), j0 + 3)
        jf = j0 - 1 if j0 > 0 and cab[j0 - 1].startswith('FECHA') else None      # "FECHA 2026", a la izquierda
        vacias, previo = 0, None
        # La lista viene en grupos (gastos, nómina, depósitos, otro HEBQ) con su subtotal y huecos entre ellos;
        # abajo siguen las notas "(a) …" y luego cálculos de inventario ("Sem 23 …", productos con precio).
        for k, f in enumerate(filas[i0 + 1:], start=i0 + 2):
            t = [f[j] if j < len(f) else None for j in range(j0, max(jm, j0 + 2) + 1)]
            tipo, desc, m = t[0], t[1], (f[jm] if jm < len(f) else None)
            fecha = f[jf] if jf is not None and jf < len(f) else None
            if norm(tipo).startswith('INVENTARIO') or norm(desc).startswith('INVENTARIO'):
                break
            if re.match(r'^SEM \d+', norm(desc)) or re.match(r'^SEM \d+', norm(tipo)):
                break                                      # aquí empiezan los cálculos de inventario
            if all(c in (None, '') for c in (tipo, desc, m)):
                vacias += 1
                if vacias > 25:          # hay huecos largos antes de los renglones de "OTRO HEBQ"
                    break
                continue
            vacias = 0
            mm = monto(m)
            if mm is None:
                # nota suelta: se pega al renglón anterior
                texto = ' '.join(x for x in (norm(tipo), norm(desc)) if x)
                if previo is not None and texto:
                    previo['notas'].append(texto)
                continue
            if not norm(tipo) and not norm(desc):
                continue                                   # subtotal
            if not tipo_conocido(norm(tipo)) and not isinstance(fecha, (dt.date, dt.datetime)):
                continue                                   # sin tipo conocido ni fecha: no es un egreso
            if isinstance(fecha, dt.datetime):
                fecha = fecha.date()
            if not isinstance(fecha, dt.date) or not (lunes - dt.timedelta(days=7) <= fecha <= lunes + dt.timedelta(days=13)):
                fecha = None                               # fecha mal capturada: se queda la semana
            previo = {'sucursal': sucursal, 'lunes': lunes, 'fecha': fecha, 'hoja': nombre, 'fila': k,
                      'tipo_excel': norm(tipo), 'descripcion': norm(desc), 'monto': mm, 'notas': []}
            out.append(previo)
    return out


TIPOS_EXCEL = ('GAST', 'NOMIN', 'SUELDO', 'DEP', 'COMIS', 'DESCAR', 'GRUA', 'GARANT', 'DEVOL', 'PRESTA', 'OTRO')


def tipo_conocido(t):
    return t.startswith(TIPOS_EXCEL)


# ---------------------------------------------------------------- Acomodar
def banco_de(desc):
    d = desc + ' '
    for clave, cuenta in BANCOS:
        if clave in d:
            return cuenta
    return None


def remision_de(desc):
    m = re.search(r'\b(?:REM|NV|NOTA)\.?\s*(\d+)', desc)
    return str(int(m.group(1))) if m else None


def nombre_limpio(desc):
    d = re.sub(r'\(.*?\)', ' ', desc)
    d = re.sub(r'\b(NOMINA|SUELDO|PRESTAMO|COPPEL|COPEL|PAGO|DEP|DEPOSITO|SUNL|PASTITO)\b', ' ', d)
    return re.sub(r'\s+', ' ', re.sub(r'[^A-Z ]', ' ', d)).strip()


def acomodar(r):
    """Devuelve el egreso: tipo, categoría (nombre), cuentas, a quién se carga, persona por buscar, etc."""
    t, d, suc = r['tipo_excel'], r['descripcion'], r['sucursal']
    e = {'tipo': 'gasto', 'categoria': 'Generales', 'sale_de': 'caja-' + suc, 'entra_a': None, 'carga_a': suc,
         'concepto': d or None, 'persona': None, 'rol_persona': None, 'remision': None, 'autorizo': None,
         'por_aclarar': False, 'motivo': None}
    if t.startswith('OTRO'):
        e['autorizo'] = 'HEBQ'
        if re.search(r'\b(NOMINA|SUELDO)\b', d):
            e['categoria'] = 'Nómina'
            ciudad = next((c for nom, c in CIUDADES.items() if nom in d), None)
            if ciudad:
                e['carga_a'], e['concepto'] = ciudad, d
                e['por_aclarar'], e['motivo'] = True, 'nómina de otra sucursal sin nombre de la persona'
            else:
                e['persona'], e['rol_persona'] = nombre_limpio(d), 'empleado'
                e['por_aclarar'], e['motivo'] = True, '¿a qué sucursal se le carga?'
        elif 'PRESTAMO' in d:
            e.update(tipo='prestamo', categoria=None, carga_a=None, persona=nombre_limpio(d), rol_persona='empleado')
        elif 'FLETE' in d:
            e['categoria'] = 'Fletes'
        elif 'VILLA' in d or 'BANQUETE' in d:
            e['carga_a'] = 'DIR'
        else:
            e['carga_a'], e['por_aclarar'], e['motivo'] = 'DIR', True, 'salida autorizada por HEBQ sin explicar'
        return e
    if t.startswith('NOMIN') or t.startswith('SUELDO'):
        e.update(categoria='Nómina', persona=nombre_limpio(d), rol_persona='empleado')
        if not e['persona']:
            e['por_aclarar'], e['motivo'] = True, 'nómina sin nombre'
    elif t.startswith('COMIS'):
        e.update(categoria='Comisiones', rol_persona='vendedor', persona=d)
    elif t.startswith('DESCAR') or t.startswith('GRUA'):
        e['categoria'] = 'Descarga y grúa'
    elif t.startswith('GARANT'):
        e.update(categoria='Garantías', remision=remision_de(d))
    elif t.startswith('DEP'):
        banco = banco_de(d)
        e.update(tipo='traspaso', categoria=None, carga_a=None, entra_a=banco or 'por-aclarar')
        if not banco:
            e['por_aclarar'], e['motivo'] = True, '¿a qué cuenta se depositó?'
    elif t.startswith('PRESTA'):
        e.update(tipo='prestamo', categoria=None, carga_a=None, persona=nombre_limpio(d), rol_persona='empleado')
    elif t.startswith('DEVOL'):
        e.update(tipo='devolucion', categoria=None, carga_a=None, remision=remision_de(d))
        if not e['remision']:
            e['por_aclarar'], e['motivo'] = True, 'devolución sin remisión'
    elif not t:
        # sin tipo: por la descripción (en Mazatlán "TRANSITO" viene sin tipo cada semana)
        if re.search(r'\b(TRANSITO|GRUA|DESCARGA|MANIOBRA)', d):
            e['categoria'] = 'Descarga y grúa'
    elif not t.startswith('GAST'):
        e['por_aclarar'], e['motivo'] = True, 'tipo no reconocido: ' + t[:40]
        e['concepto'] = ' · '.join(x for x in (t, d) if x)
    if e['tipo'] == 'gasto' and not e['concepto']:
        e['por_aclarar'], e['motivo'] = True, 'gasto sin descripción'
    return e


# ---------------------------------------------------------------- Personas
class Personas:
    """Busca a la persona entre las que ya existen (misma sucursal primero) o la crea."""

    def __init__(self, existentes):
        self.lista = [dict(p, clave=norm(p['nombre'])) for p in existentes]
        self.nuevas, self.agregar_tipo = {}, set()

    def vendedor_en(self, texto, suc):
        palabras = set(re.findall(r'[A-Z]+', texto))
        cand = [p for p in self.lista if 'vendedor' in p['tipos'] and p['clave'] in palabras]
        cand.sort(key=lambda p: (p.get('sucursal') != suc, -len(p['clave'])))
        return cand[0]['id'] if cand else None

    def buscar(self, nombre, suc, rol):
        if not nombre:
            return None
        clave = norm(nombre)
        for p in sorted(self.lista, key=lambda p: p.get('sucursal') != suc):
            if p['clave'] == clave:
                if rol not in p['tipos']:
                    self.agregar_tipo.add((p['id'], rol))
                return p['id']
        pid = str(uuid.uuid5(ESPACIO, suc + '|' + clave))
        if pid not in self.nuevas:
            self.nuevas[pid] = {'id': pid, 'nombre': clave, 'tipos': [rol], 'sucursal': suc}
            self.lista.append({'id': pid, 'nombre': clave, 'clave': clave, 'tipos': [rol], 'sucursal': suc})
        return pid


# ---------------------------------------------------------------- SQL
def lit(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return repr(round(v, 2)) if isinstance(v, float) else str(v)
    if isinstance(v, dt.date):
        return f"'{v.isoformat()}'"
    if isinstance(v, dict):
        return "'" + json.dumps(v, ensure_ascii=False).replace("'", "''") + "'::jsonb"
    return "'" + str(v).replace("'", "''") + "'"


INICIO = """select set_config('bma.importando','si',true);
do $$ begin
  if exists (select 1 from bma.egresos where origen = 'capturada') or exists (select 1 from bma.bitacora where tabla = 'egresos') then
    raise exception 'ya hay egresos capturados: la importación de egresos está cerrada';
  end if;
end $$;
"""


def armar(renglones, personas):
    egresos, resumen = [], collections.Counter()
    for r in renglones:
        e = acomodar(r)
        pid = None
        if e['rol_persona'] == 'vendedor':
            pid = personas.vendedor_en(e['persona'] or '', r['sucursal'])
            if not pid:
                e['por_aclarar'], e['motivo'] = True, 'comisión sin vendedor reconocido'
        elif e['persona']:
            pid = personas.buscar(e['persona'], r['sucursal'], e['rol_persona'])
        if e['tipo'] == 'gasto' and e['categoria'] == 'Nómina' and not pid and not e['por_aclarar']:
            e['por_aclarar'], e['motivo'] = True, 'nómina sin persona'
        nota = ' · '.join(([e['motivo']] if e['motivo'] else []) + r['notas']) or None
        if e['remision'] and not e['concepto']:
            e['concepto'] = r['descripcion']
        egresos.append({**e, 'persona_id': pid, 'nota': nota, 'lunes': r['lunes'], 'fecha': r.get('fecha') or r['lunes'], 'monto': r['monto'],
                        'sucursal': r['sucursal'], 'origen_ref': {'archivo': 'FImp%s-2026.xlsx' % r['sucursal'],
                                                                  'hoja': r['hoja'], 'fila': r['fila']}})
        resumen[(r['sucursal'], e['tipo'], e['categoria'] or '')] += 1
    return egresos, resumen


def sql(egresos, personas, max_bytes=800_000):
    partes, actual = [], INICIO + "delete from bma.egresos where origen = 'importada';\n"
    if personas.nuevas:
        actual += 'insert into bma.personas (id, nombre, tipos, sucursal, origen) values\n' + ',\n'.join(
            "(%s, %s, '{%s}', %s, 'importada')" % (lit(p['id']), lit(p['nombre']), ','.join(p['tipos']), lit(p['sucursal']))
            for p in personas.nuevas.values()) + '\non conflict (id) do nothing;\n'
    for pid, rol in sorted(personas.agregar_tipo):
        actual += f"update bma.personas set tipos = array_append(tipos, {lit(rol)}) where id = {lit(pid)} and not ({lit(rol)} = any(tipos));\n"
    cab = ('insert into bma.egresos (tipo, fecha, lunes, monto, sale_de, entra_a, carga_a, categoria_id, concepto, persona_id, '
           'venta_id, autorizo, nota, por_aclarar, origen, origen_ref) values\n')
    bloque = []
    for e in egresos:
        cat = f"(select id from bma.categorias_egreso where nombre = {lit(e['categoria'])})" if e['categoria'] else 'null'
        venta = ('(select id from bma.ventas where sucursal = %s and bma.num_remision(remision) = %s order by fecha desc limit 1)'
                 % (lit(e['sucursal']), lit(e['remision']))) if e['remision'] else 'null'
        fila = '(' + ', '.join([lit(e['tipo']), lit(e['fecha']), lit(e['lunes']), lit(e['monto']), lit(e['sale_de']),
                                lit(e['entra_a']), lit(e['carga_a']), cat, lit(e['concepto']), lit(e['persona_id']),
                                venta, lit(e['autorizo']), lit(e['nota']), lit(e['por_aclarar']), "'importada'",
                                lit(e['origen_ref'])]) + ')'
        prueba = actual + cab + ',\n'.join(bloque + [fila]) + ';\n'
        if len(prueba.encode('utf-8')) > max_bytes and bloque:
            partes.append(actual + cab + ',\n'.join(bloque) + ';\n')
            actual, bloque = "select set_config('bma.importando','si',true);\n", []
        bloque.append(fila)
    if bloque:
        actual += cab + ',\n'.join(bloque) + ';\n'
    partes.append(actual)
    return partes


def lote_json(egresos, personas):
    campos = ('tipo', 'fecha', 'lunes', 'monto', 'sale_de', 'entra_a', 'carga_a', 'categoria', 'concepto', 'persona_id',
              'sucursal', 'remision', 'autorizo', 'nota', 'por_aclarar', 'origen_ref')
    return {'personas': list(personas.nuevas.values()),
            'agregar_tipo': [{'id': i, 'tipo': t} for i, t in sorted(personas.agregar_tipo)],
            'egresos': [{k: e[k] for k in campos} for e in egresos]}


def main():
    renglones, saltados = [], collections.Counter()
    for suc in SUCURSALES:
        for r in leer_egresos(os.path.join(ENTRADA, f'FImp{suc}-2026.xlsx'), suc):
            if r['monto'] <= 0:
                saltados['monto cero o negativo'] += 1
                continue
            renglones.append(r)
    with open(os.path.join(SALIDA, 'personas.json'), encoding='utf-8') as f:
        personas = Personas(json.load(f))
    egresos, conteo = armar(renglones, personas)
    partes = sql(egresos, personas)
    for i, p in enumerate(partes, 1):
        with open(os.path.join(SALIDA, f'egresos-{i:02}.sql'), 'w', encoding='utf-8') as f:
            f.write(p)
    # Lo mismo en JSON para public.bma_importar_egresos (importar/subir-egresos: se sube desde el navegador)
    with open(os.path.join(SALIDA, 'egresos.json'), 'w', encoding='utf-8') as f:
        json.dump(lote_json(egresos, personas), f, ensure_ascii=False, default=str)
    lin = [f'Egresos: {len(egresos)} renglones, ${sum(e["monto"] for e in egresos):,.2f}',
           f'Por aclarar: {sum(e["por_aclarar"] for e in egresos)}',
           f'Personas nuevas: {len(personas.nuevas)}; a las que se les agrega un tipo: {len(personas.agregar_tipo)}',
           f'Saltados: {dict(saltados)}', f'Partes SQL: {len(partes)}', '']
    por_tipo = collections.Counter()
    for (suc, tipo, cat), n in sorted(conteo.items()):
        por_tipo[(tipo, cat)] += n
    lin += [f'{n:5}  {t:10} {c}' for (t, c), n in sorted(por_tipo.items())]
    lin += ['', 'Monto por sucursal y tipo:']
    sumas = collections.defaultdict(float)
    for e in egresos:
        sumas[(e['sucursal'], e['tipo'])] += e['monto']
    lin += [f'{s} {t:10} ${m:,.2f}' for (s, t), m in sorted(sumas.items())]
    motivos = collections.Counter(e['nota'].split(' · ')[0] for e in egresos if e['por_aclarar'])
    lin += ['', 'Por aclarar, por motivo:'] + [f'{n:5}  {m}' for m, n in motivos.most_common()]
    with open(os.path.join(SALIDA, 'egresos-resumen.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lin) + '\n')
    print('\n'.join(lin))


if __name__ == '__main__':
    main()
