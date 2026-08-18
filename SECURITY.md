# Security policy

## Supported versions

Security fixes are applied to the latest released version of Vault Toolkit Bridge.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository instead of opening a public issue. Include the affected plugin version, impact, reproduction steps, and any suggested mitigation.

Do not include real vault contents or bearer tokens. You can expect an acknowledgement within seven days. Please allow time for a fix and release before publicly disclosing the issue.

## Local server security

The plugin listens only on `127.0.0.1`, rejects requests with a browser `Origin` header, requires JSON content for MCP requests, and requires a randomly generated per-vault bearer token for every MCP operation.
