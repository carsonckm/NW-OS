/**
 * "Why can this person approve this?" (Phase 6 Batch 8). Explains each decision on a record from
 * the authority snapshot the server stored when the decision was made, never from today's rules.
 * Today's rule status is shown apart, as current information only. The server decides who may
 * see this; anyone else (including clients and contractors) gets "not available", the same as for
 * a record that does not exist.
 */
import React, { useEffect, useState } from "react";
import { api, CoreApiError } from "../services/coreApi";
import { actionErrorOf } from "../services/records";
import { Button, rm } from "./ui/forms";

type Row = Record<string, any>;
const when = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
const NOT_RECORDED = (
  <span className="italic text-slate-400">not recorded</span>
);
const val = (v: React.ReactNode) =>
  v === null || v === undefined || v === "" ? NOT_RECORDED : v;

const TYPE_TEXT: Record<string, string> = {
  Owner: "the Owner, who may decide anything",
  "System Policy": "a System Policy (a standing NW OS rule)",
  Permanent: "a permanent delegated authority",
  Temporary: "a temporary delegated authority",
  Absence: "absence cover (backup for an absent approver)",
  "Prior Owner approval": "the Owner's earlier approval",
};
const VERB: Record<string, string> = {
  Approved: "approved",
  Rejected: "rejected",
  "Changes Requested": "asked for changes on",
  "Client Approval": "approved (internal approval)",
  "Approved for Production": "approved for production",
};

function scopeText(rule: Row | null) {
  if (!rule) return null;
  if (rule.project_id) return `Project ${rule.project_name ?? rule.project_id}`;
  if (rule.client_id) return `Client ${rule.client_name ?? rule.client_id}`;
  return "All projects";
}

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({
  label,
  children,
}) => (
  <div className="grid grid-cols-[9rem_1fr] gap-2 text-[11px]">
    <dt className="text-slate-500">{label}</dt>
    <dd className="text-slate-800">{children}</dd>
  </div>
);

const Decision: React.FC<{ d: Row }> = ({ d }) => {
  const t = d.trace as Row | null;
  const who = `${d.decided_by?.name ?? "Someone"}${d.decided_by?.role ? ` (${d.decided_by.role})` : ""}`;
  const verb = VERB[d.outcome] ?? `set it to ${d.outcome}`;
  if (d.consent === "client") {
    const act = d.outcome === "Rejected" ? "declined" : "accepted";
    return (
      <li
        className="rounded-lg border border-sky-200 bg-sky-50 p-2 text-[11px] text-sky-950"
        data-testid="trace-decision"
        data-consent="client"
      >
        {d.consent_recorded_by === "staff" ? (
          <>
            <b>{who}</b> recorded that the client {act} this on {when(d.at)}
            {d.reference ? ` (reference ${d.reference})` : ""}.
          </>
        ) : (
          <>
            <b>{who}</b> {act} this on {when(d.at)} as the client, on their own
            project.
          </>
        )}{" "}
        <span className="font-bold">
          Client consent — not an internal authority approval.
        </span>
        {d.comments && <span className="block">Comment: {d.comments}</span>}
      </li>
    );
  }
  if (!t) {
    return (
      <li
        className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900"
        data-testid="trace-decision"
        data-recorded="false"
      >
        <b>{who}</b> {verb} this on {when(d.at)}. The authority terms were not
        recorded with this decision (it predates decision traceability), so the
        reason cannot be established from the record.
        {d.matched_rule_code && (
          <span className="block">
            Rule code recorded at the time: {d.matched_rule_code}.
          </span>
        )}
      </li>
    );
  }
  const rule = t.rule as Row | null;
  const checks = (t.checks ?? {}) as Row;
  return (
    <li
      className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2"
      data-testid="trace-decision"
      data-recorded="true"
      data-authority-type={t.authority_type}
    >
      <p className="text-[12px] text-slate-900">
        <b>{who}</b> {verb} this on {when(d.at)} under{" "}
        <b>{TYPE_TEXT[t.authority_type] ?? t.authority_type}</b>
        {rule ? (
          <>
            : <span className="font-mono">{rule.code}</span> {rule.name}
          </>
        ) : null}
        .
      </p>
      {t.reason && (
        <p className="text-[11px] text-slate-600">Why it matched: {t.reason}</p>
      )}
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
        Recorded when the decision was made
      </div>
      <dl className="space-y-0.5">
        <Fact label="Requested by">
          {val(t.requester?.name ?? t.requester?.id)}
        </Fact>
        <Fact label="Decided by">
          {val(
            t.approver
              ? `${t.approver.name ?? t.approver.id} (${t.approver.role ?? "role not recorded"})`
              : null,
          )}
        </Fact>
        <Fact label="Permission">{val(t.permission)}</Fact>
        <Fact label="Project">
          {val(t.decision?.project_name ?? t.decision?.project_id)}
          {t.decision?.client_name ? ` · client ${t.decision.client_name}` : ""}
        </Fact>
        <Fact label="Sensitivity">{val(t.decision?.sensitivity)}</Fact>
        {rule && (
          <Fact label="Rule applies to">
            {scopeText(rule)}
            {rule.target_user_name
              ? ` · ${rule.target_user_name}`
              : rule.target_role
                ? ` · ${rule.target_role}`
                : ""}
          </Fact>
        )}
        {(t.value || rule?.max_value != null) && (
          <Fact label="Value">
            {t.value ? rm(t.value.amount) : NOT_RECORDED}
            {rule ? (
              <>
                {" "}
                · limit {rule.max_value != null ? rm(rule.max_value) : "none"}
              </>
            ) : null}
            {checks.value && (
              <> · {checks.value.passed ? "within limit" : "outside limit"}</>
            )}
          </Fact>
        )}
        {checks.risk && (
          <Fact label="Risk">
            {val(checks.risk.actual)} · limit {checks.risk.max ?? "none"}
          </Fact>
        )}
        {rule && (
          <Fact label="Rule valid">
            {when(rule.start_at) ?? "from creation"} –{" "}
            {when(rule.end_at) ?? "no end date"}
          </Fact>
        )}
        {rule?.granted_by_name && (
          <Fact label="Granted by">{rule.granted_by_name}</Fact>
        )}
        {d.comments && <Fact label="Comments">{d.comments}</Fact>}
        {d.before?.status && (
          <Fact label="State change">{`${d.before.status} → ${d.outcome}`}</Fact>
        )}
      </dl>
    </li>
  );
};

export const DecisionTraceBody: React.FC<{
  kind: string;
  id: string;
  quiet?: boolean;
}> = ({ kind, id, quiet }) => {
  const [trace, setTrace] = useState<Row | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "hidden" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setState("loading");
    api
      .get<Row>(
        `/approval-routing/trace?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`,
      )
      .then((r) => {
        setTrace(r);
        setState("ok");
      })
      .catch((err) => {
        if (err instanceof CoreApiError && err.status === 404)
          return setState("hidden");
        setError(actionErrorOf(err).message);
        setState("error");
      });
  }, [kind, id]);
  if (state === "loading")
    return (
      <p className="text-[11px] text-slate-500">Loading decision record…</p>
    );
  if (state === "hidden" && quiet) return null;
  if (state === "hidden")
    return (
      <p
        className="text-[11px] text-slate-500"
        data-testid="decision-trace-unavailable"
      >
        No decision record is available to you for this item.
      </p>
    );
  if (state === "error")
    return <p className="text-[11px] font-bold text-rose-700">{error}</p>;
  const t = trace!;
  const decisions = (t.decisions ?? []) as Row[];
  const current = (t.current_rule_status ?? []) as Row[];
  return (
    <div className="space-y-2" data-testid="decision-trace">
      {decisions.length === 0 ? (
        <p className="text-[11px] text-slate-600">
          No decision has been recorded yet.
          {t.current_route
            ? ` It is with ${t.current_route.assignee.name} (${t.current_route.assignee.role}).`
            : ""}
        </p>
      ) : (
        <ol className="space-y-1.5">
          {decisions.map((d) => (
            <Decision key={d.audit_id} d={d} />
          ))}
        </ol>
      )}
      {current.length > 0 && (
        <div
          className="rounded-lg border border-dashed border-slate-300 p-2 text-[11px]"
          data-testid="trace-current"
        >
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
            Current status (today) — does not change past decisions
          </div>
          {current.map((c) => (
            <div key={c.id} data-in-force={String(c.in_force_now)}>
              <span className="font-mono">{c.code}</span>:{" "}
              {c.in_force_now
                ? "still in force"
                : `no longer in force${c.deactivation_reason ? ` (${c.deactivation_reason})` : c.end_at ? ` (ended ${when(c.end_at)})` : ""}`}
              {c.changed_since
                ? "; its terms have changed since the decision"
                : ""}
              . The decision above was valid under the terms in force at the
              time.
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** A toggle that opens the explanation on demand. */
export const DecisionTrace: React.FC<{
  kind: string;
  id: string;
  label?: string;
  className?: string;
}> = ({
  kind,
  id,
  label = "Why can this person approve this?",
  className = "",
}) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={`text-left ${className}`}>
      <Button
        data-testid="decision-trace-toggle"
        onClick={() => setOpen(!open)}
      >
        {open ? "Hide decision record" : label}
      </Button>
      {open && (
        <div className="mt-2">
          <DecisionTraceBody kind={kind} id={id} />
        </div>
      )}
    </div>
  );
};
