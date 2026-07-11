-- ============================================================
--  COMANDA DIGITAL — configuração do banco de dados
--  Rode UMA vez: Supabase > SQL Editor > New query > cole tudo > RUN
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

-- Migração (para bancos criados antes desta versão): adiciona as colunas novas.
alter table orders add column if not exists skipped_at int8;
alter table orders add column if not exists edited boolean not null default false;

create table if not exists messages (
  id text primary key,
  sender text not null,
  content text not null,
  ts int8 not null
);

-- Envia os valores antigos completos nos eventos de tempo real
-- (usado para tocar o som certo quando um pedido é concluído).
alter table orders replica identity full;

-- ------------------------------------------------------------
-- Acesso liberado (ferramenta interna da igreja, sem login).
-- Qualquer pessoa com o link e a chave "anon" pode ler/escrever.
-- ------------------------------------------------------------
alter table menus        enable row level security;
alter table app_settings enable row level security;
alter table orders       enable row level security;
alter table messages     enable row level security;

drop policy if exists p_menus    on menus;
drop policy if exists p_settings on app_settings;
drop policy if exists p_orders   on orders;
drop policy if exists p_messages on messages;

create policy p_menus    on menus        for all using (true) with check (true);
create policy p_settings on app_settings for all using (true) with check (true);
create policy p_orders   on orders       for all using (true) with check (true);
create policy p_messages on messages     for all using (true) with check (true);

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
