import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Copy,
  ExternalLink,
  Fingerprint,
  Globe2,
  Info,
  Link2,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  Settings2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Square,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import type { AppConfig, Offer, ShoppingRun, ShoppingDraft } from "../shared/types";
import { bestRetailOffer, knownRetailSeller } from "../shared/retail";
import { exampleRun } from "./sample";
import { initialize, operation, type CreateResponse } from "./api";
import { GuidePanel } from "./guide-panel";
import { useGuide } from "./use-guide";
import "./styles.css";

type View = "search" | "how" | "privacy";
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M16 3.5 27.5 10v12L16 28.5 4.5 22V10L16 3.5Z"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <path
          d="m10 19 6-12 6 12M12 15h8M16 15v10"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
function App() {
  const [view, setView] = useState<View>("search");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [verified, setVerified] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [connectionReady, setConnectionReady] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [accessToken, setAccessToken] = useState("");
  const [product, setProduct] = useState("");
  const [variant, setVariant] = useState("");
  const [country, setCountry] = useState("US");
  const [budget, setBudget] = useState("");
  const [sourceUrls, setSourceUrls] = useState("");
  const [link, setLink] = useState("");
  const [goalText, setGoalText] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [run, setRun] = useState<ShoppingRun | null>(null);
  const [runKey, setRunKey] = useState("");
  const [offerDetail, setOfferDetail] = useState<Offer | null>(null);
  const [copied, setCopied] = useState(false);
  const [budgetOnly, setBudgetOnly] = useState(false);
  const guided = useGuide(accessToken, () => {
    setGoalText("");
    setProduct("");
    setVariant("");
    setSourceUrls("");
    setReviewOpen(false);
  });
  const active = run?.status === "running";
  useEffect(() => {
    let current = true;
    void initialize()
      .then((result) => {
        if (current) {
          setConfig(result.config);
          setVerified(result.verified);
          setConnectionReady(true);
        }
      })
      .catch(() => {
        if (current)
          setConnectionError(
            "A verified connection could not be established. Your shopping details have not been sent.",
          );
      });
    return () => {
      current = false;
    };
  }, []);
  useEffect(() => {
    if (!run || run.mode === "sample" || run.status !== "running") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const data = await operation<{ run: ShoppingRun }>(
          "read",
          { runId: run!.id, runKey },
          accessToken,
        );
        if (!stopped) {
          setRun(data.run);
          if (data.run.status === "running") timer = setTimeout(poll, 1800);
        }
      } catch (e) {
        if (!stopped) {
          setError((e as Error).message);
          timer = setTimeout(poll, 5000);
        }
      }
    }
    timer = setTimeout(poll, 1000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [run?.id, run?.status, runKey, accessToken]);
  useEffect(() => {
    if (!run) return;
    const timer = setTimeout(
      () => {
        setRun(null);
        setRunKey("");
        setBudget("");
        setProduct("");
        setVariant("");
        setSourceUrls("");
        setLink("");
        setGoalText("");
        setError("This search expired and has been cleared.");
      },
      Math.max(0, Date.parse(run.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [run?.id]);
  async function prepare(event: React.FormEvent, kind: "link" | "goal") {
    event.preventDefault();
    setError("");
    if (
      !config?.liveConfigured ||
      (config.accessRequired && !accessToken) ||
      !connectionReady
    ) {
      setConnectionOpen(true);
      return;
    }
    if (kind === "goal") {
      await guided.start(goalText.trim(), country);
      return;
    }
    setPreparing(true);
    try {
      const result = await operation<
        | { draft: ShoppingDraft }
        | { clarification: string }
      >(
        "prepare",
        { kind, text: link, country },
        accessToken,
      );
      if ("clarification" in result) {
        setError(result.clarification);
        return;
      }
      reviewDraft(result.draft);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPreparing(false);
    }
  }
  function reviewDraft(draft: ShoppingDraft) {
    setProduct(draft.product);
    setVariant(draft.variant);
    setSourceUrls(draft.sourceUrls.join("\n"));
    setReviewOpen(true);
  }
  async function start(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (
      !config?.liveConfigured ||
      (config.accessRequired && !accessToken) ||
      !connectionReady
    ) {
      setConnectionOpen(true);
      return;
    }
    setBusy(true);
    try {
      // The private budget intentionally stays in this component. It is never part of a request.
      const data = await operation<CreateResponse>(
        "create",
        {
          product,
          variant,
          country,
          sourceUrls: sourceUrls
            .split("\n")
            .map((url) => url.trim())
            .filter(Boolean),
        },
        accessToken,
      );
      setRun(data.run);
      setRunKey(data.runKey);
      setReviewOpen(false);
      if (guided.guide) void guided.clear();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    if (run?.mode === "live") {
      try {
        await operation("clear", { runId: run.id, runKey }, accessToken);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
    }
    setRun(null);
    setRunKey("");
    setOfferDetail(null);
    setError("");
    setBudgetOnly(false);
    setProduct("");
    setVariant("");
    setSourceUrls("");
    setBudget("");
    setLink("");
    setGoalText("");
    setReviewOpen(false);
  }
  async function cancel() {
    if (!run) return;
    try {
      await operation("cancel", { runId: run.id, runKey }, accessToken);
      const data = await operation<{ run: ShoppingRun }>(
        "read",
        { runId: run.id, runKey },
        accessToken,
      );
      setRun(data.run);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function showExample() {
    setError("");
    setBudgetOnly(false);
    if (guided.guide) void guided.clear();
    setRun(exampleRun());
    setView("search");
  }
  async function copyResults() {
    if (!run) return;
    try {
      await navigator.clipboard.writeText(
        `${run.mode === "sample" ? "ILLUSTRATIVE SAMPLE — not current prices\n" : ""}Priceless — ${run.goal.product} ${run.goal.variant}\n${uniqueOffers.map((offer) => `${offer.merchant}: ${money(offer.price, offer.currency)} (shipping/tax unconfirmed)\n${offer.url}`).join("\n\n")}\nThese observations do not establish a universally fair price or prove personalization.`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Clipboard access is unavailable in this browser.");
    }
  }
  const uniqueOffers = (run?.offers ?? [])
    .filter(
      (offer, index, all) =>
        all.findIndex(
          (item) =>
            item.url === offer.url &&
            item.price === offer.price &&
            item.currency === offer.currency,
        ) === index,
    )
    .sort((a, b) => a.price - b.price);
  const displayedOffers =
    budgetOnly && Number(budget) > 0
      ? uniqueOffers.filter((offer) => offer.price <= Number(budget))
      : uniqueOffers;
  const lowest = uniqueOffers[0];
  const highest = uniqueOffers.at(-1);
  const recommended = run?.mode === "live" ? bestRetailOffer(uniqueOffers, run.goal) : lowest;
  const headlineOffer = recommended ?? lowest;

  return (
    <div
      className={`app-shell ${view === "search" && !run ? "entry-shell" : ""}`}
    >
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => setView("search")}
          aria-label="Priceless home"
        >
          <Mark />
          <span>
            priceless<span className="brand-period">.</span>
          </span>
        </button>
        <div className="workspace-label">
          <span className="workspace-avatar">P</span>
          <span>
            Personal workspace<small>Private by design</small>
          </span>
          <LockKeyhole size={13} />
        </div>
        <div className="nav-caption">YOUR WORKSPACE</div>
        <nav aria-label="Main navigation">
          <button
            className={`nav-item ${view === "search" ? "selected" : ""}`}
            onClick={() => setView("search")}
          >
            <Search size={18} />
            Find a price
            <ChevronRight size={14} className="nav-arrow" />
          </button>
          <button
            className={`nav-item ${view === "how" ? "selected" : ""}`}
            onClick={() => setView("how")}
          >
            <Sparkles size={18} />
            How it works
          </button>
          <button
            className={`nav-item ${view === "privacy" ? "selected" : ""}`}
            onClick={() => setView("privacy")}
          >
            <Shield size={18} />
            Your privacy
          </button>
        </nav>
        <div className="sidebar-note">
          <span className="tiny-label">A LITTLE LESS YOU.</span>
          <p>
            A clearer view of
            <br />
            what things cost.
          </p>
          <div className="note-line" />
          <span>
            Fresh workers.
            <br />
            No shopping profile attached.
          </span>
        </div>
        <div className="sidebar-bottom">
          <button
            className="connection-button"
            onClick={() => setConnectionOpen(true)}
          >
            <span className={`status-dot ${verified ? "live" : ""}`} />
            <span>
              {verified ? "Tinfoil verified" : "Local preview"}
              <small>
                {config?.liveConfigured
                  ? "Inference connected"
                  : "Connect Tinfoil to go live"}
              </small>
            </span>
            <Settings2 size={16} />
          </button>
          <div className="sidebar-footer">
            <LockKeyhole size={12} />
            No account history stored
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          {view === "search" && !run ? (
            <button
              className="brand entry-brand"
              onClick={() => setView("search")}
              aria-label="Priceless home"
            >
              <Mark />
              <span>
                priceless<span className="brand-period">.</span>
              </span>
            </button>
          ) : (
            <div>
              <span>Workspace</span>
              <ChevronRight size={13} />
              <strong>
                {view === "search"
                  ? run
                    ? "Price comparison"
                    : "New search"
                  : view === "how"
                    ? "How it works"
                    : "Your privacy"}
              </strong>
            </div>
          )}
          <div className="topbar-actions">
            {view === "search" && !run && (
              <button className="quiet-button" onClick={() => setView("how")}>
                How it works
              </button>
            )}
            <button
              className={`privacy-pill ${verified ? "verified" : ""}`}
              onClick={() => setConnectionOpen(true)}
            >
              {verified ? <ShieldCheck size={14} /> : <Shield size={14} />}{" "}
              {verified ? "Verified private connection" : "Local preview"}
              <span className="pill-divider" />
              <span className="tinfoil-wordmark">tinfoil</span>
              <ArrowUpRight size={12} />
            </button>
          </div>
        </header>
        <div className="content">
          {view === "search" && guided.guide && !run && (
            <GuidePanel
              guide={guided.guide}
              error={guided.error}
              active={guided.active}
              busy={guided.busy}
              canReply={guided.canReply}
              liveFares={!!config?.flightFaresConfigured}
              onCheckFares={() => void guided.checkFares()}
              onReply={guided.reply}
              onStop={() => void guided.stop()}
              onClear={() => { setGoalText(""); setReviewOpen(false); setError(""); void guided.clear(); }}
              onCompare={reviewDraft}
              onRetry={() => void guided.start(goalText, country)}
            />
          )}
          {view === "search" && !run && !guided.guide && (
            <>
              <section className="entry-heading">
                <div className="eyebrow">
                  <span /> A FRESH START FOR EVERY SEARCH
                </div>
                <h1>What are we shopping for?</h1>
                <p>Find the right option and see what it costs. Your personal history stays out.</p>
              </section>
              <section
                className="entry-choices"
                aria-label="Start a shopping search"
              >
                <form
                  className={`entry-card ${preparing ? "preparing" : ""}`}
                  onSubmit={(event) => {
                    void prepare(event, "link");
                  }}
                >
                  <div className="entry-card-top">
                    <span className="entry-icon">
                      <Link2 size={22} />
                    </span>
                    <span className="tiny-label">01</span>
                  </div>
                  <h2>
                    <label htmlFor="shopping-link">Paste a link</label>
                  </h2>
                  <p>Found something you like? Start with its product page.</p>
                  <input
                    id="shopping-link"
                    className="entry-input"
                    type="url"
                    value={link}
                    onChange={(event) => setLink(event.target.value)}
                    placeholder="https://store.com/product"
                    required
                    maxLength={1500}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={!!preparing}
                  />
                  <div className="entry-card-footer">
                    <span>Public product pages only</span>
                    <button
                      className="entry-submit"
                      type="submit"
                      disabled={!!preparing}
                    >
                      {preparing ? (
                        <LoaderCircle size={18} className="spin" />
                      ) : (
                        <ArrowRight size={18} />
                      )}
                      <span className="sr-only">Continue with link</span>
                    </button>
                  </div>
                </form>
                <span className="choice-or" aria-hidden="true">
                  or
                </span>
                <form
                  className="entry-card"
                  onSubmit={(event) => {
                    void prepare(event, "goal");
                  }}
                >
                  <div className="entry-card-top">
                    <span className="entry-icon">
                      <Sparkles size={22} />
                    </span>
                    <span className="tiny-label">02</span>
                  </div>
                  <h2>
                    <label htmlFor="shopping-goal">State a goal</label>
                  </h2>
                  <p>Describe what you need. We’ll start there and ask if a detail would help.</p>
                  <textarea
                    id="shopping-goal"
                    className="entry-input"
                    value={goalText}
                    onChange={(event) => setGoalText(event.target.value)}
                    placeholder="Find me a flight from Columbus to Atlanta next Monday morning…"
                    required
                    minLength={2}
                    maxLength={500}
                    autoComplete="off"
                    rows={2}
                    disabled={!!preparing}
                  />
                  <div className="entry-card-footer">
                    <span>Flights, products, or a shopping idea</span>
                    <button
                      className="entry-submit"
                      type="submit"
                      disabled={!!preparing}
                    >
                      <ArrowRight size={18} />
                      <span className="sr-only">Start guided search</span>
                    </button>
                  </div>
                </form>
              </section>
              <div className="entry-meta">
                <span>
                  <LockKeyhole size={13} /> No shopping profile attached
                </span>
                <details className="shopping-options">
                  <summary>
                    Shopping options <ChevronDown size={13} />
                  </summary>
                  <div className="shopping-options-panel">
                    <label className="field-label" htmlFor="country">
                      Shopping market
                    </label>
                    <div className="select-wrap">
                      <Globe2 size={16} />
                      <select
                        id="country"
                        value={country}
                        onChange={(event) => {
                          setCountry(event.target.value);
                          setBudget("");
                        }}
                        disabled={!!preparing}
                      >
                        <option value="US">United States · USD</option>
                        <option value="GB">United Kingdom · GBP</option>
                        <option value="CA">Canada · CAD</option>
                        <option value="AU">Australia · AUD</option>
                      </select>
                      <ChevronDown size={14} />
                    </div>
                    <label className="field-label" htmlFor="budget">
                      Private price ceiling{" "}
                      <span>
                        Optional ·{" "}
                        {
                          (
                            {
                              US: "USD",
                              GB: "GBP",
                              CA: "CAD",
                              AU: "AUD",
                            } as Record<string, string>
                          )[country]
                        }
                      </span>
                    </label>
                    <input
                      className="text-input"
                      id="budget"
                      type="number"
                      min="0"
                      max="1000000"
                      value={budget}
                      onChange={(event) => setBudget(event.target.value)}
                      placeholder="No limit"
                    />
                    <small>
                      This field stays in your tab. Agents and stores never
                      receive it.
                    </small>
                  </div>
                </details>
              </div>
              {(error || guided.error) && (
                <div className="error-message" role="alert">
                  <Info size={16} />
                  {error || guided.error}
                </div>
              )}
              <div className="example-row">
                <span>Just looking around?</span>
                <button onClick={showExample}>
                  Explore an example comparison
                  <ArrowUpRight size={14} />
                </button>
                <span className="sample-label">SAMPLE DATA</span>
              </div>
            </>
          )}
          {view === "search" && run && (
            <>
              <div className="results-heading">
                <div>
                  <button
                    className="back-link"
                    onClick={() => {
                      void clear();
                    }}
                  >
                    <ArrowLeft size={14} />
                    New search
                  </button>
                  <h1>
                    {run.goal.product}
                    <span>{run.goal.variant || "Exact product"}</span>
                  </h1>
                  <p>
                    New condition<span>·</span>
                    {run.goal.country} market<span>·</span>
                    {run.mode === "sample"
                      ? "Illustrative comparison"
                      : "Independent shopping styles"}
                  </p>
                </div>
                <button
                  className="icon-button"
                  onClick={() => {
                    void clear();
                  }}
                  aria-label="Clear this search"
                >
                  <Trash2 size={18} />
                </button>
              </div>
              {run.mode === "sample" && (
                <div className="sample-banner">
                  <Sparkles size={16} />
                  <span>
                    <strong>An example of a clearer comparison.</strong> These
                    stores and prices are illustrative. No live search was made.
                  </span>
                  <span className="sample-tag">SAMPLE</span>
                </div>
              )}
              {error && (
                <div className="error-message" role="alert">
                  <Info size={16} />
                  {error}
                </div>
              )}
              <section className="result-overview">
                <div className="lowest-card">
                  <div className="tiny-label">
                    {active
                      ? (recommended ? "BEST OPTION SO FAR" : "YOUR SEARCH IS UNDERWAY")
                      : recommended ? (run.mode === "sample" ? "LOWEST SAMPLE ITEM PRICE" : "BEST OPTION · LOWEST ITEM PRICE FROM A KNOWN STORE")
                      : "LOWEST OBSERVED ITEM PRICE"}
                  </div>
                  {headlineOffer ? (
                    <>
                      <div className="price-big">
                        {money(headlineOffer.price, headlineOffer.currency)}
                        <span>{run.goal.currency}</span>
                      </div>
                      <p>
                        at {headlineOffer.merchant}
                        <ArrowUpRight size={13} />
                      </p>
                      <div className="unknown-total">
                        {recommended ? "Shipping and tax not confirmed" : "Seller, shipping, and tax not verified"}
                      </div>
                      {run.mode === "live" && <a className="guide-provider retail-best-link" href={headlineOffer.url} target="_blank" rel="noopener noreferrer">
                        {recommended ? "View product at store" : "Inspect listing"} <ArrowUpRight size={15} />
                      </a>}
                    </>
                  ) : (
                    <>
                      <div className="price-big pending-price">
                        {active ? (
                          <>
                            <span className="search-pulse" />
                            Finding your price
                          </>
                        ) : (
                          "No supported offers"
                        )}
                      </div>
                      <p>
                        {active
                          ? "Checking the exact product and public price."
                          : "Try an exact model or add a store link."}
                      </p>
                    </>
                  )}
                </div>
                <div className="comparison-card">
                  <div className="card-topline">
                    <span className="tiny-label">
                      A LITTLE MORE PERSPECTIVE
                    </span>
                    <SlidersHorizontal size={17} />
                  </div>
                  <h3>
                    {uniqueOffers.length > 1
                      ? `${money((highest?.price ?? 0) - (lowest?.price ?? 0), run.goal.currency)} between observed offers`
                      : active
                        ? "Same goal. Three fresh starts."
                        : "Only supported prices make the cut."}
                  </h3>
                  <p>
                    {uniqueOffers.length > 1
                      ? "A range across matching source listings. This does not prove that any store personalized its price."
                      : "We check the product, variant, condition, currency, and price excerpt before adding an offer."}
                  </p>
                  <div className="comparison-stats">
                    <span>
                      <strong>{run.sourceCount}</strong>source pages
                    </span>
                    <span>
                      <strong>{uniqueOffers.length}</strong>distinct offers
                    </span>
                    <span>
                      <strong>
                        {run.mode === "sample"
                          ? "—"
                          : `${run.workersDisposed}/3`}
                      </strong>
                      workers ended
                    </span>
                  </div>
                </div>
              </section>
              <section className="offers-card">
                <div className="offers-heading">
                  <div>
                    <h2>
                      Side by side <span>{displayedOffers.length}</span>
                    </h2>
                    <p>Same requirements. Publicly listed item prices.</p>
                  </div>
                  <div className="offers-actions">
                    {Number(budget) > 0 && (
                      <button
                        className={`budget-filter ${budgetOnly ? "on" : ""}`}
                        onClick={() => setBudgetOnly(!budgetOnly)}
                      >
                        <SlidersHorizontal size={13} />
                        Under {money(Number(budget), run.goal.currency)}
                        <small>item only</small>
                      </button>
                    )}
                    <button
                      className="secondary-button"
                      onClick={() => {
                        void copyResults();
                      }}
                      disabled={!uniqueOffers.length}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      <span>{copied ? "Copied" : "Copy results"}</span>
                    </button>
                  </div>
                </div>
                <div className="offer-table">
                  <div className="table-head">
                    <span>STORE & PRODUCT</span>
                    <span>ITEM PRICE</span>
                    <span>SHIPPING & TAX</span>
                    <span />
                  </div>
                  {displayedOffers.map((offer, index) => (
                    <div className="offer-row" key={offer.id}>
                      <div className="merchant-cell">
                        <span className={`merchant-icon merchant-${index % 3}`}>
                          <ShoppingBag size={19} />
                        </span>
                        <div>
                          <strong>
                            {offer.merchant}
                            {offer.id === recommended?.id && (
                              <span className="best-label">{run.mode === "sample" ? "LOWEST SAMPLE" : "BEST OPTION"}</span>
                            )}
                          </strong>
                          <p>{offer.title}</p>
                          <button
                            className="evidence-link"
                            onClick={() => setOfferDetail(offer)}
                          >
                            <CheckCheck size={12} />
                            {run.mode === "sample"
                              ? "View sample evidence"
                              : "View price evidence"}
                          </button>
                        </div>
                      </div>
                      <strong className="table-price">
                        {money(offer.price, offer.currency)}
                      </strong>
                      <span className="unconfirmed">{run.mode === "live" && !knownRetailSeller(offer, run.goal.country) ? "Seller unverified" : "Not confirmed"}</span>
                      {run.mode === "live" ? <a
                        className="source-button retail-open"
                        href={offer.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`View listing at ${offer.merchant}`}
                      >Open <ArrowUpRight size={15} /></a> : <button
                        className="source-button"
                        onClick={() => setOfferDetail(offer)}
                        aria-label={`See evidence for ${offer.merchant}`}
                      >
                        <ArrowUpRight size={18} />
                      </button>}
                    </div>
                  ))}
                  {!displayedOffers.length && (
                    <div className="empty-offers">
                      {active ? (
                        <>
                          <LoaderCircle size={22} className="spin" />
                          <strong>Fresh eyes on your next purchase.</strong>
                          <span>
                            Source-backed offers will appear here as workers
                            finish.
                          </span>
                        </>
                      ) : (
                        <>
                          <Search size={22} />
                          <strong>
                            {budgetOnly
                              ? "No observed item prices under this ceiling."
                              : "No exact-match offer passed the evidence checks."}
                          </strong>
                          <span>
                            {budgetOnly
                              ? "Shipping and tax would still need confirmation."
                              : "A more specific model or a public product link may help."}
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>
                <div className="table-footnote">
                  <Info size={13} />A source price is an observation, not a
                  guaranteed checkout total.
                </div>
              </section>
              {run.warning && (
                <div className="error-message warning" role="status">
                  <Info size={16} />
                  {run.warning}
                </div>
              )}
              <div className="run-bottom">
                <section className="worker-card">
                  <div className="section-header">
                    <h2>Fresh context, same goal</h2>
                    <span className="subtle-tag">
                      {run.mode === "sample"
                        ? "EXAMPLE STYLES"
                        : "SYNTHETIC STYLES"}
                    </span>
                  </div>
                  {run.personas.map((persona, index) => (
                    <div className="worker-row" key={persona.id}>
                      <span className={`worker-avatar ${persona.color}`}>
                        <Fingerprint size={17} />
                      </span>
                      <div>
                        <strong>{persona.label}</strong>
                        <p>{persona.description}</p>
                      </div>
                      <span className="worker-state">
                        {run.mode === "sample" ? (
                          "Sample"
                        ) : index < run.workersDisposed ? (
                          <>
                            <Check size={12} />
                            Ended
                          </>
                        ) : active && index === run.workersDisposed ? (
                          <>
                            <span className="status-dot live" />
                            Working
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                    </div>
                  ))}
                  <div className="worker-footnote">
                    <LockKeyhole size={12} />
                    No age, income, identity, or personal shopping history.
                  </div>
                </section>
                <section className="activity-card">
                  <div className="section-header">
                    <h2>
                      {run.mode === "sample"
                        ? "What a live run does"
                        : "Search activity"}
                    </h2>
                    {active && (
                      <button
                        className="stop-button"
                        onClick={() => {
                          void cancel();
                        }}
                      >
                        <Square size={10} />
                        Stop
                      </button>
                    )}
                  </div>
                  <ol className="activity-list">
                    {run.events.slice(-5).map((event, index) => (
                      <li key={event.id}>
                        <span
                          className={`activity-dot ${active && index === Math.min(run.events.length, 5) - 1 ? "current" : ""}`}
                        />
                        <p>{event.message}</p>
                      </li>
                    ))}
                  </ol>
                  <div className="retention-note">
                    <Trash2 size={12} />
                    {run.mode === "sample"
                      ? "Example lives only in this tab."
                      : "Search data expires after 15 minutes. Clear it any time."}
                  </div>
                </section>
              </div>
            </>
          )}
          {view === "how" && (
            <InfoPage
              title="A fresh perspective on price."
              subtitle="Your goal stays fixed. Your personal history stays out."
              kind="how"
              onExample={showExample}
            />
          )}
          {view === "privacy" && (
            <InfoPage
              title="Privacy you can inspect."
              subtitle="Clear boundaries, without an absolute anonymity promise."
              kind="privacy"
              onExample={showExample}
            />
          )}
          <footer className="main-footer">
            <span>
              <Mark small />
              Your price. Your privacy.
            </span>
            <button onClick={() => setView("privacy")}>
              Built with less personal data
              <ArrowUpRight size={12} />
            </button>
          </footer>
        </div>
      </main>
      {reviewOpen && (
        <Dialog
          title="Check your shopping goal"
          onClose={() => setReviewOpen(false)}
        >
          <p className="goal-review-note">
            Every agent will compare this exact product, in new condition.
            Adjust it before the goal is locked.
          </p>
          <form className="goal-review-form" onSubmit={start}>
            <label className="field-label" htmlFor="product">
              Product or model
            </label>
            <input
              className="text-input"
              id="product"
              value={product}
              onChange={(event) => setProduct(event.target.value)}
              required
              minLength={2}
              maxLength={160}
              autoComplete="off"
            />
            <label className="field-label" htmlFor="variant">
              Exact variant <span>Optional</span>
            </label>
            <input
              className="text-input"
              id="variant"
              value={variant}
              onChange={(event) => setVariant(event.target.value)}
              placeholder="Color, size, or capacity"
              maxLength={100}
              autoComplete="off"
            />
            <p className="modal-note">
              {country} market · New condition · Shipping and tax may be
              unconfirmed
            </p>
            {error && (
              <p className="error-message" role="alert">
                {error}
              </p>
            )}
            <button
              className="primary-button full-width"
              type="submit"
              disabled={busy}
            >
              {busy ? (
                <LoaderCircle size={17} className="spin" />
              ) : (
                <Sparkles size={17} />
              )}{" "}
              Find my price <ArrowRight size={17} />
            </button>
          </form>
        </Dialog>
      )}
      {connectionOpen && (
        <Dialog
          title="Your private connection"
          onClose={() => setConnectionOpen(false)}
        >
          <div className="connection-hero">
            <ShieldCheck size={28} />
            <h3>{verified ? "Enclave verified." : "Ready for Tinfoil."}</h3>
            <p>
              {verified
                ? "This browser verified the configured Tinfoil workload before sending shopping details."
                : "This is a local preview. Connect the server to Tinfoil to run real shopping research."}
            </p>
          </div>
          <div className="connection-checks">
            <ConnectionLine
              checked={connectionReady}
              title="Application connection"
              detail={
                connectionError ||
                (verified
                  ? "Attestation checked; encrypted request bodies."
                  : "Loopback connection for local development.")
              }
            />
            <ConnectionLine
              checked={!!config?.liveConfigured}
              title="Confidential inference & search"
              detail={
                config?.liveConfigured
                  ? "Server credentials configured. Each provider is verified when called."
                  : "Set TINFOIL_API_KEY on the server, never in this browser."
              }
            />
            <ConnectionLine
              checked={verified}
              title="Tinfoil application hosting"
              detail={
                verified
                  ? (config?.configRepo ?? "")
                  : "Deploy the included container and pin its configuration repository."
              }
            />
          </div>
          {config?.accessRequired && (
            <div className="access-field">
              <label className="field-label" htmlFor="access">
                Workspace access code
              </label>
              <input
                className="text-input"
                id="access"
                type="password"
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                autoComplete="off"
              />
              <small>
                Kept in memory and sent inside encrypted request bodies.
              </small>
            </div>
          )}
          <p className="modal-note">
            No personal accounts or browser history are connected. Search
            queries and source URLs are shared with Tinfoil’s external search
            provider.
          </p>
          <button
            className="primary-button full-width"
            onClick={() => setConnectionOpen(false)}
          >
            Back to my workspace
            <ArrowRight size={16} />
          </button>
          <a
            className="documentation-link"
            href="https://docs.tinfoil.sh/containers/quickstart"
            target="_blank"
            rel="noopener noreferrer"
          >
            Tinfoil deployment documentation
            <ExternalLink size={12} />
          </a>
        </Dialog>
      )}
      {offerDetail && (
        <Dialog
          title="The price, with its source"
          onClose={() => setOfferDetail(null)}
        >
          <div className="evidence-header">
            <span className="merchant-icon merchant-0">
              <ShoppingBag size={22} />
            </span>
            <div>
              <h3>{offerDetail.merchant}</h3>
              <p>{offerDetail.title}</p>
            </div>
          </div>
          <div className="evidence-price">
            {money(offerDetail.price, offerDetail.currency)}
            <span>Item price · shipping and tax unconfirmed</span>
          </div>
          <div className="evidence-quote">
            <span className="tiny-label">
              {run?.mode === "sample"
                ? "ILLUSTRATIVE EXCERPT"
                : "EXCERPT FROM RETRIEVED SOURCE"}
            </span>
            <blockquote>{offerDetail.evidence}</blockquote>
          </div>
          <p className="modal-note">
            {run?.mode === "sample"
              ? "This fictional store and price demonstrate the interface. They are not a current shopping offer."
              : `Retrieved ${new Date(offerDetail.observedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. Source content can be cached or incomplete. Availability, conditions, and checkout totals can change.`}
          </p>
          {run?.mode !== "sample" && (
            <>
              <a
                className="primary-button full-width"
                href={offerDetail.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open store listing
                <ArrowUpRight size={16} />
              </a>
              <small className="external-note">
                Opens in your normal browser session. The store may identify
                you.
              </small>
            </>
          )}
        </Dialog>
      )}
    </div>
  );
}

function ConnectionLine({
  checked,
  title,
  detail,
}: {
  checked: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div className="connection-line">
      <span className={checked ? "check-circle" : "empty-circle"}>
        {checked ? <Check size={12} /> : <span />}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}
function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const dialog = ref.current!;
    dialog.querySelector<HTMLElement>("button")?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") {
        const items = [
          ...dialog.querySelectorAll<HTMLElement>(
            'button, a[href], input, select, textarea, [tabindex="0"]',
          ),
        ].filter((item) => !item.hasAttribute("disabled"));
        const first = items[0],
          last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", listener);
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", listener);
      document.body.style.overflow = old;
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        ref={ref}
      >
        <div className="dialog-heading">
          <h2 id="dialog-title">{title}</h2>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
function InfoPage({
  title,
  subtitle,
  kind,
  onExample,
}: {
  title: string;
  subtitle: string;
  kind: "how" | "privacy";
  onExample: () => void;
}) {
  const entries =
    kind === "how"
      ? [
          [
            "01",
            "Start with a link or a goal",
            "For a flight or a shopping idea, the app starts with the details you have and asks what would help narrow the search. For an exact product, review the item and variant before starting a price comparison.",
          ],
          [
            "02",
            "Generate independent shopping styles",
            "For a product comparison, a neutral control and two synthetic styles search for the same confirmed item. Their phrasing varies and none receives a user profile.",
          ],
          [
            "03",
            "Retrieve and check the sources",
            "Product prices must appear in a fetched excerpt and match the item. When enabled, live flight search checks the itinerary and shows prices with airline booking links.",
          ],
          [
            "04",
            "Compare observations, release workers",
            "The app shows supported item prices and releases each worker process. Search data remains in memory for up to 15 minutes, or until you clear it.",
          ],
        ]
      : [
          [
            "01",
            "Your budget stays here",
            "The price ceiling exists only in browser memory. It filters results on your device and is never included in a worker request.",
          ],
          [
            "02",
            "No personal profile is connected",
            "The app has no access to your email, normal browser cookies, accounts, contacts, or purchase history. Synthetic context is generated independently.",
          ],
          [
            "03",
            "Confidential processing has boundaries",
            "In production, the browser verifies the configured Tinfoil workload and encrypts request bodies. Tinfoil still observes operational metadata. External search providers receive selected search terms and source URLs.",
          ],
          [
            "04",
            "Disposable means a clear lifecycle",
            "Workers are fresh processes within the application enclave, not separate Bunker VMs. They do not inherit credentials. Results are held temporarily in memory; there is no application database, analytics, or prompt logging. Provider caches and metadata have separate lifetimes.",
          ],
          [
            "05",
            "A clearer comparison, not a fairness guarantee",
            "Different public offers do not prove personalized pricing. Source text may be cached. Opening a merchant link uses your normal browser, and your checkout price can differ. This version does not spoof browser fingerprints or create historical merchant profiles.",
          ],
        ];
  return (
    <section className="info-page">
      <div className="eyebrow">
        <span />
        {kind === "privacy"
          ? "DESIGNED AROUND LESS DATA"
          : "THE PROCESS, MADE VISIBLE"}
      </div>
      <h1>{title}</h1>
      <p className="info-subtitle">{subtitle}</p>
      <div className="info-entries">
        {entries.map(([number, heading, text]) => (
          <article key={number}>
            <span>{number}</span>
            <div>
              <h2>{heading}</h2>
              <p>{text}</p>
            </div>
            {kind === "privacy" ? (
              <Shield size={20} />
            ) : (
              <ArrowRight size={20} />
            )}
          </article>
        ))}
      </div>
      <div className="info-bottom">
        <p>
          {kind === "privacy"
            ? "Only product requirements should go into a search. A product query can itself reveal an interest."
            : "See what the result looks like before connecting anything."}
        </p>
        <button className="secondary-button" onClick={onExample}>
          Explore the example
          <ArrowUpRight size={14} />
        </button>
      </div>
    </section>
  );
}
function money(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

createRoot(document.getElementById("root")!).render(<App />);
