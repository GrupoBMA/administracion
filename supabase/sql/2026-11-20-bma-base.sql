-- Base de Grupo BMA: ventas con su historial de movimientos, personas, sucursales, bitácora,
-- dudas de la importación y renglones apartados. Aplicada en Supabase como migración "bma_base" (20-nov-2026).
-- El esquema bma NO está expuesto en la API: nadie lee estas tablas directo. La app entra solo por
-- funciones public.bma_* (security definer) que revisan la sesión en bma.usuarios.

create schema if not exists bma;
revoke all on schema bma from public, anon, authenticated;

-- ---------------------------------------------------------------- Usuarios y sucursales
create table bma.usuarios (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  rol text not null check (rol in ('admin','captura')));

create table bma.sucursales (
  clave text primary key,
  nombre text not null,
  odoo_almacen text);

insert into bma.sucursales (clave, nombre, odoo_almacen) values
  ('AGS','Aguascalientes','S-AGS'), ('GDL','Guadalajara','S-WAS'), ('MAZ','Mazatlán','S-MAZ'),
  ('MLM','Morelia','S-MOR'), ('PUE','Puebla','S-PUE'), ('QRO','Querétaro','S-QRO'), ('TEP','Tepic','S-TEP'),
  ('ZAP','Zapopan','S-ZAP'), ('NAU','Naucalpan','S-NAU'), ('LPZ','La Paz','S-LPZ'), ('TIJ','Tijuana','S-TIJ');

-- ---------------------------------------------------------------- Personas, ventas y movimientos
create sequence bma.personas_numero;

create table bma.personas (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique default nextval('bma.personas_numero'),
  nombre text not null,
  tipos text[] not null check (tipos <@ array['cliente','empleado','vendedor'] and cardinality(tipos) > 0),
  telefono text,
  sucursal text references bma.sucursales(clave),
  notas text,
  origen text not null default 'capturada' check (origen in ('importada','capturada')),
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now());

create table bma.ventas (
  id uuid primary key default gen_random_uuid(),
  folio text not null unique,
  sucursal text not null references bma.sucursales(clave),
  fecha date not null,
  cliente_id uuid references bma.personas(id),
  vendedor_id uuid references bma.personas(id),
  producto text not null,
  categoria text,
  linea text not null check (linea in ('motos','pasto','otro')),
  remision text,
  factura text,
  color text,
  precio_total numeric(12,2),
  estado text not null check (estado in ('abierta','cerrada','cancelada')),
  origen text not null default 'capturada' check (origen in ('importada','capturada')),
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now());
create index ventas_sucursal_remision on bma.ventas (sucursal, remision);
create index ventas_cliente on bma.ventas (cliente_id);

create table bma.movimientos (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references bma.ventas(id) on delete restrict,
  fecha date not null,
  lunes date not null,                       -- lunes de la semana del reporte
  tipo text not null check (tipo in ('contado','anticipo','abono','liquidacion','cancelacion','entrega')),
  monto numeric(12,2) not null default 0 check (monto >= 0),
  metodo text check (metodo in ('efectivo','transferencia','tarjeta','deposito','mercado_pago','cheque')),
  cuenta text,
  confirmado_banco boolean not null default false,
  nota text,
  origen text not null default 'capturada' check (origen in ('importada','capturada')),
  origen_ref jsonb,                          -- {archivo, hoja, fila} cuando viene del Excel de Silvia
  creado_por uuid default auth.uid(),
  creado_en timestamptz not null default now());
create index movimientos_venta on bma.movimientos (venta_id);

-- Renglones del Excel que no son ventas (abonos de préstamo, movimientos de inventario)
create table bma.apartados (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('prestamo','inventario','otro')),
  sucursal text references bma.sucursales(clave),
  fecha date,
  lunes date,
  monto numeric(12,2),
  datos jsonb not null,
  origen_ref jsonb);

create table bma.dudas_importacion (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid references bma.ventas(id) on delete cascade,
  movimiento_id uuid references bma.movimientos(id) on delete cascade,
  motivo text not null check (motivo in ('sin_anticipo','varias_candidatas','sin_tipo_pago','entrega_sin_venta',
                                         'cancelada_sin_venta','vendedor_parecido','sin_remision')),
  detalle text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','resuelta')),
  resuelta_por uuid,
  resuelta_en timestamptz);

-- ---------------------------------------------------------------- Bitácora (la escribe la base, no la pantalla)
create table bma.bitacora (
  id bigint generated always as identity primary key,
  tabla text not null,
  registro_id uuid not null,
  accion text not null check (accion in ('alta','cambio','baja')),
  antes jsonb,
  despues jsonb,
  usuario uuid default auth.uid(),
  fecha timestamptz not null default now());
create index bitacora_registro on bma.bitacora (registro_id);

create function bma.anotar() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if coalesce(current_setting('bma.importando', true), '') = 'si' then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into bma.bitacora (tabla, registro_id, accion, despues) values (tg_table_name, new.id, 'alta', to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    insert into bma.bitacora (tabla, registro_id, accion, antes, despues) values (tg_table_name, new.id, 'cambio', to_jsonb(old), to_jsonb(new));
  else
    insert into bma.bitacora (tabla, registro_id, accion, antes) values (tg_table_name, old.id, 'baja', to_jsonb(old));
  end if;
  return null;
end $$;

create trigger anotar after insert or update or delete on bma.personas for each row execute function bma.anotar();
create trigger anotar after insert or update or delete on bma.ventas for each row execute function bma.anotar();
create trigger anotar after insert or update or delete on bma.movimientos for each row execute function bma.anotar();

-- ---------------------------------------------------------------- Nadie entra directo
-- RLS encendido sin políticas: aunque alguien diera permisos por error, no vería filas.
alter table bma.usuarios enable row level security;
alter table bma.sucursales enable row level security;
alter table bma.personas enable row level security;
alter table bma.ventas enable row level security;
alter table bma.movimientos enable row level security;
alter table bma.apartados enable row level security;
alter table bma.dudas_importacion enable row level security;
alter table bma.bitacora enable row level security;
revoke all on all tables in schema bma from public, anon, authenticated;
revoke all on all sequences in schema bma from public, anon, authenticated;
revoke all on all functions in schema bma from public, anon, authenticated;

-- ---------------------------------------------------------------- Funciones públicas
-- Quién soy: {nombre, rol}. Una cuenta que no está en bma.usuarios recibe 42501.
create function public.bma_sesion() returns jsonb
language plpgsql stable security definer set search_path to '' as $$
declare u bma.usuarios;
begin
  select * into u from bma.usuarios where user_id = (select auth.uid());
  if not found then
    raise exception 'Esta cuenta no tiene acceso a la administración' using errcode = '42501';
  end if;
  return jsonb_build_object('nombre', u.nombre, 'rol', u.rol);
end $$;
revoke all on function public.bma_sesion() from public, anon;
grant execute on function public.bma_sesion() to authenticated;

-- Borra lo importado para volver a correr la importación. Solo mientras no haya nada capturado
-- a mano ni cambios de usuarios en la bitácora. Solo se corre como postgres desde la carga.
create function public.bma_borrar_importado() returns jsonb
language plpgsql security definer set search_path to '' as $$
declare dd int; ap int; mo int; ve int; pe int;
begin
  if exists (select 1 from bma.ventas where origen = 'capturada')
     or exists (select 1 from bma.movimientos where origen = 'capturada')
     or exists (select 1 from bma.personas where origen = 'capturada')
     or exists (select 1 from bma.bitacora) then
    raise exception 'ya hay captura: la importación está cerrada';
  end if;
  perform set_config('bma.importando', 'si', true);
  delete from bma.dudas_importacion where true; get diagnostics dd = row_count;
  delete from bma.apartados where true; get diagnostics ap = row_count;
  delete from bma.movimientos where origen = 'importada'; get diagnostics mo = row_count;
  delete from bma.ventas where origen = 'importada'; get diagnostics ve = row_count;
  delete from bma.personas where origen = 'importada'; get diagnostics pe = row_count;
  return jsonb_build_object('dudas', dd, 'apartados', ap, 'movimientos', mo, 'ventas', ve, 'personas', pe);
end $$;
revoke all on function public.bma_borrar_importado() from public, anon, authenticated;
