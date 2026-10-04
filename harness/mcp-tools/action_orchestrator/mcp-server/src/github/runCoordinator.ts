import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { getOctokit } from "./client.js";

const BACKGROUND_POLL_INTERVAL_MS = 30_000;

interface Reservation {
  id: string;
  taskId: string;
  createdAt: string;
}

interface ActiveRun {
  taskId: string;
  repo: string;
  startedAt: string;
}

export interface RunCapacity {
  maxConcurrentRuns: number;
  activeRuns: number;
  pendingDispatches: number;
  availableSlots: number;
  trackedRunIds: number[];
}

/**
 * Process-wide concurrency coordinator shared by every MCP transport/session.
 * A reservation is taken before dispatch because GitHub does not return a run
 * ID from workflow_dispatch immediately. It becomes an active run when the ID
 * is discovered, and is released when GitHub reports the run as completed.
 */
class RunCoordinator {
  private readonly reservations = new Map<string, Reservation>();
  private readonly activeRuns = new Map<number, ActiveRun>();
  private monitorTimer: ReturnType<typeof setInterval> | undefined;
  private monitoring = false;

  reserve(taskId: string): string {
    const capacity = this.getCapacity();
    if (capacity.availableSlots === 0) {
      throw new Error(
        `MAX_CONCURRENT_RUNS=${capacity.maxConcurrentRuns} has been reached ` +
          `(${capacity.activeRuns} active, ${capacity.pendingDispatches} dispatching). ` +
          "Poll or clean up an existing run before starting another one.",
      );
    }

    const id = randomUUID();
    this.reservations.set(id, { id, taskId, createdAt: new Date().toISOString() });
    return id;
  }

  activate(reservationId: string, runId: number, repo: string): RunCapacity {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error("Workflow run reservation was not found");
    }

    this.reservations.delete(reservationId);
    this.activeRuns.set(runId, {
      taskId: reservation.taskId,
      repo,
      startedAt: new Date().toISOString(),
    });
    this.startBackgroundMonitor();
    return this.getCapacity();
  }

  releaseReservation(reservationId: string): void {
    this.reservations.delete(reservationId);
    this.stopMonitorWhenIdle();
  }

  observeStatus(runId: number, status: string): RunCapacity {
    if (status === "completed") {
      this.releaseRun(runId);
    }
    return this.getCapacity();
  }

  releaseRun(runId: number): void {
    if (this.activeRuns.delete(runId)) {
      logger.info({ runId }, "Released workflow concurrency slot");
    }
    this.stopMonitorWhenIdle();
  }

  releaseRepository(repo: string): void {
    for (const [runId, activeRun] of this.activeRuns) {
      if (activeRun.repo === repo) this.releaseRun(runId);
    }
  }

  getCapacity(): RunCapacity {
    const activeRuns = this.activeRuns.size;
    const pendingDispatches = this.reservations.size;
    return {
      maxConcurrentRuns: config.MAX_CONCURRENT_RUNS,
      activeRuns,
      pendingDispatches,
      availableSlots: Math.max(0, config.MAX_CONCURRENT_RUNS - activeRuns - pendingDispatches),
      trackedRunIds: [...this.activeRuns.keys()],
    };
  }

  private startBackgroundMonitor(): void {
    if (this.monitorTimer) return;

    this.monitorTimer = setInterval(() => {
      void this.refreshCompletedRuns();
    }, BACKGROUND_POLL_INTERVAL_MS);
    this.monitorTimer.unref();
  }

  private stopMonitorWhenIdle(): void {
    if (this.activeRuns.size > 0 || this.reservations.size > 0 || !this.monitorTimer) return;
    clearInterval(this.monitorTimer);
    this.monitorTimer = undefined;
  }

  private async refreshCompletedRuns(): Promise<void> {
    if (this.monitoring || this.activeRuns.size === 0) return;
    this.monitoring = true;

    try {
      const octokit = getOctokit();
      const runIds = [...this.activeRuns.keys()];
      const statuses = await Promise.all(
        runIds.map(async (runId) => {
          const activeRun = this.activeRuns.get(runId);
          if (!activeRun) return undefined;
          const { data } = await octokit.rest.actions.getWorkflowRun({
            owner: config.GITHUB_OWNER,
            repo: activeRun.repo,
            run_id: runId,
          });
          return { runId, status: data.status };
        }),
      );

      for (const result of statuses) {
        if (!result) continue;
        const { runId, status } = result;
        if (status === "completed") this.releaseRun(runId);
      }
    } catch (err) {
      // Keep slots reserved when GitHub cannot be reached; releasing them would
      // allow the configured limit to be exceeded while runs may still be active.
      logger.warn({ err }, "Unable to refresh tracked workflow runs");
    } finally {
      this.monitoring = false;
    }
  }
}

export const runCoordinator = new RunCoordinator();
