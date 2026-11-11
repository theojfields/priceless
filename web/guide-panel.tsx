import { useState } from "react";
import { ArrowLeft, ArrowRight, ArrowUpRight, Info, LoaderCircle, LockKeyhole, Plane, Search, Sparkles, Square } from "lucide-react";
import type { GuidedSearch, ShoppingDraft } from "../shared/types";

function displayDetail(label: string, value: string) {
  if (!label.endsWith("date") || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return new Date(`${value}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export function GuidePanel({ guide, error, active, busy, canReply, onReply, onStop, onClear, onCompare, onRetry }: {
  guide: GuidedSearch;
  error: string;
  active: boolean;
  busy: boolean;
  canReply: boolean;
  onReply: (text: string) => Promise<boolean>;
  onStop: () => void;
  onClear: () => void;
  onCompare: (draft: ShoppingDraft) => void;
  onRetry: () => void;
}) {
  const [reply, setReply] = useState("");
  const plan = guide.plan;
  const flight = plan?.kind === "flight";
  const status = guide.status === "planning" ? "Understanding your goal…" : guide.status === "searching" ? "Checking public sources…" : guide.status === "cancelled" ? "Search stopped" : guide.status === "failed" ? "Search interrupted" : guide.sources.length ? "Sources ready" : plan?.draft ? "Product ready to review" : plan?.question ? "Ready for a detail" : "Search complete";
  const limit = guide.turns.length >= 6;
  return (
    <section className="guide-shell" aria-label="Guided search">
      <header className="guide-header">
        <button type="button" className="back-link" onClick={onClear}><ArrowLeft size={16} /> New search</button>
        {active && canReply && <button type="button" className="guide-stop" onClick={onStop} disabled={busy}><Square size={13} /> Stop search</button>}
      </header>
      <div className="guide-title">
        <span className="entry-icon">{flight ? <Plane size={23} /> : <Sparkles size={23} />}</span>
        <div><div className="eyebrow">{flight ? "FLIGHT SEARCH" : "GUIDED SEARCH"}</div><h1>{plan?.title || "Let’s find it"}</h1></div>
      </div>
      <div className="guide-conversation">
        <ol aria-label="Your search conversation" className="guide-turns">
          {guide.turns.map((text, index) => <li key={index}><span>{index ? "Your follow-up" : "Your goal"}</span><p>{text}</p></li>)}
        </ol>
        <div className="guide-state" role="status">
          {active ? <LoaderCircle size={16} className="spin" /> : <Search size={16} />}
          {status}
        </div>
        {!!plan?.details.length && <dl className="guide-details" aria-label="Search details">
          {plan.details.map(({ label, value }, index) => <div key={index}><dt>{label}</dt><dd>{displayDetail(label, value)}</dd></div>)}
        </dl>}
        {plan?.draft && <div className="guide-review">
          <p>I found an exact product in your goal. Review it before comparing prices.</p>
          <button className="primary-button" type="button" onClick={() => onCompare(plan.draft!)}>Review product <ArrowRight size={16} /></button>
        </div>}
        {(error || guide.warning) && <div className="error-message guide-warning" role="alert"><Info size={16} /> {error || guide.warning}</div>}
        {!canReply && guide.status === "failed" && <button type="button" className="primary-button" onClick={onRetry}>Try again <ArrowRight size={16} /></button>}
        {canReply && !limit && <form className="guide-reply" onSubmit={async (event) => {
          event.preventDefault();
          if (reply.trim().length >= 2 && await onReply(reply.trim())) setReply("");
        }}>
          <label htmlFor="guide-reply">{plan?.question || "Add a detail or change your search"}</label>
          {plan?.question && guide.status === "searching" && <p>Checking public sources while you answer.</p>}
          <div className="guide-reply-input">
            <textarea id="guide-reply" rows={2} maxLength={500} minLength={2} required autoComplete="off" value={reply} onChange={(event) => setReply(event.target.value)} placeholder={flight ? "e.g. nonstop, round trip, or a different date" : "e.g. a preferred size, feature, or brand"} />
            <button className="entry-submit" type="submit" aria-label="Send follow-up" disabled={busy || reply.trim().length < 2}>{busy ? <LoaderCircle size={17} className="spin" /> : <ArrowRight size={17} />}</button>
          </div>
        </form>}
        {limit && <p className="guide-footnote">Start a new search to add more details.</p>}
      </div>
      {(guide.sources.length > 0 || plan?.flightSearchUrl) && <section className="guide-results" aria-labelledby="guide-results-title">
        <div className="guide-results-header">
          <div><h2 id="guide-results-title">{flight ? "Flight references" : "Public sources"}</h2><p>{flight ? "Public schedule and route information. Confirm your dates, availability, and current fares with the provider." : "Starting points to explore. Confirm prices and availability on the source page."}</p></div>
          {plan?.flightSearchUrl && <a className="guide-provider" href={plan.flightSearchUrl} target="_blank" rel="noopener noreferrer">Check on Google Flights <ArrowUpRight size={16} /></a>}
        </div>
        {guide.sources.length > 0 && <ul className="guide-source-list">{guide.sources.map((source) => <li key={source.url}>
          <a href={source.url} target="_blank" rel="noopener noreferrer"><div><span>{source.domain}</span><h3>{source.title}</h3>{source.excerpt && <p>{source.excerpt}</p>}</div><ArrowUpRight size={17} /></a>
        </li>)}</ul>}
      </section>}
      <p className="guide-footnote"><LockKeyhole size={13} /> This conversation is temporary. No shopping profile is attached.</p>
    </section>
  );
}
