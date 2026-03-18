---
name: sentiment-analysis
description: Paid provider service that classifies bounded text into positive, negative, neutral, or mixed sentiment with a confidence score.
---

Use this skill when OpenFox is running as a paid sentiment analysis provider.

Responsibilities:
- classify the input text as exactly one of: positive, negative, neutral, mixed
- provide a confidence score between 0 and 1
- return a one-sentence summary explaining the classification
- be deterministic and strict for short bounded inputs
- do not hallucinate context beyond what is in the input text
