# QuickerWrite isolated runner

This AGPL-3.0 runner exposes the repository's presentation runtime through
QuickerWrite's neutral `v1` JSON job protocol. It is an independent program
and image: QuickerWrite does not import or package this repository.

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
