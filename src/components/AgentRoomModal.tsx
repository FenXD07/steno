import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Archive,
  CheckCircle2,
  Inbox,
  Loader2,
  Play,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import type { AgentEvent, AgentLog, OwnerConfig, StenoDocument } from '../types';

interface AgentRoomModalProps {
  open: boolean;
  onClose: () => void;
  ownerConfig: OwnerConfig | null;
  documents: StenoDocument[];
}

interface GitHubRunInfo {
  id: number;
  status: 'queued' | 'in_progress' | 'completed' | string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  activeStepName?: string;
}

type AgentId = 'courier' | 'archivist' | 'librarian';

function detectRepo(ownerConfig: OwnerConfig | null): { owner: string; repo: string } {
  if (ownerConfig?.owner && ownerConfig?.repo) {
    return { owner: ownerConfig.owner, repo: ownerConfig.repo };
  }
  const host = window.location.hostname;
  if (host.endsWith('.github.io')) {
    const owner = host.replace('.github.io', '');
    const repo = window.location.pathname.split('/').filter(Boolean)[0] || 'steno';
    return { owner, repo };
  }
  return { owner: 'FenXD07', repo: 'steno' };
}

function AgentSprite({
  id,
  walking,
  active,
  bubble,
}: {
  id: AgentId;
  walking: boolean;
  active: boolean;
  bubble?: string;
}) {
  const meta = {
    courier: { name: 'Courier', color: '#C1664B', bg: '#F7E8E3' },
    archivist: { name: 'Gemini', color: '#5D8A7B', bg: '#E5EFEA' },
    librarian: { name: 'Librarian', color: '#233329', bg: '#EAE6DA' },
  }[id];

  return (
    <div className="relative flex flex-col items-center select-none">
      {/* Speech Bubble */}
      {bubble && (
        <div className="mb-2 px-2.5 py-1 rounded-lg bg-paper border border-rule shadow-sm text-[11px] font-mono text-ink whitespace-nowrap max-w-[190px] truncate animate-fade-in">
          {bubble}
        </div>
      )}

      {/* Cute Retro Character SVG */}
      <div className={walking ? 'agent-walking' : ''}>
        <svg
          width="42"
          height="46"
          viewBox="0 0 42 46"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className={`drop-shadow-xs transition-transform ${active ? 'scale-110' : 'scale-100 opacity-90'}`}
        >
          {/* Shadow */}
          <ellipse cx="21" cy="43" rx="11" ry="2.5" fill="#233329" fillOpacity="0.14" />
          {/* Legs */}
          <rect x="15" y="34" width="4" height="7" rx="2" fill="#233329" />
          <rect x="23" y="34" width="4" height="7" rx="2" fill="#233329" />
          {/* Body */}
          <rect x="11" y="20" width="20" height="16" rx="6" fill={meta.color} />
          {/* Head */}
          <circle cx="21" cy="14" r="9" fill="#FBF8F1" stroke="#233329" strokeWidth="1.8" />
          {/* Eyes */}
          <circle cx="18" cy="13.5" r="1.3" fill="#233329" />
          <circle cx="24" cy="13.5" r="1.3" fill="#233329" />
          {/* Role accessory */}
          {id === 'courier' && (
            <>
              {/* Cap */}
              <path d="M13 10C13 6.5 16.5 4.5 21 4.5C25.5 4.5 29 6.5 29 10H13Z" fill="#C1664B" stroke="#233329" strokeWidth="1.5" />
              {/* Paper */}
              <rect x="27" y="22" width="8" height="10" rx="1.5" fill="#FFFFFF" stroke="#233329" strokeWidth="1.3" />
            </>
          )}
          {id === 'archivist' && (
            <>
              {/* Glasses */}
              <circle cx="18" cy="13.5" r="3" stroke="#233329" strokeWidth="1.2" />
              <circle cx="24" cy="13.5" r="3" stroke="#233329" strokeWidth="1.2" />
              <line x1="21" y1="13.5" x2="21.2" y2="13.5" stroke="#233329" strokeWidth="1.2" />
              {/* Sparkle badge */}
              <circle cx="21" cy="27" r="3" fill="#F7F5EE" />
            </>
          )}
          {id === 'librarian' && (
            <>
              {/* Book */}
              <rect x="6" y="22" width="8" height="10" rx="1.5" fill="#7FA195" stroke="#233329" strokeWidth="1.3" />
              <line x1="8.5" y1="24" x2="8.5" y2="30" stroke="#F7F5EE" strokeWidth="1.2" />
            </>
          )}
        </svg>
      </div>

      {/* Nameplate */}
      <span
        className="mt-1 px-2 py-0.5 rounded-full font-mono text-[10px] border border-rule/80"
        style={{ backgroundColor: meta.bg, color: '#233329' }}
      >
        {meta.name}
      </span>
    </div>
  );
}

export function AgentRoomModal({
  open,
  onClose,
  ownerConfig,
  documents,
}: AgentRoomModalProps) {
  const { owner, repo } = useMemo(() => detectRepo(ownerConfig), [ownerConfig]);
  const [agentLog, setAgentLog] = useState<AgentLog | null>(null);
  const [runInfo, setRunInfo] = useState<GitHubRunInfo | null>(null);
  const [pollingError, setPollingError] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(false);

  // Agent positions in % along the room floor (12%, 38%, 64%, 88%)
  const [positions, setPositions] = useState<Record<AgentId, number>>({
    courier: 12,
    archivist: 64,
    librarian: 88,
  });
  const [walking, setWalking] = useState<Record<AgentId, boolean>>({
    courier: false,
    archivist: false,
    librarian: false,
  });
  const [bubbles, setBubbles] = useState<Partial<Record<AgentId, string>>>({});
  const [activeAgent, setActiveAgent] = useState<AgentId | null>(null);
  const [replaying, setReplaying] = useState(false);
  const replayAbortRef = useRef(false);

  const loadAgentLog = useCallback(async () => {
    try {
      const res = await fetch(`./agent-log.json?t=${Date.now()}`);
      if (res.ok) {
        const data: AgentLog = await res.json();
        setAgentLog(data);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchGitHubStatus = useCallback(async () => {
    setLoadingStatus(true);
    setPollingError('');
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
      };
      if (ownerConfig?.token) {
        headers.Authorization = `Bearer ${ownerConfig.token}`;
      }

      const runsRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
          repo
        )}/actions/runs?per_page=1`,
        { headers }
      );

      if (!runsRes.ok) {
        throw new Error(`GitHub API ${runsRes.status}`);
      }

      const runsData = await runsRes.json();
      const latest = runsData?.workflow_runs?.[0];
      if (!latest) {
        setRunInfo(null);
        return;
      }

      let activeStepName = '';
      if (latest.status !== 'completed') {
        const jobsRes = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(
            repo
          )}/actions/runs/${latest.id}/jobs`,
          { headers }
        );
        if (jobsRes.ok) {
          const jobsData = await jobsRes.json();
          const currentJob = jobsData?.jobs?.find((j: { status: string }) => j.status !== 'completed');
          const currentStep = currentJob?.steps?.find((s: { status: string }) => s.status === 'in_progress');
          activeStepName = currentStep?.name || currentJob?.name || '';
        }
      }

      setRunInfo({
        id: latest.id,
        status: latest.status,
        conclusion: latest.conclusion,
        html_url: latest.html_url,
        created_at: latest.created_at,
        activeStepName,
      });
    } catch (err) {
      setPollingError(err instanceof Error ? err.message : 'Could not fetch live status');
    } finally {
      setLoadingStatus(false);
    }
  }, [owner, repo, ownerConfig]);

  // Load log & poll GitHub Actions when modal opens
  useEffect(() => {
    if (!open) return;
    loadAgentLog();
    fetchGitHubStatus();

    const interval = setInterval(() => {
      fetchGitHubStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [open, loadAgentLog, fetchGitHubStatus]);

  // Move agents dynamically based on real GitHub Actions progress (when not replaying)
  useEffect(() => {
    if (!open || replaying || !runInfo) return;

    if (runInfo.status === 'completed') {
      setPositions({ courier: 12, archivist: 64, librarian: 88 });
      setWalking({ courier: false, archivist: false, librarian: false });
      setActiveAgent(null);
      setBubbles(
        runInfo.conclusion === 'success'
          ? { librarian: 'Archive up to date!' }
          : { archivist: `Run ended: ${runInfo.conclusion}` }
      );
      loadAgentLog();
      return;
    }

    const step = (runInfo.activeStepName || '').toLowerCase();
    if (step.includes('gemini') || step.includes('sort')) {
      setPositions({ courier: 38, archivist: 64, librarian: 88 });
      setWalking({ courier: false, archivist: true, librarian: false });
      setActiveAgent('archivist');
      setBubbles({ archivist: 'Gemini is reading & tagging…' });
    } else if (step.includes('commit') || step.includes('build') || step.includes('deploy')) {
      setPositions({ courier: 12, archivist: 64, librarian: 88 });
      setWalking({ courier: false, archivist: false, librarian: true });
      setActiveAgent('librarian');
      setBubbles({ librarian: `Publishing (${runInfo.activeStepName || 'deploy'})…` });
    } else {
      setPositions({ courier: 38, archivist: 38, librarian: 88 });
      setWalking({ courier: true, archivist: false, librarian: false });
      setActiveAgent('courier');
      setBubbles({ courier: `Fetching inbox (${runInfo.activeStepName || 'queued'})…` });
    }
  }, [open, replaying, runInfo, loadAgentLog]);

  const stopReplay = () => {
    replayAbortRef.current = true;
    setReplaying(false);
    setWalking({ courier: false, archivist: false, librarian: false });
    setActiveAgent(null);
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const startReplay = async () => {
    if (replaying) {
      stopReplay();
      return;
    }

    // Use real events from agent-log.json, or fallback to latest docs as demo trace
    const eventsToPlay: AgentEvent[] =
      agentLog?.events?.length
        ? agentLog.events.slice(0, 6)
        : documents.slice(0, 3).map((d) => ({
            file: d.filename,
            title: d.title,
            source: 'manual',
            folder: d.folder,
            tags: d.tags,
            reason: d.summary || `Filed under ${d.folder}`,
            durationMs: 900,
            at: d.addedAt,
          }));

    if (eventsToPlay.length === 0) {
      setBubbles({ archivist: 'Drop a doc in inbox/ first!' });
      return;
    }

    replayAbortRef.current = false;
    setReplaying(true);

    for (const ev of eventsToPlay) {
      if (replayAbortRef.current) break;

      // Step 1: Courier picks up from Inbox -> brings to Reading Lamp
      setActiveAgent('courier');
      setWalking({ courier: true, archivist: false, librarian: false });
      setPositions({ courier: 12, archivist: 64, librarian: 88 });
      setBubbles({ courier: `Picked up ${ev.file}` });
      await sleep(300);
      if (replayAbortRef.current) break;
      setPositions({ courier: 38, archivist: 64, librarian: 88 });
      await sleep(1000);

      // Step 2: Archivist walks to Reading Lamp -> Gemini Desk
      if (replayAbortRef.current) break;
      setActiveAgent('archivist');
      setWalking({ courier: false, archivist: true, librarian: false });
      setPositions({ courier: 12, archivist: 38, librarian: 88 });
      setBubbles({ archivist: `Reading ${ev.file}…` });
      await sleep(950);
      if (replayAbortRef.current) break;
      setPositions({ courier: 12, archivist: 64, librarian: 88 });
      const tagPreview = ev.tags.length ? ` #${ev.tags[0]}` : '';
      setBubbles({ archivist: `→ ${ev.folder}${tagPreview}` });
      await sleep(1100);

      // Step 3: Librarian walks from Gemini Desk -> Filing Cabinet
      if (replayAbortRef.current) break;
      setActiveAgent('librarian');
      setWalking({ courier: false, archivist: false, librarian: true });
      setPositions({ courier: 12, archivist: 64, librarian: 64 });
      setBubbles({ librarian: `Filing "${ev.title}"…` });
      await sleep(950);
      if (replayAbortRef.current) break;
      setPositions({ courier: 12, archivist: 64, librarian: 88 });
      setBubbles({ librarian: `Saved in ${ev.folder}!` });
      await sleep(950);
    }

    if (!replayAbortRef.current) {
      setBubbles({ librarian: 'All done!' });
    }
    setWalking({ courier: false, archivist: false, librarian: false });
    setActiveAgent(null);
    setReplaying(false);
  };

  useEffect(() => {
    if (!open) stopReplay();
  }, [open]);

  if (!open) return null;

  const isLiveRunning = runInfo && runInfo.status !== 'completed';

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 backdrop-blur-[2px] flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="bg-paper border border-rule rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-rule bg-ivory/80 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-mint-soft border border-mint/40 flex items-center justify-center">
              <Activity className="w-4 h-4 text-ink" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-ink leading-none">
                Steno Agent Room
              </h2>
              <p className="text-xs font-mono text-ink-muted mt-0.5">
                {owner}/{repo} • Live GitHub Actions & Gemini Trace
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Live status pill */}
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] border ${
                isLiveRunning
                  ? 'bg-terracotta-soft border-terracotta/40 text-terracotta'
                  : 'bg-mint-soft border-mint/40 text-ink'
              }`}
            >
              {isLiveRunning ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Radio className="w-3 h-3 text-mint" />
              )}
              {isLiveRunning
                ? runInfo?.activeStepName || runInfo?.status
                : runInfo?.status === 'completed'
                ? 'Idle (Last run: ok)'
                : 'Idle'}
            </span>

            <button
              type="button"
              onClick={startReplay}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-ink text-ivory hover:opacity-90 transition-opacity"
            >
              {replaying ? (
                <>
                  <Square className="w-3 h-3" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  Replay
                </>
              )}
            </button>

            <button
              type="button"
              onClick={fetchGitHubStatus}
              disabled={loadingStatus}
              className="p-1.5 rounded-lg border border-rule bg-paper text-ink-muted hover:text-ink hover:bg-paper-warm transition-colors"
              title="Refresh GitHub status"
            >
              <RefreshCw className={`w-4 h-4 ${loadingStatus ? 'animate-spin' : ''}`} />
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-paper-warm"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-ivory/40">
          {/* Interactive Study Room Stage */}
          <div className="relative bg-ivory border border-rule rounded-xl p-5 overflow-hidden shadow-xs">
            {/* Subtle Floor Grid */}
            <div
              className="absolute inset-0 opacity-40 pointer-events-none"
              style={{
                backgroundImage:
                  'linear-gradient(to right, #E2DED2 1px, transparent 1px), linear-gradient(to bottom, #E2DED2 1px, transparent 1px)',
                backgroundSize: '28px 28px',
              }}
            />

            {/* 4 Stations */}
            <div className="relative grid grid-cols-4 gap-2 text-center mb-10 pt-2">
              <div className="flex flex-col items-center">
                <div className="w-11 h-11 rounded-xl bg-paper border border-rule flex items-center justify-center shadow-xs">
                  <Inbox className="w-5 h-5 text-terracotta" />
                </div>
                <span className="mt-1.5 font-mono text-[11px] font-medium text-ink">
                  1. Inbox Tray
                </span>
              </div>

              <div className="flex flex-col items-center">
                <div className="w-11 h-11 rounded-xl bg-paper border border-rule flex items-center justify-center shadow-xs">
                  <Search className="w-5 h-5 text-ink-muted" />
                </div>
                <span className="mt-1.5 font-mono text-[11px] font-medium text-ink">
                  2. Reading Desk
                </span>
              </div>

              <div className="flex flex-col items-center">
                <div className="w-11 h-11 rounded-xl bg-paper border border-rule flex items-center justify-center shadow-xs">
                  <Sparkles className="w-5 h-5 text-mint" />
                </div>
                <span className="mt-1.5 font-mono text-[11px] font-medium text-ink">
                  3. Gemini Brain
                </span>
              </div>

              <div className="flex flex-col items-center">
                <div className="w-11 h-11 rounded-xl bg-paper border border-rule flex items-center justify-center shadow-xs">
                  <Archive className="w-5 h-5 text-ink" />
                </div>
                <span className="mt-1.5 font-mono text-[11px] font-medium text-ink">
                  4. Filing Cabinet
                </span>
              </div>
            </div>

            {/* Walking Path & Animated Agents */}
            <div className="relative h-28 mt-2">
              <div className="absolute left-[10%] right-[10%] bottom-5 h-0.5 bg-rule border-b border-dashed border-ink-muted/30" />

              {(['courier', 'archivist', 'librarian'] as AgentId[]).map((id) => (
                <div
                  key={id}
                  className="absolute bottom-2 -translate-x-1/2 transition-all duration-900 ease-in-out"
                  style={{ left: `${positions[id]}%` }}
                >
                  <AgentSprite
                    id={id}
                    walking={walking[id]}
                    active={activeAgent === id}
                    bubble={bubbles[id]}
                  />
                </div>
              ))}
            </div>

            {pollingError && (
              <p className="relative text-[11px] font-mono text-terracotta mt-2">
                Note: Live GitHub polling paused ({pollingError}). Replay still works offline.
              </p>
            )}
          </div>

          {/* Chronological Agent Trace */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="font-mono text-xs uppercase tracking-wider text-ink-muted">
                Recent Gemini Activity Log
              </h3>
              {runInfo?.html_url && (
                <a
                  href={runInfo.html_url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[11px] text-mint hover:underline"
                >
                  View full run on GitHub →
                </a>
              )}
            </div>

            {!agentLog?.events?.length ? (
              <div className="bg-paper border border-rule rounded-xl p-6 text-center text-sm text-ink-muted">
                No AI sorting log recorded yet. Push a file or click{' '}
                <strong className="text-ink">Replay</strong> to see the agents in action!
              </div>
            ) : (
              <div className="bg-paper border border-rule rounded-xl divide-y divide-rule overflow-hidden">
                {agentLog.events.map((ev, idx) => (
                  <div key={`${ev.file}-${idx}`} className="px-4 py-3 text-sm flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-mint shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <span className="font-medium text-ink truncate">
                          {ev.title}{' '}
                          <span className="font-mono text-xs text-ink-muted font-normal">
                            ({ev.file})
                          </span>
                        </span>
                        <span className="font-mono text-[11px] text-ink-muted">
                          {(ev.durationMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                      <p className="text-xs text-ink-muted mt-0.5">
                        Filed in <span className="font-mono text-ink">{ev.folder}</span>
                        {ev.reason ? ` — ${ev.reason}` : ''}
                      </p>
                      {ev.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {ev.tags.map((t) => (
                            <span
                              key={t}
                              className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-ivory border border-rule text-ink-muted"
                            >
                              #{t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}