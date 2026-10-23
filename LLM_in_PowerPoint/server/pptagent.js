// PPT 智能排版 Agent（P0-2）：读当前页形状 → AI 生成操作计划 → 客户端预览后逐步执行。
// 与 Excel 三件套同一套模式：spawn cbc-claude.js（glm-5.3-flash）强制输出纯 JSON。
// 服务端只负责「生成计划」，执行在客户端用 Office.js 完成（每步可反馈、执行前快照可撤销）。
//
// 固定操作 schema（客户端逐字实现，模型只能从中选）：
//   setText     {shapeId, text}                 改文本内容
//   setFont     {shapeId, font}                  改字体（如 微软雅黑 / Source Han Sans）
//   setFontSize {shapeId, size}                  改字号（磅）
//   setBold     {shapeId, bold}                  加粗/取消加粗
//   setColor    {shapeId, color}                 文字颜色（#RRGGBB）
//   setFill     {shapeId, color}                 形状填充色（#RRGGBB）
//   addTextbox  {text, left, top, width, height, fontSize?, color?}  新增文本框（坐标单位：磅）
//   deleteShape {shapeId}                        删除形状

import { spawn } from 'node:child_process';
import { spawnEnv, CLAUDE_BIN } from './config.js';

const PROMPT_MODEL = 'glm-5.3-flash';
const TIMEOUT_MS = 120 * 1000;
const MAX_SHAPES = 60;        // 单页形状数上限（防超大页面打爆上下文）
const MAX_STEPS = 20;         // 单次计划步数上限
const OPS = new Set(['setText', 'setFont', 'setFontSize', 'setBold', 'setColor', 'setFill', 'addTextbox', 'deleteShape']);
const HEX = /^#[0-9A-Fa-f]{6}$/;

function callCliJson(sysPrompt) {
  return new Promise((resolve, reject) => {
    const bin = CLAUDE_BIN.endsWith('cbc-claude.js') ? process.execPath : CLAUDE_BIN;
    const base = ['-p', '--output-format', 'text', '--model', PROMPT_MODEL, '--effort', 'low', '--permission-mode', 'dontAsk', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', ''];
    const args = bin === process.execPath ? [CLAUDE_BIN, ...base, sysPrompt] : [...base, sysPrompt];
    const child = spawn(bin, args, { env: spawnEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('AI 生成计划超时，请重试')); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`调用 CodeBuddy 失败：${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const text = out.trim();
      if (code !== 0 && !text) {
        reject(new Error(`AI 生成计划失败：${(err || '').trim().slice(0, 200) || 'exit ' + code}`));
        return;
      }
      let s = text.replace(/```(?:json)?/g, '').trim();
      const first = s.indexOf('{');
      const last = s.lastIndexOf('}');
      if (first < 0 || last <= first) { reject(new Error('AI 返回的内容不是有效 JSON，请重试')); return; }
      try { resolve(JSON.parse(s.slice(first, last + 1))); }
      catch { reject(new Error('AI 返回的 JSON 解析失败，请重试')); }
    });
  });
}

// ---- 计划生成：形状列表 + 指令 → 步骤数组 ----
export async function planEdit({ instruction, shapes, slide } = {}) {
  const ins = typeof instruction === 'string' ? instruction.trim() : '';
  if (!ins) throw new Error('请先描述想要的修改效果');
  const list = Array.isArray(shapes) ? shapes : [];
  if (!list.length) throw new Error('没有读到当前页的形状，请先在幻灯片上点击任意位置再试');
  if (list.length > MAX_SHAPES) throw new Error(`当前页形状过多（${list.length} 个），单次最多 ${MAX_SHAPES} 个`);

  // 精简形状描述（只留模型需要的字段，控制上下文长度）
  const slim = list.slice(0, MAX_SHAPES).map((s) => ({
    shapeId: s.id,
    name: String(s.name || '').slice(0, 40),
    type: s.type,
    text: typeof s.text === 'string' ? s.text.slice(0, 120) : '',
    pos: [s.left, s.top, s.width, s.height].map((v) => (typeof v === 'number' ? Math.round(v) : null)),
  }));
  const slideInfo = slide && typeof slide === 'object'
    ? `幻灯片画布尺寸（磅）：宽 ${Math.round(slide.width || 960)} × 高 ${Math.round(slide.height || 540)}`
    : '幻灯片画布尺寸（磅）：宽 960 × 高 540（16:9 默认）';

  const sysPrompt = [
    '你是 PowerPoint 排版助手。根据当前页的形状列表和用户指令，生成一份可直接执行的操作计划。',
    '只输出 JSON，格式：{"steps":[{"op":"操作名", ...参数, "reason":"一句话说明这步做什么"}]}',
    '',
    '可选操作（只能用这 8 种，参数名必须完全一致）：',
    '1. {"op":"setText","shapeId":N,"text":"新文本"} —— 修改指定形状的文本内容',
    '2. {"op":"setFont","shapeId":N,"font":"微软雅黑"} —— 修改字体',
    '3. {"op":"setFontSize","shapeId":N,"size":28} —— 修改字号（磅，数字）',
    '4. {"op":"setBold","shapeId":N,"bold":true} —— 加粗（true）或取消加粗（false）',
    '5. {"op":"setColor","shapeId":N,"color":"#FFFFFF"} —— 文字颜色（#RRGGBB）',
    '6. {"op":"setFill","shapeId":N,"color":"#1F6FEB"} —— 形状填充色（#RRGGBB）',
    '7. {"op":"addTextbox","text":"文本","left":40,"top":40,"width":300,"height":50,"fontSize":18,"color":"#333333"} —— 新增文本框（left/top/width/high 单位磅，须落在画布内；fontSize/color 可省略）',
    '8. {"op":"deleteShape","shapeId":N} —— 删除形状',
    '',
    '要求：',
    '1. shapeId 必须来自下面形状列表的 shapeId 字段，不得编造；',
    '2. 步骤按执行顺序排列，最多 ' + MAX_STEPS + ' 步；无关形状不要动；',
    '3. 修改文本时保留原意，只按用户指令调整；删除是不可逆操作，仅当用户明确要求删除时才用；',
    '4. 配色使用常见商务色（如 #1F6FEB 蓝、#0F172A 深灰、#FFFFFF 白），避免刺眼高饱和色；',
    '5. reason 用中文、25 字以内。',
    '',
    slideInfo,
    '当前页形状列表（pos 顺序：left, top, width, height，单位磅）：',
    JSON.stringify(slim),
    '',
    '用户指令：' + ins.slice(0, 1000),
  ].join('\n');

  const raw = await callCliJson(sysPrompt);
  const steps = Array.isArray(raw?.steps) ? raw.steps : (Array.isArray(raw) ? raw : null);
  if (!steps) throw new Error('AI 未返回有效计划（缺少 steps），请换个说法重试');
  if (!steps.length) throw new Error('AI 认为当前指令不需要修改任何形状，请把要求说得更具体');

  // 服务端校验：op 白名单、参数完整性、shapeId 存在性
  const ids = new Set(slim.map((s) => s.shapeId));
  const valid = [];
  for (let i = 0; i < steps.length && valid.length < MAX_STEPS; i++) {
    const st = steps[i] || {};
    const op = String(st.op || '');
    if (!OPS.has(op)) continue;
    if (op === 'addTextbox') {
      if (typeof st.text !== 'string' || !st.text) continue;
      valid.push({
        op, text: st.text.slice(0, 500),
        left: num(st.left, 40), top: num(st.top, 40), width: num(st.width, 300), height: num(st.height, 50),
        ...(st.fontSize != null ? { fontSize: num(st.fontSize, 18) } : {}),
        ...(HEX.test(String(st.color || '')) ? { color: st.color } : {}),
        reason: str(st.reason),
      });
      continue;
    }
    if (!ids.has(st.shapeId)) continue; // 引用不存在的形状 → 丢弃该步
    const step = { op, shapeId: st.shapeId, reason: str(st.reason) };
    if (op === 'setText') { if (typeof st.text !== 'string') continue; step.text = st.text.slice(0, 2000); }
    if (op === 'setFont') { if (typeof st.font !== 'string' || !st.font) continue; step.font = st.font.slice(0, 60); }
    if (op === 'setFontSize') { const v = num(st.size, 0); if (v < 6 || v > 200) continue; step.size = v; }
    if (op === 'setBold') step.bold = st.bold !== false;
    if (op === 'setColor' || op === 'setFill') { if (!HEX.test(String(st.color || ''))) continue; step.color = st.color; }
    valid.push(step);
  }
  if (!valid.length) throw new Error('计划校验后没有可执行的步骤（可能 shapeId 无效），请重试');
  return { steps: valid };
}

function num(v, dflt) {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : Number.parseFloat(v);
  return Number.isFinite(n) ? n : dflt;
}
function str(v) { return typeof v === 'string' ? v.slice(0, 60) : ''; }
