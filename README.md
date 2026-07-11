# 🍴 Comanda Digital — Guia GitHub + Vercel (sem terminal)

Este caminho **não exige instalar nada** no seu computador (nem Node, nem terminal).
Você vai só clicar e colar. Ao final, terá um **link fixo** para os celulares e, sempre que
quiser mudar algo, o site **se atualiza sozinho**.

> Como funciona, em uma frase: o **Supabase** guarda os pedidos e faz a sincronização
> **em tempo real entre todos os aparelhos**; o **GitHub + Vercel** hospedam o app num link
> fixo e o atualizam automaticamente quando você mexe em algo.

Faça as partes **na ordem**. Leva ~15 minutos na primeira vez.

---

## PARTE 1 — Banco de dados (Supabase)  ⏱️ ~5 min

1. Acesse **https://supabase.com** → **Start your project** → crie a conta (pode usar o Google).
2. **New project** → dê um nome (ex: `comanda-igreja`), crie uma senha e, se pedir região,
   escolha **South America (São Paulo)**. Clique em **Create new project** e espere ~2 min.
3. No menu à esquerda, abra **SQL Editor** → **New query**.
4. Abra o arquivo **`supabase.sql`** (está dentro do projeto), **selecione tudo, copie e cole**
   na caixa. Clique em **Run** (canto inferior direito). Deve aparecer **Success**.
5. Agora pegue as chaves: clique na engrenagem **Project Settings** → **API**. Deixe esta aba
   aberta; você vai copiar dois valores daqui na PARTE 3:
   - **Project URL** (ex: `https://abcdefg.supabase.co`)
   - **anon public** (chave longa que começa com `eyJ...`)

---

## PARTE 2 — Subir o app no GitHub  ⏱️ ~5 min

1. Acesse **https://github.com** e crie uma conta gratuita (se ainda não tiver).
2. No canto superior direito, clique no **+** → **New repository**.
3. Em **Repository name** digite `comanda-igreja`. Deixe em **Public** (ou Private, tanto faz)
   e clique em **Create repository**.
4. Na tela seguinte, clique no link **“uploading an existing file”**
   (fica no meio da página, na frase "…or push an existing repository…").
5. **Descompacte** o arquivo `comanda-app.zip` no seu computador. Abra a pasta `comanda-app`.
6. **Selecione TUDO que está DENTRO dessa pasta** (os arquivos + a pasta `src`) e **arraste**
   para a área de upload do GitHub.
   > Importante: arraste o **conteúdo de dentro** da pasta, não a pasta inteira. O arquivo
   > `package.json` precisa ficar na "raiz" do repositório.
7. Espere os arquivos aparecerem na lista e clique no botão verde **Commit changes**.

---

## PARTE 3 — Colar as chaves do Supabase  ⏱️ ~2 min

Isso você faz **direto no site do GitHub**, sem baixar nada:

1. No seu repositório, entre na pasta **`src`** e clique no arquivo **`config.js`**.
2. Clique no ícone de **lápis** (✏️ "Edit this file"), no canto superior direito do arquivo.
3. Substitua os dois valores de exemplo pelos seus (da PARTE 1, passo 5). Mantenha as aspas:
   ```js
   export const SUPABASE_URL = "https://abcdefg.supabase.co";
   export const SUPABASE_ANON_KEY = "eyJ...sua_chave_anon...";
   ```
4. Clique em **Commit changes** para salvar.

---

## PARTE 4 — Publicar na Vercel (gera o link)  ⏱️ ~3 min

1. Acesse **https://vercel.com** → **Sign Up** → escolha **Continue with GitHub**
   (assim ela já enxerga seu projeto). Autorize quando pedir.
2. No painel, clique em **Add New…** → **Project**.
3. Encontre o repositório **`comanda-igreja`** na lista e clique em **Import**.
4. Não precisa mexer em nada (a Vercel reconhece o Vite sozinha). Clique em **Deploy**.
5. Aguarde ~1 minuto. Vai aparecer **“Congratulations”** e um link como
   **`https://comanda-igreja.vercel.app`**. **Esse é o link do app!** 🎉

> ⚠️ Se por acaso der erro de build dizendo que não achou o `package.json`: você provavelmente
> subiu a pasta inteira em vez do conteúdo dela. Na Vercel, vá em **Settings → General →
> Root Directory**, clique em **Edit**, escolha a pasta `comanda-app` e salve. Depois
> **Deployments → ⋯ → Redeploy**.

---

## PARTE 5 — Instalar nos celulares  ⏱️ ~1 min por aparelho

1. Abra o **link da Vercel** no navegador do celular (Chrome no Android, Safari no iPhone).
2. Menu do navegador → **“Adicionar à tela inicial”**. Vira um ícone como um app, em tela cheia.
3. Cada trabalhadora abre o mesmo link. O atendente deixa na aba **Atendente**; a cozinha, na aba **Cozinha**.

> **Som:** por regra dos navegadores, o alerta sonoro só toca **depois do primeiro toque** na
> tela. Peça para tocarem uma vez ao abrir (ex: trocar de aba e voltar).

---

## 🔄 Como atualizar o app depois (fica automático!)

Sempre que quiser mudar algo (ex: trocar as chaves, ajustar um texto): edite o arquivo pelo
**site do GitHub** (lápis ✏️ → Commit). A **Vercel republica sozinha** em 1–2 minutos e o link
continua o mesmo. Não precisa refazer nada.

E os cardápios do dia a dia você muda **dentro do próprio app**, na engrenagem ⚙️ (Administração) —
isso é instantâneo e não mexe no código.

---

## 📋 Uso no dia a dia

- **⚙️ Administração:** antes do almoço, escolha o cardápio do dia (**Usar**) ou edite os itens.
  Dá para ter vários (Domingo, Quarta…) e alternar em 1 toque.
- **Atendente:** cria os pedidos (nome, Local/Entrega, horário, itens). Pode **Repetir** um pedido
  e **Cancelar** os que ainda não foram concluídos.
- **Cozinha:** vê a fila ("para agora" primeiro, agendados depois), **Prepara**, **Pula** e **Conclui**
  (com botão **Desfazer**). Ao fim do dia, aba **Entregues → Limpar histórico**.

---

## 🔒 Segurança

O app não tem senha: quem tem o link acessa. Para uma igreja costuma bastar — só **não divulgue
o link publicamente**. Se quiser um **PIN de acesso** depois, dá para adicionar. A chave "anon"
ficar visível é **normal** no Supabase; a proteção vem das regras que o `supabase.sql` cria.

---

## 🛠️ Deu problema?

- **App abre com "Falta configurar o Supabase":** as chaves em `src/config.js` não foram
  preenchidas (PARTE 3) ou ficaram com o texto de exemplo. Edite e faça Commit.
- **"Erro de conexão" na tela:** confira se o `supabase.sql` foi executado por completo (PARTE 1,
  passo 4) e se as chaves estão certas, sem espaços sobrando.
- **Um aparelho não vê o pedido do outro:** confirme que ambos abriram o **mesmo link** e têm internet.
- **Erro na Vercel sobre `package.json`:** veja o aviso ⚠️ da PARTE 4 (Root Directory).

Se travar em algum ponto, me diga **em qual parte e passo** e o que apareceu na tela — eu te destravo.
