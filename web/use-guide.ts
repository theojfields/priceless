import { useEffect, useRef, useState } from "react";
import type { GuidedSearch } from "../shared/types";
import { operation } from "./api";

export function useGuide(accessToken: string, onExpire: () => void) {
  const [guide, setGuide] = useState<GuidedSearch | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const active = guide?.status === "planning" || guide?.status === "searching";

  useEffect(() => {
    if (!guide || !key || !active || busy) return;
    const id = request.current;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { guide: next } = await operation<{ guide: GuidedSearch }>("guide-read", { runId: guide.id, runKey: key }, accessToken);
        if (!current || request.current !== id) return;
        setGuide(next);
        setError("");
        if (next.status === "planning" || next.status === "searching") timer = setTimeout(poll, 1100);
      } catch (err) {
        if (!current || request.current !== id) return;
        setError((err as Error).message);
        timer = setTimeout(poll, 4000);
      }
    };
    timer = setTimeout(poll, 600);
    return () => { current = false; clearTimeout(timer); };
  }, [guide?.id, guide?.revision, active, key, busy, accessToken]);

  useEffect(() => {
    if (!guide) return;
    const timer = setTimeout(() => {
      request.current++;
      setGuide(null);
      setKey("");
      setBusy(false);
      onExpire();
      setError("This guided search expired and was cleared.");
    }, Math.max(0, Date.parse(guide.expiresAt) - Date.now()));
    return () => clearTimeout(timer);
  }, [guide?.id]);

  async function start(text: string, country: string) {
    const id = ++request.current;
    setError("");
    setBusy(true);
    setKey("");
    setGuide({ id: "pending", revision: 0, status: "planning", turns: [text], sources: [], expiresAt: new Date(Date.now() + 15 * 60_000).toISOString() });
    const date = new Date();
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    try {
      const { guide: next, runKey } = await operation<{ guide: GuidedSearch; runKey: string }>("guide-start", { text, country, today }, accessToken);
      if (request.current !== id) {
        void operation("guide-clear", { runId: next.id, runKey }, accessToken).catch(() => undefined);
        return;
      }
      setGuide(next);
      setKey(runKey);
    } catch (err) {
      if (request.current === id) {
        setGuide((current) => current && { ...current, status: "failed" });
        setError((err as Error).message);
      }
    } finally {
      if (request.current === id) setBusy(false);
    }
  }

  async function reply(text: string) {
    if (!guide || !key || busy) return false;
    const id = ++request.current;
    setError("");
    setBusy(true);
    try {
      const { guide: next } = await operation<{ guide: GuidedSearch }>("guide-reply", { runId: guide.id, runKey: key, text }, accessToken);
      if (request.current !== id) return false;
      setGuide(next);
      return true;
    } catch (err) {
      if (request.current === id) setError((err as Error).message);
      return false;
    } finally {
      if (request.current === id) setBusy(false);
    }
  }

  async function checkFares() {
    if (!guide || !key || busy || active) return;
    const id = ++request.current;
    setError("");
    setBusy(true);
    try {
      const { guide: next } = await operation<{ guide: GuidedSearch }>("guide-fares", {
        runId: guide.id, runKey: key, revision: guide.revision,
      }, accessToken);
      if (request.current === id) setGuide(next);
    } catch (err) {
      if (request.current === id) setError((err as Error).message);
    } finally {
      if (request.current === id) setBusy(false);
    }
  }

  async function stop() {
    if (!guide || !key || busy) return;
    const id = ++request.current;
    setError("");
    setBusy(true);
    try {
      await operation("guide-cancel", { runId: guide.id, runKey: key }, accessToken);
      if (request.current === id) setGuide({ ...guide, status: "cancelled" });
    } catch (err) {
      if (request.current === id) setError((err as Error).message);
    } finally {
      if (request.current === id) setBusy(false);
    }
  }

  async function clear() {
    const id = ++request.current;
    setGuide(null);
    setKey("");
    setBusy(false);
    setError("");
    if (guide && key) {
      try { await operation("guide-clear", { runId: guide.id, runKey: key }, accessToken); }
      catch { if (request.current === id) setError("Cleared from this tab. The server copy expires automatically."); }
    }
  }

  return { guide, error, active, busy, canReply: !!key, start, reply, checkFares, stop, clear };
}
