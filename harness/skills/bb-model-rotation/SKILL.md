---
name: bb-model-rotation
description: Runtime-only model failover.
---
Team Lead: Gemini -> GPT-5.6.
SME: Claude Sonnet -> GPT-5.6.
Report Validator: GPT-5.6 -> Gemini.
Junior: DeepSeek -> stop.

Rotate only for timeout, provider error, transient network or rate limit.
Never rotate for scope/policy/human/authorization/invalid-target denial.
