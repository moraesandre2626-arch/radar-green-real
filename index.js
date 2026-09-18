


m
Projects


dep-damqusp7lnhs73c8pr7g

Your free instance will spin down with inactivity, which can delay requests by 50 seconds or more.
Upgrade now
Update index.js
Status
Deploy failed
Duration
19,3s
Deployed
Sep 18, 2026
at
6:38:59 PM
GMT-3

Trigger
Auto-Deploy
Source
2cf74fb
Notices
Exited with status 1 while running your code.
Read our docs for common ways to troubleshoot your deploy.

All logs
Search
Search logs


Live tail



info No lockfile found.
warning radar-v34-6@1.0.0: No license field
[1/4] Resolving packages...
(node:96) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized and prone to errors that have security implications. Use the WHATWG URL API instead. CVEs are not issued for `url.parse()` vulnerabilities.
(Use `node --trace-deprecation ...` to show where the warning was created)
warning node-cron > uuid@8.3.2: uuid@10 and below is no longer supported.  For ESM codebases, update to uuid@latest.  For CommonJS codebases, use uuid@11 (but be aware this version will likely be deprecated in 2028).
[2/4] Fetching packages...
[3/4] Linking dependencies...
[4/4] Building fresh packages...
success Saved lockfile.
Done in 0.95s.
==> Uploading build...
==> Uploaded in 1.4s. Compression took 0.6s
==> Build successful 🎉
==> Deploying...
==> Setting WEB_CONCURRENCY=1 by default, based on available CPUs in the instance
==> Running 'node index.js'
/opt/render/project/src/index.js:609
SyntaxError: Unexpected end of input
    at wrapSafe (node:internal/modules/cjs/loader:1743:18)
    at Module._compile (node:internal/modules/cjs/loader:1786:20)
    at Object..js (node:internal/modules/cjs/loader:1943:10)
    at Module.load (node:internal/modules/cjs/loader:1533:32)
    at Module._load (node:internal/modules/cjs/loader:1335:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47
Node.js v24.14.1
==> Exited with status 1
==> Common ways to troubleshoot your deploy: https://render.com/docs/troubleshooting-deploys
==> Running 'node index.js'
/opt/render/project/src/index.js:609
SyntaxError: Unexpected end of input
    at wrapSafe (node:internal/modules/cjs/loader:1743:18)
    at Module._compile (node:internal/modules/cjs/loader:1786:20)
    at Object..js (node:internal/modules/cjs/loader:1943:10)
    at Module.load (node:internal/modules/cjs/loader:1533:32)
    at Module._load (node:internal/modules/cjs/loader:1335:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47
Node.js v24.14.1
Need better ways to work with logs? Try theRender CLI, Render MCP Server, or set up a log stream integration 

0 services selected:

Move


GMT-3:
Sep 18 06:39:24 PM

UTC:
Sep 18 09:39:24 PM

Timestamp:
1789767564773

From previous:
0,0s

From start:
24,9s
