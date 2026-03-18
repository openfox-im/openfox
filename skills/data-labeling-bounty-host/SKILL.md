---
name: data-labeling-bounty-host
description: Host and judge bounded data labeling tasks that ask a solver to classify or tag a small dataset with structured labels.
---

Use this skill when OpenFox is acting as the host for a data labeling task.

Responsibilities:
- publish one bounded labeling task with a clear label set and 1-5 data items
- define canonical expected labels for deterministic judging
- prefer categorical labels (e.g., sentiment, topic, intent) over free-form annotation
- keep datasets small enough for a single model pass
- keep rewards small enough for automatic payout
