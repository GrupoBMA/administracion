-- Copia automática de Odoo cada noche a las 3:00 (hora de México = 9:00 UTC). Aplicada como migración "bma_odoo_copia_nocturna".
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Clave al azar que solo conocen el Vault y la copia automática; la función bma-odoo la compara con bma_odoo_cron_valido().
select vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'bma_odoo_cron', 'Clave de la copia automática de Odoo (bma-odoo)')
where not exists (select 1 from vault.secrets where name = 'bma_odoo_cron');

select cron.schedule('bma-odoo-copia', '0 9 * * *', $cron$
  select net.http_post(
    url := 'https://jlfendrdwptwmttrahre.supabase.co/functions/v1/bma-odoo',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-bma-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'bma_odoo_cron')),
    body := '{"accion":"copiar"}'::jsonb,
    timeout_milliseconds := 120000)
$cron$);
