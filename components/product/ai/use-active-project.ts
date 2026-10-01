'use client';
import { useCallback, useEffect, useState } from 'react';
import { resolveActiveProjectId, type ProjectRecord } from './model';

export const PROJECT_PARAM = 'project';
const STORAGE_KEY = 'unilab-active-project';

function readRequested(): string {
  if (typeof window === 'undefined') return '';
  const fromUrl = new URL(window.location.href).searchParams.get(PROJECT_PARAM);
  if (fromUrl) return fromUrl;
  try {
    return sessionStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function persist(id: string) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(PROJECT_PARAM, id);
  else url.searchParams.delete(PROJECT_PARAM);
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(window.history.state, '', next);
  }
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: URL still carries the choice */
  }
}

/**
 * Active project shared by the AI page and the Leads filter: URL `?project=` first, then sessionStorage,
 * then the default (oldest) project. A deleted project falls back to the default.
 */
export function useActiveProject(projects: readonly ProjectRecord[], ready: boolean) {
  const [requested, setRequested] = useState<string>('');
  useEffect(() => {
    setRequested(readRequested());
  }, []);
  const activeId = resolveActiveProjectId(requested, projects);
  useEffect(() => {
    if (ready && projects.length) persist(activeId);
  }, [activeId, ready, projects.length]);
  const select = useCallback((id: string) => {
    setRequested(id);
    persist(id);
  }, []);
  return [activeId, select] as const;
}
