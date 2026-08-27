#!/usr/bin/env node
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runnerDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(runnerDir, '..');
const outputRoot = path.resolve(process.env.QW_RUNNER_OUTPUT_DIR || path.join(root, '.runner-output'));
const host = process.env.QW_RUNNER_HOST || '0.0.0.0';
const port = Number(process.env.QW_RUNNER_PORT || 8080);
const sharedSecret = process.env.QW_RUNNER_SHARED_SECRET || '';
const jobs = new Map();
fs.mkdirSync(outputRoot, { recursive: true });

function json(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length });
  res.end(body);
}

function authenticate(req, body = Buffer.alloc(0)) {
  if (!sharedSecret) return true;
  const timestamp = String(req.headers['x-quickerwrite-timestamp'] || '');
  const supplied = String(req.headers['x-quickerwrite-signature'] || '').replace(/^sha256=/, '');
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected = crypto.createHmac('sha256', sharedSecret).update(`${timestamp}.`).update(body).digest('hex');
  const left = Buffer.from(supplied, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error('request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function slug(value, fallback) {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || fallback;
}

function renderSlides(slides, swiss) {
  return slides.map((slide, index) => {
    const title = escapeHtml(slide.title || `第 ${index + 1} 页`);
    const points = (Array.isArray(slide.points) ? slide.points : []).slice(0, 8);
    const id = slug(slide.id, `slide-${index + 1}`);
    const isCover = index === 0 || slide.role === 'cover';
    if (isCover) {
      return swiss
        ? `<section class="slide accent" data-animate="hero" data-slide-id="${id}"><div class="canvas-card"><canvas class="ascii-bg" aria-hidden="true"></canvas><div class="chrome-min"><div class="l">${title}</div><div class="r">${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}</div></div><div style="flex:1;display:grid;place-items:center"><h1 data-anim="title" style="font-family:var(--sans),var(--sans-zh);font-weight:200;font-size:min(10vw,17vh);line-height:.96;color:#fff">${title}</h1></div></div></section>`
        : `<section class="slide dark" data-animate="hero" data-slide-id="${id}"><div class="chrome"><span>FIELD NOTE</span><span>${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}</span></div><div class="content" style="justify-content:center"><h1 class="h-hero" data-anim="title">${title}</h1></div></section>`;
    }
    const items = points.map((point, pointIndex) => `<div data-anim="item" style="padding:2vh 0;border-top:1px solid var(--border-subtle)"><span class="t-meta">${String(pointIndex + 1).padStart(2, '0')}</span><p style="font-size:max(17px,1.35vw);line-height:1.55;margin-top:.8vh">${escapeHtml(point)}</p></div>`).join('');
    return swiss
      ? `<section class="slide light" data-animate="grid-reveal" data-slide-id="${id}"><div class="canvas-card"><div class="chrome-min"><div class="l">${title}</div><div class="r">${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}</div></div><h2 class="h-xl-zh" data-anim="title">${title}</h2><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 3vw;margin-top:3vh">${items}</div></div></section>`
      : `<section class="slide light" data-animate="stagger" data-slide-id="${id}"><div class="chrome"><span>${title}</span><span>${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}</span></div><div class="content"><h2 class="h-xl" data-anim="title">${title}</h2><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 3vw">${items}</div></div></section>`;
  }).join('\n');
}

function replaceDeck(template, slidesHtml) {
  const start = template.indexOf('<div id="deck">');
  const end = template.indexOf('\n</div>\n\n<div id="nav">', start);
  if (start < 0 || end < 0) throw new Error('deck boundary not found');
  return template.slice(0, start) + `<div id="deck">\n${slidesHtml}` + template.slice(end);
}

function replaceNotes(template, slides) {
  const startMarker = 'const SPEAKER_NOTES = [';
  const endMarker = '];\nwindow.__SPEAKER_NOTES__';
  const start = template.indexOf(startMarker);
  const end = template.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('speaker-notes boundary not found');
  const notes = slides.map((slide, index) => ({
    id: slug(slide.id, `slide-${index + 1}`), title: String(slide.title || ''), purpose: '传达本页核心信息',
    talk: (Array.isArray(slide.points) ? slide.points : []).slice(0, 5), transition: index + 1 < slides.length ? '进入下一页' : '结束演示',
  }));
  return template.slice(0, start) + `const SPEAKER_NOTES = ${JSON.stringify(notes, null, 2)}` + template.slice(end + 1);
}

function inlineMotion(template) {
  const source = fs.readFileSync(path.join(root, 'assets/motion.min.js'), 'utf8');
  const replacement = `await import(URL.createObjectURL(new Blob([${JSON.stringify(source)}],{type:'text/javascript'})))`;
  return template.replace("await import('./assets/motion.min.js')", replacement);
}

function sourceArchive() {
  const target = path.join(outputRoot, 'guizang-ppt-skill-source.tar.gz');
  const result = spawnSync('tar', ['--exclude=.git', '--exclude=.runner-output', '-czf', target, '-C', path.dirname(root), path.basename(root)], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || 'could not build source archive');
  return target;
}

async function generate(jobId, spec) {
  const job = jobs.get(jobId);
  try {
    job.status = 'running'; job.progress = 10; job.stage = 'building_html';
    const slides = Array.isArray(spec.slides) && spec.slides.length ? spec.slides : [{ id: 'cover', role: 'cover', title: spec.title, points: [] }];
    const swiss = /swiss|瑞士/i.test(String(spec.theme || ''));
    let html = fs.readFileSync(path.join(root, swiss ? 'assets/template-swiss.html' : 'assets/template.html'), 'utf8');
    html = replaceDeck(html, renderSlides(slides, swiss));
    html = replaceNotes(html, slides);
    html = inlineMotion(html).replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(spec.title || 'Presentation')}</title>`);
    const dir = path.join(outputRoot, jobId);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'presentation.html');
    fs.writeFileSync(file, html);
    job.status = 'succeeded'; job.progress = 100; job.stage = 'completed';
    job.artifacts = [{ type: 'html', file_name: `${String(spec.title || 'presentation').replace(/[\\/:*?"<>|]/g, '_')}.html`, mime_type: 'text/html; charset=utf-8', download_url: `/v1/jobs/${jobId}/artifacts/presentation` }];
  } catch (error) {
    job.status = 'failed'; job.error = String(error?.message || error); job.stage = 'failed';
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://runner.local');
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, engine: 'guizang' });
  if (req.method === 'GET' && url.pathname === '/source') return json(res, 200, { license: 'AGPL-3.0', download_url: '/source/archive' });
  if (req.method === 'GET' && url.pathname === '/source/archive') {
    try { const data = fs.readFileSync(sourceArchive()); res.writeHead(200, { 'content-type': 'application/gzip', 'content-disposition': 'attachment; filename="guizang-ppt-skill-source.tar.gz"', 'content-length': data.length }); return res.end(data); }
    catch (error) { return json(res, 500, { error: String(error.message) }); }
  }
  if (req.method === 'GET' && new Set([
    '/v1/previews/showcase',
    '/v1/previews/editorial',
    '/v1/previews/swiss',
  ]).has(url.pathname)) {
    const file = path.join(root, 'assets/ppt-skill-showcase.png');
    const data = fs.readFileSync(file); res.writeHead(200, { 'content-type': 'image/png', 'content-length': data.length }); return res.end(data);
  }
  let body = Buffer.alloc(0);
  if (req.method === 'POST') {
    try { body = await readBody(req); } catch (error) { return json(res, 413, { error: String(error.message) }); }
  }
  if (!authenticate(req, body)) return json(res, 401, { error: 'invalid signature' });
  if (req.method === 'POST' && url.pathname === '/v1/jobs') {
    let spec; try { spec = JSON.parse(body.toString('utf8')); } catch { return json(res, 400, { error: 'invalid JSON' }); }
    if (spec.protocol_version !== '1.0') return json(res, 400, { error: 'unsupported protocol_version' });
    const jobId = crypto.randomUUID();
    jobs.set(jobId, { job_id: jobId, status: 'queued', progress: 0, stage: 'queued', artifacts: [], engine_version: 'quickerwrite-runner-v1', source_offer_url: '/source' });
    setImmediate(() => generate(jobId, spec));
    return json(res, 202, jobs.get(jobId));
  }
  const jobMatch = url.pathname.match(/^\/v1\/jobs\/([0-9a-f-]+)$/);
  if (req.method === 'GET' && jobMatch) {
    const job = jobs.get(jobMatch[1]); return job ? json(res, 200, job) : json(res, 404, { error: 'job not found' });
  }
  const artifactMatch = url.pathname.match(/^\/v1\/jobs\/([0-9a-f-]+)\/artifacts\/presentation$/);
  if (req.method === 'GET' && artifactMatch) {
    const file = path.join(outputRoot, artifactMatch[1], 'presentation.html');
    if (!fs.existsSync(file)) return json(res, 404, { error: 'artifact not found' });
    const data = fs.readFileSync(file); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': data.length }); return res.end(data);
  }
  return json(res, 404, { error: 'not found' });
});

server.listen(port, host, () => console.log(`Guizang QuickerWrite runner listening on ${host}:${port}`));
