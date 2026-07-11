import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config";

// Usa as variáveis de ambiente se existirem (opcional); senão, usa o config.js.
const url = import.meta.env.VITE_SUPABASE_URL || SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY || SUPABASE_ANON_KEY;

const isPlaceholder = (v) => !v || v.includes("SEU-PROJETO") || v.includes("COLE_AQUI");

export const isConfigured = Boolean(url && key) && !isPlaceholder(url) && !isPlaceholder(key);
export const supabase = isConfigured ? createClient(url, key) : null;
