import { useEffect, useState } from "react";
import { leadsApi } from "../lib/api";
import { calcAllScores } from "../lib/scoring";
import type { ScoredRecord } from "../lib/types";

export function useEligibleScore() {
  const [records, setRecords] = useState<ScoredRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    leadsApi.listAll("elegivel").then((raw) => {
      setRecords(calcAllScores(raw));
      setLoading(false);
    });
  }, []);

  return { records, loading };
}
