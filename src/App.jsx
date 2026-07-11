import { useState, useRef, useEffect } from "react";
import {
  Utensils, ChefHat, User, Settings, Volume2, VolumeX, MessageSquare, Send, X, Check,
  SkipForward, RotateCcw, CheckCircle2, AlertTriangle, Clock, Timer, Trash2, Undo2,
  ClipboardList, Plus, Bell, Copy, Home, Bike, Star, Save, WifiOff,
} from "lucide-react";
import { supabase, isConfigured } from "./supabaseClient";

/* ================================================================== */
/*  Utilitários                                                        */
/* ================================================================== */

const STATUS = {
  na_fila:    { label: "Na Fila",    classes: "bg-slate-200 text-slate-700" },
  preparando: { label: "Preparando", classes: "bg-blue-100 text-blue-700" },
  pulado:     { label: "Pulado",     classes: "bg-amber-100 text-amber-800" },
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
      return { categoria: cat.nome, valores, destaque: isProteinCat(cat.nome) };
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
});
const orderToRow = (o) => ({
  id: o.id, nome: o.nome, tipo: o.tipo, horario: o.horario || "", status: o.status,
  itens: o.itens, selections: o.selections, observacoes: o.observacoes || "",
  created_at: o.createdAt, completed_at: o.completedAt,
});
const msgFromRow = (r) => ({ id: r.id, sender: r.sender, text: r.content, ts: Number(r.ts) });
const msgToRow = (m) => ({ id: m.id, sender: m.sender, content: m.text, ts: m.ts });
const menuFromRow = (r) => ({ id: r.id, nome: r.nome, categorias: r.categorias || [] });
const menuToRow = (m) => ({ id: m.id, nome: m.nome, categorias: m.categorias });

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

/* ================================================================== */
/*  Formulário de pedido                                               */
/* ================================================================== */

function buildInitialForm(initial) {
  if (initial) {
    return {
      nome: "",
      tipo: initial.tipo || "local",
      horario: initial.horario || "",
      obs: initial.observacoes || "",
      selections: JSON.parse(JSON.stringify(initial.selections || {})),
    };
  }
  return { nome: "", tipo: "local", horario: "", obs: "", selections: {} };
}

function OrderForm({ menu, initial, onSubmit, onConsumedPrefill }) {
  const [f, setF] = useState(() => buildInitialForm(initial));

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

  const canSubmit = f.nome.trim().length > 0;
  const submit = () => {
    if (!canSubmit) return;
    onSubmit({
      nome: f.nome.trim(),
      tipo: f.tipo,
      horario: f.horario,
      observacoes: f.obs.trim(),
      selections: JSON.parse(JSON.stringify(f.selections)),
      itens: resolveItens(menu, f.selections),
    });
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
        {!canSubmit && <p className="text-center text-xs text-slate-400 mb-1">Informe o nome para enviar</p>}
        <button onClick={submit} disabled={!canSubmit}
          className={"w-full rounded-2xl font-extrabold text-lg flex items-center justify-center gap-2 " + (canSubmit ? "bg-green-600 text-white active:bg-green-700" : "bg-slate-300 text-slate-500")} style={{ minHeight: "60px" }}>
          <Send size={22} /> Enviar para Cozinha
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Visão Atendente                                                    */
/* ================================================================== */

function AtendenteView({ orders, menu, prefill, formSeed, nowTs, onCreate, onCancel, onRepeat, onConsumedPrefill }) {
  const [sub, setSub] = useState("novo");
  const [confirmingId, setConfirmingId] = useState(null);

  useEffect(() => { if (prefill) setSub("novo"); }, [formSeed]); // eslint-disable-line

  const activeCount = orders.filter((o) => ["na_fila", "preparando", "pulado"].includes(o.status)).length;
  const recent = [...orders].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div>
      <div className="p-3">
        <div className="grid grid-cols-2 gap-1 bg-slate-200 rounded-xl p-1">
          <Tab active={sub === "novo"} onClick={() => setSub("novo")} icon={<Plus size={18} />}>Novo Pedido</Tab>
          <Tab active={sub === "enviados"} onClick={() => setSub("enviados")} icon={<ClipboardList size={18} />} count={activeCount}>Enviados</Tab>
        </div>
      </div>

      {sub === "novo" ? (
        <OrderForm key={formSeed} menu={menu} initial={prefill} onSubmit={onCreate} onConsumedPrefill={onConsumedPrefill} />
      ) : (
        <div className="p-4 space-y-3">
          {recent.length === 0 && <Empty>Nenhum pedido enviado ainda.</Empty>}
          {recent.map((o) => (
            <div key={o.id} className="rounded-2xl border-2 border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="rounded-lg bg-slate-900 text-white px-3 py-1 font-extrabold text-lg truncate" style={{ maxWidth: "170px" }}>{o.nome}</div>
                  <StatusBadge status={o.status} />
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

              <p className={"mt-2 text-sm " + (o.status === "cancelado" ? "line-through text-slate-400" : "text-slate-600")}>{flatSummary(o)}</p>
              {o.observacoes.trim() && (
                <p className="mt-1 text-sm text-red-600 flex items-start gap-1"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> {o.observacoes}</p>
              )}

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button onClick={() => { onRepeat(o); setSub("novo"); }} className="rounded-xl border-2 border-emerald-200 text-emerald-700 font-bold flex items-center justify-center gap-2" style={{ minHeight: "46px" }}>
                  <Copy size={16} /> Repetir
                </button>
                {o.status !== "concluido" && o.status !== "cancelado" ? (
                  confirmingId === o.id ? (
                    <div className="flex gap-1">
                      <button onClick={() => { onCancel(o.id); setConfirmingId(null); }} className="flex-1 rounded-xl bg-red-600 text-white font-bold text-sm" style={{ minHeight: "46px" }}>Sim</button>
                      <button onClick={() => setConfirmingId(null)} className="flex-1 rounded-xl bg-slate-200 text-slate-700 font-bold text-sm" style={{ minHeight: "46px" }}>Não</button>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmingId(o.id)} className="rounded-xl border-2 border-red-200 text-red-600 font-bold flex items-center justify-center gap-2" style={{ minHeight: "46px" }}>
                      <Trash2 size={16} /> Cancelar
                    </button>
                  )
                ) : (
                  <div />
                )}
              </div>
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

function KitchenCard({ order, nowTs, variant, onPrepare, onComplete, onSkip, onBackToQueue }) {
  const preparing = order.status === "preparando";
  const isNew = variant === "fila" && nowTs - order.createdAt < 20000;
  const hInfo = horarioInfo(order, nowTs);

  return (
    <div className={"rounded-2xl border-2 bg-white p-4 shadow-sm " + (preparing ? "border-blue-400" : "border-slate-200")}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-400 leading-none mb-0.5">PEDIDO</div>
          <div className="text-2xl font-extrabold text-slate-900 leading-tight break-words">{order.nome}</div>
          <div className="text-xs text-slate-500 flex items-center gap-1 mt-1"><Clock size={14} /> recebido {relTime(order.createdAt, nowTs)}</div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {isNew && <span className="rounded-full bg-emerald-500 text-white text-xs font-bold px-2 py-0.5 animate-pulse">NOVO</span>}
          {preparing && <span className="rounded-full bg-blue-100 text-blue-700 text-xs font-bold px-2 py-0.5">EM PREPARO</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        <TipoBadge tipo={order.tipo} />
        <HorarioBadge info={hInfo} tipo={order.tipo} />
      </div>

      <div className="space-y-3">
        {order.itens.length ? (
          order.itens.map((g, i) => (
            <div key={i}>
              <div className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">{g.categoria}</div>
              <div className="flex flex-wrap gap-2">
                {g.valores.map((t, j) => (
                  <span key={j} className={"rounded-lg px-3 py-1.5 text-base font-semibold " + (g.destaque ? "bg-orange-600 text-white" : "bg-slate-800 text-white")}>{t}</span>
                ))}
              </div>
            </div>
          ))
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
            <button onClick={() => onComplete(order.id)} className="w-full rounded-xl font-extrabold text-lg bg-green-600 text-white flex items-center justify-center gap-2 active:bg-green-700" style={{ minHeight: "58px" }}>
              <CheckCircle2 size={22} /> CONCLUÍDO
            </button>
          </div>
        )}
        {variant === "pulado" && (
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => onBackToQueue(order.id)} className="rounded-xl font-bold bg-slate-200 text-slate-800 flex items-center justify-center gap-2 active:bg-slate-300" style={{ minHeight: "56px" }}>
              <RotateCcw size={20} /> Voltar p/ Fila
            </button>
            <button onClick={() => onComplete(order.id)} className="rounded-xl font-extrabold bg-green-600 text-white flex items-center justify-center gap-2 active:bg-green-700" style={{ minHeight: "56px" }}>
              <CheckCircle2 size={20} /> Concluído
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CozinhaView({ orders, nowTs, onPrepare, onComplete, onSkip, onBackToQueue, onClearHistory }) {
  const [tab, setTab] = useState("fila");
  const fila = orders.filter((o) => o.status === "na_fila" || o.status === "preparando").sort((a, b) => targetTs(a, nowTs) - targetTs(b, nowTs));
  const pulados = orders.filter((o) => o.status === "pulado").sort((a, b) => a.createdAt - b.createdAt);
  const entregues = orders.filter((o) => o.status === "concluido").sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));

  return (
    <div>
      <div className="p-3">
        <div className="grid grid-cols-3 gap-1 bg-slate-200 rounded-xl p-1">
          <Tab active={tab === "fila"} onClick={() => setTab("fila")} count={fila.length}>Fila</Tab>
          <Tab active={tab === "pulados"} onClick={() => setTab("pulados")} count={pulados.length}>Pulados</Tab>
          <Tab active={tab === "entregues"} onClick={() => setTab("entregues")} count={entregues.length}>Entregues</Tab>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {tab === "fila" && (fila.length ? fila.map((o) => <KitchenCard key={o.id} order={o} nowTs={nowTs} variant="fila" onPrepare={onPrepare} onComplete={onComplete} onSkip={onSkip} />) : <Empty>Nenhum pedido na fila. Tudo em dia! 🎉</Empty>)}
        {tab === "pulados" && (pulados.length ? pulados.map((o) => <KitchenCard key={o.id} order={o} nowTs={nowTs} variant="pulado" onComplete={onComplete} onBackToQueue={onBackToQueue} />) : <Empty>Nenhum pedido aguardando.</Empty>)}
        {tab === "entregues" && (entregues.length ? (
          <>
            {entregues.map((o) => (
              <div key={o.id} className="rounded-2xl border-2 border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="rounded-lg bg-green-600 text-white px-3 py-1 font-extrabold text-lg flex items-center gap-1 truncate" style={{ maxWidth: "200px" }}>
                    <CheckCircle2 size={18} /> {o.nome}
                  </div>
                  <div className="text-xs text-slate-400 shrink-0">Entregue {relTime(o.completedAt || o.createdAt, nowTs)}</div>
                </div>
                <div className="mt-2"><TipoBadge tipo={o.tipo} size="sm" /></div>
                <p className="mt-2 text-sm text-slate-600">{flatSummary(o)}</p>
              </div>
            ))}
            <button onClick={onClearHistory} className="w-full rounded-xl border-2 border-slate-200 text-slate-500 font-bold flex items-center justify-center gap-2" style={{ minHeight: "46px" }}>
              <Trash2 size={16} /> Limpar histórico
            </button>
          </>
        ) : <Empty>Nenhum prato entregue ainda.</Empty>)}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Visão Administração (cardápios)                                    */
/* ================================================================== */

function AdminView({ menus, activeMenuId, onCreateMenu, onSaveMenu, onDeleteMenu, onSetActive }) {
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

function ChatDrawer({ open, onClose, messages, role, onSend }) {
  const [text, setText] = useState("");
  const listRef = useRef(null);
  useEffect(() => { if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight; }, [open, messages]);
  if (!open) return null;

  const presets = ["Acabou a farofa", "Sem batata frita no momento", "Prato pronto para servir", "Cliente desistiu de um item"];
  const send = () => { if (text.trim()) { onSend(text); setText(""); } };

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1" style={{ backgroundColor: "rgba(0,0,0,0.45)" }} onClick={onClose} />
      <div className="w-full bg-white h-full flex flex-col shadow-xl" style={{ maxWidth: "420px" }}>
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <div className="flex items-center gap-2 font-bold text-slate-800"><MessageSquare size={20} /> Chat · Salão ⇄ Cozinha</div>
          <button onClick={onClose} className="rounded-lg p-2 text-slate-500 active:bg-slate-100"><X size={22} /></button>
        </div>
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && <Empty>Nenhuma mensagem ainda.</Empty>}
          {messages.map((m) => {
            const mine = m.sender === role;
            return (
              <div key={m.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                <div className={"rounded-2xl px-4 py-2 " + (mine ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-800")} style={{ maxWidth: "82%" }}>
                  <div className={"text-xs font-bold mb-0.5 " + (mine ? "text-blue-100" : "text-slate-500")}>{m.sender === "cozinha" ? "Cozinha" : "Atendente"}</div>
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
              placeholder={`Escrever como ${role === "cozinha" ? "Cozinha" : "Atendente"}...`}
              className="flex-1 rounded-xl border-2 border-slate-200 px-4 outline-none focus:border-blue-500" style={{ minHeight: "50px" }} />
            <button onClick={send} className="rounded-xl bg-blue-600 text-white px-4 flex items-center justify-center active:bg-blue-700" style={{ minHeight: "50px" }}><Send size={20} /></button>
          </div>
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
                <div className="font-bold truncate">Pedido de {t.nome} concluído</div>
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
  const [lastOpen, setLastOpen] = useState({ atendente: Date.now(), cozinha: Date.now() });
  const [toasts, setToasts] = useState([]);
  const [nowTs, setNowTs] = useState(Date.now());
  const [prefill, setPrefill] = useState(null);
  const [formSeed, setFormSeed] = useState(0);
  const [ready, setReady] = useState(false);
  const [connError, setConnError] = useState("");

  const audioRef = useRef(null);
  const timers = useRef({});

  const role = view === "cozinha" ? "cozinha" : "atendente";
  const roleRef = useRef(role); roleRef.current = role;
  const soundOnRef = useRef(soundOn); soundOnRef.current = soundOn;

  const unread = messages.filter((m) => m.sender !== role && m.ts > (lastOpen[role] || 0)).length;
  const activeMenu = menus.find((m) => m.id === activeMenuId) || menus[0] || null;

  useEffect(() => { const i = setInterval(() => setNowTs(Date.now()), 15000); return () => clearInterval(i); }, []);
  useEffect(() => () => Object.values(timers.current).forEach(clearTimeout), []);

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
  const dingNewOrder = () => playTone([784, 1046, 1318], "triangle", 0.18);
  const chimeDone = () => playTone([880, 660], "sine", 0.16);
  const blipChat = () => playTone([1174], "sine", 0.12);

  /* Toasts */
  const removeToast = (id) => { setToasts((t) => t.filter((x) => x.id !== id)); const tm = timers.current[id]; if (tm) { clearTimeout(tm); delete timers.current[id]; } };
  const pushToast = (toast) => { const id = uid(); setToasts((t) => [...t, { ...toast, id }]); timers.current[id] = setTimeout(() => removeToast(id), toast.duration || 2500); };

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
            if (p.eventType === "INSERT" && roleRef.current === "cozinha") dingNewOrder();
            if (p.eventType === "UPDATE" && p.new.status === "concluido" && (!p.old || p.old.status !== "concluido") && roleRef.current === "atendente") chimeDone();
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (p) => {
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

  /* Ações — atualização otimista + gravação no banco */
  const createOrder = (data) => {
    const o = { id: uid(), createdAt: Date.now(), completedAt: null, status: "na_fila", ...data };
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
    upsertOrder({ ...o, status: "pulado" });
    supabase.from("orders").update({ status: "pulado" }).eq("id", id).then(({ error }) => dbFail(error));
  };
  const backToQueue = (id) => {
    const o = orders.find((x) => x.id === id); if (!o) return;
    upsertOrder({ ...o, status: "na_fila" });
    supabase.from("orders").update({ status: "na_fila" }).eq("id", id).then(({ error }) => dbFail(error));
  };
  const completeOrder = (id) => {
    const o = orders.find((x) => x.id === id); if (!o || o.status === "concluido") return;
    const prevStatus = o.status; const ts = Date.now();
    upsertOrder({ ...o, status: "concluido", completedAt: ts });
    pushToast({ type: "undo", nome: o.nome, orderId: id, prevStatus, duration: 5000 });
    supabase.from("orders").update({ status: "concluido", completed_at: ts }).eq("id", id).then(({ error }) => dbFail(error));
  };
  const undoComplete = (toast) => {
    const o = orders.find((x) => x.id === toast.orderId);
    if (o) upsertOrder({ ...o, status: toast.prevStatus, completedAt: null });
    removeToast(toast.id);
    supabase.from("orders").update({ status: toast.prevStatus, completed_at: null }).eq("id", toast.orderId).then(({ error }) => dbFail(error));
  };
  const clearHistory = () => {
    const ids = orders.filter((o) => o.status === "concluido").map((o) => o.id);
    setOrders((prev) => prev.filter((o) => o.status !== "concluido"));
    if (ids.length) supabase.from("orders").delete().in("id", ids).then(({ error }) => dbFail(error));
  };

  const repeatOrder = (order) => {
    setPrefill({ tipo: order.tipo, horario: order.horario, observacoes: order.observacoes, selections: order.selections });
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

  const navBtn = (target, icon, label) => (
    <button onClick={() => setView(target)}
      className={"rounded-lg font-bold flex items-center justify-center gap-2 " + (view === target ? "bg-white text-slate-900 shadow" : "text-slate-500")} style={{ minHeight: "46px" }}>
      {icon} {label}
    </button>
  );

  return (
    <div className="min-h-screen flex flex-col text-slate-900" style={{ backgroundColor: "#f1f5f9" }}>
      <style>{`@keyframes undobar{from{width:100%}to{width:0%}}`}</style>

      <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
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
          <div className="grid grid-cols-2 gap-1 bg-slate-200 rounded-xl p-1">
            {navBtn("atendente", <User size={18} />, "Atendente")}
            {navBtn("cozinha", <ChefHat size={18} />, "Cozinha")}
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
              <AtendenteView orders={orders} menu={activeMenu} prefill={prefill} formSeed={formSeed} nowTs={nowTs}
                onCreate={createOrder} onCancel={cancelOrder} onRepeat={repeatOrder} onConsumedPrefill={consumedPrefill} />
            ) : <div className="p-8"><Empty>Nenhum cardápio ativo. Vá em Administração.</Empty></div>)}
            {view === "cozinha" && (
              <CozinhaView orders={orders} nowTs={nowTs} onPrepare={prepareToggle} onComplete={completeOrder} onSkip={skipOrder} onBackToQueue={backToQueue} onClearHistory={clearHistory} />
            )}
            {view === "admin" && (
              <AdminView menus={menus} activeMenuId={activeMenuId} onCreateMenu={createMenu} onSaveMenu={saveMenu} onDeleteMenu={deleteMenu} onSetActive={setActive} />
            )}
          </>
        )}
      </main>

      <ChatDrawer open={chatOpen} onClose={() => setChatOpen(false)} messages={messages} role={role} onSend={sendMessage} />
      <Toasts toasts={toasts} onUndo={undoComplete} />
    </div>
  );
}

export default function App() {
  if (!isConfigured) return <SetupNeeded />;
  return <ComandaApp />;
}
