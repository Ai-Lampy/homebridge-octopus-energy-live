# Contributing

Thank you for helping improve Octopus Energy Live.

## Before opening an issue

- Search existing issues first.
- Remove API keys, account numbers, MPANs, meter serials, device IDs, and other personal information from logs and screenshots.
- Confirm the problem still occurs on a supported Node.js and Homebridge version.

## Development

Use Node.js 22 or 24, then run:

```bash
npm ci
npm run lint
npm test
npm pack --dry-run
```

Keep pull requests focused, include tests for behavioural changes, and update the README or changelog where appropriate.

## Pull requests

1. Fork the repository and create a topic branch.
2. Make and test the change.
3. Open a pull request against `main`.
4. Ensure every GitHub Actions check passes.

By contributing, you agree that your contribution is licensed under the MIT License included in this repository.
