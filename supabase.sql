-- ============================================================
--  COMANDA DIGITAL — configuração do banco de dados (versão 4)
--  Supabase > SQL Editor > New query > cole TUDO > RUN
--  Pode rodar quantas vezes quiser: nada é apagado.
-- ============================================================

create table if not exists menus (
  id text primary key,
  nome text not null,
  categorias jsonb not null default '[]'::jsonb
);

create table if not exists app_settings (
  id text primary key,
  active_menu_id text
);

create table if not exists orders (
  id text primary key,
  nome text not null,
  tipo text not null default 'local',
  horario text default '',
  status text not null default 'na_fila',
  itens jsonb not null default '[]'::jsonb,
  selections jsonb not null default '{}'::jsonb,
  observacoes text default '',
  created_at int8 not null,
  completed_at int8,
  skipped_at int8,
  edited boolean not null default false
);

create table if not exists messages (
  id text primary key,
  sender text not null,
  content text not null,
  ts int8 not null
);

-- ---- Colunas acrescentadas ao longo das versões -------------
alter table orders add column if not exists skipped_at int8;
alter table orders add column if not exists edited boolean not null default false;
-- Entregador
alter table orders add column if not exists endereco text default '';
alter table orders add column if not exists referencia text default '';
alter table orders add column if not exists ready_at int8;     -- cozinha terminou (enviou ao entregador / pronto p/ retirada)
alter table orders add column if not exists out_at int8;       -- entregador saiu
-- Pagamento
alter table orders add column if not exists pagamento text default '';       -- 'pago' | 'receber' | 'junto'
alter table orders add column if not exists valor numeric;
alter table orders add column if not exists forma_pagamento text default '';
alter table orders add column if not exists troco_para numeric;
alter table orders add column if not exists recebido_at int8;
-- NOVO (v4): acompanhamento do cliente + retirada
alter table orders add column if not exists codigo text default '';      -- código do link de acompanhamento
alter table orders add column if not exists telefone text default '';    -- WhatsApp do cliente
alter table orders add column if not exists preparo_at int8;             -- quando a cozinha começou a preparar
create index if not exists orders_codigo_idx on orders (upper(codigo));

alter table app_settings add column if not exists whatsapp_contato text default ''; -- WhatsApp mostrado ao cliente

-- Envia os valores antigos completos nos eventos de tempo real.
alter table orders replica identity full;

-- ------------------------------------------------------------
-- SEGURANÇA (v4)
-- A equipe entra com e-mail e senha (Supabase > Authentication).
-- Quem NÃO está logado (o cliente) não lê nem altera nada:
-- só consegue usar a função "acompanhar_pedidos" abaixo, que
-- devolve apenas os pedidos do código que ele tem no link.
-- ------------------------------------------------------------
alter table menus        enable row level security;
alter table app_settings enable row level security;
alter table orders       enable row level security;
alter table messages     enable row level security;

drop policy if exists p_menus    on menus;
drop policy if exists p_settings on app_settings;
drop policy if exists p_orders   on orders;
drop policy if exists p_messages on messages;

create policy p_menus    on menus        for all to authenticated using (true) with check (true);
create policy p_settings on app_settings for all to authenticated using (true) with check (true);
create policy p_orders   on orders       for all to authenticated using (true) with check (true);
create policy p_messages on messages     for all to authenticated using (true) with check (true);

-- ------------------------------------------------------------
-- Página do cliente: devolve só os pedidos daquele código.
-- ------------------------------------------------------------
create or replace function public.acompanhar_pedidos(p_codigo text)
returns json
language sql
stable
security definer
set search_path = public
as $$
  select json_build_object(
    'agora', (extract(epoch from now()) * 1000)::int8,
    'contato', coalesce((select whatsapp_contato from app_settings where id = 'singleton'), ''),
    'pedidos', coalesce((
      select json_agg(x order by x.created_at)
      from (
        select
          o.id,
          split_part(trim(o.nome), ' ', 1) as nome,
          o.tipo, o.status, o.horario, o.itens, o.endereco,
          o.pagamento, o.valor, o.forma_pagamento, o.troco_para,
          o.created_at, o.preparo_at, o.ready_at, o.out_at, o.completed_at, o.recebido_at,
          (select count(*) from orders q
             where q.status in ('na_fila', 'preparando', 'pulado')
               and q.created_at < o.created_at) as na_frente
        from orders o
        where length(trim(coalesce(p_codigo, ''))) >= 4
          and upper(o.codigo) = upper(trim(p_codigo))
      ) x
    ), '[]'::json)
  );
$$;

revoke all on function public.acompanhar_pedidos(text) from public;
grant execute on function public.acompanhar_pedidos(text) to anon, authenticated;

-- ------------------------------------------------------------
-- Tempo real (Realtime)
-- ------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='orders') then
    alter publication supabase_realtime add table orders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='messages') then
    alter publication supabase_realtime add table messages;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='menus') then
    alter publication supabase_realtime add table menus;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='app_settings') then
    alter publication supabase_realtime add table app_settings;
  end if;
end $$;

-- Pronto! Os cardápios iniciais são criados automaticamente pelo app
-- na primeira vez que ele abre.
