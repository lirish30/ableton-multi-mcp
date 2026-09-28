# Security Policy

## Supported Versions

Only the latest published version of `ableton-multi-mcp` is supported with
security fixes.

## Reporting a Vulnerability

Please **do not open a public issue** for a security vulnerability.

Instead, report it privately using
[GitHub's private vulnerability reporting](https://github.com/lirish30/ableton-multi-mcp/security/advisories/new)
for this repository. Include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce it.
- Your macOS version and Node.js version.

You should get an initial response within a few days. If the report is
confirmed, a fix will be released and the advisory published once a patch is
available.

## Scope Notes

This tool launches OS processes (`open`, `pgrep`, `mdfind`, `find`) and reads
two environment variables (`ABLETON_APP_PATH`, `ABLETON_PROJECTS_DIRS`) to
build subprocess arguments. Every subprocess call uses `execFile` with an
argument array — never a shell string — specifically to close off
command-injection through project paths or environment variable values. If
you find a case where a path or environment variable value can influence
command execution beyond being passed as a literal argument, that's exactly
the kind of report this policy is for.
