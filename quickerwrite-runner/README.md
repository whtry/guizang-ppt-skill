# QuickerWrite isolated runner

This AGPL-3.0 runner exposes the repository's presentation runtime through
QuickerWrite's neutral `v1` JSON job protocol. In QuickerWrite it is bundled
under `api/ppt_engines` and automatically supervised by the API startup
chain; operators do not start it or configure a Runner URL separately.
It remains a separate Node process and source tree, and QuickerWrite never
imports its implementation into the Django commercial core.

## Changes in this fork

- Added asynchronous `POST /v1/jobs` and `GET /v1/jobs/{id}` endpoints plus
  authenticated artifact download.
- Added optional HMAC-SHA256 request authentication with a five-minute replay
  window.
- Reduced the deployment image to the two HTML templates, local Motion
  runtime, preview sheet, license/source files, and this Runner. Agent install
  helpers, development validators, examples, and screenshot-only assets are
  not shipped.
- Inlined Motion into each generated HTML artifact, so the artifact remains
  usable without a sibling asset directory or a GitHub-hosted runtime.
- Restricted preview serving to the three IDs advertised by QuickerWrite.

## Supported contract

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Container health probe |
| `POST` | `/v1/jobs` | Submit a neutral v1 deck job |
| `GET` | `/v1/jobs/{id}` | Poll job state |
| `GET` | `/v1/jobs/{id}/artifacts/presentation` | Download the HTML deck |
| `GET` | `/v1/previews/{showcase,editorial,swiss}` | Read repository-local previews |
| `GET` | `/source` and `/source/archive` | AGPL corresponding-source offer |

The following standalone container is only a development/debugging option for
this AGPL repository. It is not a separate service in QuickerWrite's Compose
deployment:

```bash
docker build -f quickerwrite-runner/Dockerfile -t guizang-ppt-runner:local .
docker run --rm -p 127.0.0.1:5801:8080 \
  -e QW_RUNNER_SHARED_SECRET=change-me \
  guizang-ppt-runner:local
```

Local previews are served from repository assets at `/v1/previews/showcase`,
`/v1/previews/editorial`, and `/v1/previews/swiss`; no GitHub image URL is
required at runtime. Corresponding source is offered locally at `/source` and
downloaded from `/source/archive`; this deployment path does not point users
to a GitHub-hosted image or source archive.

Only `html` output is supported. QuickerWrite sends titles, slide roles,
points, and speaker notes through a runner-neutral DTO; repository-specific
templates and prompts never cross into the QuickerWrite process.
