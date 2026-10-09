/**
 * One approval's history (Phase 6 Batch 4): routed, reminded, re-routed, escalated, decided.
 * Built by the server from the routes, the automation ledger and the audit log.
 */
import React, { useEffect, useState } from "react";
import { api } from "../services/coreApi";
import { actionErrorOf } from "../services/records";
import { DecisionTraceBody } from "./DecisionTrace";

type Row = Record<string, any>;
const when = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

export const ApprovalHistory: React.FC<{ kind: string; id: string }> = ({
  kind,
  id,
}) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api
      .get<{ timeline: Row[] }>(
        `/approval-routing/history?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
      )
      .then((r) => setRows(r.timeline))
      .catch((err) => setError(actionErrorOf(err).message));
  }, [kind, id]);
  if (error)
    return <p className="text-[11px] font-bold text-rose-700">{error}</p>;
  if (!rows)
    return <p className="text-[11px] text-slate-500">Loading history…</p>;
  return (
    <div className="space-y-2">
      <ol
        className="space-y-1 border-l-2 border-slate-200 pl-3"
        data-testid="approval-history"
      >
        {rows.map((r, i) => (
          <li key={i} className="text-[11px] text-slate-700">
            <span className="font-mono text-slate-400">{when(r.at)}</span>{" "}
            <span className="font-bold text-slate-900">{r.action}</span>
            <span className="text-slate-500"> · {r.actor}</span>
            {r.reason && (
              <span className="block text-slate-500">Reason: {r.reason}</span>
            )}
            {r.basis && (
              <span className="block text-slate-400">
                Basis {r.basis}
                {r.rule ? ` (${r.rule})` : ""}
                {r.owner_reason_code ? ` · ${r.owner_reason_code}` : ""}
              </span>
            )}
          </li>
        ))}
      </ol>
      <div>
        <div className="mb-1 text-[11px] font-black text-slate-900">
          Why can this person approve this?
        </div>
        <DecisionTraceBody kind={kind} id={id} quiet />
      </div>
    </div>
  );
};
