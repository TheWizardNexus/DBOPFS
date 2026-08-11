# Security policy

## Supported version

Security fixes are provided for the current `1.x` release line.

## Reporting a vulnerability

Do not publish exploit details, user data, credentials, or sensitive storage contents in a public issue. Use GitHub's private vulnerability-reporting feature for this repository. If that feature is unavailable, open a minimal issue asking the maintainers for a private reporting channel.

DBOPFS uses application-ID folders to prevent accidental cross-application access. Those folders are not a security boundary against hostile code running on the same origin. Use separate origins or browser profiles where untrusted applications must not share storage authority.
