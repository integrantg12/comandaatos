import { useState, useRef, useEffect } from "react";
import {
  Utensils, ChefHat, User, Settings, Volume2, VolumeX, MessageSquare, Send, X, Check,
  SkipForward, RotateCcw, CheckCircle2, AlertTriangle, Clock, Timer, Trash2, Undo2,
  ClipboardList, Plus, Bell, Copy, Home, Bike, Star, Save, WifiOff,
  MapPin, Navigation, Coffee, Package, Wallet, Banknote,
} from "lucide-react";
import { supabase, isConfigured } from "./supabaseClient";

/* ================================================================== */
/*  Utilitários                                                        */
/* ================================================================== */

const STATUS = {
  na_fila:    { label: "Na Fila",    classes: "bg-slate-200 text-slate-700" },
  preparando: { label: "Preparando", classes: "bg-blue-100 text-blue-700" },
  pulado:     { label: "Pulado",     classes: "bg-amber-100 text-amber-800" },
  aguardando_entrega: { label: "Com o entregador", classes: "bg-purple-100 text-purple-700" },
  em_rota:    { label: "Saiu p/ entrega", classes: "bg-purple-600 text-white" },
  concluido:  { label: "Concluído",  classes: "bg-green-100 text-green-700" },
  cancelado:  { label: "Cancelado",  classes: "bg-red-100 text-red-600" },
};

const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
const pad2 = (n) => String(n).padStart(2, "0");
const nowHHMM = (offsetMin = 0) => {
  const d = new Date(Date.now() + offsetMin * 60000);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

function relTime(ts, nowTs) {
  const s = Math.max(0, Math.floor((nowTs - ts) / 1000));
  if (s < 45) return "agora";
  const min = Math.floor(s / 60);
  if (min < 1) return "há menos de 1 min";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return `há ${h}h${min % 60 ? ` ${min % 60}min` : ""}`;
}

function targetTs(o, nowTs) {
  if (o.horario) {
    const [h, m] = o.horario.split(":").map(Number);
    const d = new Date(nowTs);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }
  return o.createdAt;
}

function horarioInfo(o, nowTs) {
  if (!o.horario) return null;
  const diffMin = Math.round((targetTs(o, nowTs) - nowTs) / 60000);
  let level = "agendado";
  if (diffMin <= 10) level = "urgente";
  else if (diffMin <= 30) level = "breve";
  return { time: o.horario, diffMin, level };
}

const isProteinCat = (nome) => /prote|mistura/i.test(nome || "");

/* ---- Bebidas -------------------------------------------------------
   Detecta a categoria de bebida pelo nome (funciona com cardápios
   personalizados: "Bebida", "Bebidas", "Refrigerantes", "Sucos"...). */
const isBebidaCat = (nome) => /bebid|refri|suco|drink|liquid/i.test(nome || "");

/* Lista as bebidas marcadas no pedido (ex: ["Refri (Coca)", "Guaravita"]). */
function bebidasDoPedido(order) {
  const out = [];
  (order.itens || []).forEach((g) => { if (isBebidaCat(g.categoria)) g.valores.forEach((v) => out.push(v)); });
  return out;
}
const temBebida = (order) => bebidasDoPedido(order).length > 0;

/* ---- Entrega ------------------------------------------------------- */
const ENTREGA_STATUS = ["aguardando_entrega", "em_rota"];
const isEntregaAtiva = (o) => ENTREGA_STATUS.includes(o.status);

const enderecoCompleto = (o) => {
  const e = (o.endereco || "").trim();
  const r = (o.referencia || "").trim();
  if (!e) return r;
  return r ? `${e} — ${r}` : e;
};
/* Só o endereço vai para a rota; a referência atrapalharia o mapa. */
const mapsUrl = (o) =>
  `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent((o.endereco || "").trim())}`;
const wazeUrl = (o) =>
  `https://www.waze.com/ul?navigate=yes&q=${encodeURIComponent((o.endereco || "").trim())}`;

/* ---- Pagamento (entregas) ------------------------------------------
   pagamento: "pago" (já pago, nada a cobrar) | "receber" (cobrar na entrega)
   Para "receber": valor, forma e, se for dinheiro, "troco para" (opcional). */
const FORMAS_PAGAMENTO = [
  { id: "dinheiro", label: "Dinheiro" },
  { id: "pix", label: "Pix" },
  { id: "cartao_debito", label: "Cartão débito" },
  { id: "cartao_credito", label: "Cartão crédito" },
];
const formaLabel = (id) => (FORMAS_PAGAMENTO.find((f) => f.id === id) || { label: "" }).label;

/* Aceita "35", "35,50", "R$ 1.234,50" ou "35.50". Retorna null se inválido. */
function parseValor(txt) {
  let t = String(txt == null ? "" : txt).replace(/R\$|\s/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
const fmtBRL = (n) => Number(n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const valorParaInput = (n) => (n == null ? "" : Number(n).toFixed(2).replace(".", ","));

const aReceber = (o) => o.tipo === "entrega" && o.pagamento === "receber" && o.valor > 0;
const trocoDe = (o) => (aReceber(o) && o.formaPagamento === "dinheiro" && o.trocoPara > o.valor ? o.trocoPara - o.valor : 0);

/* Texto curto do pagamento (cards do atendente e relatório). */
function pagamentoResumo(o) {
  if (o.tipo !== "entrega") return "";
  if (o.pagamento === "pago") return "Já pago";
  if (aReceber(o)) {
    let t = `${o.recebidoAt ? "Recebido" : "Receber"} ${fmtBRL(o.valor)} · ${formaLabel(o.formaPagamento)}`;
    if (trocoDe(o)) t += ` (troco p/ ${fmtBRL(o.trocoPara)})`;
    return t;
  }
  return "Pagamento não informado";
}

function copiarTexto(txt, onOk) {
  const done = () => { if (onOk) onOk(); };
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(done).catch(() => done());
      return;
    }
  } catch (e) { /* ignore */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (e) { /* ignore */ }
  done();
}

function resolveItens(menu, selections) {
  if (!menu) return [];
  return menu.categorias
    .map((cat) => {
      const valores = [];
      cat.itens.forEach((item) => {
        const sel = selections && selections[cat.id] && selections[cat.id][item.id];
        if (!sel || !sel.on) return;
        if (item.tipo === "variacoes" && item.variacoes && item.variacoes.length) {
          valores.push(`${item.label} — ${sel.variant || item.variacoes[0]}`);
        } else if (item.tipo === "texto") {
          const t = sel.text && sel.text.trim();
          valores.push(`${item.label}${t ? ` (${t})` : ""}`);
        } else {
          valores.push(item.label);
        }
      });
      return { categoria: cat.nome, valores, destaque: isProteinCat(cat.nome), bebida: isBebidaCat(cat.nome) };
    })
    .filter((g) => g.valores.length);
}

function flatSummary(order) {
  const s = (order.itens || []).map((g) => g.valores.join(", ")).filter(Boolean).join(" · ");
  return s || "Pedido sem itens marcados";
}

/* Cardápios padrão (criados no banco na 1ª execução) */
function defaultMenu() {
  return {
    id: "menu_padrao",
    nome: "Cardápio de Domingo",
    categorias: [
      { id: "cat_guarnicao", nome: "Guarnição base", itens: [
        { id: "i_arroz", label: "Arroz", tipo: "simples" },
        { id: "i_feijao", label: "Feijão", tipo: "simples" },
        { id: "i_macarrao", label: "Macarrão", tipo: "simples" },
        { id: "i_farofa", label: "Farofa", tipo: "simples" },
      ] },
      { id: "cat_acomp", nome: "Acompanhamentos", itens: [
        { id: "i_salada", label: "Salada verde", tipo: "simples" },
        { id: "i_legumes", label: "Legumes", tipo: "simples" },
        { id: "i_fritas", label: "Fritas", tipo: "simples" },
        { id: "i_outra_ac", label: "Outra", tipo: "texto", placeholder: "Especifique o acompanhamento" },
      ] },
      { id: "cat_mistura", nome: "Mistura (proteína)", itens: [
        { id: "i_pratododia", label: "Prato do Dia", tipo: "simples" },
        { id: "i_file", label: "Filé de frango", tipo: "variacoes", variacoes: ["Grelhado", "Empanado"] },
        { id: "i_outro_mist", label: "Outro", tipo: "texto", placeholder: "Especifique a proteína" },
      ] },
      { id: "cat_bebida", nome: "Bebida", itens: [
        { id: "i_refri", label: "Refri", tipo: "texto", placeholder: "Sabor (ex: Coca, Guaraná)" },
        { id: "i_guaravita", label: "Guaravita", tipo: "simples" },
        { id: "i_outra_beb", label: "Outra", tipo: "texto", placeholder: "Especifique a bebida" },
      ] },
    ],
  };
}
function feijoadaMenu() {
  return {
    id: "menu_quarta",
    nome: "Cardápio de Quarta (Feijoada)",
    categorias: [
      { id: "c_base", nome: "Guarnição base", itens: [
        { id: "a1", label: "Arroz", tipo: "simples" },
        { id: "a2", label: "Feijão", tipo: "simples" },
        { id: "a3", label: "Farofa", tipo: "simples" },
        { id: "a4", label: "Couve refogada", tipo: "simples" },
      ] },
      { id: "c_ac", nome: "Acompanhamentos", itens: [
        { id: "b1", label: "Laranja", tipo: "simples" },
        { id: "b2", label: "Vinagrete", tipo: "simples" },
        { id: "b3", label: "Torresmo", tipo: "simples" },
      ] },
      { id: "c_prot", nome: "Mistura (proteína)", itens: [
        { id: "d1", label: "Feijoada completa", tipo: "simples" },
        { id: "d2", label: "Linguiça", tipo: "simples" },
        { id: "d3", label: "Outro", tipo: "texto", placeholder: "Especifique" },
      ] },
      { id: "c_beb", nome: "Bebida", itens: [
        { id: "e1", label: "Refri", tipo: "texto", placeholder: "Sabor" },
        { id: "e2", label: "Guaravita", tipo: "simples" },
        { id: "e3", label: "Suco de laranja", tipo: "simples" },
      ] },
    ],
  };
}

/* Conversão entre app (camelCase) e banco (snake_case) */
const orderFromRow = (r) => ({
  id: r.id, nome: r.nome, tipo: r.tipo, horario: r.horario || "", status: r.status,
  itens: r.itens || [], selections: r.selections || {}, observacoes: r.observacoes || "",
  createdAt: Number(r.created_at), completedAt: r.completed_at != null ? Number(r.completed_at) : null,
  skippedAt: r.skipped_at != null ? Number(r.skipped_at) : null, edited: !!r.edited,
  endereco: r.endereco || "", referencia: r.referencia || "",
  readyAt: r.ready_at != null ? Number(r.ready_at) : null,
  outAt: r.out_at != null ? Number(r.out_at) : null,
  pagamento: r.pagamento || "", valor: r.valor != null ? Number(r.valor) : null,
  formaPagamento: r.forma_pagamento || "", trocoPara: r.troco_para != null ? Number(r.troco_para) : null,
  recebidoAt: r.recebido_at != null ? Number(r.recebido_at) : null,
});
const orderToRow = (o) => ({
  id: o.id, nome: o.nome, tipo: o.tipo, horario: o.horario || "", status: o.status,
  itens: o.itens, selections: o.selections, observacoes: o.observacoes || "",
  created_at: o.createdAt, completed_at: o.completedAt,
  skipped_at: o.skippedAt != null ? o.skippedAt : null, edited: !!o.edited,
  endereco: o.endereco || "", referencia: o.referencia || "",
  ready_at: o.readyAt != null ? o.readyAt : null,
  out_at: o.outAt != null ? o.outAt : null,
  pagamento: o.pagamento || "", valor: o.valor != null ? o.valor : null,
  forma_pagamento: o.formaPagamento || "", troco_para: o.trocoPara != null ? o.trocoPara : null,
  recebido_at: o.recebidoAt != null ? o.recebidoAt : null,
});
const msgFromRow = (r) => ({ id: r.id, sender: r.sender, text: r.content, ts: Number(r.ts) });
const msgToRow = (m) => ({ id: m.id, sender: m.sender, content: m.text, ts: m.ts });
const menuFromRow = (r) => ({ id: r.id, nome: r.nome, categorias: r.categorias || [] });
const menuToRow = (m) => ({ id: m.id, nome: m.nome, categorias: m.categorias });

/* Agrupa pedidos por cliente, preservando a ordem de primeira aparição
   da lista já ordenada (mesmo cliente fica junto). */
function groupByClient(list) {
  const groups = [];
  const idx = {};
  for (const o of list) {
    const key = (o.nome || "").trim().toLowerCase();
    if (idx[key] === undefined) { idx[key] = groups.length; groups.push({ nome: o.nome, items: [o] }); }
    else groups[idx[key]].items.push(o);
  }
  return groups;
}

const SKIP_RETURN_MS = 20 * 60 * 1000; // pulados voltam à fila após 20 min

/* ================================================================== */
/*  Componentes reutilizáveis                                          */
/* ================================================================== */

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-xl px-3 py-2 text-base font-semibold border-2 flex items-center justify-center gap-2 transition-colors " +
        (active ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-slate-200 text-slate-700 active:bg-slate-50")
      }
      style={{ minHeight: "52px" }}
    >
      {active && <Check size={18} className="shrink-0" />}
      <span className="text-center leading-tight">{children}</span>
    </button>
  );
}

function SubChip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-xl px-3 py-2 font-semibold border-2 flex items-center justify-center gap-2 " +
        (active ? "bg-blue-600 border-blue-600 text-white" : "bg-white border-slate-200 text-slate-600")
      }
      style={{ minHeight: "48px" }}
    >
      <span className={"inline-block rounded-full border-2 " + (active ? "bg-white border-white" : "border-slate-300")} style={{ width: "14px", height: "14px" }} />
      {children}
    </button>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <div className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-2">{title}</div>
      {children}
    </div>
  );
}

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.na_fila;
  return <span className={"rounded-full px-3 py-1 text-xs font-bold " + s.classes}>{s.label}</span>;
}

function Empty({ children }) {
  return <div className="text-center text-slate-400 py-12 font-medium">{children}</div>;
}

function Tab({ active, onClick, children, count, icon }) {
  return (
    <button
      onClick={onClick}
      className={"rounded-lg font-bold flex items-center justify-center gap-2 transition-colors " + (active ? "bg-white text-slate-900 shadow" : "text-slate-500")}
      style={{ minHeight: "46px" }}
    >
      {icon}
      <span>{children}</span>
      {typeof count === "number" && (
        <span className={"rounded-full text-xs px-2 py-0.5 " + (active ? "bg-slate-900 text-white" : "bg-slate-300 text-slate-700")}>{count}</span>
      )}
    </button>
  );
}

function TipoBadge({ tipo, size = "md" }) {
  const entrega = tipo === "entrega";
  const sm = size === "sm";
  return (
    <span className={"rounded-full font-bold flex items-center gap-1 " + (entrega ? "bg-indigo-600 text-white" : "bg-slate-200 text-slate-700") + (sm ? " text-xs px-2 py-0.5" : " text-sm px-3 py-1")}>
      {entrega ? <Bike size={sm ? 12 : 16} /> : <Home size={sm ? 12 : 16} />} {entrega ? "ENTREGA" : "LOCAL"}
    </span>
  );
}

function HorarioBadge({ info, tipo }) {
  if (!info) return null;
  const verbo = tipo === "entrega" ? "ENTREGAR" : "SERVIR";
  const cls =
    info.level === "urgente" ? "bg-red-600 text-white animate-pulse"
    : info.level === "breve" ? "bg-amber-500 text-white"
    : "bg-indigo-100 text-indigo-800 border-2 border-indigo-300";
  const rel = info.diffMin <= 0 ? "agora!" : `em ${info.diffMin} min`;
  return (
    <span className={"rounded-lg font-bold flex items-center gap-1 text-sm px-3 py-1.5 " + cls}>
      <Timer size={16} /> {verbo} {info.time} · {rel}
    </span>
  );
}

/* Situação do pagamento da entrega.
   size "lg" = bloco grande do entregador; "sm" = linha do atendente. */
function PagamentoInfo({ order, size = "sm" }) {
  if (order.tipo !== "entrega") return null;
  const lg = size === "lg";
  const receber = aReceber(order);
  const troco = trocoDe(order);

  if (!lg) {
    const cls = order.pagamento === "pago" ? "bg-green-100 text-green-800"
      : receber && order.recebidoAt ? "bg-green-600 text-white"
      : receber ? "bg-amber-100 text-amber-900 border border-amber-300"
      : "bg-slate-100 text-slate-500";
    return (
      <span className={"rounded-lg text-xs font-bold px-2 py-1 flex items-center gap-1 " + cls}>
        <Wallet size={13} className="shrink-0" />
        {receber && order.recebidoAt ? `Entregador recebeu ${fmtBRL(order.valor)} · ${formaLabel(order.formaPagamento)}` : pagamentoResumo(order)}
      </span>
    );
  }

  if (order.pagamento === "pago") {
    return (
      <div className="mt-3 rounded-xl border-4 border-green-500 bg-green-50 p-3 flex items-center gap-2">
        <CheckCircle2 size={26} className="text-green-600 shrink-0" />
        <div>
          <div className="text-lg font-extrabold text-green-800 leading-tight">JÁ PAGO</div>
          <div className="text-sm font-semibold text-green-700">Nada a cobrar do cliente</div>
        </div>
      </div>
    );
  }
  if (receber) {
    return (
      <div className={"mt-3 rounded-xl border-4 p-3 " + (order.recebidoAt ? "border-green-500 bg-green-50" : "border-amber-500 bg-amber-50")}>
        <div className={"flex items-center gap-1 text-xs font-extrabold uppercase tracking-wide " + (order.recebidoAt ? "text-green-800" : "text-amber-800")}>
          <Banknote size={15} /> {order.recebidoAt ? `Recebido ${fmtHM(order.recebidoAt)}` : "Cobrar na entrega"}
        </div>
        <div className="flex items-end justify-between gap-2 flex-wrap mt-1">
          <div className="text-3xl font-extrabold text-slate-900 leading-none">{fmtBRL(order.valor)}</div>
          <span className="rounded-lg bg-slate-900 text-white text-sm font-bold px-3 py-1">{formaLabel(order.formaPagamento)}</span>
        </div>
        {order.formaPagamento === "dinheiro" && (
          <p className="mt-2 text-sm font-semibold text-amber-900">
            {troco > 0
              ? <>Troco para {fmtBRL(order.trocoPara)} → <b>levar {fmtBRL(troco)} de troco</b></>
              : "Não precisa de troco"}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="mt-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-semibold text-slate-600 flex items-center gap-2">
      <Wallet size={18} className="shrink-0" /> Pagamento não informado — confirme com o atendente
    </div>
  );
}

/* ================================================================== */
/*  Formulário de pedido                                               */
/* ================================================================== */

function buildInitialForm(initial) {
  if (initial) {
    return {
      nome: initial.mode === "edit" ? (initial.nome || "") : "",
      tipo: initial.tipo || "local",
      horario: initial.horario || "",
      obs: initial.observacoes || "",
      endereco: initial.endereco || "",
      referencia: initial.referencia || "",
      pagamento: initial.pagamento || "",
      valor: valorParaInput(initial.valor),
      forma: initial.formaPagamento || "",
      troco: valorParaInput(initial.trocoPara),
      selections: JSON.parse(JSON.stringify(initial.selections || {})),
    };
  }
  return { nome: "", tipo: "local", horario: "", obs: "", endereco: "", referencia: "", pagamento: "", valor: "", forma: "", troco: "", selections: {} };
}

function OrderForm({ menu, initial, onSubmit, onConsumedPrefill }) {
  const [f, setF] = useState(() => buildInitialForm(initial));
  const [editId, setEditId] = useState(initial && initial.mode === "edit" ? initial.editId : null);

  useEffect(() => { if (initial && onConsumedPrefill) onConsumedPrefill(); }, []); // eslint-disable-line

  const getSel = (catId, itemId) => (f.selections[catId] && f.selections[catId][itemId]) || null;
  const setSel = (catId, itemId, val) =>
    setF((p) => {
      const cat = { ...(p.selections[catId] || {}) };
      if (val === null) delete cat[itemId];
      else cat[itemId] = val;
      return { ...p, selections: { ...p.selections, [catId]: cat } };
    });
  const toggleItem = (cat, item) => {
    const cur = getSel(cat.id, item.id);
    if (cur && cur.on) { setSel(cat.id, item.id, null); return; }
    const val = { on: true };
    if (item.tipo === "variacoes" && item.variacoes && item.variacoes.length) val.variant = item.variacoes[0];
    if (item.tipo === "texto") val.text = "";
    setSel(cat.id, item.id, val);
  };
  const setVariant = (cat, item, variant) => setSel(cat.id, item.id, { on: true, variant });
  const setText = (cat, item, text) => setSel(cat.id, item.id, { on: true, text });
  const setTop = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const precisaEndereco = f.tipo === "entrega";
  const enderecoOk = !precisaEndereco || f.endereco.trim().length > 0;

  /* Pagamento — obrigatório informar na entrega, para o entregador saber se cobra. */
  const valorNum = parseValor(f.valor);
  const trocoNum = parseValor(f.troco);
  const ehDinheiro = f.forma === "dinheiro";
  let pagamentoErro = "";
  if (precisaEndereco) {
    if (!f.pagamento) pagamentoErro = "Informe se já foi pago ou se o entregador vai receber";
    else if (f.pagamento === "receber") {
      if (!valorNum) pagamentoErro = "Informe o valor a receber";
      else if (!f.forma) pagamentoErro = "Escolha a forma de pagamento";
      else if (ehDinheiro && f.troco.trim() && (trocoNum == null || trocoNum < valorNum)) pagamentoErro = "O troco deve ser para um valor maior que o total";
    }
  }
  const pagamentoOk = !pagamentoErro;
  const trocoPrevisto = ehDinheiro && valorNum && trocoNum && trocoNum > valorNum ? trocoNum - valorNum : 0;

  const canSubmit = f.nome.trim().length > 0 && enderecoOk && pagamentoOk;
  const submit = () => {
    if (!canSubmit) return;
    const receber = f.tipo === "entrega" && f.pagamento === "receber";
    onSubmit({
      nome: f.nome.trim(),
      tipo: f.tipo,
      horario: f.horario,
      observacoes: f.obs.trim(),
      endereco: f.tipo === "entrega" ? f.endereco.trim() : "",
      referencia: f.tipo === "entrega" ? f.referencia.trim() : "",
      pagamento: f.tipo === "entrega" ? f.pagamento : "",
      valor: receber ? valorNum : null,
      formaPagamento: receber ? f.forma : "",
      trocoPara: receber && ehDinheiro && trocoPrevisto ? trocoNum : null,
      selections: JSON.parse(JSON.stringify(f.selections)),
      itens: resolveItens(menu, f.selections),
    }, editId);
    setEditId(null);
    setF(buildInitialForm(null));
  };

  const inputCls = "w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base text-slate-900 outline-none focus:border-emerald-500";

  return (
    <div>
      <div className="p-4 space-y-5">
        <div>
          <div className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-2">Nome do cliente</div>
          <input autoFocus value={f.nome} onChange={(e) => setTop("nome", e.target.value)} placeholder="Ex: Dona Maria"
            className="w-full rounded-xl border-2 border-slate-200 px-4 text-2xl font-extrabold text-slate-900 outline-none focus:border-emerald-500" style={{ minHeight: "58px" }} />
        </div>

        <Section title="Tipo de pedido">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setTop("tipo", "local")}
              className={"rounded-xl font-bold flex items-center justify-center gap-2 border-2 " + (f.tipo === "local" ? "bg-slate-800 border-slate-800 text-white" : "bg-white border-slate-200 text-slate-600")} style={{ minHeight: "56px" }}>
              <Home size={20} /> No local
            </button>
            <button onClick={() => setTop("tipo", "entrega")}
              className={"rounded-xl font-bold flex items-center justify-center gap-2 border-2 " + (f.tipo === "entrega" ? "bg-indigo-600 border-indigo-600 text-white" : "bg-white border-slate-200 text-slate-600")} style={{ minHeight: "56px" }}>
              <Bike size={20} /> Entrega
            </button>
          </div>
        </Section>

        {f.tipo === "entrega" && (
          <div className="rounded-2xl border-2 border-indigo-300 bg-indigo-50 p-3 space-y-3">
            <div className="flex items-center gap-2 text-indigo-800 font-bold text-sm uppercase tracking-wide">
              <MapPin size={16} /> Endereço da entrega
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Endereço (rua, número, bairro)</div>
              <textarea value={f.endereco} onChange={(e) => setTop("endereco", e.target.value)} rows={2}
                placeholder="Ex: Rua das Flores, 120 — Centro, Teresópolis"
                className={inputCls + " resize-none bg-white"} />
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-600 mb-1">Ponto de referência (opcional)</div>
              <input value={f.referencia} onChange={(e) => setTop("referencia", e.target.value)}
                placeholder="Ex: casa azul, ao lado da padaria; portão 2"
                className={inputCls + " bg-white"} />
            </div>
            {!enderecoOk && (
              <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
                <AlertTriangle size={12} /> O endereço é obrigatório para entrega
              </p>
            )}
          </div>
        )}

        {f.tipo === "entrega" && (
          <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3 space-y-3">
            <div className="flex items-center gap-2 text-amber-800 font-bold text-sm uppercase tracking-wide">
              <Wallet size={16} /> Pagamento (para o entregador)
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setTop("pagamento", "pago")}
                className={"rounded-xl font-bold flex items-center justify-center gap-2 border-2 " + (f.pagamento === "pago" ? "bg-green-600 border-green-600 text-white" : "bg-white border-slate-200 text-slate-600")} style={{ minHeight: "54px" }}>
                <CheckCircle2 size={18} /> Já pago
              </button>
              <button onClick={() => setTop("pagamento", "receber")}
                className={"rounded-xl font-bold flex items-center justify-center gap-2 border-2 " + (f.pagamento === "receber" ? "bg-amber-600 border-amber-600 text-white" : "bg-white border-slate-200 text-slate-600")} style={{ minHeight: "54px" }}>
                <Banknote size={18} /> Receber na entrega
              </button>
            </div>

            {f.pagamento === "receber" && (
              <>
                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-1">Valor a receber (R$)</div>
                  <input value={f.valor} onChange={(e) => setTop("valor", e.target.value)} inputMode="decimal" placeholder="Ex: 35,00"
                    className={inputCls + " bg-white text-xl font-extrabold"} />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-600 mb-1">Forma de pagamento</div>
                  <div className="grid grid-cols-2 gap-2">
                    {FORMAS_PAGAMENTO.map((fp) => (
                      <Chip key={fp.id} active={f.forma === fp.id} onClick={() => setTop("forma", fp.id)}>{fp.label}</Chip>
                    ))}
                  </div>
                </div>
                {ehDinheiro && (
                  <div>
                    <div className="text-xs font-semibold text-slate-600 mb-1">Troco para quanto? (opcional)</div>
                    <input value={f.troco} onChange={(e) => setTop("troco", e.target.value)} inputMode="decimal" placeholder="Ex: 50,00 — deixe vazio se não precisa"
                      className={inputCls + " bg-white"} />
                    {trocoPrevisto > 0 && (
                      <p className="text-xs text-amber-800 font-semibold mt-1">Entregador leva {fmtBRL(trocoPrevisto)} de troco</p>
                    )}
                  </div>
                )}
              </>
            )}

            {pagamentoErro && (
              <p className="text-xs text-red-600 font-semibold flex items-center gap-1">
                <AlertTriangle size={12} /> {pagamentoErro}
              </p>
            )}
          </div>
        )}

        <Section title={f.tipo === "entrega" ? "Horário de entrega" : "Horário para servir"}>
          <div className="flex flex-wrap gap-2 mb-2">
            {[{ l: "Agora", v: "" }, { l: "+30 min", v: nowHHMM(30) }, { l: "+1 h", v: nowHHMM(60) }].map((p, i) => {
              const active = i === 0 ? f.horario === "" : false;
              return (
                <button key={i} onClick={() => setTop("horario", p.v)}
                  className={"rounded-full px-4 py-2 text-sm font-semibold border-2 " + (active ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-slate-200 text-slate-600")}>
                  {p.l}
                </button>
              );
            })}
          </div>
          <input type="time" value={f.horario} onChange={(e) => setTop("horario", e.target.value)} className={inputCls} />
          {f.tipo === "entrega" && f.horario === "" && (
            <p className="text-xs text-amber-600 mt-1 flex items-center gap-1"><AlertTriangle size={12} /> Defina um horário para a entrega</p>
          )}
        </Section>

        {menu.categorias.map((cat) => (
          <Section key={cat.id} title={cat.nome}>
            {cat.itens.length === 0 ? (
              <p className="text-sm text-slate-400">Sem itens neste cardápio.</p>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {cat.itens.map((item) => {
                    const s = getSel(cat.id, item.id);
                    return <Chip key={item.id} active={!!(s && s.on)} onClick={() => toggleItem(cat, item)}>{item.label}</Chip>;
                  })}
                </div>
                {cat.itens.map((item) => {
                  const s = getSel(cat.id, item.id);
                  if (!s || !s.on) return null;
                  if (item.tipo === "variacoes" && item.variacoes && item.variacoes.length) {
                    return (
                      <div key={item.id} className="mt-2">
                        <div className="text-xs text-slate-500 mb-1">{item.label}:</div>
                        <div className="grid grid-cols-2 gap-2">
                          {item.variacoes.map((v) => (
                            <SubChip key={v} active={s.variant === v} onClick={() => setVariant(cat, item, v)}>{v}</SubChip>
                          ))}
                        </div>
                      </div>
                    );
                  }
                  if (item.tipo === "texto") {
                    return (
                      <input key={item.id} value={s.text || ""} onChange={(e) => setText(cat, item, e.target.value)}
                        placeholder={item.placeholder || `Especifique: ${item.label}`} className={inputCls + " mt-2"} />
                    );
                  }
                  return null;
                })}
              </>
            )}
          </Section>
        ))}

        <Section title="Observações">
          <textarea value={f.obs} onChange={(e) => setTop("obs", e.target.value)} rows={3} placeholder="Restrições, alergias, pedidos especiais..." className={inputCls + " resize-none"} />
        </Section>
      </div>

      <div className="sticky bottom-0 border-t border-slate-200 p-3" style={{ backgroundColor: "#f1f5f9" }}>
        {editId && <p className="text-center text-xs font-bold text-amber-600 mb-1">✏️ Editando pedido enviado — as alterações vão para a cozinha</p>}
        {!canSubmit && (
          <p className="text-center text-xs text-slate-400 mb-1">
            {f.nome.trim().length === 0 ? "Informe o nome para enviar" : !enderecoOk ? "Informe o endereço da entrega" : pagamentoErro}
          </p>
        )}
        <button onClick={submit} disabled={!canSubmit}
          className={"w-full rounded-2xl font-extrabold text-lg flex items-center justify-center gap-2 " + (canSubmit ? (editId ? "bg-amber-600 text-white active:bg-amber-700" : "bg-green-600 text-white active:bg-green-700") : "bg-slate-300 text-slate-500")} style={{ minHeight: "60px" }}>
          {editId ? <><Check size={22} /> Salvar alterações</> : <><Send size={22} /> Enviar para Cozinha</>}
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Visão Atendente                                                    */
/* ================================================================== */

function AtendenteView({ orders, menu, prefill, formSeed, nowTs, headerH, onCreate, onEdit, onCancel, onRepeat, onConsumedPrefill }) {
  const [sub, setSub] = useState("novo");
  const [confirmingId, setConfirmingId] = useState(null);

  useEffect(() => { if (prefill) setSub("novo"); }, [formSeed]); // eslint-disable-line

  const activeCount = orders.filter((o) => ["na_fila", "preparando", "pulado", "aguardando_entrega", "em_rota"].includes(o.status)).length;
  const recent = [...orders].sort((a, b) => b.createdAt - a.createdAt);
  const groups = groupByClient(recent);

  const cancelavel = (o) => o.status !== "concluido" && o.status !== "cancelado";

  return (
    <div>
      <div className="sticky z-20 px-3 py-3" style={{ top: headerH, backgroundColor: "#f1f5f9" }}>
        <div className="grid grid-cols-2 gap-1 bg-slate-200 rounded-xl p-1">
          <Tab active={sub === "novo"} onClick={() => setSub("novo")} icon={<Plus size={18} />}>Novo Pedido</Tab>
          <Tab active={sub === "enviados"} onClick={() => setSub("enviados")} icon={<ClipboardList size={18} />} count={activeCount}>Enviados</Tab>
        </div>
      </div>

      {sub === "novo" ? (
        <OrderForm key={formSeed} menu={menu} initial={prefill} onSubmit={onCreate} onConsumedPrefill={onConsumedPrefill} />
      ) : (
        <div className="p-4 space-y-4">
          {recent.length === 0 && <Empty>Nenhum pedido enviado ainda.</Empty>}
          {groups.map((g) => (
            <div key={g.nome + g.items[0].id} className={g.items.length > 1 ? "rounded-2xl bg-slate-100 border-2 border-slate-200 p-2 space-y-2" : ""}>
              {g.items.length > 1 && (
                <div className="flex items-center gap-2 px-1 pt-1">
                  <span className="rounded-lg bg-slate-900 text-white px-3 py-1 font-extrabold">{g.nome}</span>
                  <span className="text-xs font-bold text-slate-500">{g.items.length} pedidos</span>
                </div>
              )}
              {g.items.map((o) => (
                <div key={o.id} className="rounded-2xl border-2 border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <div className="rounded-lg bg-slate-900 text-white px-3 py-1 font-extrabold text-lg truncate" style={{ maxWidth: "170px" }}>{o.nome}</div>
                      <StatusBadge status={o.status} />
                      {o.edited && <span className="rounded-full bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5">EDITADO</span>}
                    </div>
                    <div className="text-xs text-slate-400 shrink-0">{relTime(o.createdAt, nowTs)}</div>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <TipoBadge tipo={o.tipo} size="sm" />
                    {o.horario && (
                      <span className="text-xs font-semibold text-indigo-700 flex items-center gap-1">
                        <Timer size={12} /> {o.tipo === "entrega" ? "Entregar" : "Servir"} {o.horario}
                      </span>
                    )}
                  </div>

                  {o.tipo === "entrega" && enderecoCompleto(o) && (
                    <p className="mt-2 text-xs text-slate-500 flex items-start gap-1">
                      <MapPin size={13} className="mt-0.5 shrink-0" /> {enderecoCompleto(o)}
                    </p>
                  )}

                  {o.tipo === "entrega" && o.status !== "cancelado" && (
                    <div className="mt-2 flex"><PagamentoInfo order={o} /></div>
                  )}

                  {isEntregaAtiva(o) && (
                    <div className={"mt-2 rounded-xl px-3 py-2 text-sm font-bold flex items-center gap-2 " + (o.status === "em_rota" ? "bg-purple-600 text-white" : "bg-purple-100 text-purple-800 border-2 border-purple-300")}>
                      <Bike size={16} className="shrink-0" />
                      {o.status === "em_rota" ? "Entregador saiu para entrega" : "Pronto — enviado ao entregador"}
                    </div>
                  )}

                  <p className={"mt-2 text-sm " + (o.status === "cancelado" ? "line-through text-slate-400" : "text-slate-600")}>{flatSummary(o)}</p>
                  {o.observacoes.trim() && (
                    <p className="mt-1 text-sm text-red-600 flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {o.observacoes}</p>
                  )}

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {cancelavel(o) ? (
                      <button onClick={() => { onEdit(o); setSub("novo"); }} className="rounded-xl border-2 border-amber-300 text-amber-700 font-bold flex items-center justify-center gap-1" style={{ minHeight: "46px" }}>
                        <Check size={16} /> Editar
                      </button>
                    ) : <div />}
                    <button onClick={() => { onRepeat(o); setSub("novo"); }} className="rounded-xl border-2 border-emerald-200 text-emerald-700 font-bold flex items-center justify-center gap-1" style={{ minHeight: "46px" }}>
                      <Copy size={16} /> Repetir
                    </button>
                    {cancelavel(o) ? (
                      confirmingId === o.id ? (
                        <div className="flex gap-1">
                          <button onClick={() => { onCancel(o.id); setConfirmingId(null); }} className="flex-1 rounded-xl bg-red-600 text-white font-bold text-sm" style={{ minHeight: "46px" }}>Sim</button>
                          <button onClick={() => setConfirmingId(null)} className="flex-1 rounded-xl bg-slate-200 text-slate-700 font-bold text-sm" style={{ minHeight: "46px" }}>Não</button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmingId(o.id)} className="rounded-xl border-2 border-red-200 text-red-600 font-bold flex items-center justify-center gap-1" style={{ minHeight: "46px" }}>
                          <Trash2 size={16} /> Cancelar
                        </button>
                      )
                    ) : <div />}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Card + Visão Cozinha                                               */
/* ================================================================== */

function KitchenCard({ order, nowTs, variant, highlight, onPrepare, onComplete, onSkip, onBackToQueue, onSendToDelivery }) {
  const preparing = order.status === "preparando";
  const comBebida = temBebida(order);
  const paraEntrega = order.tipo === "entrega";
  const isNew = variant === "fila" && nowTs - order.createdAt < 20000;
  const hInfo = horarioInfo(order, nowTs);
  const urgente = variant === "fila" && hInfo && hInfo.level === "urgente";
  const breve = variant === "fila" && hInfo && hInfo.level === "breve";
  const overdue = urgente && hInfo.diffMin <= 0;

  // contagem regressiva para pulados voltarem à fila
  let skipLeft = null;
  if (variant === "pulado" && order.skippedAt) {
    skipLeft = Math.max(0, Math.ceil((order.skippedAt + SKIP_RETURN_MS - nowTs) / 60000));
  }

  const cardTone = highlight
    ? "border-slate-900 bg-white ring-4 ring-slate-900"
    : urgente
    ? "border-red-500 bg-red-50 shadow-md"
    : breve
    ? "border-amber-400 bg-amber-50"
    : preparing
    ? "border-blue-400 bg-white"
    : "border-slate-200 bg-white";

  return (
    <div id={"card-" + order.id} className={"rounded-2xl border-2 p-4 shadow-sm transition-colors " + cardTone + (urgente ? " animate-pulse" : "")}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-400 leading-none mb-0.5">PEDIDO</div>
          <div className="text-2xl font-extrabold text-slate-900 leading-tight break-words">{order.nome}</div>
          <div className="text-xs text-slate-500 flex items-center gap-1 mt-1"><Clock size={14} /> recebido {relTime(order.createdAt, nowTs)}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {overdue && <span className="rounded-full bg-red-600 text-white text-xs font-bold px-2 py-0.5">ATRASADO</span>}
          {isNew && <span className="rounded-full bg-emerald-500 text-white text-xs font-bold px-2 py-0.5 animate-pulse">NOVO</span>}
          {order.edited && <span className="rounded-full bg-amber-100 text-amber-800 text-xs font-bold px-2 py-0.5">EDITADO</span>}
          {preparing && <span className="rounded-full bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5">EM PREPARO</span>}
          {comBebida && (
            <span className="rounded-full bg-cyan-600 text-white text-xs font-extrabold px-2 py-0.5 flex items-center gap-1 animate-pulse">
              <Coffee size={12} /> BEBIDA
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <TipoBadge tipo={order.tipo} />
        <HorarioBadge info={hInfo} tipo={order.tipo} />
      </div>

      {paraEntrega && enderecoCompleto(order) && (
        <div className="mb-3 rounded-xl bg-indigo-50 border-2 border-indigo-200 px-3 py-2 text-sm text-indigo-900 flex items-start gap-2">
          <MapPin size={16} className="mt-0.5 shrink-0" /> <span className="font-semibold">{enderecoCompleto(order)}</span>
        </div>
      )}

      <div className="space-y-3">
        {order.itens.length ? (
          order.itens.map((g, i) => {
            const beb = isBebidaCat(g.categoria);
            if (beb) {
              return (
                <div key={i} className="rounded-xl border-4 border-cyan-500 bg-cyan-50 p-2.5 animate-pulse">
                  <div className="text-xs font-extrabold uppercase tracking-wide text-cyan-800 mb-1 flex items-center gap-1">
                    <Coffee size={14} /> {g.categoria} — NÃO ESQUEÇA!
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {g.valores.map((t, j) => (
                      <span key={j} className="rounded-lg px-3 py-1.5 text-base font-extrabold bg-cyan-600 text-white">🥤 {t}</span>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <div key={i}>
                <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">{g.categoria}</div>
                <div className="flex flex-wrap gap-2">
                  {g.valores.map((t, j) => (
                    <span key={j} className={"rounded-lg px-3 py-1.5 text-base font-semibold " + (g.destaque ? "bg-orange-600 text-white" : "bg-slate-800 text-white")}>{t}</span>
                  ))}
                </div>
              </div>
            );
          })
        ) : (
          <p className="text-slate-400 text-sm">Nenhum item marcado.</p>
        )}
      </div>

      {order.observacoes.trim() && (
        <div className="mt-3 rounded-xl border-2 border-red-500 bg-red-50 p-3">
          <div className="flex items-center gap-2 text-red-700 font-bold text-sm mb-1"><AlertTriangle size={18} /> OBSERVAÇÃO</div>
          <p className="text-red-800 font-semibold">{order.observacoes}</p>
        </div>
      )}

      <div className="mt-4">
        {variant === "fila" && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onPrepare(order.id)}
                className={"rounded-xl font-bold flex items-center justify-center gap-2 " + (preparing ? "bg-blue-600 text-white" : "bg-blue-50 text-blue-700 border-2 border-blue-200")} style={{ minHeight: "52px" }}>
                <ChefHat size={20} /> {preparing ? "Em preparo" : "Preparar"}
              </button>
              <button onClick={() => onSkip(order.id)} className="rounded-xl font-bold bg-amber-500 text-white flex items-center justify-center gap-2 active:bg-amber-600" style={{ minHeight: "52px" }}>
                <SkipForward size={20} /> Pular
              </button>
            </div>
            {paraEntrega ? (
              <button onClick={() => onSendToDelivery && onSendToDelivery(order.id)} className="w-full rounded-xl font-extrabold text-lg bg-purple-600 text-white flex items-center justify-center gap-2 active:bg-purple-700" style={{ minHeight: "58px" }}>
                <Bike size={22} /> PRONTO → ENVIAR AO ENTREGADOR
              </button>
            ) : (
              <button onClick={() => onComplete(order.id)} className="w-full rounded-xl font-extrabold text-lg bg-green-600 text-white flex items-center justify-center gap-2 active:bg-green-700" style={{ minHeight: "58px" }}>
                <CheckCircle2 size={22} /> CONCLUÍDO
              </button>
            )}
          </div>
        )}
        {variant === "pulado" && (
          <div className="space-y-2">
            {skipLeft !== null && (
              <div className="text-xs font-semibold text-amber-700 flex items-center gap-1 justify-center">
                <RotateCcw size={13} /> {skipLeft > 0 ? `Volta para a fila em ${skipLeft} min` : "Voltando para a fila..."}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onBackToQueue(order.id)} className="rounded-xl font-bold bg-slate-200 text-slate-800 flex items-center justify-center gap-2 active:bg-slate-300" style={{ minHeight: "56px" }}>
                <RotateCcw size={20} /> Voltar p/ Fila
              </button>
              {paraEntrega ? (
                <button onClick={() => onSendToDelivery && onSendToDelivery(order.id)} className="rounded-xl font-extrabold bg-purple-600 text-white flex items-center justify-center gap-2 active:bg-purple-700" style={{ minHeight: "56px" }}>
                  <Bike size={20} /> Ao entregador
                </button>
              ) : (
                <button onClick={() => onComplete(order.id)} className="rounded-xl font-extrabold bg-green-600 text-white flex items-center justify-center gap-2 active:bg-green-700" style={{ minHeight: "56px" }}>
                  <CheckCircle2 size={20} /> Concluído
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function fmtHM(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function gerarRelatorioPDF(entregues) {
  const rows = [...entregues].sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0));
  const now = new Date();
  const dataStr = now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const totalLocal = rows.filter((o) => o.tipo !== "entrega").length;
  const totalEntrega = rows.filter((o) => o.tipo === "entrega").length;
  const totalRecebido = rows.filter((o) => aReceber(o) && o.recebidoAt).reduce((t, o) => t + o.valor, 0);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  const trs = rows.map((o, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td><b>${esc(o.nome)}</b></td>
      <td class="c">${o.tipo === "entrega" ? "🚲 Entrega" : "🏠 Local"}</td>
      <td class="c">${o.horario ? esc(o.horario) : "—"}</td>
      <td>${esc(flatSummary(o))}</td>
      <td class="end">${o.tipo === "entrega" ? esc(enderecoCompleto(o)) : "—"}</td>
      <td>${o.tipo === "entrega" ? esc(pagamentoResumo(o)) : "—"}</td>
      <td class="obs">${esc(o.observacoes || "")}</td>
      <td class="c">${fmtHM(o.completedAt)}</td>
    </tr>`).join("");
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
    <title>Relatório de Pedidos — ${esc(dataStr)}</title>
    <style>
      *{box-sizing:border-box} body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;margin:24px}
      h1{margin:0 0 2px;font-size:20px} .sub{color:#64748b;font-size:13px;margin-bottom:14px}
      .cards{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
      .kpi{border:2px solid #e2e8f0;border-radius:12px;padding:10px 16px}
      .kpi b{display:block;font-size:22px} .kpi span{font-size:12px;color:#64748b}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th,td{border:1px solid #e2e8f0;padding:7px 9px;text-align:left;vertical-align:top}
      th{background:#f1f5f9;font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#475569}
      td.c{text-align:center;white-space:nowrap} td.obs{color:#b91c1c} td.end{color:#3730a3;font-size:12px}
      tr:nth-child(even) td{background:#fafafa}
      .print{margin-top:18px;padding:12px 18px;border:0;border-radius:10px;background:#059669;color:#fff;font-weight:700;font-size:15px;cursor:pointer}
      @media print{.print{display:none}body{margin:0}}
    </style></head><body>
    <h1>🍴 Relatório de Pedidos — Comanda Digital</h1>
    <div class="sub">${esc(dataStr)} · gerado às ${pad2(now.getHours())}:${pad2(now.getMinutes())}</div>
    <div class="cards">
      <div class="kpi"><b>${rows.length}</b><span>Pratos entregues</span></div>
      <div class="kpi"><b>${totalLocal}</b><span>No local</span></div>
      <div class="kpi"><b>${totalEntrega}</b><span>Entregas</span></div>
      <div class="kpi"><b>${esc(fmtBRL(totalRecebido))}</b><span>Recebido nas entregas</span></div>
    </div>
    <table><thead><tr><th>#</th><th>Cliente</th><th>Tipo</th><th>Horário</th><th>Itens</th><th>Endereço</th><th>Pagamento</th><th>Observações</th><th>Concluído</th></tr></thead>
    <tbody>${trs || '<tr><td colspan="9" class="c">Nenhum pedido.</td></tr>'}</tbody></table>
    <button class="print" onclick="window.print()">🖨️ Imprimir / Salvar como PDF</button>
    <script>window.onload=function(){setTimeout(function(){window.print();},400);};</script>
    </body></html>`;
  const w = window.open("", "_blank");
  if (!w) { alert("Permita pop-ups (janelas) neste site para gerar o relatório."); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

/* Popup que lembra a bebida antes de concluir / enviar ao entregador */
function BebidaModal({ pending, onConfirm, onCancel }) {
  if (!pending) return null;
  const { order, acao } = pending;
  const bebidas = bebidasDoPedido(order);
  const entrega = acao === "entregador";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
      <div className="w-full rounded-2xl bg-white p-5 shadow-xl" style={{ maxWidth: "420px" }}>
        <div className="flex items-center gap-2 text-cyan-700 font-extrabold text-lg">
          <Coffee size={24} /> Não esqueça a bebida!
        </div>
        <p className="text-sm text-slate-600 mt-1">
          O pedido de <b>{order.nome}</b> tem bebida. Confira antes de {entrega ? "enviar ao entregador" : "concluir"}:
        </p>
        <div className="mt-3 rounded-xl border-4 border-cyan-500 bg-cyan-50 p-3 flex flex-wrap gap-2">
          {bebidas.map((b, i) => (
            <span key={i} className="rounded-lg bg-cyan-600 text-white px-3 py-1.5 font-extrabold">🥤 {b}</span>
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="rounded-xl bg-slate-200 text-slate-700 font-bold" style={{ minHeight: "54px" }}>
            Ainda não
          </button>
          <button onClick={onConfirm} className={"rounded-xl text-white font-extrabold flex items-center justify-center gap-2 " + (entrega ? "bg-purple-600 active:bg-purple-700" : "bg-green-600 active:bg-green-700")} style={{ minHeight: "54px" }}>
            {entrega ? <><Bike size={20} /> Bebida ok, enviar</> : <><CheckCircle2 size={20} /> Bebida ok, concluir</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function CozinhaView({ orders, nowTs, headerH, onPrepare, onComplete, onSkip, onBackToQueue, onClearHistory, onSendToDelivery }) {
  const [tab, setTab] = useState("fila");
  const [highlightId, setHighlightId] = useState(null);
  const [pendingBebida, setPendingBebida] = useState(null);

  /* Se o pedido tiver bebida, pede confirmação antes de sair da cozinha. */
  const guardBebida = (acao) => (id) => {
    const o = orders.find((x) => x.id === id);
    if (o && temBebida(o)) { setPendingBebida({ order: o, acao }); return; }
    if (acao === "entregador") onSendToDelivery(id); else onComplete(id);
  };
  const completeGuard = guardBebida("concluir");
  const deliveryGuard = guardBebida("entregador");
  const confirmBebida = () => {
    const p = pendingBebida;
    setPendingBebida(null);
    if (!p) return;
    if (p.acao === "entregador") onSendToDelivery(p.order.id); else onComplete(p.order.id);
  };

  const fila = orders.filter((o) => o.status === "na_fila" || o.status === "preparando").sort((a, b) => targetTs(a, nowTs) - targetTs(b, nowTs));
  const pulados = orders.filter((o) => o.status === "pulado").sort((a, b) => (a.skippedAt || a.createdAt) - (b.skippedAt || b.createdAt));
  const concluidos = orders.filter((o) => o.status === "concluido").sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  /* A cozinha continua vendo o pedido depois de enviá-lo ao entregador. */
  const entregues = orders
    .filter((o) => o.status === "concluido" || isEntregaAtiva(o))
    .sort((a, b) => (b.completedAt || b.outAt || b.readyAt || 0) - (a.completedAt || a.outAt || a.readyAt || 0));

  const filaGroups = groupByClient(fila);
  const alertas = fila.filter((o) => { const h = horarioInfo(o, nowTs); return h && h.level === "urgente"; });

  const irParaPedido = (id) => {
    setTab("fila");
    setTimeout(() => {
      const el = document.getElementById("card-" + id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightId(id);
      setTimeout(() => setHighlightId(null), 2600);
    }, 70);
  };

  return (
    <div>
      <div className="sticky z-20" style={{ top: headerH, backgroundColor: "#f1f5f9" }}>
        <div className="px-3 pt-3 pb-2">
          <div className="grid grid-cols-3 gap-1 bg-slate-200 rounded-xl p-1">
            <Tab active={tab === "fila"} onClick={() => setTab("fila")} count={fila.length}>Fila</Tab>
            <Tab active={tab === "pulados"} onClick={() => setTab("pulados")} count={pulados.length}>Pulados</Tab>
            <Tab active={tab === "entregues"} onClick={() => setTab("entregues")} count={entregues.length}>Entregues</Tab>
          </div>
        </div>

        {alertas.length > 0 && (
          <div className="px-3 pb-2">
            <div className="rounded-xl border-2 border-red-500 bg-red-600 text-white p-2 animate-pulse">
              <div className="flex items-center gap-2 font-bold text-sm px-1 mb-1"><Bell size={16} /> Atenção ao horário — toque para ir ao pedido</div>
              <div className="flex flex-col gap-1">
                {alertas.slice(0, 4).map((o) => {
                  const h = horarioInfo(o, nowTs);
                  const rel = h.diffMin <= 0 ? `ATRASADO ${Math.abs(h.diffMin)} min` : `em ${h.diffMin} min`;
                  return (
                    <button key={o.id} onClick={() => irParaPedido(o.id)} className="w-full text-left rounded-lg bg-white/15 active:bg-white/25 px-3 py-2 flex items-center justify-between gap-2">
                      <span className="font-bold truncate">{o.tipo === "entrega" ? "🚲 " : ""}{o.nome}</span>
                      <span className="text-sm font-extrabold shrink-0">{o.horario} · {rel}</span>
                    </button>
                  );
                })}
                {alertas.length > 4 && <div className="text-xs px-1">+{alertas.length - 4} outro(s) próximo(s) do horário</div>}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 space-y-4">
        {tab === "fila" && (fila.length ? filaGroups.map((g) => (
          g.items.length > 1 ? (
            <div key={g.nome + g.items[0].id} className="rounded-2xl bg-slate-100 border-2 border-slate-300 p-2 space-y-2">
              <div className="flex items-center gap-2 px-1 pt-1">
                <span className="rounded-lg bg-slate-900 text-white px-3 py-1 font-extrabold">{g.nome}</span>
                <span className="text-xs font-bold text-slate-500">{g.items.length} pedidos deste cliente</span>
              </div>
              {g.items.map((o) => <KitchenCard key={o.id} order={o} nowTs={nowTs} variant="fila" highlight={highlightId === o.id} onPrepare={onPrepare} onComplete={completeGuard} onSkip={onSkip} onSendToDelivery={deliveryGuard} />)}
            </div>
          ) : (
            <KitchenCard key={g.items[0].id} order={g.items[0]} nowTs={nowTs} variant="fila" highlight={highlightId === g.items[0].id} onPrepare={onPrepare} onComplete={completeGuard} onSkip={onSkip} onSendToDelivery={deliveryGuard} />
          )
        )) : <Empty>Nenhum pedido na fila. Tudo em dia! 🎉</Empty>)}

        {tab === "pulados" && (pulados.length ? pulados.map((o) => <KitchenCard key={o.id} order={o} nowTs={nowTs} variant="pulado" onComplete={completeGuard} onBackToQueue={onBackToQueue} onSendToDelivery={deliveryGuard} />) : <Empty>Nenhum pedido aguardando.</Empty>)}

        {tab === "entregues" && (entregues.length ? (
          <>
            <button onClick={() => gerarRelatorioPDF(concluidos)} className="w-full rounded-xl bg-slate-900 text-white font-bold flex items-center justify-center gap-2" style={{ minHeight: "50px" }}>
              <ClipboardList size={18} /> Gerar relatório (PDF)
            </button>
            {entregues.map((o) => {
              const emEntrega = isEntregaAtiva(o);
              return (
                <div key={o.id} className={"rounded-2xl border-2 bg-white p-4 " + (emEntrega ? "border-purple-300" : "border-slate-200")}>
                  <div className="flex items-center justify-between gap-2">
                    <div className={"rounded-lg text-white px-3 py-1 font-extrabold text-lg flex items-center gap-1 truncate " + (emEntrega ? "bg-purple-600" : "bg-green-600")} style={{ maxWidth: "200px" }}>
                      {emEntrega ? <Bike size={18} /> : <CheckCircle2 size={18} />} {o.nome}
                    </div>
                    <div className="text-xs text-slate-400 shrink-0">
                      {emEntrega ? relTime(o.outAt || o.readyAt || o.createdAt, nowTs) : `Entregue ${relTime(o.completedAt || o.createdAt, nowTs)}`}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 items-center">
                    <TipoBadge tipo={o.tipo} size="sm" />
                    {emEntrega && (
                      <span className={"rounded-full text-xs font-bold px-2 py-0.5 " + (o.status === "em_rota" ? "bg-purple-600 text-white" : "bg-purple-100 text-purple-800")}>
                        {o.status === "em_rota" ? "SAIU PARA ENTREGA" : "COM O ENTREGADOR"}
                      </span>
                    )}
                    {temBebida(o) && <span className="rounded-full bg-cyan-600 text-white text-xs font-bold px-2 py-0.5">🥤 COM BEBIDA</span>}
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{flatSummary(o)}</p>
                </div>
              );
            })}
            <button onClick={onClearHistory} className="w-full rounded-xl border-2 border-slate-200 text-slate-500 font-bold flex items-center justify-center gap-2" style={{ minHeight: "46px" }}>
              <Trash2 size={16} /> Limpar histórico
            </button>
          </>
        ) : <Empty>Nenhum prato entregue ainda.</Empty>)}
      </div>

      <BebidaModal pending={pendingBebida} onConfirm={confirmBebida} onCancel={() => setPendingBebida(null)} />
    </div>
  );
}

/* ================================================================== */
/*  Visão Entregador                                                   */
/* ================================================================== */

function EntregaCard({ order, nowTs, variant, onStartRoute, onDelivered, onBackToKitchen, onCopied }) {
  const hInfo = horarioInfo(order, nowTs);
  const urgente = hInfo && hInfo.level === "urgente";
  const emRota = order.status === "em_rota";
  const comBebida = temBebida(order);
  const end = (order.endereco || "").trim();
  const [confirmVolta, setConfirmVolta] = useState(false);

  const tone = variant === "entregue"
    ? "border-slate-200 bg-white"
    : urgente ? "border-red-500 bg-red-50"
    : emRota ? "border-purple-500 bg-purple-50"
    : "border-slate-200 bg-white";

  return (
    <div id={"entrega-" + order.id} className={"rounded-2xl border-2 p-4 shadow-sm " + tone}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-400 leading-none mb-0.5">ENTREGAR PARA</div>
          <div className="text-2xl font-extrabold text-slate-900 leading-tight break-words">{order.nome}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {emRota && <span className="rounded-full bg-purple-600 text-white text-xs font-bold px-2 py-0.5">EM ROTA</span>}
          {variant === "entregue" && <span className="rounded-full bg-green-600 text-white text-xs font-bold px-2 py-0.5">ENTREGUE</span>}
          {comBebida && variant !== "entregue" && (
            <span className="rounded-full bg-cyan-600 text-white text-xs font-extrabold px-2 py-0.5 flex items-center gap-1 animate-pulse">
              <Coffee size={12} /> BEBIDA
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <HorarioBadge info={hInfo} tipo="entrega" />
        {order.readyAt && variant !== "entregue" && (
          <span className="rounded-lg bg-slate-100 text-slate-600 text-sm font-semibold px-3 py-1.5 flex items-center gap-1">
            <Clock size={14} /> pronto {relTime(order.readyAt, nowTs)}
          </span>
        )}
      </div>

      <div className="mt-3 rounded-xl border-2 border-indigo-300 bg-indigo-50 p-3">
        <div className="flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-indigo-700 mb-1">
          <MapPin size={14} /> Endereço
        </div>
        <p className="text-lg font-bold text-slate-900 leading-snug break-words">{end || "— endereço não informado —"}</p>
        {(order.referencia || "").trim() && (
          <p className="text-sm text-indigo-800 mt-1"><b>Referência:</b> {order.referencia}</p>
        )}
      </div>

      {variant !== "entregue" && end && (
        <div className="mt-2 grid grid-cols-3 gap-2">
          <a href={mapsUrl(order)} target="_blank" rel="noopener noreferrer"
            className="rounded-xl bg-emerald-600 text-white font-bold text-sm flex items-center justify-center gap-1 active:bg-emerald-700" style={{ minHeight: "50px" }}>
            <Navigation size={16} /> Maps
          </a>
          <a href={wazeUrl(order)} target="_blank" rel="noopener noreferrer"
            className="rounded-xl bg-sky-600 text-white font-bold text-sm flex items-center justify-center gap-1 active:bg-sky-700" style={{ minHeight: "50px" }}>
            <Navigation size={16} /> Waze
          </a>
          <button onClick={() => copiarTexto(enderecoCompleto(order), onCopied)}
            className="rounded-xl border-2 border-slate-300 text-slate-700 font-bold text-sm flex items-center justify-center gap-1" style={{ minHeight: "50px" }}>
            <Copy size={16} /> Copiar
          </button>
        </div>
      )}

      <PagamentoInfo order={order} size="lg" />

      <div className="mt-3 space-y-3">
        {order.itens.length ? order.itens.map((g, i) => {
          const beb = isBebidaCat(g.categoria);
          return (
            <div key={i} className={beb && variant !== "entregue" ? "rounded-xl border-4 border-cyan-500 bg-cyan-50 p-2.5 animate-pulse" : ""}>
              <div className={"text-xs font-bold uppercase tracking-wide mb-1 flex items-center gap-1 " + (beb ? "text-cyan-800" : "text-slate-400")}>
                {beb && <Coffee size={14} />} {g.categoria}{beb && variant !== "entregue" ? " — CONFIRA!" : ""}
              </div>
              <div className="flex flex-wrap gap-2">
                {g.valores.map((t, j) => (
                  <span key={j} className={"rounded-lg px-3 py-1.5 font-semibold " + (beb ? "bg-cyan-600 text-white font-extrabold" : g.destaque ? "bg-orange-600 text-white" : "bg-slate-800 text-white")}>
                    {beb ? "🥤 " : ""}{t}
                  </span>
                ))}
              </div>
            </div>
          );
        }) : <p className="text-slate-400 text-sm">Nenhum item marcado.</p>}
      </div>

      {(order.observacoes || "").trim() && (
        <div className="mt-3 rounded-xl border-2 border-red-500 bg-red-50 p-3">
          <div className="flex items-center gap-2 text-red-700 font-bold text-sm mb-1"><AlertTriangle size={18} /> OBSERVAÇÃO</div>
          <p className="text-red-800 font-semibold">{order.observacoes}</p>
        </div>
      )}

      {variant !== "entregue" && (
        <div className="mt-4 space-y-2">
          {!emRota ? (
            <button onClick={() => onStartRoute(order.id)} className="w-full rounded-xl font-extrabold text-lg bg-purple-600 text-white flex items-center justify-center gap-2 active:bg-purple-700" style={{ minHeight: "58px" }}>
              <Bike size={22} /> SAIR PARA ENTREGA
            </button>
          ) : (
            <button onClick={() => onDelivered(order.id)} className="w-full rounded-xl font-extrabold text-lg bg-green-600 text-white flex items-center justify-center gap-2 active:bg-green-700" style={{ minHeight: "58px" }}>
              <CheckCircle2 size={22} /> {aReceber(order) ? "RECEBER E ENTREGAR" : "ENTREGUE AO CLIENTE"}
            </button>
          )}
          {confirmVolta ? (
            <div className="flex gap-2">
              <button onClick={() => { onBackToKitchen(order.id); setConfirmVolta(false); }} className="flex-1 rounded-xl bg-amber-600 text-white font-bold" style={{ minHeight: "46px" }}>Sim, devolver</button>
              <button onClick={() => setConfirmVolta(false)} className="flex-1 rounded-xl bg-slate-200 text-slate-700 font-bold" style={{ minHeight: "46px" }}>Não</button>
            </div>
          ) : (
            <button onClick={() => setConfirmVolta(true)} className="w-full rounded-xl border-2 border-slate-300 text-slate-500 font-semibold text-sm" style={{ minHeight: "44px" }}>
              <RotateCcw size={14} className="inline mr-1" /> Devolver para a cozinha
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* Confirma que o entregador recebeu o valor antes de concluir a entrega. */
function RecebimentoModal({ order, onConfirm, onCancel }) {
  if (!order) return null;
  const troco = trocoDe(order);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
      <div className="w-full rounded-2xl bg-white p-5 shadow-xl" style={{ maxWidth: "420px" }}>
        <div className="flex items-center gap-2 text-amber-700 font-extrabold text-lg">
          <Banknote size={24} /> Recebeu o pagamento?
        </div>
        <p className="text-sm text-slate-600 mt-1">Pedido de <b>{order.nome}</b>:</p>
        <div className="mt-3 rounded-xl border-4 border-amber-500 bg-amber-50 p-3">
          <div className="text-3xl font-extrabold text-slate-900">{fmtBRL(order.valor)}</div>
          <div className="text-sm font-bold text-slate-700 mt-1">{formaLabel(order.formaPagamento)}</div>
          {troco > 0 && <div className="text-sm font-semibold text-amber-900 mt-1">Troco: {fmtBRL(troco)} (para {fmtBRL(order.trocoPara)})</div>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button onClick={onCancel} className="rounded-xl bg-slate-200 text-slate-700 font-bold" style={{ minHeight: "54px" }}>
            Ainda não
          </button>
          <button onClick={onConfirm} className="rounded-xl bg-green-600 text-white font-extrabold flex items-center justify-center gap-2 active:bg-green-700" style={{ minHeight: "54px" }}>
            <CheckCircle2 size={20} /> Recebi, entregue
          </button>
        </div>
      </div>
    </div>
  );
}

function EntregadorView({ orders, nowTs, headerH, onStartRoute, onDelivered, onBackToKitchen, onCopied }) {
  const [tab, setTab] = useState("aguardando");
  const [cobrando, setCobrando] = useState(null);

  /* Entrega com valor a receber passa pela confirmação do recebimento. */
  const delivered = (id) => {
    const o = orders.find((x) => x.id === id);
    if (o && aReceber(o)) { setCobrando(o); return; }
    onDelivered(id);
  };
  const confirmRecebimento = () => { const o = cobrando; setCobrando(null); if (o) onDelivered(o.id); };

  const aguardando = orders.filter((o) => o.status === "aguardando_entrega").sort((a, b) => targetTs(a, nowTs) - targetTs(b, nowTs));
  const emRota = orders.filter((o) => o.status === "em_rota").sort((a, b) => (a.outAt || 0) - (b.outAt || 0));
  const entregues = orders.filter((o) => o.status === "concluido" && o.tipo === "entrega").sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  /* Ao sair para entregar, leva o entregador direto para a aba "Em rota",
     senão ele ficaria olhando uma lista vazia. */
  const startRoute = (id) => { onStartRoute(id); setTab("rota"); };

  const somaReceber = (list) => list.filter(aReceber).reduce((t, o) => t + o.valor, 0);
  const trocoTotal = (tab === "aguardando" ? aguardando : emRota).reduce((t, o) => t + trocoDe(o), 0);
  const recebidos = entregues.filter((o) => aReceber(o) && o.recebidoAt);
  const recebidoTotal = recebidos.reduce((t, o) => t + o.valor, 0);
  const recebidoDinheiro = recebidos.filter((o) => o.formaPagamento === "dinheiro").reduce((t, o) => t + o.valor, 0);
  const aCobrar = somaReceber(tab === "aguardando" ? aguardando : emRota);

  const lista = tab === "aguardando" ? aguardando : tab === "rota" ? emRota : entregues;
  const vazio = tab === "aguardando" ? "Nenhuma entrega pronta no momento."
    : tab === "rota" ? "Você não está com nenhuma entrega em rota."
    : "Nenhuma entrega concluída ainda.";

  /* Todos os endereços pendentes, para montar uma rota única no Maps */
  const pendentes = [...emRota, ...aguardando].filter((o) => (o.endereco || "").trim());
  const rotaGeralUrl = pendentes.length > 1
    ? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${encodeURIComponent(pendentes[pendentes.length - 1].endereco.trim())}&waypoints=${pendentes.slice(0, -1).map((o) => encodeURIComponent(o.endereco.trim())).join("%7C")}`
    : null;

  return (
    <div>
      <div className="sticky z-20 px-3 py-3" style={{ top: headerH, backgroundColor: "#f1f5f9" }}>
        <div className="grid grid-cols-3 gap-1 bg-slate-200 rounded-xl p-1">
          <Tab active={tab === "aguardando"} onClick={() => setTab("aguardando")} count={aguardando.length}>Prontas</Tab>
          <Tab active={tab === "rota"} onClick={() => setTab("rota")} count={emRota.length}>Em rota</Tab>
          <Tab active={tab === "entregues"} onClick={() => setTab("entregues")} count={entregues.length}>Entregues</Tab>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {tab !== "entregues" && rotaGeralUrl && (
          <a href={rotaGeralUrl} target="_blank" rel="noopener noreferrer"
            className="w-full rounded-xl bg-slate-900 text-white font-bold flex items-center justify-center gap-2" style={{ minHeight: "50px" }}>
            <Navigation size={18} /> Rota com as {pendentes.length} entregas (Maps)
          </a>
        )}

        {tab !== "entregues" && aCobrar > 0 && (
          <div className="rounded-xl bg-amber-100 border-2 border-amber-300 px-3 py-2 text-sm font-bold text-amber-900 flex items-center gap-2">
            <Banknote size={18} className="shrink-0" />
            <span>A cobrar nesta aba: {fmtBRL(aCobrar)}{trocoTotal > 0 ? ` · leve ${fmtBRL(trocoTotal)} em troco` : ""}</span>
          </div>
        )}
        {tab === "entregues" && recebidoTotal > 0 && (
          <div className="rounded-xl bg-green-100 border-2 border-green-300 px-3 py-2 text-sm font-bold text-green-900 flex items-center gap-2">
            <Wallet size={18} className="shrink-0" />
            <span>Recebido nas entregas: {fmtBRL(recebidoTotal)}{recebidoDinheiro > 0 ? ` · em dinheiro: ${fmtBRL(recebidoDinheiro)}` : ""}</span>
          </div>
        )}

        {lista.length === 0 ? <Empty>{vazio}</Empty> : lista.map((o) => (
          <EntregaCard key={o.id} order={o} nowTs={nowTs} variant={tab === "entregues" ? "entregue" : "ativa"}
            onStartRoute={startRoute} onDelivered={delivered} onBackToKitchen={onBackToKitchen} onCopied={onCopied} />
        ))}
      </div>

      <RecebimentoModal order={cobrando} onConfirm={confirmRecebimento} onCancel={() => setCobrando(null)} />
    </div>
  );
}

/* ================================================================== */
/*  Visão Administração (cardápios)                                    */
/* ================================================================== */

function NovoDiaCard({ orders, messagesCount, onClearAll }) {
  const [confirmando, setConfirmando] = useState(false);
  const concluidos = orders.filter((o) => o.status === "concluido");
  const emAndamento = orders.filter((o) => !["concluido", "cancelado"].includes(o.status)).length;
  const vazio = orders.length === 0 && messagesCount === 0;

  return (
    <div className="rounded-2xl border-2 border-red-200 bg-red-50 p-4">
      <div className="flex items-center gap-2 font-bold text-red-800"><Trash2 size={18} /> Novo dia de vendas</div>
      <p className="text-sm text-red-900/80 mt-1">
        Apaga <b>todo o histórico</b> em todas as abas e em todos os aparelhos: pedidos (atendente, cozinha, entregador) e o chat.
        Os cardápios <b>não</b> são apagados.
      </p>
      <button onClick={() => setConfirmando(true)} disabled={vazio}
        className={"mt-3 w-full rounded-xl font-extrabold flex items-center justify-center gap-2 " + (vazio ? "bg-slate-200 text-slate-400" : "bg-red-600 text-white active:bg-red-700")} style={{ minHeight: "54px" }}>
        <Trash2 size={20} /> {vazio ? "Nada para apagar" : `Apagar todo o histórico (${orders.length} pedido${orders.length === 1 ? "" : "s"})`}
      </button>

      {confirmando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.55)" }}>
          <div className="w-full rounded-2xl bg-white p-5 shadow-xl" style={{ maxWidth: "420px" }}>
            <div className="flex items-center gap-2 text-red-700 font-extrabold text-lg"><AlertTriangle size={24} /> Apagar tudo e começar um novo dia?</div>
            <ul className="text-sm text-slate-700 mt-2 space-y-1">
              <li>• {orders.length} pedido(s) serão apagados de todos os aparelhos</li>
              {messagesCount > 0 && <li>• {messagesCount} mensagem(ns) do chat</li>}
            </ul>
            {emAndamento > 0 && (
              <p className="mt-2 rounded-lg bg-amber-100 text-amber-900 text-sm font-bold p-2 flex items-start gap-2">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> Atenção: {emAndamento} pedido(s) ainda estão em andamento (fila, preparo ou entrega) e também serão apagados.
              </p>
            )}
            <p className="text-xs text-slate-500 mt-2">Isso não pode ser desfeito. Se quiser guardar, gere o relatório antes.</p>
            <button onClick={() => gerarRelatorioPDF(concluidos)} disabled={!concluidos.length}
              className={"mt-3 w-full rounded-xl font-bold flex items-center justify-center gap-2 " + (concluidos.length ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-400")} style={{ minHeight: "48px" }}>
              <ClipboardList size={18} /> Gerar relatório (PDF) antes
            </button>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button onClick={() => setConfirmando(false)} className="rounded-xl bg-slate-200 text-slate-700 font-bold" style={{ minHeight: "54px" }}>Cancelar</button>
              <button onClick={() => { onClearAll(); setConfirmando(false); }} className="rounded-xl bg-red-600 text-white font-extrabold active:bg-red-700" style={{ minHeight: "54px" }}>Sim, apagar tudo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function AdminView({ menus, activeMenuId, onCreateMenu, onSaveMenu, onDeleteMenu, onSetActive, orders, messagesCount, onClearAll }) {
  const [selectedId, setSelectedId] = useState(activeMenuId || (menus[0] && menus[0].id));
  const [draft, setDraft] = useState(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const sel = menus.find((m) => m.id === selectedId);
    if (sel && !dirty) setDraft(JSON.parse(JSON.stringify(sel)));
    if (!sel && menus.length) setSelectedId(menus[0].id);
  }, [selectedId, menus]); // eslint-disable-line

  const edit = (fn) => { setDraft((d) => { const nd = JSON.parse(JSON.stringify(d)); fn(nd); return nd; }); setDirty(true); };
  const renameMenu = (nome) => edit((d) => { d.nome = nome; });
  const addCategoria = () => edit((d) => { d.categorias.push({ id: "cat_" + uid(), nome: "Nova categoria", itens: [] }); });
  const renameCategoria = (cid, nome) => edit((d) => { const c = d.categorias.find((c) => c.id === cid); if (c) c.nome = nome; });
  const deleteCategoria = (cid) => edit((d) => { d.categorias = d.categorias.filter((c) => c.id !== cid); });
  const addItem = (cid) => edit((d) => { const c = d.categorias.find((c) => c.id === cid); if (c) c.itens.push({ id: "item_" + uid(), label: "Novo item", tipo: "simples" }); });
  const updateItem = (cid, iid, patch) => edit((d) => { const c = d.categorias.find((c) => c.id === cid); if (!c) return; const it = c.itens.find((i) => i.id === iid); if (it) Object.assign(it, patch); });
  const deleteItem = (cid, iid) => edit((d) => { const c = d.categorias.find((c) => c.id === cid); if (c) c.itens = c.itens.filter((i) => i.id !== iid); });

  const save = () => { if (draft) { onSaveMenu(draft); setDirty(false); } };

  const cloneWithIds = (m, nome) => ({
    id: "menu_" + uid(),
    nome,
    categorias: m.categorias.map((c) => ({ id: "cat_" + uid(), nome: c.nome, itens: c.itens.map((it) => ({ ...it, id: "item_" + uid(), variacoes: it.variacoes ? [...it.variacoes] : undefined })) })),
  });
  const novo = () => { const nm = cloneWithIds(defaultMenu(), "Novo cardápio"); onCreateMenu(nm); setSelectedId(nm.id); setDirty(false); };
  const duplicar = (m) => { const nm = cloneWithIds(m, m.nome + " (cópia)"); onCreateMenu(nm); setSelectedId(nm.id); setDirty(false); };
  const excluir = (id) => { if (menus.length <= 1) return; const other = menus.find((m) => m.id !== id); onDeleteMenu(id); if (other) setSelectedId(other.id); setDirty(false); };

  const smallInput = "rounded-lg border-2 border-slate-200 px-3 py-2 outline-none focus:border-emerald-500";

  if (!menus.length || !draft) return <div className="p-4"><Empty>Carregando cardápios…</Empty></div>;

  return (
    <div className="p-4 space-y-5">
      <div className="rounded-2xl bg-slate-900 text-white p-4">
        <div className="flex items-center gap-2 font-bold"><Settings size={18} /> Administração de cardápios</div>
        <p className="text-sm text-slate-300 mt-1">Configure os itens que o atendente pode marcar. O cardápio marcado como “EM USO” é o que aparece no formulário — troque conforme o dia.</p>
      </div>

      <NovoDiaCard orders={orders} messagesCount={messagesCount} onClearAll={onClearAll} />

      <div className="space-y-2">
        <div className="text-sm font-bold text-slate-500 uppercase tracking-wide">Cardápios</div>
        {menus.map((m) => {
          const active = m.id === activeMenuId;
          const editing = m.id === selectedId;
          return (
            <div key={m.id} className={"rounded-xl border-2 p-3 " + (editing ? "border-emerald-500 bg-emerald-50" : "border-slate-200 bg-white")}>
              <div className="flex items-center justify-between gap-2">
                <button onClick={() => { setSelectedId(m.id); setDirty(false); }} className="flex items-center gap-2 min-w-0 text-left">
                  <span className="font-bold text-slate-800 truncate">{m.nome}</span>
                  {active && <span className="rounded-full bg-green-600 text-white text-xs font-bold px-2 py-0.5 shrink-0">EM USO</span>}
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  {!active && <button onClick={() => onSetActive(m.id)} className="rounded-lg bg-slate-900 text-white text-xs font-bold px-3 py-2 flex items-center gap-1"><Star size={14} /> Usar</button>}
                  <button onClick={() => duplicar(m)} className="rounded-lg bg-slate-100 text-slate-600 p-2" aria-label="Duplicar"><Copy size={16} /></button>
                  <button onClick={() => excluir(m.id)} disabled={menus.length <= 1} className={"rounded-lg p-2 " + (menus.length <= 1 ? "bg-slate-100 text-slate-300" : "bg-red-50 text-red-600")} aria-label="Excluir"><Trash2 size={16} /></button>
                </div>
              </div>
            </div>
          );
        })}
        <button onClick={novo} className="w-full rounded-xl border-2 border-dashed border-slate-300 text-slate-600 font-bold flex items-center justify-center gap-2 py-3"><Plus size={18} /> Novo cardápio</button>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-bold text-slate-500 uppercase tracking-wide">Editando cardápio</div>
          <button onClick={save} disabled={!dirty}
            className={"rounded-xl font-bold flex items-center gap-2 px-4 py-2 " + (dirty ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-400")}>
            <Save size={16} /> {dirty ? "Salvar alterações" : "Salvo"}
          </button>
        </div>

        <div>
          <div className="text-xs font-semibold text-slate-500 mb-1">Nome do cardápio</div>
          <input value={draft.nome} onChange={(e) => renameMenu(e.target.value)} className={"w-full font-bold " + smallInput} />
        </div>

        {draft.categorias.map((cat) => (
          <div key={cat.id} className="rounded-2xl border-2 border-slate-200 bg-white p-3 space-y-3">
            <div className="flex items-center gap-2">
              <input value={cat.nome} onChange={(e) => renameCategoria(cat.id, e.target.value)} className={"flex-1 font-bold " + smallInput} />
              <button onClick={() => deleteCategoria(cat.id)} className="rounded-lg bg-red-50 text-red-600 p-2 shrink-0" aria-label="Excluir categoria"><Trash2 size={16} /></button>
            </div>

            {cat.itens.map((item) => (
              <div key={item.id} className="rounded-xl bg-slate-50 border border-slate-200 p-2 space-y-2">
                <div className="flex items-center gap-2">
                  <input value={item.label} onChange={(e) => updateItem(cat.id, item.id, { label: e.target.value })} className={"flex-1 " + smallInput} />
                  <button onClick={() => deleteItem(cat.id, item.id)} className="rounded-lg bg-white text-red-500 border border-slate-200 p-2 shrink-0" aria-label="Excluir item"><X size={16} /></button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 shrink-0">Tipo:</span>
                  <select value={item.tipo} onChange={(e) => {
                    const tipo = e.target.value; const patch = { tipo };
                    if (tipo === "variacoes" && (!item.variacoes || !item.variacoes.length)) patch.variacoes = ["Opção 1", "Opção 2"];
                    updateItem(cat.id, item.id, patch);
                  }} className="rounded-lg border-2 border-slate-200 px-2 py-1.5 text-sm bg-white outline-none">
                    <option value="simples">Simples (marcar)</option>
                    <option value="variacoes">Múltipla escolha</option>
                    <option value="texto">Campo de texto</option>
                  </select>
                </div>
                {item.tipo === "variacoes" && (
                  <input value={(item.variacoes || []).join(", ")} onChange={(e) => updateItem(cat.id, item.id, { variacoes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                    placeholder="Opções separadas por vírgula (ex: Grelhado, Empanado)" className={"w-full text-sm " + smallInput} />
                )}
                {item.tipo === "texto" && (
                  <input value={item.placeholder || ""} onChange={(e) => updateItem(cat.id, item.id, { placeholder: e.target.value })}
                    placeholder="Texto de ajuda (ex: Sabor do refri)" className={"w-full text-sm " + smallInput} />
                )}
              </div>
            ))}

            <button onClick={() => addItem(cat.id)} className="w-full rounded-lg border-2 border-dashed border-slate-300 text-slate-600 font-semibold text-sm flex items-center justify-center gap-1 py-2"><Plus size={16} /> Adicionar item</button>
          </div>
        ))}

        <button onClick={addCategoria} className="w-full rounded-xl border-2 border-dashed border-slate-300 text-slate-600 font-bold flex items-center justify-center gap-2 py-3"><Plus size={18} /> Adicionar categoria</button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Chat + Toasts                                                      */
/* ================================================================== */

const ROLE_LABEL = { cozinha: "Cozinha", entregador: "Entregador", atendente: "Atendente" };

function ChatDrawer({ open, onClose, messages, role, onSend }) {
  const [text, setText] = useState("");
  const listRef = useRef(null);
  useEffect(() => { if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [open, messages]);
  if (!open) return null;

  const presets = role === "entregador"
    ? ["Saindo para a entrega", "Cliente não atendeu", "Endereço não encontrado", "Voltando para buscar mais pedidos"]
    : ["Acabou a farofa", "Sem batata frita no momento", "Prato pronto para servir", "Cliente desistiu de um item"];
  const send = () => { if (text.trim()) { onSend(text); setText(""); } };

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={onClose} />
      <div className="w-full bg-white h-full flex flex-col shadow-xl" style={{ maxWidth: "420px" }}>
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div className="flex items-center gap-2 font-bold text-slate-800"><MessageSquare size={20} /> Chat · Salão ⇄ Cozinha ⇄ Entrega</div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 active:bg-slate-100"><X size={22} /></button>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && <Empty>Nenhuma mensagem ainda.</Empty>}
          {messages.map((m) => {
            const mine = m.sender === role;
            return (
              <div key={m.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                <div className={"rounded-2xl px-4 py-2 " + (mine ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-800")} style={{ maxWidth: "82%" }}>
                  <div className={"text-xs font-bold mb-0.5 " + (mine ? "text-blue-100" : "text-slate-500")}>{ROLE_LABEL[m.sender] || "Atendente"}</div>
                  <div className="text-sm">{m.text}</div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="border-t border-slate-200 p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {presets.map((p, i) => (
              <button key={i} onClick={() => onSend(p)} className="rounded-full border border-slate-200 text-slate-600 text-xs px-3 py-2 active:bg-slate-100">{p}</button>
            ))}
          </div>
          <div className="flex gap-2 items-end">
            <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }}
              placeholder={`Escrever como ${ROLE_LABEL[role] || "Atendente"}...`}
              className="flex-1 rounded-xl border-2 border-slate-200 px-4 outline-none focus:border-blue-500" style={{ minHeight: "50px" }} />
            <button onClick={send} className="rounded-xl bg-blue-600 text-white px-4 flex items-center justify-center active:bg-blue-700" style={{ minHeight: "50px" }}><Send size={20} /></button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Aviso central de chegada: some sozinho em 3 s ou ao tocar em OK.
   Vários avisos seguidos do mesmo tipo se juntam num só, com todos os nomes. */
const ALERTA_MS = 3000;
const ALERTA_ESTILO = {
  pedido:    { titulo: "NOVO PEDIDO!",   plural: "NOVOS PEDIDOS!",   cor: "bg-emerald-600", barra: "bg-emerald-600", icon: <ChefHat size={30} /> },
  entrega:   { titulo: "NOVA ENTREGA!",  plural: "NOVAS ENTREGAS!",  cor: "bg-purple-600",  barra: "bg-purple-600",  icon: <Bike size={30} /> },
  devolvido: { titulo: "PEDIDO DEVOLVIDO", plural: "PEDIDOS DEVOLVIDOS", cor: "bg-amber-600", barra: "bg-amber-600", icon: <RotateCcw size={30} /> },
};

function AlertaPopup({ alerta, onClose }) {
  if (!alerta) return null;
  const st = ALERTA_ESTILO[alerta.tipo] || ALERTA_ESTILO.pedido;
  const varios = alerta.nomes.length > 1;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-6" style={{ backgroundColor: "rgba(0,0,0,0.35)" }} onClick={onClose}>
      <div className="w-full rounded-2xl bg-white shadow-2xl overflow-hidden" style={{ maxWidth: "360px" }} onClick={(e) => e.stopPropagation()}>
        <div className={"text-white px-5 py-4 flex items-center gap-3 " + st.cor}>
          <Bell size={30} className="shrink-0 animate-pulse" />
          <div className="text-2xl font-extrabold leading-tight">{varios ? `${alerta.nomes.length} ${st.plural}` : st.titulo}</div>
        </div>
        <div className="px-5 py-4">
          <div className="flex items-center gap-2 text-slate-400 mb-1">{st.icon}</div>
          {alerta.nomes.slice(-5).map((n, i) => (
            <div key={i} className="text-xl font-extrabold text-slate-900 break-words">{n}</div>
          ))}
          {alerta.nomes.length > 5 && <div className="text-sm text-slate-500">+{alerta.nomes.length - 5} outro(s)</div>}
          {alerta.detalhe && <div className="text-sm font-semibold text-slate-500 mt-1">{alerta.detalhe}</div>}
          <button onClick={onClose} className={"mt-4 w-full rounded-xl text-white font-extrabold text-lg " + st.cor} style={{ minHeight: "54px" }}>OK</button>
        </div>
        <div className="h-1.5 w-full bg-slate-100">
          <div key={alerta.seq} className={"h-full " + st.barra} style={{ animation: `undobar ${ALERTA_MS}ms linear forwards` }} />
        </div>
      </div>
    </div>
  );
}

function Toasts({ toasts, onUndo }) {
  if (!toasts.length) return null;
  return (
    <div className="fixed left-0 right-0 z-50 flex flex-col items-center gap-2 px-4" style={{ bottom: "16px" }}>
      {toasts.map((t) => (
        <div key={t.id} className="w-full rounded-xl bg-slate-900 text-white px-4 py-3 shadow-lg flex items-center gap-3" style={{ maxWidth: "420px" }}>
          {t.type === "undo" ? (
            <>
              <CheckCircle2 size={22} className="text-green-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-bold truncate">Pedido de {t.nome} {t.message || "concluído"}</div>
                <div className="mt-1 h-1 w-full rounded overflow-hidden" style={{ backgroundColor: "rgba(255,255,255,0.2)" }}>
                  <div className="h-full bg-green-400" style={{ animation: "undobar 5s linear forwards" }} />
                </div>
              </div>
              <button onClick={() => onUndo(t)} className="font-bold text-amber-300 flex items-center gap-1 shrink-0"><Undo2 size={16} /> Desfazer</button>
            </>
          ) : t.type === "success" ? (
            <>
              <CheckCircle2 size={22} className="text-green-400 shrink-0" />
              <div className="flex-1 text-sm font-semibold">{t.message}</div>
            </>
          ) : (
            <>
              <Bell size={20} className="text-amber-300 shrink-0" />
              <div className="flex-1 text-sm font-semibold">{t.message}</div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/*  Tela de configuração pendente                                      */
/* ================================================================== */

function SetupNeeded() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ backgroundColor: "#f1f5f9" }}>
      <div className="max-w-md w-full rounded-2xl bg-white border-2 border-slate-200 p-6 space-y-3">
        <div className="flex items-center gap-2 font-extrabold text-slate-800 text-lg"><WifiOff size={22} /> Falta configurar o Supabase</div>
        <p className="text-sm text-slate-600">Abra o arquivo <b>src/config.js</b> e preencha as duas linhas com os dados do seu projeto Supabase:</p>
        <pre className="rounded-lg bg-slate-900 text-slate-100 text-xs p-3 overflow-x-auto">SUPABASE_URL = "https://...supabase.co"{"\n"}SUPABASE_ANON_KEY = "eyJ..."</pre>
        <p className="text-sm text-slate-600">Os valores estão em <b>Supabase → Project Settings → API</b>. Depois de salvar, o site publicado se atualiza sozinho. Veja o passo a passo no arquivo <b>README.md</b>.</p>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  App com Supabase (tempo real)                                      */
/* ================================================================== */

function ComandaApp() {
  const [view, setView] = useState("atendente");
  const [orders, setOrders] = useState([]);
  const [menus, setMenus] = useState([]);
  const [activeMenuId, setActiveMenuId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [soundOn, setSoundOn] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [lastOpen, setLastOpen] = useState({ atendente: Date.now(), cozinha: Date.now(), entregador: Date.now() });
  const [toasts, setToasts] = useState([]);
  const [nowTs, setNowTs] = useState(Date.now());
  const [prefill, setPrefill] = useState(null);
  const [formSeed, setFormSeed] = useState(0);
  const [ready, setReady] = useState(false);
  const [connError, setConnError] = useState("");

  const [alerta, setAlerta] = useState(null);
  const alertaTimer = useRef(null);

  const audioRef = useRef(null);
  const timers = useRef({});
  const headerRef = useRef(null);
  const [headerH, setHeaderH] = useState(0);

  const role = view === "cozinha" ? "cozinha" : view === "entregador" ? "entregador" : "atendente";
  const roleRef = useRef(role); roleRef.current = role;
  const soundOnRef = useRef(soundOn); soundOnRef.current = soundOn;

  const unread = messages.filter((m) => m.sender !== role && m.ts > (lastOpen[role] || 0)).length;
  const activeMenu = menus.find((m) => m.id === activeMenuId) || menus[0] || null;

  useEffect(() => { const i = setInterval(() => setNowTs(Date.now()), 10000); return () => clearInterval(i); }, []);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

  // mede a altura do cabeçalho para posicionar os menus fixos logo abaixo dele
  useEffect(() => {
    const measure = () => { if (headerRef.current) setHeaderH(headerRef.current.offsetHeight); };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [view]);

  /* Sons */
  const playTone = (freqs, type, gain) => {
    if (!soundOnRef.current) return;
    try {
      if (!audioRef.current) { const AC = window.AudioContext || window.webkitAudioContext; audioRef.current = new AC(); }
      const ctx = audioRef.current;
      if (ctx.state === "suspended") ctx.resume();
      const t0 = ctx.currentTime;
      freqs.forEach((fr, i) => {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.type = type || "sine"; o.frequency.value = fr;
        const s = t0 + i * 0.14; const gv = gain || 0.15;
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(gv, s + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, s + 0.22);
        o.connect(g); g.connect(ctx.destination); o.start(s); o.stop(s + 0.24);
      });
    } catch (e) { /* ignore */ }
  };
  /* Os navegadores (principalmente iPhone) só liberam o som depois de um toque
     na tela. Criamos/retomamos o áudio a cada toque, para que os avisos que
     chegam depois (sem toque) consigam tocar. */
  useEffect(() => {
    const unlock = () => {
      try {
        if (!audioRef.current) { const AC = window.AudioContext || window.webkitAudioContext; audioRef.current = new AC(); }
        if (audioRef.current.state === "suspended") audioRef.current.resume();
      } catch (e) { /* ignore */ }
    };
    const evs = ["pointerdown", "touchstart", "keydown"];
    evs.forEach((ev) => window.addEventListener(ev, unlock, { passive: true }));
    return () => evs.forEach((ev) => window.removeEventListener(ev, unlock));
  }, []);

  const dingNewOrder = () => playTone([784, 1046, 1318], "triangle", 0.18);
  const chimeDone = () => playTone([880, 660], "sine", 0.16);
  const blipChat = () => playTone([1174], "sine", 0.12);

  /* Toasts */
  const removeToast = (id) => { setToasts((t) => t.filter((x) => x.id !== id)); const tm = timers.current[id]; if (tm) { clearTimeout(tm); delete timers.current[id]; } };
  const pushToast = (toast) => { const id = uid(); setToasts((t) => [...t, { ...toast, id }]); timers.current[id] = setTimeout(() => removeToast(id), toast.duration || 2500); };

  /* Popup de chegada (cozinha / entregador) */
  const fecharAlerta = () => { clearTimeout(alertaTimer.current); setAlerta(null); };
  const mostrarAlerta = (tipo, nome, detalhe) => {
    setAlerta((a) => (a && a.tipo === tipo
      ? { ...a, nomes: [...a.nomes, nome], detalhe: "", seq: a.seq + 1 }
      : { tipo, nomes: [nome], detalhe, seq: 0 }));
    clearTimeout(alertaTimer.current);
    alertaTimer.current = setTimeout(() => setAlerta(null), ALERTA_MS);
  };
  useEffect(() => () => clearTimeout(alertaTimer.current), []);
  // O aviso é de quem está na aba: ao trocar de aba, ele some.
  useEffect(() => { fecharAlerta(); }, [view]); // eslint-disable-line

  /* Atualizações idempotentes de estado */
  const upsertOrder = (o) => setOrders((prev) => { const i = prev.findIndex((x) => x.id === o.id); if (i === -1) return [...prev, o]; const cp = [...prev]; cp[i] = o; return cp; });
  const removeOrder = (id) => setOrders((prev) => prev.filter((o) => o.id !== id));
  const upsertMessage = (m) => setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev.map((x) => (x.id === m.id ? m : x)) : [...prev, m]));
  const upsertMenu = (m) => setMenus((prev) => { const i = prev.findIndex((x) => x.id === m.id); if (i === -1) return [...prev, m]; const cp = [...prev]; cp[i] = m; return cp; });
  const removeMenu = (id) => setMenus((prev) => prev.filter((m) => m.id !== id));

  const dbFail = (error) => { if (error) { console.error(error); pushToast({ type: "info", message: "Falha ao salvar. Verifique a conexão.", duration: 3000 }); } };

  /* Carregar dados + inscrever no tempo real */
  useEffect(() => {
    let channel;
    (async () => {
      try {
        await supabase.from("menus").upsert([menuToRow(defaultMenu()), menuToRow(feijoadaMenu())], { onConflict: "id", ignoreDuplicates: true });
        await supabase.from("app_settings").upsert({ id: "singleton", active_menu_id: "menu_padrao" }, { onConflict: "id", ignoreDuplicates: true });

        const [mRes, sRes, oRes, gRes] = await Promise.all([
          supabase.from("menus").select("*"),
          supabase.from("app_settings").select("*").eq("id", "singleton").maybeSingle(),
          supabase.from("orders").select("*").order("created_at", { ascending: true }),
          supabase.from("messages").select("*").order("ts", { ascending: true }),
        ]);
        if (mRes.error) throw mRes.error;
        if (oRes.error) throw oRes.error;

        setMenus((mRes.data || []).map(menuFromRow));
        setActiveMenuId((sRes.data && sRes.data.active_menu_id) || "menu_padrao");
        setOrders((oRes.data || []).map(orderFromRow));
        setMessages((gRes.data || []).map(msgFromRow));
        setReady(true);

        channel = supabase
          .channel("comanda")
          .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, (p) => {
            if (p.eventType === "DELETE") { removeOrder(p.old.id); return; }
            const o = orderFromRow(p.new); upsertOrder(o);
            const statusMudou = (st) => p.eventType === "UPDATE" && p.new.status === st && (!p.old || p.old.status !== st);
            if (p.eventType === "INSERT" && roleRef.current === "cozinha") {
              dingNewOrder();
              mostrarAlerta("pedido", o.nome, o.tipo === "entrega" ? "🚲 Entrega" + (o.horario ? ` · ${o.horario}` : "") : o.horario ? `Servir ${o.horario}` : "");
            }
            if (statusMudou("na_fila") && p.old && ENTREGA_STATUS.includes(p.old.status) && roleRef.current === "cozinha") {
              dingNewOrder();
              mostrarAlerta("devolvido", o.nome, "O entregador devolveu para a cozinha");
            }
            if (p.eventType === "UPDATE" && p.new.status === "concluido" && (!p.old || p.old.status !== "concluido") && roleRef.current === "atendente") chimeDone();
            if (p.eventType === "UPDATE" && p.new.recebido_at && (!p.old || !p.old.recebido_at) && roleRef.current === "atendente")
              pushToast({ type: "success", message: `Entregador recebeu ${fmtBRL(o.valor)} (${formaLabel(o.formaPagamento)}) de ${o.nome}`, duration: 4000 });
            if (statusMudou("aguardando_entrega") && roleRef.current === "entregador") {
              dingNewOrder();
              mostrarAlerta("entrega", o.nome, (o.endereco || "").trim());
            }
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (p) => {
            if (p.eventType === "DELETE") { setMessages((prev) => prev.filter((x) => x.id !== p.old.id)); return; }
            if (p.eventType !== "INSERT") return;
            const m = msgFromRow(p.new); upsertMessage(m);
            if (m.sender !== roleRef.current) blipChat();
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "menus" }, (p) => {
            if (p.eventType === "DELETE") { removeMenu(p.old.id); return; }
            upsertMenu(menuFromRow(p.new));
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "app_settings" }, (p) => {
            if (p.new && p.new.active_menu_id) setActiveMenuId(p.new.active_menu_id);
          })
          .subscribe();
      } catch (e) {
        console.error(e);
        setConnError(e.message || "Erro de conexão com o Supabase.");
      }
    })();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, []);

  // Pulados voltam automaticamente para a fila após 20 minutos
  useEffect(() => {
    if (!ready) return;
    const expirados = orders.filter((o) => o.status === "pulado" && o.skippedAt && nowTs - o.skippedAt >= SKIP_RETURN_MS);
    expirados.forEach((o) => {
      upsertOrder({ ...o, status: "na_fila", skippedAt: null });
      supabase.from("orders").update({ status: "na_fila", skipped_at: null }).eq("id", o.id).then(({ error }) => dbFail(error));
    });
  }, [nowTs, ready]); // eslint-disable-line

  /* Ações — atualização otimista + gravação no banco */
  const createOrder = (data, editId) => {
    if (editId) {
      const cur = orders.find((x) => x.id === editId);
      if (!cur) return;
      const upd = { ...cur, ...data, edited: true };
      upsertOrder(upd);
      pushToast({ type: "success", message: `Pedido de ${data.nome} atualizado`, duration: 2500 });
      supabase.from("orders").update({
        nome: data.nome, tipo: data.tipo, horario: data.horario, observacoes: data.observacoes,
        endereco: data.endereco || "", referencia: data.referencia || "",
        pagamento: data.pagamento || "", valor: data.valor, forma_pagamento: data.formaPagamento || "", troco_para: data.trocoPara,
        itens: data.itens, selections: data.selections, edited: true,
      }).eq("id", editId).then(({ error }) => dbFail(error));
      return;
    }
    const o = { id: uid(), createdAt: Date.now(), completedAt: null, status: "na_fila", edited: false, skippedAt: null, ...data };
    upsertOrder(o);
    pushToast({ type: "success", message: `Pedido de ${data.nome} enviado para a cozinha`, duration: 2500 });
    supabase.from("orders").insert(orderToRow(o)).then(({ error }) => dbFail(error));
  };
  const cancelOrder = (id) => {
    const o = orders.find((x) => x.id === id); if (!o || o.status === "concluido" || o.status === "cancelado") return;
    upsertOrder({ ...o, status: "cancelado" });
    pushToast({ type: "info", message: `Pedido de ${o.nome} cancelado`, duration: 2500 });
    supabase.from("orders").update({ status: "cancelado" }).eq("id", id).then(({ error }) => dbFail(error));
  };
  const prepareToggle = (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    const ns = o.status === "preparando" ? "na_fila" : "preparando";
    upsertOrder({ ...o, status: ns });
    supabase.from("orders").update({ status: ns }).eq("id", id).then(({ error }) => dbFail(error));
  };
  const skipOrder = (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    const ts = Date.now();
    upsertOrder({ ...o, status: "pulado", skippedAt: ts });
    supabase.from("orders").update({ status: "pulado", skipped_at: ts }).eq("id", id).then(({ error }) => dbFail(error));
  };
  const backToQueue = (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    upsertOrder({ ...o, status: "na_fila", skippedAt: null });
    supabase.from("orders").update({ status: "na_fila", skipped_at: null }).eq("id", id).then(({ error }) => dbFail(error));
  };
  const completeOrder = (id) => {
    const o = orders.find((x) => x.id === id); if (!o || o.status === "concluido") return;
    const prevStatus = o.status; const ts = Date.now();
    upsertOrder({ ...o, status: "concluido", completedAt: ts, skippedAt: null });
    pushToast({ type: "undo", nome: o.nome, orderId: id, prevStatus, duration: 5000 });
    supabase.from("orders").update({ status: "concluido", completed_at: ts, skipped_at: null }).eq("id", id).then(({ error }) => dbFail(error));
  };
  const undoComplete = (toast) => {
    const o = orders.find((x) => x.id === toast.orderId);
    const patch = { status: toast.prevStatus, completed_at: null };
    if (toast.paraEntregador) patch.ready_at = null; // desfazer envio ao entregador
    if (toast.recebido) patch.recebido_at = null; // desfazer recebimento na entrega
    if (o) upsertOrder({ ...o, status: toast.prevStatus, completedAt: null, readyAt: toast.paraEntregador ? null : o.readyAt, recebidoAt: toast.recebido ? null : o.recebidoAt });
    removeToast(toast.id);
    supabase.from("orders").update(patch).eq("id", toast.orderId).then(({ error }) => dbFail(error));
  };
  /* --- Fluxo de entrega ------------------------------------------- */
  const sendToDelivery = (id) => {
    const o = orders.find((x) => x.id === id); if (!o || o.status === "aguardando_entrega") return;
    const prevStatus = o.status; const ts = Date.now();
    upsertOrder({ ...o, status: "aguardando_entrega", readyAt: ts, skippedAt: null });
    pushToast({ type: "undo", nome: o.nome, orderId: id, prevStatus, paraEntregador: true, message: "enviado ao entregador", duration: 5000 });
    supabase.from("orders").update({ status: "aguardando_entrega", ready_at: ts, skipped_at: null }).eq("id", id).then(({ error }) => dbFail(error));
  };
  const startRoute = (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    const ts = Date.now();
    upsertOrder({ ...o, status: "em_rota", outAt: ts });
    pushToast({ type: "success", message: `Saindo para entregar: ${o.nome}`, duration: 2500 });
    supabase.from("orders").update({ status: "em_rota", out_at: ts }).eq("id", id).then(({ error }) => dbFail(error));
  };
  /* Entregador concluiu: se havia valor a receber, registra o recebimento. */
  const deliverOrder = (id) => {
    const o = orders.find((x) => x.id === id); if (!o || o.status === "concluido") return;
    if (!aReceber(o)) { completeOrder(id); return; }
    const prevStatus = o.status; const ts = Date.now();
    upsertOrder({ ...o, status: "concluido", completedAt: ts, recebidoAt: ts, skippedAt: null });
    pushToast({ type: "undo", nome: o.nome, orderId: id, prevStatus, recebido: true, message: `entregue · ${fmtBRL(o.valor)} recebido`, duration: 5000 });
    supabase.from("orders").update({ status: "concluido", completed_at: ts, recebido_at: ts, skipped_at: null }).eq("id", id).then(({ error }) => dbFail(error));
  };
  const backToKitchen = (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    upsertOrder({ ...o, status: "na_fila", readyAt: null, outAt: null });
    pushToast({ type: "info", message: `Pedido de ${o.nome} devolvido à cozinha`, duration: 2500 });
    supabase.from("orders").update({ status: "na_fila", ready_at: null, out_at: null }).eq("id", id).then(({ error }) => dbFail(error));
  };

  const clearHistory = () => {
    const ids = orders.filter((o) => o.status === "concluido").map((o) => o.id);
    setOrders((prev) => prev.filter((o) => o.status !== "concluido"));
    if (ids.length) supabase.from("orders").delete().in("id", ids).then(({ error }) => dbFail(error));
  };

  /* Novo dia: apaga TODOS os pedidos (qualquer situação) e o chat, em todos os aparelhos. */
  const clearAllDay = () => {
    setOrders([]); setMessages([]); setPrefill(null);
    supabase.from("orders").delete().neq("id", "").then(({ error }) => dbFail(error));
    supabase.from("messages").delete().neq("id", "").then(({ error }) => dbFail(error));
    pushToast({ type: "success", message: "Histórico apagado — pronto para um novo dia!", duration: 3000 });
  };

  const repeatOrder = (order) => {
    setPrefill({ mode: "repeat", tipo: order.tipo, horario: order.horario, observacoes: order.observacoes, endereco: order.endereco, referencia: order.referencia, selections: order.selections });
    setFormSeed((n) => n + 1);
    setView("atendente");
  };
  const editOrder = (order) => {
    setPrefill({ mode: "edit", editId: order.id, nome: order.nome, tipo: order.tipo, horario: order.horario, observacoes: order.observacoes, endereco: order.endereco, referencia: order.referencia,
      pagamento: order.pagamento, valor: order.valor, formaPagamento: order.formaPagamento, trocoPara: order.trocoPara, selections: order.selections });
    setFormSeed((n) => n + 1);
    setView("atendente");
  };
  const consumedPrefill = () => setPrefill(null);

  /* Cardápios */
  const createMenu = (m) => { upsertMenu(m); supabase.from("menus").insert(menuToRow(m)).then(({ error }) => dbFail(error)); };
  const saveMenu = (m) => { upsertMenu(m); supabase.from("menus").upsert(menuToRow(m), { onConflict: "id" }).then(({ error }) => dbFail(error)); pushToast({ type: "success", message: "Cardápio salvo", duration: 2000 }); };
  const deleteMenu = (id) => { removeMenu(id); supabase.from("menus").delete().eq("id", id).then(({ error }) => dbFail(error)); };
  const setActive = (id) => { setActiveMenuId(id); supabase.from("app_settings").upsert({ id: "singleton", active_menu_id: id }, { onConflict: "id" }).then(({ error }) => dbFail(error)); };

  /* Chat */
  const openChat = () => { setChatOpen(true); setLastOpen((l) => ({ ...l, [role]: Date.now() })); };
  const sendMessage = (text) => {
    const t = text.trim(); if (!t) return;
    const m = { id: uid(), sender: role, text: t, ts: Date.now() };
    upsertMessage(m);
    setLastOpen((l) => ({ ...l, [role]: Date.now() }));
    supabase.from("messages").insert(msgToRow(m)).then(({ error }) => dbFail(error));
  };

  const entregasPendentes = orders.filter((o) => isEntregaAtiva(o)).length;

  const navBtn = (target, icon, label, count) => (
    <button onClick={() => setView(target)}
      className={"rounded-lg font-bold flex items-center justify-center gap-1.5 text-sm " + (view === target ? "bg-white text-slate-900 shadow" : "text-slate-500")} style={{ minHeight: "46px" }}>
      {icon} {label}
      {typeof count === "number" && count > 0 && (
        <span className={"rounded-full text-xs px-1.5 " + (view === target ? "bg-purple-600 text-white" : "bg-purple-500 text-white")}>{count}</span>
      )}
    </button>
  );

  return (
    <div className="min-h-screen flex flex-col text-slate-900" style={{ backgroundColor: "#f1f5f9" }}>
      <style>{`@keyframes undobar{from{width:100%}to{width:0%}}`}</style>

      <header ref={headerRef} className="sticky top-0 z-30 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between px-4 py-3 max-w-xl mx-auto w-full">
          <div className="flex items-center gap-2 font-extrabold text-slate-800">
            <span className="rounded-lg bg-emerald-600 text-white p-1.5"><Utensils size={18} /></span>
            Comanda Digital
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setView("admin")} className={"rounded-xl p-2 " + (view === "admin" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600")} aria-label="Administração"><Settings size={22} /></button>
            <button onClick={() => setSoundOn((s) => !s)} className={"rounded-xl p-2 " + (soundOn ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-400")} aria-label="Alternar som">
              {soundOn ? <Volume2 size={22} /> : <VolumeX size={22} />}
            </button>
            <button onClick={openChat} className="relative rounded-xl p-2 bg-slate-100 text-slate-600" aria-label="Abrir chat">
              <MessageSquare size={22} />
              {unread > 0 && (
                <span className="absolute rounded-full bg-red-500 text-white text-xs font-bold flex items-center justify-center" style={{ top: "-4px", right: "-4px", width: "20px", height: "20px" }}>{unread}</span>
              )}
            </button>
          </div>
        </div>

        <div className="px-4 pb-3 max-w-xl mx-auto w-full">
          <div className="grid grid-cols-3 gap-1 bg-slate-200 rounded-xl p-1">
            {navBtn("atendente", <User size={18} />, "Atendente")}
            {navBtn("cozinha", <ChefHat size={18} />, "Cozinha")}
            {navBtn("entregador", <Bike size={18} />, "Entregador", entregasPendentes)}
          </div>
          {view === "admin" && <div className="mt-2 text-center text-xs font-semibold text-slate-500">Modo administração — toque em Atendente ou Cozinha para voltar</div>}
        </div>
      </header>

      <main className="flex-1 max-w-xl mx-auto w-full">
        {connError && (
          <div className="p-4"><div className="rounded-xl bg-red-50 border-2 border-red-300 text-red-700 p-4 text-sm">Erro de conexão: {connError}. Confira as chaves do Supabase e se o script SQL foi executado.</div></div>
        )}
        {!ready && !connError ? (
          <div className="p-8"><Empty>Conectando…</Empty></div>
        ) : (
          <>
            {view === "atendente" && (activeMenu ? (
              <AtendenteView orders={orders} menu={activeMenu} prefill={prefill} formSeed={formSeed} nowTs={nowTs} headerH={headerH}
                onCreate={createOrder} onEdit={editOrder} onCancel={cancelOrder} onRepeat={repeatOrder} onConsumedPrefill={consumedPrefill} />
            ) : <div className="p-8"><Empty>Nenhum cardápio ativo. Vá em Administração.</Empty></div>)}
            {view === "cozinha" && (
              <CozinhaView orders={orders} nowTs={nowTs} headerH={headerH} onPrepare={prepareToggle} onComplete={completeOrder} onSkip={skipOrder} onBackToQueue={backToQueue} onClearHistory={clearHistory} onSendToDelivery={sendToDelivery} />
            )}
            {view === "entregador" && (
              <EntregadorView orders={orders} nowTs={nowTs} headerH={headerH} onStartRoute={startRoute} onDelivered={deliverOrder} onBackToKitchen={backToKitchen}
                onCopied={() => pushToast({ type: "success", message: "Endereço copiado", duration: 1800 })} />
            )}
            {view === "admin" && (
              <AdminView menus={menus} activeMenuId={activeMenuId} onCreateMenu={createMenu} onSaveMenu={saveMenu} onDeleteMenu={deleteMenu} onSetActive={setActive}
                orders={orders} messagesCount={messages.length} onClearAll={clearAllDay} />
            )}
          </>
        )}
      </main>

      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} messages={messages} role={role} onSend={sendMessage} />
      <Toasts toasts={toasts} onUndo={undoComplete} />
      <AlertaPopup alerta={alerta} onClose={fecharAlerta} />
    </div>
  );
}

export default function App() {
  if (!isConfigured) return <SetupNeeded />;
  return <ComandaApp />;
}
