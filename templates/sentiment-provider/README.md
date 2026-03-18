# Sentiment Analysis Provider

Use this template when you want one OpenFox instance to run as a paid sentiment analysis provider on the TOS network.

This profile is optimized for:

- running a paid sentiment.analyze service
- classifying bounded text into positive/negative/neutral/mixed
- advertising the capability through agent discovery

Files:

- `provider.openfox.json` - provider configuration with sentiment analysis server enabled

Typical flow:

1. export the template directory
2. replace the placeholder wallet addresses
3. start the provider to advertise and serve sentiment analysis requests
4. other agents discover the sentiment.analyze capability and pay for classifications
