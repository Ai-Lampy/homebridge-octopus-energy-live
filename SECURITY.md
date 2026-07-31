# Security policy

## Reporting a vulnerability

Do not report security vulnerabilities in a public issue.

Use GitHub's private vulnerability reporting feature on the repository Security tab. Include the affected version, impact, reproduction steps, and any suggested mitigation. Remove real Octopus credentials and household identifiers from all examples.

The maintainer will acknowledge a complete report as soon as practical and coordinate a fix and disclosure when the issue is confirmed.

## Credentials

Octopus API keys must be treated as passwords. This plugin keeps its short-lived Octopus authentication token in memory and does not intentionally log credentials.
