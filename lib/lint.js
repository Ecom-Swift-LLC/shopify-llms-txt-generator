'use strict';

const LINK_ITEM = /^[-*+]\s+\[([^\]]*)\]\(([^)\s]*)(?:\s+"[^"]*")?\)(?::\s*(.*))?$/;
const MAX_BYTES = 100000;

/**
 * Check a llms.txt string against the llmstxt.org layout.
 * Returns { findings: [{ rule, severity, line, message }], errors, warnings }.
 */
function lintLlmsTxt(text) {
  const findings = [];
  const add = (rule, severity, line, message) => findings.push({ rule, severity, line, message });

  if (!text || !text.trim()) {
    add('empty-file', 'error', 1, 'The file is empty.');
    return summarize(findings);
  }

  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  if (!/^#\s+\S/.test(lines[firstIdx])) {
    add('title-first', 'error', firstIdx + 1, 'The first line must be an H1 with the site name ("# Name").');
  }

  let h1Count = 0;
  let sawSummary = false;
  let sawSection = false;
  let section = null; // { title, line, items }
  const sections = [];
  const seenUrls = new Map();
  let inFence = false;

  lines.forEach((raw, i) => {
    const n = i + 1;
    const line = raw.trim();
    if (line.startsWith('```')) {
      inFence = !inFence;
      return;
    }
    if (inFence || line === '') return;

    if (/^#\s/.test(line)) {
      h1Count++;
      if (h1Count > 1) add('single-h1', 'error', n, 'There must be exactly one H1.');
      return;
    }
    if (/^##\s/.test(line)) {
      sawSection = true;
      section = { title: line.replace(/^##\s+/, ''), line: n, items: 0 };
      sections.push(section);
      return;
    }
    if (/^>\s?/.test(line)) {
      if (!sawSection) sawSummary = true;
      return;
    }
    if (/^[-*+]\s/.test(line)) {
      if (!section) {
        add('list-outside-section', 'warning', n, 'List item appears before any H2 section.');
        return;
      }
      section.items++;
      const m = line.match(LINK_ITEM);
      if (!m) {
        add('link-format', 'warning', n, 'List item is not in the "- [label](url): notes" form.');
        return;
      }
      const [, label, url] = m;
      if (!label.trim()) add('empty-label', 'warning', n, 'Link has an empty label.');
      if (!/^https?:\/\//i.test(url)) {
        add('absolute-url', 'error', n, `URL "${url}" is not an absolute http(s) URL; a model reading the file alone cannot resolve it.`);
      } else if (/^http:\/\//i.test(url)) {
        add('https', 'warning', n, `URL "${url}" uses http://; use https://.`);
      }
      if (seenUrls.has(url)) add('duplicate-url', 'warning', n, `URL already listed on line ${seenUrls.get(url)}.`);
      else seenUrls.set(url, n);
    }
  });

  if (!sawSummary) add('summary', 'warning', firstIdx + 2, 'No "> summary" blockquote after the title. It is the one-line description a model reads first.');
  if (sections.length === 0) add('sections', 'warning', 1, 'No H2 sections; the file lists no links.');
  for (const s of sections) {
    if (s.items === 0) add('empty-section', 'warning', s.line, `Section "${s.title}" has no list items.`);
  }
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_BYTES) {
    add('size', 'warning', 1, `File is ${bytes} bytes. Keep llms.txt short and put long text in llms-full.txt.`);
  }
  return summarize(findings);
}

function summarize(findings) {
  return {
    findings,
    errors: findings.filter((f) => f.severity === 'error').length,
    warnings: findings.filter((f) => f.severity === 'warning').length,
  };
}

module.exports = { lintLlmsTxt };
