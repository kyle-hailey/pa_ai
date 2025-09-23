// Conversation script: array of message pairs or singles
// Each step will render one or more messages (e.g., user then assistant)
const conversationSteps = [
  {
    messages: [
      { role: 'assistant', text: "Hello! I'm your Performance Advisor assistant. I can help you analyze database performance, identify bottlenecks, and recommend optimizations to keep your YugabyteDB clusters running smoothly. Let's dig in and make your system faster and more efficient!\n\nHere’s what I can do:\n- Identify Issues – Detect anomalies, locking problems, or slowdowns.\n- Analyze Queries – Find your most expensive queries and suggest optimizations.\n- Recommend Fixes – Provide steps to resolve performance bottlenecks.\n- Explain Trends – Help you understand why performance changed over time." },
    ]
  },
  {
    messages: [
      { role: 'user', text: 'Can you give me a quick overview of cluster load?' },
      { role: 'assistant', text: 'Here is the current view of cluster activity. Highlights indicate issue windows. See summary below.' },
    ]
  },
  {
    messages: [
      { role: 'user', text: 'Any anomalies in the last hour?' },
      { role: 'assistant', text: 'Yes — there were two anomalies during this period.\n\n1) Lock Contention (Primary)\n   - Affected query:\n     insert into test_table (k, v, t) select max(k) + $1 as k, max(v) + $2 as v, now() as t from test_table\n   - This statement is responsible for over 50% of lock wait time.\n   - Resolution: commit immediately after the insert to release the lock sooner.\n\n2) Catalog Read waits (Secondary)\n   - Over 50% of processing time for a handful of one‑off DDL statements.\n   - Impact is low since these are not frequent. If these DDLs are often run, pre‑cache table metadata with ysql_catalog_preload_additional_table_list.' },
    ]
  },
  {
    messages: [
      { role: 'user', text: 'Which queries contributed most to those spikes?' },
      { role: 'assistant', text: 'Top queries are listed below by total execution time. Look at the Queries tab below the Cluster Load chart to the left. The range predicate on pgbench_accounts dominates during those intervals. The top query of import is: insert into test_table (k, v, t) select max(k) + $1 as k, max(v) + $2 as v, now() as t from test_table — it is running into locking issues that will be solved by committing immediately after the insert.\n\nAnother notable query is: SELECT sum(A.id) FROM A JOIN B ON A.category = B.filter_category — it represents over 50% of the CPU time on the cluster, though overall OS CPU utilization is not a concern, remaining under 30%.' },
    ]
  },
  {
    messages: [
      { role: 'user', text: 'Are there any queries that need tuning' },
      { role: 'assistant', text: 'Optimization details below.' },
    ]
  },
];

// DOM helpers
const chatEl = document.getElementById('chat');
const btnNext = document.getElementById('btn-next');
const btnPrev = document.getElementById('btn-prev');
const btnReset = document.getElementById('btn-reset');
const chartCanvas = document.getElementById('chart-load');
const ganttEl = document.getElementById('gantt');
const drilldownEl = document.getElementById('drilldown');
const tblQueries = document.getElementById('tbl-queries');
const btnReport = document.getElementById('btn-report');
const composer = document.getElementById('composer');
const input = document.getElementById('message');
const paImageWrap = document.getElementById('pa-image-wrap');
const paImage = document.getElementById('pa-image');
const paWidgets = document.getElementById('pa-widgets');
const chatPanel = document.getElementById('chat-panel');
const paPanel = document.querySelector('.pa-panel');
const chatHeader = document.querySelector('.chat-header');

let currentStepIndex = -1;
let history = []; // keep track of rendered nodes for undo

function createRow(role, text) {
  const row = document.createElement('div');
  row.className = `row ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (role === 'assistant') {
    const img = document.createElement('img');
    img.src = 'assets/ai_icon.png';
    img.alt = 'AI';
    img.className = 'avatar-img';
    avatar.appendChild(img);
  } else {
    avatar.textContent = 'U';
  }

  const column = document.createElement('div');
  column.style.maxWidth = 'min(75ch, 100%)';

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerText = text;

  const meta = document.createElement('div');
  meta.className = 'meta';
  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.textContent = time;

  column.appendChild(bubble);
  column.appendChild(meta);
  row.appendChild(role === 'assistant' ? avatar : document.createElement('div'));
  row.appendChild(column);
  if (role === 'user') row.appendChild(avatar);
  return row;
}

// Type out text into a new bubble for the given role, character by character
async function typeOut(role, text, charDelayMs = 60) {
  const row = document.createElement('div');
  row.className = `row ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (role === 'assistant') {
    const img = document.createElement('img');
    img.src = 'assets/ai_icon.png';
    img.alt = 'AI';
    img.className = 'avatar-img';
    avatar.appendChild(img);
  } else {
    avatar.textContent = 'U';
  }

  const column = document.createElement('div');
  column.style.maxWidth = 'min(75ch, 100%)';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  const meta = document.createElement('div');
  meta.className = 'meta';

  if (role === 'assistant') {
    row.appendChild(avatar);
    row.appendChild(column);
  } else {
    row.appendChild(column);
    row.appendChild(avatar);
  }
  column.appendChild(bubble);
  column.appendChild(meta);
  chatEl.appendChild(row);
  scrollToBottom();

  // Pre-measure final bubble size so the container doesn't grow while typing
  bubble.style.visibility = 'hidden';
  bubble.textContent = text;
  // Force layout, then capture size (clamped by CSS max-width)
  const finalWidth = bubble.offsetWidth;
  const finalHeight = bubble.offsetHeight;
  // Prepare for typing
  bubble.textContent = '';
  bubble.style.visibility = 'visible';
  bubble.style.width = finalWidth + 'px';
  bubble.style.minHeight = finalHeight + 'px';

  // typing animation
  for (let i = 1; i <= text.length; i++) {
    bubble.innerText = text.slice(0, i);
    const ch = text[i - 1];
    const delay = (ch === ' ' || ch === '\n' || ch === '\t') ? charDelayMs * 2 : charDelayMs;
    await new Promise(r => setTimeout(r, delay));
    scrollToBottom();
  }

  const now = new Date();
  const time = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  meta.textContent = time;
  return row;
}

// Simulate typing into the bottom composer input, then render the user bubble instantly
async function simulateComposerTyping(text, charDelayMs = 50) {
  if (!input) return null;
  input.value = '';
  for (let i = 1; i <= text.length; i++) {
    input.value = text.slice(0, i);
    const ch = text[i - 1];
    const delay = (ch === ' ' || ch === '\n' || ch === '\t') ? charDelayMs * 2 : charDelayMs; // 50ms letters, 100ms spaces
    await new Promise(r => setTimeout(r, delay));
  }
  const node = createRow('user', text);
  chatEl.appendChild(node);
  scrollToBottom();
  input.value = '';
  return node;
}

function scrollToBottom() {
  chatEl.scrollTo({ top: chatEl.scrollHeight, behavior: 'smooth' });
}

function renderTyping(role) {
  const row = document.createElement('div');
  row.className = `row ${role}`;
  const avatar = document.createElement('div');
  avatar.className = 'avatar';
  if (role === 'assistant') {
    const img = document.createElement('img');
    img.src = 'assets/ai_icon.png';
    img.alt = 'AI';
    img.className = 'avatar-img';
    avatar.appendChild(img);
  } else {
    avatar.textContent = 'U';
  }
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  // Show explicit thinking prompt text
  bubble.textContent = 'Thinking ... ';
  const span = document.createElement('span');
  span.className = 'typing';
  bubble.appendChild(span);
  if (role === 'assistant') {
    row.appendChild(avatar);
    row.appendChild(bubble);
  } else {
    row.appendChild(bubble);
    row.appendChild(avatar);
  }
  chatEl.appendChild(row);
  scrollToBottom();
  return row;
}

async function playStep(step) {
  // Render each message in the step with small typing delay for assistant
  const nodesForThisStep = [];
  for (const msg of step.messages) {
    if (msg.role === 'assistant') {
      // Formatted introduction with bold bullets (no thinking delay)
      if (step === conversationSteps[0]) {
        const wrap = document.createElement('div');
        wrap.className = 'row assistant';
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        const img = document.createElement('img');
        img.src = 'assets/ai_icon.png';
        img.alt = 'AI';
        img.className = 'avatar-img';
        avatar.appendChild(img);
        const col = document.createElement('div');
        col.style.maxWidth = 'min(75ch, 100%)';
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = `
          <div>
            <div>Hello! I'm your Performance Advisor assistant. I can help you analyze database performance, identify bottlenecks, and recommend optimizations to keep your YugabyteDB clusters running smoothly. Let's dig in and make your system faster and more efficient!</div>
            <div style="margin-top:8px; font-weight:600;">Here’s what I can do:</div>
            <ul style="margin:6px 0 0 18px; padding:0;">
              <li><strong>Identify Issues</strong> — Detect anomalies, locking problems, or slowdowns.</li>
              <li><strong>Analyze Queries</strong> — Find your most expensive queries and suggest optimizations.</li>
              <li><strong>Recommend Fixes</strong> — Provide steps to resolve performance bottlenecks.</li>
              <li><strong>Explain Trends</strong> — Help you understand why performance changed over time.</li>
            </ul>
          </div>`;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        col.appendChild(bubble);
        col.appendChild(meta);
        wrap.appendChild(avatar);
        wrap.appendChild(col);
        chatEl.appendChild(wrap);
        nodesForThisStep.push(wrap);
        scrollToBottom();
      // Render findings-style block for the first overview answer (with delay)
      } else if (step === conversationSteps[1]) {
        const typing = renderTyping('assistant');
        await new Promise(r => setTimeout(r, Math.min(4000, 1200 + (msg.text.length * 28))));
        chatEl.removeChild(typing);
        // Switch image to highlighted version when answering overview
        if (paImage) paImage.src = 'assets/pa_example_highlighted.png';
        const wrap = document.createElement('div');
        wrap.className = 'row assistant';
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        const img = document.createElement('img');
        img.src = 'assets/ai_icon.png';
        img.alt = 'AI';
        img.className = 'avatar-img';
        avatar.appendChild(img);
        const col = document.createElement('div');
        col.style.maxWidth = 'min(75ch, 100%)';
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = `
          <div class="report">
            <div class="section-title">Issues Found</div>
            <div class="summary-row">
              <span class="pill imp">1 Important</span>
              <span class="pill min">3 Minor</span>
            </div>
            <div class="section-title">Top Findings</div>
            <div class="block-imp">
              <div class="mini-title">Important — Locking Issues</div>
              <div>The following query spends over 50% of its time waiting for locks and is responsible for the majority of total lock wait time on the cluster:</div>
              <div>The following query spends over 50% of its time waiting for locks and is responsible for the majority of total lock wait time on the cluster:</div>
              <pre><code>INSERT INTO test_table (k, v, t)
SELECT max(k) + $1 AS k, max(v) + $2 AS v, now() AS t
FROM test_table;</code></pre>
            </div>
            <div class="block-min">
              <div class="mini-title">Minor - CPU optimization</div>
              <div>The query is responsible for half of all CPU time, yet total OS CPU utilization remains low, under 30%.</div>
              <div><code>SELECT sum(A.id) FROM A JOIN B ON A.category = B.filter_category</code></div>
            </div>
            <div class="block-min"><div class="mini-title">Minor - Catalog Reads</div>Several statements hit the catalog read anomaly but they are DDL, so of little concern.</div>
            <div class="block-min"><div class="mini-title">Minor - Hot Tablet</div>There is one hot tablet but total activity on this table represents less 5% of all cluster activity.</div>
            <div class="section-title">Next Steps</div>
            <div class="block-imp">
              <div><strong>Issue Detected:</strong> Lock Contention</div>
              <div>Locking is the primary performance bottleneck in your cluster, representing the majority of time spent running queries. The contention area is highlighted in the Cluster Load chart to the left on the Perf Advisor dashboard.</div>
              <div><strong>Solution:</strong> Commit immediately after the insert, as the current insert is part of a transaction that delays the commit. Committing immediately after the insert reduces lock wait time. Expected improvement: reduce query latency by about 50%.</div>
              <div class="mini-title">Insert statement</div>
              <pre><code>INSERT INTO test_table (k, v, t)
SELECT max(k) + $1 AS k, max(v) + $2 AS v, now() AS t
FROM test_table;</code></pre>
            </div>
          </div>`;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        col.appendChild(bubble);
        col.appendChild(meta);
        wrap.appendChild(avatar);
        wrap.appendChild(col);
        chatEl.appendChild(wrap);
        nodesForThisStep.push(wrap);
        scrollToBottom();
      } else if (step === conversationSteps[2]) {
        const typing = renderTyping('assistant');
        await new Promise(r => setTimeout(r, Math.min(4000, 1200 + (msg.text.length * 28))));
        chatEl.removeChild(typing);
        // Switch image to anomalies view when answering anomalies question
        if (paImage) paImage.src = 'assets/pa_example_anomalies.png';
        const wrap = document.createElement('div');
        wrap.className = 'row assistant';
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        const img = document.createElement('img');
        img.src = 'assets/ai_icon.png';
        img.alt = 'AI';
        img.className = 'avatar-img';
        avatar.appendChild(img);
        const col = document.createElement('div');
        col.style.maxWidth = 'min(75ch, 100%)';
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = `
          <div class="report">
            <div class="section-title">Anomalies Summary</div>
            <div>Yes — there were <strong>two anomalies</strong> during this period.</div>
            <div class="block-imp">
              <div class="mini-title">Lock Contention (Primary)</div>
              <div class="pa-subtle">Affected query</div>
              <pre><code>insert into test_table (k, v, t)
select max(k) + $1 as k, max(v) + $2 as v, now() as t
from test_table</code></pre>
              <ul style="margin: 6px 0 0 18px;">
                <li>Responsible for <strong>over 50% of lock wait time</strong>.</li>
                <li><strong>Resolution:</strong> commit immediately after the insert to release the lock sooner.</li>
              </ul>
            </div>
            <div class="block-min">
              <div class="mini-title">Catalog Read waits (Secondary)</div>
              <ul style="margin: 6px 0 0 18px;">
                <li><strong>Over 50% of processing time</strong> for a handful of one‑off DDL statements.</li>
                <li>Impact is low since these are infrequent. If they are run often, pre‑cache table metadata with <code>ysql_catalog_preload_additional_table_list</code>.</li>
              </ul>
              <div>Catalog read waits can be avoided by pre-caching the table metadata with the gflag:</div>
              <pre><code>ysql_catalog_preload_additional_table_list="test_table, test,pgbench_history"</code></pre>
            </div>
          </div>`;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        col.appendChild(bubble);
        col.appendChild(meta);
        wrap.appendChild(avatar);
        wrap.appendChild(col);
        chatEl.appendChild(wrap);
        nodesForThisStep.push(wrap);
        scrollToBottom();
      } else if (step === conversationSteps[3]) {
        const typing = renderTyping('assistant');
        await new Promise(r => setTimeout(r, Math.min(4000, 1200 + (msg.text.length * 28))));
        chatEl.removeChild(typing);
        // Switch image to queries view when discussing top queries
        if (paImage) paImage.src = 'assets/pa_example_queries.png';
        const wrap = document.createElement('div');
        wrap.className = 'row assistant';
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        const img = document.createElement('img');
        img.src = 'assets/yugabyte_icon.jpg';
        img.alt = 'AI';
        img.className = 'avatar-img';
        avatar.appendChild(img);
        const col = document.createElement('div');
        col.style.maxWidth = 'min(75ch, 100%)';
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = `
          <div class="report">
            <div class="section-title">Top Queries</div>
            <div>Top queries are listed below by total execution time. Look at the <strong>Queries</strong> tab below the Cluster Load chart to the left.</div>

            <div class="block-imp">
              <div class="mini-title">Locking — INSERT into test_table</div>
              <pre><code>insert into test_table (k, v, t)
select max(k) + $1 as k, max(v) + $2 as v, now() as t
from test_table</code></pre>
              <ul style="margin: 6px 0 0 18px;">
                <li>The majority of active cluster load was spent waiting for locks. This statement is responsible the majority of lock wait time and spends over 50% of its execution time waiting for locks.</li>
                <li><strong>Resolution:</strong> commit immediately after the insert.</li>
              </ul>
            </div>

            <div class="block-min">
              <div class="mini-title">CPU — SELECT sum(A.id) ...</div>
              <pre><code>SELECT sum(A.id) FROM A JOIN B ON A.category = B.filter_category</code></pre>
              <ul style="margin: 6px 0 0 18px;">
                <li>Represents <strong>over 50% of CPU time</strong> for the period.</li>
                <li>Overall OS CPU utilization remains <strong>under 30%</strong>, so system-wide CPU is not a concern.</li>
              </ul>
            </div>
            <div class="block-min">
              <div class="mini-title">Catalog Read</div>
              <div>The following DDL queries spend more than 50% of time on catalog read</div>
              <pre><code>CREATE TABLE test_table(k i...
DROP TABLE IF EXISTS test.i...
DROP TABLE IF EXISTS test.t...
TRUNCATE pgbench_history;</code></pre>
              <div>Catalog read waits can be avoided by pre-caching the table metadata with the gflag:</div>
              <pre><code>ysql_catalog_preload_additional_table_list="test_table, test,pgbench_histoy"</code></pre>
            </div>
          </div>`;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        col.appendChild(bubble);
        col.appendChild(meta);
        wrap.appendChild(avatar);
        wrap.appendChild(col);
        chatEl.appendChild(wrap);
        nodesForThisStep.push(wrap);
        scrollToBottom();
      } else if (step === conversationSteps[4]) {
        const typing = renderTyping('assistant');
        await new Promise(r => setTimeout(r, Math.min(4000, 1200 + (msg.text.length * 28))));
        chatEl.removeChild(typing);
        const wrap = document.createElement('div');
        wrap.className = 'row assistant';
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        const img = document.createElement('img');
        img.src = 'assets/yugabyte_icon.jpg';
        img.alt = 'AI';
        img.className = 'avatar-img';
        avatar.appendChild(img);
        const col = document.createElement('div');
        col.style.maxWidth = 'min(75ch, 100%)';
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = `
          <div class="report">
            <div class="section-title">SQL Optimization Recommendation</div>
            <div>The one primary SQL optimization is tuning the query:</div>
            <pre><code>SELECT *
FROM pgbench_accounts
WHERE aid BETWEEN $1 AND $2 + $3
ORDER BY abalance DESC
LIMIT $4</code></pre>

            <div class="section-title">Explanation</div>
            <div>The query performs a sequential scan on the <code>pgbench_accounts</code> table because there is no suitable index to satisfy the range condition <code>aid BETWEEN $1 AND $2 + $3</code>. In YugabyteDB, primary keys are HASH partitioned by default. A HASH index is efficient for point lookups (e.g., <code>WHERE aid = ?</code>) but does not store data in a sorted order. Consequently, to find all rows where <code>aid BETWEEN $1 AND $2 + $3</code>, the database must scan all rows and apply the filter, which is inefficient.</div>

            <div class="section-title">Recommended Index Strategy</div>
            <div>Since the primary key is <code>aid</code>, you have two options to resolve the sequential scan:</div>
            <div class="block-min">
              <div class="mini-title">1) Recommended — Create a secondary RANGE index</div>
              <div>This is often the safest option as it does not change the table's primary key partitioning, preserving distribution for writes and point-reads on the primary key. This new index will be used to optimize range queries on <code>aid</code>.</div>
              <pre><code>CREATE INDEX pgbench_accounts_aid_idx ON pgbench_accounts (aid ASC);</code></pre>
            </div>
            <div class="block-min">
              <div class="mini-title">2) Alternatively recreate the table with a RANGE partitioned primary key</div>
              <div>If range queries on <code>aid</code> are the most frequent and critical access pattern, change the primary key to be RANGE partitioned. This makes range scans fastest but may introduce write hotspots if inserts use monotonically increasing <code>aid</code> values.</div>
              <pre><code>-- This requires dropping and recreating the table.
CREATE TABLE pgbench_accounts (
  aid BIGINT,
  bid INT,
  abalance INT,
  filler VARCHAR,
  PRIMARY KEY (aid ASC)
);</code></pre>
            </div>
          </div>`;
        const meta = document.createElement('div');
        meta.className = 'meta';
        meta.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        col.appendChild(bubble);
        col.appendChild(meta);
        wrap.appendChild(avatar);
        wrap.appendChild(col);
        chatEl.appendChild(wrap);
        nodesForThisStep.push(wrap);
        scrollToBottom();
      } else {
        const node = createRow('assistant', msg.text);
        chatEl.appendChild(node);
        nodesForThisStep.push(node);
        scrollToBottom();
      }
    } else if (msg.role === 'user') {
      // Show typing inside the bottom input, then render the message (use default slow rate)
      const node = await simulateComposerTyping(msg.text);
      nodesForThisStep.push(node);
    } else {
      const node = createRow(msg.role, msg.text);
      chatEl.appendChild(node);
      nodesForThisStep.push(node);
      scrollToBottom();
    }
  }
  history.push(nodesForThisStep);
}

function next() {
  if (currentStepIndex >= conversationSteps.length - 1) return;
  currentStepIndex++;
  playStep(conversationSteps[currentStepIndex]);
  updateButtons();
}

function prev() {
  if (history.length === 0) return;
  const nodes = history.pop();
  for (const n of nodes) {
    if (n.parentNode) n.parentNode.removeChild(n);
  }
  currentStepIndex = Math.max(-1, currentStepIndex - 1);
  updateButtons();
}

function reset() {
  chatEl.innerHTML = '';
  history = [];
  currentStepIndex = -1;
  updateButtons();
}

function updateButtons() {
  btnPrev.disabled = history.length === 0;
  btnNext.disabled = currentStepIndex >= conversationSteps.length - 1;
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const ae = document.activeElement;
  const isTyping = ae && ((ae.tagName === 'INPUT') || (ae.tagName === 'TEXTAREA') || ae.isContentEditable);
  if (isTyping) return; // don't hijack keys while user is typing in the composer
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
  else if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); prev(); }
  else if (e.key.toLowerCase() === 'r') { e.preventDefault(); reset(); }
});

btnNext.addEventListener('click', next);
btnPrev.addEventListener('click', prev);
btnReset.addEventListener('click', reset);

// Start with the first step rendered to show how it looks
next();

// ===== Performance Advisor Demo =====
// lightweight chart without dependencies
function drawLoadChart(ctx) {
  if (!ctx) return;
  const w = ctx.canvas.width = ctx.canvas.clientWidth;
  const h = ctx.canvas.height = 120;
  const c = ctx;
  c.clearRect(0,0,w,h);
  const margin = 20;
  const N = 60;
  const values = Array.from({length:N}, (_,i)=> 45 + 30*Math.sin(i/6) + 15*Math.random());
  const anomalies = [
    { start: 12, end: 18 },
    { start: 36, end: 41 },
  ];
  // background
  c.fillStyle = '#f3f4f6';
  c.fillRect(0,0,w,h);
  // grid
  c.strokeStyle = 'rgba(0,0,0,.08)';
  c.beginPath();
  for (let y=margin; y<h-margin; y+=20) { c.moveTo(0,y); c.lineTo(w,y); }
  c.stroke();
  // anomalies areas
  c.fillStyle = 'rgba(239,68,68,.15)';
  anomalies.forEach(a=>{
    const x1 = (a.start/N)*w; const x2 = (a.end/N)*w;
    c.fillRect(x1, 0, x2-x1, h);
  });
  // line
  c.strokeStyle = '#2563eb'; c.lineWidth = 2;
  c.beginPath();
  values.forEach((v,i)=>{
    const x = (i/(N-1))*w;
    const y = h - (v/100)*(h-margin) - 5;
    if (i===0) c.moveTo(x,y); else c.lineTo(x,y);
  });
  c.stroke();
  return { values, anomalies, N };
}

function buildGantt(anomalies, N) {
  if (!ganttEl) return;
  ganttEl.innerHTML = '';
  anomalies.forEach((a,idx)=>{
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.style.left = `${(a.start/N)*100}%`;
    bar.style.width = `${((a.end-a.start)/N)*100}%`;
    bar.title = `Anomaly ${idx+1}: spikes detected`;
    bar.addEventListener('click', ()=> showDrilldown(idx));
    ganttEl.appendChild(bar);
  });
}

const exampleQueries = [
  { query: 'SELECT * FROM pgbench_accounts WHERE aid BETWEEN $1 AND $2 + $3 ORDER BY abalance DESC LIMIT $4', calls: 15272, avgMs: 6787.04, totalMs: 103651664.49 },
  { query: 'UPDATE orders SET status=$1 WHERE id=$2', calls: 8240, avgMs: 214.2, totalMs: 1766208.0 },
  { query: 'INSERT INTO events(user_id, ts, payload) VALUES($1, $2, $3)', calls: 120340, avgMs: 12.3, totalMs: 1480182.0 },
];

function buildTopQueries() {
  if (!tblQueries) return;
  const thead = `<tr><th>Query</th><th>Calls</th><th>Avg (ms)</th><th>Total (ms)</th></tr>`;
  const rows = exampleQueries.map(q=> `<tr><td style="max-width:520px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${q.query}</td><td>${q.calls.toLocaleString()}</td><td>${q.avgMs.toFixed(2)}</td><td>${q.totalMs.toFixed(2)}</td></tr>`).join('');
  tblQueries.innerHTML = thead + rows;
}

function showDrilldown(idx) {
  const q = exampleQueries[0];
  drilldownEl.style.display = 'block';
  drilldownEl.innerHTML = `<div><strong>Anomaly ${idx+1}</strong>: Top contributors</div>
  <ul style="margin:6px 0 0 16px;">
    <li>Hot query: <code>SELECT * FROM pgbench_accounts WHERE aid BETWEEN ...</code></li>
    <li>Suggested fix: <span class="callout-yellow">Create RANGE index on <code>aid</code></span></li>
  </ul>`;
}

function showExampleReport() {
  const report = `# Query Analysis Report\n\n## Top Slow Queries\n\n==================================================\n\n### Query 1\n\n**Analysis of Findings**\n\n*   **Sequential Scans Found:** Yes.\n*   **Affected Fields:** The aid column is subject to a sequential scan.\n*   **Recommended Index Strategy:**\n    1.  The query's range predicate WHERE aid BETWEEN ... results in a Seq Scan because the aid column, which is the primary key, is HASH partitioned by default in YugabyteDB.\n    2.  To enable efficient range lookups, the table should be recreated with RANGE partitioning on the primary key.\n        SQL1\n    3.  If recreating the table is not an option, create a secondary RANGE index on the aid column.\n        SQL2\n*   **Explanation:** The current HASH partitioned primary key on aid distributes data evenly across nodes but does not maintain a sorted order. Consequently, a query for a range of aid values must scan all tablets to find the matching rows, leading to an inefficient Seq Scan. A RANGE partitioned index (either primary or secondary) stores the data sorted by the aid value, allowing the database to perform a much faster Index Scan by directly accessing only the data within the specified range.\n\n\n## Query Analysis\n\n==================================================\n\n#### Query Analysis\n\nThis SQL query contains a range predicate.\n\nThe range predicate is:\n\nSQL3\n\nThis predicate uses the BETWEEN operator to select all rows where the value in the aid column falls within the inclusive range defined by the parameter $1 and the expression $2 + $3.\n\n\n#### Existing Indexes\n\n- CREATE UNIQUE INDEX pgbench_accounts_pkey ON public.pgbench_accounts USING lsm (aid HASH)\n- CREATE INDEX idx_abalance ON public.pgbench_accounts USING lsm (abalance HASH)\n--------------------------------------------------\n\n\n- Calls: 15272\n- Total Exec Time (ms): 103651664.49349204\n- Avg Exec Time (ms): 6787.03931989864\n\n#### Query Text\n\nSQL4\n\n#### Explain Plan\n\nSQL5\n\n\n--------------------------------------------------`;
  // Insert into chat as assistant bubble with red/yellow highlights and code blocks preserved
  const node = createRow('assistant', 'Opened example Query Analysis Report below.');
  chatEl.appendChild(node);
  const pre = document.createElement('div');
  // Build formatted HTML replacing placeholders with code blocks
  const sql1 = `CREATE TABLE pgbench_accounts (\n    aid bigint NOT NULL,\n    bid integer,\n    abalance integer,\n    filler character(84),\n    PRIMARY KEY (aid ASC)\n);`;
  const sql2 = `CREATE INDEX pgbench_accounts_aid_idx ON pgbench_accounts (aid ASC);`;
  const sql3 = `aid BETWEEN $1 AND $2 + $3`;
  const sql4 = `SELECT *\nFROM pgbench_accounts\nWHERE aid BETWEEN $1 AND $2 + $3\nORDER BY abalance DESC\nLIMIT $4`;
  const sql5 = `[...] shortened plan ...`;
  const safe = report
    .replace('SQL1', `<pre><code>${sql1}</code></pre>`)
    .replace('SQL2', `<pre><code>${sql2}</code></pre>`)
    .replace('SQL3', `<pre><code>${sql3}</code></pre>`)
    .replace('SQL4', `<pre><code>${sql4}</code></pre>`)
    .replace('SQL5', `<pre><code>${sql5}</code></pre>`)
    .replaceAll('Sequential Scans Found: Yes.', `<span class=\"callout-red\"><strong>Sequential Scans Found:</strong> Yes</span>`) 
    .replaceAll('Recommended Index Strategy:', `<span class=\"callout-yellow\"><strong>Recommended Index Strategy</strong></span>`);
  pre.innerHTML = safe
    .split('\n')
    .map(line => {
      if (line.startsWith('## ')) return `<h3>${line.slice(3)}</h3>`;
      if (line.startsWith('### ')) return `<h4>${line.slice(4)}</h4>`;
      if (line.startsWith('#### ')) return `<h5>${line.slice(5)}</h5>`;
      if (line.startsWith('- ')) return `<div>• ${line.slice(2)}</div>`;
      if (line.startsWith('==================================================')) return '<hr />';
      return `<div>${line}</div>`;
    })
    .join('');
  const wrap = document.createElement('div');
  wrap.className = 'row assistant';
  const col = document.createElement('div');
  col.style.maxWidth = 'min(75ch, 100%)';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.appendChild(pre);
  col.appendChild(bubble);
  wrap.appendChild(document.createElement('div'));
  wrap.appendChild(col);
  chatEl.appendChild(wrap);
  scrollToBottom();
}

if (btnReport) btnReport.addEventListener('click', showExampleReport);

// simple send to append user message and assistant echo
if (composer) {
  composer.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = (input && input.value || '').trim();
    if (!text) return;
    await typeOut('user', text, 50);
    input.value = '';
    scrollToBottom();
    const reply = createRow('assistant', 'Thanks! I will analyze those details and update the insights.');
    chatEl.appendChild(reply);
    scrollToBottom();
  });
  // Allow pressing Enter in the empty composer to advance the scripted demo
  input && input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const hasText = (input.value || '').trim().length > 0;
      if (!hasText) { e.preventDefault(); next(); }
    }
  });
}

// initialize widgets
function initPerformanceAdvisorVisuals() {
  // Check for pa_image via URL or existing asset at assets/pa_example.png
  const params = new URLSearchParams(location.search);
  const url = params.get('pa_image');
  const candidate = url || 'assets/pa_example.png';
  const img = paImage;
  if (!img) return fallbackToWidgets();

  const showImage = (src) => {
    if (!src) return fallbackToWidgets();
    img.onload = () => {
      if (paImageWrap) paImageWrap.style.display = 'block';
      if (paWidgets) paWidgets.style.display = 'none';
      syncChatHeightToLeft();
    };
    img.onerror = fallbackToWidgets;
    img.src = src;
  };

  // If url param provided, try it; otherwise try default asset and rely on onerror for fallback
  if (url) {
    showImage(url);
  } else {
    showImage(candidate);
  }
}

function fallbackToWidgets() {
  const ctx = chartCanvas ? chartCanvas.getContext('2d') : null;
  const { anomalies, N } = drawLoadChart(ctx) || { anomalies: [], N: 60 };
  buildGantt(anomalies, N);
  buildTopQueries();
  window.addEventListener('resize', ()=> drawLoadChart(ctx));
  if (chatPanel) chatPanel.style.height = '';
  syncChatHeightToLeft();
}

initPerformanceAdvisorVisuals();

function syncChatHeightToLeft() {
  if (!chatPanel) return;
  // Prefer matching the AI message area to the PA image height if available
  const headerH = chatHeader ? chatHeader.offsetHeight : 0;
  const composerH = composer ? composer.offsetHeight : 0;
  const imgH = (paImageWrap && paImageWrap.style.display !== 'none' && paImage) ? paImage.clientHeight : 0;

  if (imgH > 0) {
    chatPanel.style.height = (headerH + imgH + composerH) + 'px';
    return;
  }

  // Fallback: match overall left panel height
  if (paPanel) {
    const leftHeight = paPanel.offsetHeight;
    if (leftHeight > 0) chatPanel.style.height = leftHeight + 'px';
  }
}

window.addEventListener('resize', syncChatHeightToLeft);


