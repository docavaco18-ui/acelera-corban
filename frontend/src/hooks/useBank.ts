import { useEffect, useState, useCallback } from "react";

export type Bank = "v8" | "vctex";
const KEY = "selected_bank";
const DEFAULT: Bank = "v8";

let listeners = new Set<() => void>();
function notify() { listeners.forEach(fn => fn()); }

function read(): Bank {
  try {
    const v = localStorage.getItem(KEY);
    return v === "vctex" ? "vctex" : "v8";
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
  // Path normaliza: "/api/leads/..." → "/api/vctex/leads/..." quando bank=vctex
  if (bank === "v8") return path;
  return path.replace(/^\/api\/(leads|bot|stats|batches)/, "/api/vctex/$1");
}
