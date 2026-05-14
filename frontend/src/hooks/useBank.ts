import { useEffect, useState, useCallback } from "react";

export type Bank = "v8" | "vctex" | "mercantil";
const KEY = "selected_bank";
const DEFAULT: Bank = "v8";

let listeners = new Set<() => void>();
function notify() { listeners.forEach(fn => fn()); }

function read(): Bank {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "vctex" || v === "mercantil" || v === "v8") return v;
    return DEFAULT;
  } catch { return DEFAULT; }
}

export function useBank() {
  const [bank, setBankState] = useState<Bank>(read);

  useEffect(() => {
    const fn = () => setBankState(read());
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  }, []);

  const setBank = useCallback((b: Bank) => {
    try { localStorage.setItem(KEY, b); } catch {}
    notify();
  }, []);

  return { bank, setBank };
}

export function getBank(): Bank {
  return read();
}

export function bankPrefix(bank: Bank, path: string): string {
  // V8 = paths originais (/api/leads, /api/bot, /api/stats, /api/batches)
  // VCTex = reescreve para /api/vctex/*
  // Mercantil = reescreve para /api/mercantil/*
  if (bank === "v8") return path;
  if (bank === "vctex") return path.replace(/^\/api\/(leads|bot|stats|batches)/, "/api/vctex/$1");
  if (bank === "mercantil") return path.replace(/^\/api\/(leads|bot|stats|batches)/, "/api/mercantil/$1");
  return path;
}
