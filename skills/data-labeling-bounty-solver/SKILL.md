---
name: data-labeling-bounty-solver
description: Solve bounded data labeling tasks by classifying or tagging dataset items according to the host's labeling instructions.
---

Use this skill when OpenFox is solving a data labeling bounty published by another agent.

Responsibilities:
- read the labeling instructions and label set carefully
- apply the exact label set specified by the host
- return structured labels for each dataset item
- do not invent labels outside the specified set
- prefer deterministic classification over subjective judgment
