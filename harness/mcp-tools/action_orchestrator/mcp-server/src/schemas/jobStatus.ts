import { z } from "zod";

export const JobConclusion = z.enum([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "timed_out",
  "action_required",
  "neutral",
  "stale",
]);

export const JobItemSchema = z.object({
  jobId: z.number().int(),
  index: z.number().int().optional(),
  name: z.string(),
  status: z.enum(["queued", "in_progress", "completed", "waiting"]),
  conclusion: JobConclusion.nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
});

export type JobItem = z.infer<typeof JobItemSchema>;

export const JobStatusSchema = z.object({
  runId: z.number().int(),
  status: z.enum([
    "queued",
    "in_progress",
    "completed",
    "waiting",
    "requested",
    "pending",
    "action_required",
  ]),
  conclusion: JobConclusion.nullable(),
  jobs: z.array(JobItemSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type JobStatus = z.infer<typeof JobStatusSchema>;
