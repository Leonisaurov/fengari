# Security policy

## Supported versions

Fengari is developed on `master` and published from that branch. Security
fixes are applied to the latest release.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private vulnerability reporting on
<https://github.com/fengari-lua/fengari/security/advisories/new>, or contact a
maintainer listed in `package.json`.

Include:

- the Fengari version or commit;
- the host (Node version, browser, worker) and how Lua code is loaded;
- a minimal reproducer (Lua chunk, JS host code or archive);
- the impact and any known workaround.

You should receive an initial response within a few days. We will coordinate a
fix and a disclosure date, and credit reporters unless they prefer to stay
anonymous.

## Scope

Fengari executes untrusted Lua code only behind the host's own sandbox,
timeouts and memory limits. `api.sandbox` reduces the available libraries and
adds approximate instruction/time/memory limits, but it is not a hardened
security boundary by itself. In particular:

- `io`, `os`, `debug` and `package` are powerful and can be removed with
  `api.sandbox`;
- the JavaScript GC and the 32-bit integer model are not sandbox controls;
- browser deployments should also treat network-loaded modules as untrusted.

Problems in those documented limitations are not vulnerabilities by
themselves. Bugs that escape the sandbox, corrupt memory/state, execute host
code or read files outside the mounted VFS are in scope.
