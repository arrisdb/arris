import { useCallback, useEffect, useRef, useState } from "react";

// Generic behaviors for the collapsible sidebar sections (consoles, notebooks):
// a shared resizable height and a soft-delete with an undo window. They hold no
// domain knowledge, so they live in the shared primitives layer and are reused
// by whichever domain contributes a section.

const SECTION_HEIGHT_KEY = "leftSidebar.sectionHeight";
const SECTION_MIN_H = 80;
const SECTION_MAX_H = 600;
const SECTION_DEFAULT_H = 200;
const EVENT_NAME = "mdbc-section-height";

const SOFT_DELETE_TIMEOUT_MS = 30_000;

function useSectionHeight() {
  const [height, setHeight] = useState<number>(() => {
    if (typeof window === "undefined") return SECTION_DEFAULT_H;
    const raw = window.localStorage.getItem(SECTION_HEIGHT_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n)
      ? Math.min(SECTION_MAX_H, Math.max(SECTION_MIN_H, n))
      : SECTION_DEFAULT_H;
  });
  const isLocal = useRef(false);

  const setLocalHeight = useCallback((h: number) => {
    const clamped = Math.min(SECTION_MAX_H, Math.max(SECTION_MIN_H, h));
    isLocal.current = true;
    setHeight(clamped);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SECTION_HEIGHT_KEY, String(height));
    if (isLocal.current) {
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: height }));
      isLocal.current = false;
    }
  }, [height]);

  useEffect(() => {
    const handler = (e: Event) => {
      setHeight((e as CustomEvent<number>).detail);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => window.removeEventListener(EVENT_NAME, handler);
  }, []);

  return [height, setLocalHeight] as const;
}

function useSoftDelete(onPurge: (id: string) => void) {
  const [deleted, setDeleted] = useState<Set<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const onPurgeRef = useRef(onPurge);
  onPurgeRef.current = onPurge;

  const softDelete = useCallback((id: string) => {
    setDeleted((prev: Set<string>) => new Set(prev).add(id));
    const timer = setTimeout(() => {
      timers.current.delete(id);
      onPurgeRef.current(id);
      setDeleted((prev: Set<string>) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, SOFT_DELETE_TIMEOUT_MS);
    timers.current.set(id, timer);
  }, []);

  const restore = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer != null) clearTimeout(timer);
    timers.current.delete(id);
    setDeleted((prev: Set<string>) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const purgeAll = useCallback(() => {
    for (const [id, timer] of timers.current) {
      clearTimeout(timer);
      onPurgeRef.current(id);
    }
    timers.current.clear();
    setDeleted(new Set());
  }, []);

  useEffect(() => {
    return () => {
      for (const [id, timer] of timers.current) {
        clearTimeout(timer);
        onPurgeRef.current(id);
      }
      timers.current.clear();
    };
  }, []);

  return { deleted, softDelete, restore, purgeAll };
}

export { SOFT_DELETE_TIMEOUT_MS, useSectionHeight, useSoftDelete };
