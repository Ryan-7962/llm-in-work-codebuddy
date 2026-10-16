// Excel 智能工具：公式生成 / 批量 AI 填充 / 数据清洗。
// 三个函数都 spawn cbc-claude.js（CodeBuddy wrapper，glm-5.3-flash effort low）
// 强制输出纯 JSON，客户端拿到结构化结果后用 Office.js 写回表格。
// 参考实现：Ai-in-Office/kimi-in-excel（选区感知 + 公式一键写入 + 批量填充 + 清洗预览）。

import { spawn } from 'node:child_process';
import { spawnEnv, CLAUDE_BIN } from './config.js';

const PROMPT_MODEL = 'glm-5.3-flash';
const TIMEOUT_MS = 120 * 1000;
const MAX_ROWS = 200;          // 批量填充/清洗单次行数上限（防超大选区打爆上下文）
const MAX_CTX_CHARS = 6000;    // 发给模型的数据上下文上限

// ---- 公共：调 CLI 拿 JSON ----
function callCliJson(sysPrompt) {
  return new Promise((resolve, reject) => {
    const bin = CLAUDE_BIN.endsWith('cbc-claude.js') ? process.execPath : CLAUDE_BIN;
    const base = ['-p', '--output-format', 'text', '--model', PROMPT_MODEL, '--effort', 'low', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', ''];
    const args = bin === process.execPath ? [CLAUDE_BIN, ...base, sysPrompt] : [...base, sysPrompt];
    const child = spawn(bin, args, { env: spawnEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('AI 处理超时，请缩小选区或重试')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`调用 CodeBuddy 失败：${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (code !== 0 && !text) {
        reject(new Error(`AI 处理失败：${(err || '').trim().slice(0, 200) || 'exit ' + code}`));
        return;
      }
      // 容错提取 JSON：剥掉 markdown 围栏 / 前后杂文本，找第一个 { 或 [ 到最后一个 } 或 ]
      let s = text.replace(/```(?:json)?/g, '').trim();
      const first = Math.min(...[s.indexOf('{'), s.indexOf('[')].filter((i) => i >= 0));
      const last = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
      if (!Number.isFinite(first) || last < 0 || last <= first) {
        reject(new Error('AI 返回的内容不是有效 JSON，请重试'));
        return;
      }
      try { resolve(JSON.parse(s.slice(first, last + 1))); }
      catch { reject(new Error('AI 返回的 JSON 解析失败，请重试')); }
    });
  });
}

// ---- 选区数据上下文（客户端把选区读成 {headers, rows} 传上来）----
function ctxText({ headers, rows, maxRows = 15 }) {
  const hs = Array.isArray(headers) ? headers.filter((h) => typeof h === 'string') : [];
  const rs = (Array.isArray(rows) ? rows : []).slice(0, maxRows)
    .map((r) => (Array.isArray(r) ? r : []).map((c) => (c == null ? '' : String(c))).join(' | '));
  return ['表头：' + (hs.join(' | ') || '（无）'), '前 ' + rs.length + ' 行示例：', ...rs.map((r) => r)].join('\n').slice(0, MAX_CTX_CHARS);
}

// ---- ① 公式生成：自然语言 → 公式 + 解释（客户端一键写入选中单元格）----
export function formulaGen({ desc, context } = {}) {
  const d = typeof desc === 'string' ? desc.trim() : '';
  if (!d) throw new Error('请先描述你想要的计算效果');
  const sysPrompt = [
    '你是 Excel 公式专家。根据用户描述和表格上下文，生成一个可直接使用的 Excel 公式。',
    '只输出 JSON，格式：{"formula":"=...","explanation":"一句话说明这个公式怎么用、引用了哪些列"}',
    '要求：',
    '1. formula 必须以 = 开头，用中文列名（如 [销售额]）或 A1 引用皆可，优先按表头写结构化引用；',
    '2. 公式须兼容 Microsoft 365 / Excel 2016（需要新函数时给出 2016 兼容写法放 fallback 字段：{"formula":"...","fallback":"...","explanation":"..."}）；',
    '3. explanation 用中文、60 字以内。',
    '',
    '用户描述：' + d,
    '',
    ctxText(context || {}),
  ].join('\n');
  return callCliJson(sysPrompt);
}

// ---- ② 批量 AI 填充：模板 + 行数据 → 逐行结果 ----
// 模板支持 {{A}}/{{B}}…（按表头列名取值）和 {{行号}}。
export function batchFill({ template, headers, rows } = {}) {
  const t = typeof template === 'string' ? template.trim() : '';
  if (!t) throw new Error('请先填写填充模板，例如：把 {{产品名}} 翻译成英文，并写一句卖点');
  const hs = Array.isArray(headers) ? headers.map((h) => String(h)) : [];
  const rs = Array.isArray(rows) ? rows : [];
  if (!rs.length) throw new Error('没有读到行数据，请先在表格里选中数据区域');
  if (rs.length > MAX_ROWS) throw new Error(`选区行数过多（${rs.length} 行），单次最多 ${MAX_ROWS} 行，请分批选择`);
  const sysPrompt = [
    '你是表格批量填充助手。对下面每一行数据，按模板生成一个填充结果。',
    '只输出 JSON 数组，格式：{"results":["第1行结果","第2行结果",...]}，数组长度必须等于行数，顺序一致。',
    '要求：结果为纯文本（不含公式），空行对应空字符串。',
    '',
    '表头（列名，模板里用 {{列名}} 引用）：' + hs.join(' | '),
    '填充模板：' + t,
    '',
    '数据行（| 分隔，与表头同序，共 ' + rs.length + ' 行）：',
    ...rs.map((r, i) => `第${i + 1}行：` + (Array.isArray(r) ? r : []).map((c) => (c == null ? '' : String(c))).join(' | ')),
  ].join('\n').slice(0, MAX_CTX_CHARS * 2);
  return callCliJson(sysPrompt);
}

// ---- ③ 数据清洗：选区数据 → 清洗建议（diff 由客户端展示）----
export function cleanSuggest({ headers, rows, instruction } = {}) {
  const rs = Array.isArray(rows) ? rows : [];
  if (!rs.length) throw new Error('没有读到数据，请先在表格里选中要清洗的区域');
  if (rs.length > MAX_ROWS) throw new Error(`选区行数过多（${rs.length} 行），单次最多 ${MAX_ROWS} 行，请分批选择`);
  const extra = typeof instruction === 'string' && instruction.trim() ? `\n用户补充要求：${instruction.trim()}` : '';
  const sysPrompt = [
    '你是数据清洗专家。对下面的表格数据做标准化清洗，只输出 JSON：',
    '{"rows":[["清洗后的第1行各列"],["第2行"],...],"notes":"一句话说明做了哪些清洗"}',
    '默认清洗规则（用户另有要求时以用户为准）：',
    '1. 去除首尾空格、全角空格、单元格内换行；',
    '2. 日期统一为 YYYY-MM-DD；数字去掉千分位逗号和货币符号，保留数值本身；',
    '3. 统一大小写规范（如产品 SKU 保持原样，英文姓名首字母大写）；',
    '4. 明显的错别字/全半角标点混用予以纠正；',
    '5. 空值保持空字符串，不要编造数据；行数与列数保持不变。',
    '',
    '表头：' + (Array.isArray(headers) ? headers.map((h) => String(h)).join(' | ') : '（无）'),
    '数据（共 ' + rs.length + ' 行）：',
    ...rs.map((r, i) => `第${i + 1}行：` + (Array.isArray(r) ? r : []).map((c) => (c == null ? '' : String(c))).join(' | ')),
    extra,
  ].join('\n').slice(0, MAX_CTX_CHARS * 2);
  return callCliJson(sysPrompt);
}
