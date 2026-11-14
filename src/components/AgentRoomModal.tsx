import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Camera,
  CheckCircle2,
  FastForward,
  Loader2,
  PackagePlus,
  Play,
  Radio,
  RefreshCw,
  Square,
  X,
} from 'lucide-react';
import type { AgentEvent, AgentLog, OwnerConfig, StenoDocument } from '../types';
import type { CameraPreset, LiveWorkflowStage, PipelineJob, PipelinePhase } from './AgentRoom3DCanvas';

const AgentRoom3DCanvas = lazy(() =>
  import('./AgentRoom3DCanvas').then((module) => ({ default: module.AgentRoom3DCanvas }))
);

interface AgentRoomModalProps {
  open: boolean;
  onClose: () => void;
  ownerConfig: OwnerConfig | null;
  documents: StenoDocument[];
  pendingDrop?: { seq: number; files: string[] } | null;
}

interface GitHubRunInfo {
  id: number;
  status: 'queued' | 'in_progress' | 'completed' | string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  activeStepName?: string;
}

const STEP_LABELS: Array<{ id: string; label: string; phases: PipelinePhase[] }> = [
  { id: 'drop', label: '1. Drop', phases: ['dropping'] },
  { id: 'courier', label: '2. Courier', phases: ['courier_to_inbox', 'courier_to_github'] },
  { id: 'github', label: '3. GitHub', phases: ['github_sync', 'gemini_to_github'] },
  { id: 'desk', label: '4. Desk', phases: ['gemini_to_desk'] },
  { id: 'scan', label: '5. AI Scan', phases: ['ai_processing'] },
  {
    id: 'shelf',
    label: '6. Shelved',
    phases: ['librarian_to_desk', 'librarian_to_shelf', 'shelving_and_stamp', 'return_idle'],
  },
];

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

export function AgentRoomModal({
  open,
  onClose,
  ownerConfig,
  documents,
  pendingDrop,
}: AgentRoomModalProps) {
  const { owner, repo } = useMemo(() => detectRepo(ownerConfig), [ownerConfig]);
  const [agentLog, setAgentLog] = useState<AgentLog | null>(null);
  const [runInfo, setRunInfo] = useState<GitHubRunInfo | null>(null);
  const [pollingError, setPollingError] = useState('');
  const [loadingStatus, setLoadingStatus] = useState(false);

  const [dropBatch, setDropBatch] = useState<{ seq: number; jobs: PipelineJob[] } | null>(null);
  const [stopSeq, setStopSeq] = useState(0);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [cameraPreset, setCameraPreset] = useState<{ seq: number; preset: CameraPreset }>({
    seq: 0,
    preset: 'iso',
  });
  const [activePhase, setActivePhase] = useState<PipelinePhase>('idle');
  const [activeJob, setActiveJob] = useState<PipelineJob | null>(null);
  const [queueCount, setQueueCount] = useState(0);
  const [lastConsumedDropSeq, setLastConsumedDropSeq] = useState(0);

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
          const currentJob = jobsData?.jobs?.find(
            (j: { status: string }) => j.status !== 'completed'
          );
          const currentStep = currentJob?.steps?.find(
            (s: { status: string }) => s.status === 'in_progress'
          );
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

  useEffect(() => {
    if (!open) return;
    loadAgentLog();
    fetchGitHubStatus();

    const interval = setInterval(() => {
      fetchGitHubStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [open, loadAgentLog, fetchGitHubStatus]);

  // Trigger 3D drop automatically when OwnerModal uploads files
  useEffect(() => {
    if (!open || !pendingDrop || pendingDrop.seq <= lastConsumedDropSeq) return;
    setLastConsumedDropSeq(pendingDrop.seq);
    const jobs: PipelineJob[] = pendingDrop.files.map((filename, idx) => ({
      id: `upload-${pendingDrop.seq}-${idx}`,
      filename,
      title: filename.replace(/\.[^/.]+$/, ''),
      folder: 'Sorting via Gemini',
      tags: ['inbox', 'ai-sort'],
    }));
    setDropBatch({ seq: Date.now(), jobs });
  }, [open, pendingDrop, lastConsumedDropSeq]);

  // Reset queue when modal closes
  useEffect(() => {
    if (!open) {
      setStopSeq((s) => s + 1);
    }
  }, [open]);

  const handleStateChange = useCallback(
    (info: { phase: PipelinePhase; currentJob: PipelineJob | null; queueCount: number }) => {
      setActivePhase(info.phase);
      setActiveJob(info.currentJob);
      setQueueCount(info.queueCount);
    },
    []
  );

  const handleDropTest = () => {
    const sampleDoc = documents[Math.floor(Math.random() * Math.max(1, documents.length))];
    const job: PipelineJob = sampleDoc
      ? {
          id: `test-${Date.now()}`,
          filename: sampleDoc.filename,
          title: sampleDoc.title,
          folder: sampleDoc.folder,
          tags: sampleDoc.tags,
          reason: sampleDoc.summary,
        }
      : {
          id: `test-${Date.now()}`,
          filename: 'PLL_Notes.pdf',
          title: 'Phase-Locked Loop Notes',
          folder: 'Analog/PLL',
          tags: ['pll', 'circuit'],
        };
    setDropBatch({ seq: Date.now(), jobs: [job] });
  };

  const handleReplay = () => {
    if (activePhase !== 'idle') {
      setStopSeq((s) => s + 1);
      return;
    }

    const eventsToPlay: AgentEvent[] = agentLog?.events?.length
      ? agentLog.events.slice(0, 5)
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
      handleDropTest();
      return;
    }

    const jobs: PipelineJob[] = eventsToPlay.map((ev, idx) => ({
      id: `replay-${Date.now()}-${idx}`,
      filename: ev.file,
      title: ev.title,
      folder: ev.folder,
      tags: ev.tags,
      reason: ev.reason,
    }));
    setDropBatch({ seq: Date.now(), jobs });
  };

  const liveStage: LiveWorkflowStage = useMemo(() => {
    if (!runInfo || runInfo.status === 'completed') return 'idle';
    const step = (runInfo.activeStepName || '').toLowerCase();
    if (step.includes('gemini') || step.includes('sort')) return 'ai';
    if (step.includes('commit') || step.includes('build') || step.includes('deploy')) {
      return 'deploy';
    }
    return 'github';
  }, [runInfo]);

  if (!open) return null;

  const isLiveRunning = runInfo && runInfo.status !== 'completed';
  const isAnimating = activePhase !== 'idle';

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/45 backdrop-blur-[2px] flex items-center justify-center p-2 sm:p-5"
      onClick={onClose}
    >
      <div
        className="bg-paper border border-rule rounded-xl shadow-xl w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 sm:px-5 py-3.5 border-b border-rule bg-ivory/85 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-mint-soft border border-mint/40 flex items-center justify-center">
              <Activity className="w-4 h-4 text-ink" />
            </div>
            <div>
              <h2 className="font-serif text-2xl text-ink leading-none">
                Steno 3D Agent Room
              </h2>
              <p className="text-xs font-mono text-ink-muted mt-0.5">
                {owner}/{repo} • Interactive 3D Sorting Pipeline
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
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
              onClick={handleDropTest}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border border-terracotta/40 bg-terracotta-soft text-terracotta hover:bg-terracotta hover:text-ivory transition-colors"
              title="Drop 1 package down the 3D chute"
            >
              <PackagePlus className="w-3.5 h-3.5" />
              <span>Drop Test</span>
            </button>

            <button
              type="button"
              onClick={handleReplay}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-ink text-ivory hover:opacity-90 transition-opacity"
            >
              {isAnimating ? (
                <>
                  <Square className="w-3 h-3" />
                  Stop
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  Replay Log
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setSpeed((s) => (s === 1 ? 2 : 1))}
              className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                speed === 2
                  ? 'bg-mint-soft border-mint text-ink'
                  : 'bg-paper border-rule text-ink-muted hover:text-ink'
              }`}
              title="Toggle animation speed"
            >
              <FastForward className="w-3.5 h-3.5" />
              {speed}x
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

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4 bg-ivory/40">
          {/* 3D Diorama Stage */}
          <div className="space-y-2.5">
            <Suspense fallback={<div className="h-[460px] rounded-xl bg-ivory border border-rule flex items-center justify-center text-sm text-ink-muted">Loading 3D room…</div>}>
            <AgentRoom3DCanvas
              dropBatch={dropBatch}
              stopSeq={stopSeq}
              speed={speed}
              cameraPreset={cameraPreset}
              liveStage={liveStage}
              onStateChange={handleStateChange}
            />
            </Suspense>

            {/* Stepper + Camera Presets Bar */}
            <div className="flex items-center justify-between gap-3 flex-wrap bg-paper border border-rule rounded-xl px-3.5 py-2.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                {STEP_LABELS.map((step) => {
                  const isCurrent = step.phases.includes(activePhase);
                  return (
                    <span
                      key={step.id}
                      className={`px-2 py-0.5 rounded-md font-mono text-[11px] border transition-colors ${
                        isCurrent
                          ? 'bg-ink text-ivory border-ink font-medium'
                          : 'bg-ivory/70 text-ink-muted border-rule'
                      }`}
                    >
                      {step.label}
                    </span>
                  );
                })}
                {activeJob && (
                  <span className="ml-1 font-mono text-[11px] text-terracotta truncate max-w-[180px]">
                    • {activeJob.filename}
                    {queueCount > 0 ? ` (+${queueCount} queued)` : ''}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-1 font-mono text-[11px]">
                <Camera className="w-3.5 h-3.5 text-ink-muted mr-1" />
                {(['iso', 'front', 'desk'] as CameraPreset[]).map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setCameraPreset((c) => ({ seq: c.seq + 1, preset }))}
                    className="px-2 py-0.5 rounded border border-rule bg-ivory hover:bg-mint-soft text-ink capitalize transition-colors"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            {pollingError && (
              <p className="text-[11px] font-mono text-terracotta">
                Note: Live GitHub polling paused ({pollingError}). 3D Replay & Drop Test still work offline.
              </p>
            )}
          </div>

          {/* Chronological Agent Trace */}
          <div>
            <div className="flex items-center justify-between mb-2">
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
              <div className="bg-paper border border-rule rounded-xl p-5 text-center text-sm text-ink-muted">
                No AI sorting log recorded yet. Click{' '}
                <strong className="text-ink">Drop Test</strong> or{' '}
                <strong className="text-ink">Replay Log</strong> to watch the 3D agents!
              </div>
            ) : (
              <div className="bg-paper border border-rule rounded-xl divide-y divide-rule overflow-hidden">
                {agentLog.events.map((ev, idx) => (
                  <div
                    key={`${ev.file}-${idx}`}
                    className="px-4 py-2.5 text-sm flex items-start gap-3 hover:bg-ivory/50 cursor-pointer transition-colors"
                    onClick={() =>
                      setDropBatch({
                        seq: Date.now(),
                        jobs: [
                          {
                            id: `pick-${idx}-${Date.now()}`,
                            filename: ev.file,
                            title: ev.title,
                            folder: ev.folder,
                            tags: ev.tags,
                            reason: ev.reason,
                          },
                        ],
                      })
                    }
                    title="Click to animate this file in 3D"
                  >
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
                        <div className="flex flex-wrap gap-1 mt-1">
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
