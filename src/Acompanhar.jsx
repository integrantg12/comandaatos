import { useState, useEffect, useRef } from "react";
import { supabase, isConfigured } from "./supabaseClient";

/* ==================================================================
   PÁGINA DO CLIENTE — acompanhamento do pedido em tempo real
   Endereço:  https://SEU-SITE/?p=CÓDIGO
   O cliente NÃO tem acesso a nada além disto: a página só chama a
   função "acompanhar_pedidos", que devolve os pedidos daquele código.
   ================================================================== */

const VINHO = "#c8102e";
const VINHO_ESCURO = "#9b0c23";
const ATUALIZA_MS = 8000;

const pad2 = (n) => String(n).padStart(2, "0");
const hm = (ts) => { if (!ts) return ""; const d = new Date(Number(ts)); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const fmtBRL = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const FORMAS = { dinheiro: "Dinheiro", pix: "Pix", cartao_debito: "Cartão de débito", cartao_credito: "Cartão de crédito" };
const limpaCodigo = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
const foneWhats = (tel) => { const d = String(tel || "").replace(/\D/g, ""); if (!d) return ""; return d.length <= 11 ? "55" + d : d; };

/* Etapas que o cliente vê, por tipo de pedido. */
const ETAPAS = {
  entrega:  ["Recebido", "Preparando", "Pronto", "A caminho", "Entregue"],
  retirada: ["Recebido", "Preparando", "Pronto p/ retirar", "Retirado"],
  local:    ["Recebido", "Preparando", "Pronto"],
};
const TIPO_TXT = { entrega: "🛵 Entrega em domicílio", retirada: "🛍️ Retirada na igreja", local: "🍽️ Refeição na igreja" };

function etapaAtual(p) {
  const st = p.status;
  if (st === "na_fila" || st === "pulado") return 0;
  if (st === "preparando") return 1;
  if (st === "aguardando_entrega" || st === "pronto_retirada") return 2;
  if (st === "em_rota") return 3;
  if (st === "concluido") return (ETAPAS[p.tipo] || ETAPAS.local).length - 1;
  return 0;
}
function horaEtapa(p, i) {
  const tipo = p.tipo in ETAPAS ? p.tipo : "local";
  if (i === 0) return p.created_at;
  if (i === 1) return p.preparo_at;
  if (tipo === "local") return p.completed_at;
  if (i === 2) return p.ready_at;
  if (tipo === "retirada") return p.completed_at;
  if (i === 3) return p.out_at;
  return p.completed_at;
}

/* Título grande + explicação, em linguagem simples. */
function situacao(p) {
  const st = p.status;
  const tipo = p.tipo;
  if (st === "cancelado") return { emoji: "❌", titulo: "Pedido cancelado", texto: "Este pedido foi cancelado. Se tiver alguma dúvida, fale com a gente.", cor: "#64748b" };
  if (st === "na_fila" || st === "pulado") {
    let texto = "Seu pedido já está na fila da cozinha.";
    if (p.horario) texto += ` Programado para as ${p.horario}.`;
    else if (p.na_frente > 0) texto += ` Há ${p.na_frente} pedido${p.na_frente > 1 ? "s" : ""} na sua frente.`;
    else texto += " Você é o próximo!";
    return { emoji: "📝", titulo: "Pedido recebido!", texto, cor: "#2563eb" };
  }
  if (st === "preparando") return { emoji: "👩‍🍳", titulo: "Preparando seu pedido", texto: "A cozinha já está preparando sua comida com carinho.", cor: "#ea580c" };
  if (st === "aguardando_entrega") return { emoji: "📦", titulo: "Pedido pronto!", texto: "Está pronto e logo sai para entrega.", cor: "#7c3aed" };
  if (st === "em_rota") return { emoji: "🛵", titulo: "Saiu para entrega!", texto: "O entregador está a caminho. Fique atento(a) ao portão e ao telefone.", cor: "#7c3aed" };
  if (st === "pronto_retirada") return { emoji: "🛍️", titulo: "Pronto para retirar!", texto: "Pode vir buscar na igreja. É só dizer o seu nome no balcão.", cor: "#0d9488" };
  if (st === "concluido") {
    if (tipo === "entrega") return { emoji: "✅", titulo: "Pedido entregue!", texto: "Bom apetite! Obrigado pela preferência. 🙏", cor: "#16a34a" };
    if (tipo === "retirada") return { emoji: "✅", titulo: "Pedido retirado!", texto: "Bom apetite! Obrigado pela preferência. 🙏", cor: "#16a34a" };
    return { emoji: "🍽️", titulo: "Seu prato está pronto!", texto: "Bom apetite! Obrigado pela preferência. 🙏", cor: "#16a34a" };
  }
  return { emoji: "⏳", titulo: "Acompanhando…", texto: "", cor: "#64748b" };
}

function pagamentoTexto(p) {
  if (p.tipo !== "entrega" && p.tipo !== "retirada") return "";
  if (p.recebido_at && p.valor) return `Pago: ${fmtBRL(p.valor)} (${FORMAS[p.forma_pagamento] || "—"}). Obrigado!`;
  if (p.pagamento === "pago") return "Pagamento já confirmado. ✓";
  if (p.pagamento === "junto") return "O pagamento está junto com o seu outro pedido.";
  if (p.pagamento === "receber" && p.valor) {
    let t = `${p.tipo === "entrega" ? "Pagar na entrega" : "Pagar na retirada"}: ${fmtBRL(p.valor)} · ${FORMAS[p.forma_pagamento] || ""}`;
    if (p.forma_pagamento === "dinheiro" && p.troco_para && p.troco_para > p.valor) t += ` (troco para ${fmtBRL(p.troco_para)})`;
    return t;
  }
  return "";
}

function Linha({ etapas, atual, pedido, cor, cancelado }) {
  return (
    <ol className="mt-4 space-y-0">
      {etapas.map((nome, i) => {
        const feito = !cancelado && i < atual;
        const agora = !cancelado && i === atual;
        const final = i === etapas.length - 1;
        const done = feito || (agora && final);
        const hora = (feito || agora) ? hm(horaEtapa(pedido, i)) : "";
        return (
          <li key={i} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={"rounded-full flex items-center justify-center text-sm font-extrabold shrink-0 " + (agora && !final ? "animate-pulse" : "")}
                style={{ width: 30, height: 30, backgroundColor: done || agora ? cor : "#e2e8f0", color: done || agora ? "#fff" : "#94a3b8", boxShadow: agora && !final ? `0 0 0 5px ${cor}33` : "none" }}>
                {done ? "✓" : i + 1}
              </div>
              {!final && <div style={{ width: 3, flex: 1, minHeight: 18, backgroundColor: feito ? cor : "#e2e8f0" }} />}
            </div>
            <div className="pb-3 flex-1 flex items-start justify-between gap-2" style={{ paddingTop: 4 }}>
              <span className={"text-base " + (agora ? "font-extrabold text-slate-900" : feito ? "font-semibold text-slate-700" : "text-slate-400")}>{nome}</span>
              {hora && <span className="text-sm text-slate-500 font-semibold">{hora}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function PedidoCard({ p, idx, total, destaque }) {
  const s = situacao(p);
  const etapas = ETAPAS[p.tipo] || ETAPAS.local;
  const atual = etapaAtual(p);
  const pg = pagamentoTexto(p);
  const itens = Array.isArray(p.itens) ? p.itens : [];
  return (
    <div className={"rounded-3xl bg-white shadow-sm overflow-hidden transition-all " + (destaque ? "ring-4" : "")} style={destaque ? { "--tw-ring-color": s.cor + "66" } : {}}>
      <div className="px-5 pt-5 pb-4 text-white" style={{ backgroundColor: s.cor }}>
        {total > 1 && <div className="text-xs font-bold uppercase tracking-wider opacity-80 mb-1">Pedido {idx + 1} de {total}</div>}
        <div className="flex items-center gap-3">
          <div className="text-5xl leading-none">{s.emoji}</div>
          <div className="min-w-0">
            <div className="text-2xl font-extrabold leading-tight">{s.titulo}</div>
            <div className="text-sm font-semibold opacity-95 mt-1 leading-snug">{s.texto}</div>
          </div>
        </div>
      </div>

      <div className="px-5 pb-5">
        <Linha etapas={etapas} atual={atual} pedido={p} cor={s.cor} cancelado={p.status === "cancelado"} />

        <div className="flex flex-wrap gap-2 mt-1">
          <span className="rounded-full bg-slate-100 text-slate-700 text-sm font-semibold px-3 py-1">{TIPO_TXT[p.tipo] || TIPO_TXT.local}</span>
          {p.horario && <span className="rounded-full bg-slate-100 text-slate-700 text-sm font-semibold px-3 py-1">🕐 {p.horario}</span>}
        </div>

        {pg && (
          <div className="mt-3 rounded-2xl bg-amber-50 border-2 border-amber-200 px-4 py-3 text-base font-bold text-amber-900">💳 {pg}</div>
        )}

        {itens.length > 0 && (
          <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3">
            <div className="text-xs font-bold uppercase tracking-wide text-slate-500 mb-1">O que você pediu</div>
            {itens.map((g, i) => (
              <div key={i} className="text-base text-slate-800 leading-snug">
                <span className="text-slate-500">{g.categoria}:</span> {(g.valores || []).join(", ")}
              </div>
            ))}
          </div>
        )}

        {p.tipo === "entrega" && p.endereco && (
          <div className="mt-3 text-sm text-slate-600">📍 <b>Endereço:</b> {p.endereco}</div>
        )}
      </div>
    </div>
  );
}

export default function Acompanhar({ codigoInicial }) {
  const [codigo, setCodigo] = useState(limpaCodigo(codigoInicial));
  const [digitado, setDigitado] = useState("");
  const [dados, setDados] = useState(null);     // { pedidos, contato }
  const [erro, setErro] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState(null);
  const [aviso, setAviso] = useState(null);     // banner de mudança
  const [mudouId, setMudouId] = useState(null);
  const anterior = useRef({});
  const primeira = useRef(true);

  useEffect(() => { document.title = "Acompanhe seu pedido · Almoço Atos"; }, []);

  useEffect(() => {
    if (!codigo || !isConfigured) return;
    let vivo = true;
    let timer;
    const buscar = async () => {
      const { data, error } = await supabase.rpc("acompanhar_pedidos", { p_codigo: codigo });
      if (!vivo) return;
      if (error) { setErro(true); return; }
      setErro(false);
      const pedidos = (data && data.pedidos) || [];
      /* Avisa quando a situação de algum pedido muda. */
      if (!primeira.current) {
        for (const p of pedidos) {
          const antes = anterior.current[p.id];
          if (antes && antes !== p.status) {
            const s = situacao(p);
            setAviso(`${s.emoji} ${s.titulo}`);
            setMudouId(p.id);
            try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* ignore */ }
            setTimeout(() => { setAviso(null); setMudouId(null); }, 6000);
            break;
          }
        }
      }
      primeira.current = false;
      anterior.current = Object.fromEntries(pedidos.map((p) => [p.id, p.status]));
      setDados({ pedidos, contato: (data && data.contato) || "" });
      setAtualizadoEm(Date.now());
    };
    const agendar = () => { timer = setTimeout(async () => { await buscar(); if (vivo) agendar(); }, ATUALIZA_MS); };
    buscar().then(agendar);
    /* Ao voltar para a tela (ex: depois de usar o WhatsApp), atualiza na hora. */
    const onVis = () => { if (document.visibilityState === "visible") buscar(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { vivo = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); };
  }, [codigo]);

  const pedidos = dados ? dados.pedidos : [];
  const ativos = pedidos.filter((p) => p.status !== "cancelado");
  const nome = (pedidos[0] && pedidos[0].nome) || "";
  const contato = dados ? foneWhats(dados.contato) : "";
  const todosProntos = ativos.length > 0 && ativos.every((p) => p.status === "concluido");

  const irPara = (c) => {
    const lc = limpaCodigo(c);
    if (lc.length < 4) return;
    window.history.replaceState(null, "", `/?p=${lc}`);
    anterior.current = {}; primeira.current = true;
    setDados(null); setCodigo(lc);
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#f6f1f1" }}>
      <header className="text-white px-5 pt-6 pb-10" style={{ background: `linear-gradient(135deg, ${VINHO_ESCURO}, ${VINHO})` }}>
        <div className="max-w-md mx-auto">
          <div className="text-sm font-bold opacity-80">🍽️ Almoço Atos · Ministério Atos</div>
          <h1 className="text-3xl font-extrabold mt-1 leading-tight">{nome ? `Olá, ${nome}!` : "Acompanhe seu pedido"}</h1>
          {dados && pedidos.length > 0 && (
            <p className="text-base font-semibold opacity-90 mt-1">
              {todosProntos ? "Tudo certo com seu pedido. 🙏" : pedidos.length > 1 ? `Você tem ${pedidos.length} pedidos. Veja cada um abaixo.` : "Veja abaixo em que etapa está o seu pedido."}
            </p>
          )}
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 -mt-6 pb-28 space-y-4">
        {aviso && (
          <div className="sticky top-3 z-10 rounded-2xl text-white font-extrabold text-lg px-5 py-4 shadow-lg text-center" style={{ backgroundColor: "#0f172a" }}>
            Atualização: {aviso}
          </div>
        )}

        {!codigo && (
          <div className="rounded-3xl bg-white shadow-sm p-5">
            <p className="text-base text-slate-700">Digite o código que você recebeu:</p>
          </div>
        )}

        {codigo && !dados && !erro && (
          <div className="rounded-3xl bg-white shadow-sm p-8 text-center text-slate-500 font-semibold">Buscando seu pedido…</div>
        )}

        {codigo && erro && !dados && (
          <div className="rounded-3xl bg-white shadow-sm p-6 text-center">
            <div className="text-4xl">📶</div>
            <p className="mt-2 text-base font-semibold text-slate-700">Sem conexão no momento. Vamos tentar de novo sozinhos…</p>
          </div>
        )}

        {dados && pedidos.length === 0 && (
          <div className="rounded-3xl bg-white shadow-sm p-6">
            <div className="text-5xl text-center">⏳</div>
            <h2 className="text-xl font-extrabold text-slate-900 text-center mt-2">Ainda não encontramos seu pedido</h2>
            <p className="mt-2 text-base text-slate-600 leading-relaxed">
              Se você <b>acabou de pedir</b>, fique tranquilo(a): assim que nossa equipe registrar o pedido,
              ele aparece aqui sozinho. <b>Deixe esta página aberta</b> ou volte daqui a pouco pelo mesmo link.
            </p>
            <div className="mt-3 rounded-xl bg-slate-100 px-4 py-2 text-center text-slate-600 text-sm">Seu código: <b className="font-mono tracking-widest">{codigo}</b></div>
          </div>
        )}

        {pedidos.map((p, i) => <PedidoCard key={p.id} p={p} idx={i} total={pedidos.length} destaque={mudouId === p.id} />)}

        {dados && (
          <div className="text-center text-sm text-slate-500 flex items-center justify-center gap-2">
            <span className="inline-block rounded-full animate-pulse" style={{ width: 9, height: 9, backgroundColor: erro ? "#f59e0b" : "#16a34a" }} />
            {erro ? "Reconectando…" : `Ao vivo · atualizado às ${atualizadoEm ? new Date(atualizadoEm).toLocaleTimeString("pt-BR") : ""}`}
          </div>
        )}

        <form onSubmit={(e) => { e.preventDefault(); irPara(digitado); setDigitado(""); }} className="rounded-3xl bg-white shadow-sm p-4">
          <div className="text-sm font-bold text-slate-600 mb-2">{codigo ? "Tem outro código?" : "Código do pedido"}</div>
          <div className="flex gap-2">
            <input value={digitado} onChange={(e) => setDigitado(e.target.value.toUpperCase())} placeholder="Ex: K7P2QX" autoCapitalize="characters"
              className="flex-1 rounded-xl border-2 border-slate-200 px-4 text-lg font-mono tracking-widest outline-none" style={{ minHeight: 52 }} />
            <button type="submit" className="rounded-xl text-white font-bold px-5" style={{ backgroundColor: VINHO }}>Ver</button>
          </div>
        </form>

        <p className="text-center text-xs text-slate-400 px-6">Dica: guarde este link. Ele mostra todos os seus pedidos de hoje e se atualiza sozinho.</p>
      </main>

      {contato && (
        <div className="fixed left-0 right-0 bottom-0 p-3" style={{ background: "linear-gradient(to top, #f6f1f1 60%, transparent)" }}>
          <a href={`https://wa.me/${contato}?text=${encodeURIComponent(`Olá! Tenho uma dúvida sobre meu pedido (código ${codigo}).`)}`}
            target="_blank" rel="noopener noreferrer"
            className="max-w-md mx-auto rounded-2xl bg-green-600 text-white font-extrabold text-lg flex items-center justify-center gap-2 shadow-lg" style={{ minHeight: 56 }}>
            💬 Falar com a gente no WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}
