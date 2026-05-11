(function () {
  const LOG_OUTPUT_STRING = 'http://www.w3.org/2000/10/swap/log#outputString';
  const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';
  const DPV_RISK = 'https://w3id.org/dpv#Risk';

  const PASS_QUERY = `
  @prefix log: <http://www.w3.org/2000/10/swap/log#> .

  { ?S ?P ?O } log:query { ?S ?P ?O }.
  `;

  const EXAMPLES = {
    abusive_content_removal: 'input_data/abusive/content_removal.ttl',
    abusive_unilateral_change: 'input_data/abusive/unilateral_change.ttl',
    abusive_unilateral_termination: 'input_data/abusive/unilateral_termination.ttl',
    abusive_contract_by_using: 'input_data/abusive/contract_by_using.ttl',
    abusive_arbitration: 'input_data/abusive/arbitration.ttl',
    abusive_choice_of_law: 'input_data/abusive/choice_law.ttl',
    abusive_jurisdiction: 'input_data/abusive/jurisdiction.ttl',
    non_abusive_content_removal: 'input_data/non_abusive/content_removal.ttl',
    non_abusive_unilateral_change: 'input_data/non_abusive/unilateral_change.ttl',
    non_abusive_unilateral_termination: 'input_data/non_abusive/unilateral_termination.ttl',
    non_abusive_contract_by_using: 'input_data/non_abusive/contract_by_using.ttl',
    non_abusive_arbitration: 'input_data/non_abusive/arbitration.ttl',
    non_abusive_choice_of_law: 'input_data/non_abusive/choice_law.ttl',
    non_abusive_jurisdiction: 'input_data/non_abusive/jurisdiction.ttl'
  };

  const RULE_FILES = ['rules/content_removal.n3',
    'rules/unilateral_change.n3',
    'rules/unilateral_termination.n3',
    'rules/contract_by_using.n3',
    'rules/arbitration.n3',
    'rules/choice_law.n3',
    'rules/jurisdiction.n3'
  ];

  async function fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} (${res.status})`);
    return res.text();
  }

  async function loadRulesText() {
    const parts = await Promise.all(RULE_FILES.map(fetchText));
    return parts.join('\n\n');
  }

  function decodeLiteral(lit) {
    let s = String(lit || '').trim();

    if (s.startsWith('"""')) s = s.endsWith('"""') ? s.slice(3, -3) : s.slice(3);
    else if (s.startsWith('"')) s = s.endsWith('"') ? s.slice(1, -1) : s.slice(1);

    return s
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  function extractOutputStrings(closureN3) {
    const re =
      /^\s*(\S+)\s+log:outputString\s+("(?:(?:\\.|[^"\\])*)"|"""[\s\S]*?""")\s*\.\s*$/;

    const items = [];
    for (const line of String(closureN3 || '').split(/\r\n|\n|\r/)) {
      const m = line.match(re);
      if (m) items.push({ key: m[1], value: decodeLiteral(m[2]) });
    }

    items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return items.map((x) => x.value).join('').trim();
  }

  function extractOutputStringsFromTriples(triples) {
    const items = [];

    for (const triple of Array.isArray(triples) ? triples : []) {
      if (!triple || triple.p?.value !== LOG_OUTPUT_STRING) continue;
      items.push({
        key: String(triple.s?.value || triple.s || ''),
        value: String(triple.o?.value || ''),
      });
    }

    items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    return items.map((x) => x.value).join('').trim();
  }

  function hasRiskTriples(triples) {
    return Array.isArray(triples) && triples.some(
      (triple) => triple?.p?.value === RDF_TYPE && triple?.o?.value === DPV_RISK
    );
  }

  function findSuggestAddBlocks(n3) {
    const text = String(n3 || '');
    const blocks = [];
    let searchFrom = 0;

    while (searchFrom < text.length) {
      const markerIndex = text.indexOf(':suggestAdd', searchFrom);
      if (markerIndex === -1) break;

      const openIndex = text.indexOf('{', markerIndex);
      if (openIndex === -1) break;

      let depth = 1;
      let inString = false;
      let escaped = false;
      let endIndex = -1;

      for (let i = openIndex + 1; i < text.length; i += 1) {
        const ch = text[i];

        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (ch === '\\') {
            escaped = true;
          } else if (ch === '"') {
            inString = false;
          }
          continue;
        }

        if (ch === '"') {
          inString = true;
          continue;
        }

        if (ch === '{') {
          depth += 1;
          continue;
        }

        if (ch === '}') {
          depth -= 1;
          if (depth === 0) {
            endIndex = i + 1;
            while (endIndex < text.length && /\s/.test(text[endIndex])) {
              endIndex += 1;
            }
            if (text[endIndex] === '.') endIndex += 1;
            blocks.push({
              start: markerIndex,
              end: endIndex,
              body: text.slice(openIndex + 1, i).trim(),
            });
            searchFrom = endIndex;
            break;
          }
        }
      }

      if (endIndex === -1) break;
    }

    return blocks;
  }

  function stripSuggestAddBlocks(n3) {
    const text = String(n3 || '');
    const blocks = findSuggestAddBlocks(text);
    if (!blocks.length) return text.trim();

    let out = text;
    for (let i = blocks.length - 1; i >= 0; i -= 1) {
      const { start, end } = blocks[i];
      out = out.slice(0, start) + out.slice(end);
    }

    return out.trim();
  }

  function extractSuggestAddPatchTTL(n3) {
    const blocks = findSuggestAddBlocks(n3);
    const body = blocks.map((b) => b.body).filter(Boolean).join("\n\n");
    if (!body) return "";

    return `${body}\n`;
  }

  function renderPatchTTL(ttl) {
    const pretty = prettifyPatchTTL(ttl);
    return pretty || String(ttl || '').trim();
  }

  function tripleToText(triple, prefixes) {
    if (typeof eyeling?.tripleToN3 === 'function') {
      return String(eyeling.tripleToN3(triple, prefixes) || '');
    }

    const s = triple?.s?.value || '';
    const p = triple?.p?.value || '';
    const o = triple?.o?.value || '';
    return `${s} ${p} ${o}`.trim();
  }

  function renderTriples(triples, prefixes) {
    if (typeof eyeling?.prettyPrintQueryTriples === 'function') {
      const rendered = eyeling.prettyPrintQueryTriples(triples, prefixes);
      if (rendered && String(rendered).trim()) {
        return String(rendered).trim();
      }
    }

    return triples.map((triple) => tripleToText(triple, prefixes)).join('\n').trim();
  }

  function splitMitigationTriples(triples, prefixes) {
    const mitigation = [];
    const remaining = [];

    for (const triple of triples) {
      const text = tripleToText(triple, prefixes);
      if (/\bsuggestAdd\b/.test(text)) mitigation.push(triple);
      else remaining.push(triple);
    }

    return { mitigation, remaining };
  }

  function prettifyPatchTTL(ttl) {
    const triples = [];
    const lines = String(ttl || '').split(/\r\n|\n|\r/);

    for (const line of lines) {
      const m = line.trim().match(/^(\S+)\s+(\S+)\s+(.+?)\s*\.\s*$/);
      if (m) {
        triples.push({
          s: m[1],
          p: m[2],
          o: m[3]
        });
      }
    }

    const blankNodeTriples = new Map();
    const topLevelTriples = [];

    for (const t of triples) {
      if (t.s.startsWith('_:')) {
        if (!blankNodeTriples.has(t.s)) {
          blankNodeTriples.set(t.s, []);
        }
        blankNodeTriples.get(t.s).push(t);
      } else {
        topLevelTriples.push(t);
      }
    }

    const subjects = new Map();

    for (const t of topLevelTriples) {
      if (!subjects.has(t.s)) {
        subjects.set(t.s, []);
      }
      subjects.get(t.s).push(t);
    }

    const blocks = [];

    for (const [subject, subjectTriples] of subjects.entries()) {
      const predicates = [];

      for (const t of subjectTriples) {
        if (t.o.startsWith('_:') && blankNodeTriples.has(t.o)) {
          const innerTriples = blankNodeTriples.get(t.o);

          const inner = innerTriples
            .map((bt, index) => {
              const end = index === innerTriples.length - 1 ? '' : ' ;';
              return `    ${bt.p} ${bt.o}${end}`;
            })
            .join('\n');

          predicates.push(`${t.p} [\n${inner}\n  ]`);
        } else {
          predicates.push(`${t.p} ${t.o}`);
        }
      }

      const body = predicates
        .map((p, index) => {
          const end = index === predicates.length - 1 ? ' .' : ' ;';
          return `  ${p}${end}`;
        })
        .join('\n');

      blocks.push(`${subject}\n${body}`);
    }

    return blocks.join('\n\n').trim();
  }

  function setup() {
    const textarea = document.getElementById('policy-input');
    const runButton = document.getElementById('btn-analyse-policy');
    const exampleSelect = document.getElementById('policy-examples');
    const loadButton = document.getElementById('load-policy-example');
    const riskOutput = document.getElementById('risk-output');
    const riskSummary = document.getElementById('risk-summary');
    const riskResult = document.getElementById('risk-result');
    const mitigationResult = document.getElementById('mitigation-result');
    const mitigationOutput = document.getElementById('mitigation-output');

    loadButton.onclick = async () => {
      riskResult.classList.add("visually-hidden");
      mitigationResult.classList.add("visually-hidden");
      try {
        const url = EXAMPLES[exampleSelect.value];
        if (!url) return;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`${url} (${res.status})`);

        textarea.value = await res.text();
      } catch (e) {
        console.error(e);
        riskOutput.textContent = 'Error loading example: ' + (e?.message || e);
      }
    };

    runButton.onclick = async () => {
      riskResult.classList.add("visually-hidden");
      mitigationResult.classList.add("visually-hidden");

      try {
        const rulesText = await loadRulesText();
        const fullInput = textarea.value + "\n\n" + rulesText + "\n\n" + PASS_QUERY;

        const result = eyeling.reasonStream(fullInput, {
          proof: false,
          includeInputFactsInClosure: true,
        });

        const closureN3 = result?.closureN3 ? String(result.closureN3) : "";
        const queryTriples = Array.isArray(result?.queryTriples) ? result.queryTriples : [];
        const prefixes = result?.prefixes;

        const messages =
          extractOutputStringsFromTriples(queryTriples) || extractOutputStrings(closureN3);

        const cleanClosureN3 = stripSuggestAddBlocks(closureN3);
        riskOutput.textContent = renderPatchTTL(cleanClosureN3);

        if (riskSummary) {
          riskSummary.textContent = messages ||
            (hasRiskTriples(queryTriples)
              ? "Potential risks detected. Review the input policy for details."
              : "No potential risks detected in this term. Review the input policy for any missing or incorrect statements.");
        }

        if (riskResult) {
          riskResult.classList.remove("visually-hidden");
        }

        const { mitigation: mitigationTriples } = splitMitigationTriples(queryTriples, prefixes);
        if (mitigationTriples.length) {
          mitigationOutput.textContent = renderTriples(mitigationTriples, prefixes);
          mitigationResult.classList.remove("visually-hidden");
        }

      } catch (e) {
        console.error(e);
        riskOutput.textContent = "Error running Eyeling: " + (e?.message || e);
        if (riskSummary) riskSummary.textContent = "";
      }
    };
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', setup)
    : setup();
})();
