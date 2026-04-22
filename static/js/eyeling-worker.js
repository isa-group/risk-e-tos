(function () {
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

  function stripSuggestAddBlocks(n3) {
    return n3.replace(
      /(^|\n)[^\n]*\s:suggestAdd\s*\{[\s\S]*?\}\s*\.\s*(?=\n|$)/g,
      ''
    ).trim();
  }

  function extractSuggestAddPatchTTL(n3) {
    const re = /(^|\n)[^\n]*\s:suggestAdd\s*\{\s*([\s\S]*?)\s*\}\s*\.\s*(?=\n|$)/g;
    const chunks = [];
    let m;
    while ((m = re.exec(n3)) !== null) {
      chunks.push(m[2].trim());
    }

    const body = chunks.filter(Boolean).join("\n\n");
    if (!body) return "";

    return `${body}\n`;
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
        const fullInput = textarea.value + "\n\n" + rulesText;

        const result = eyeling.reasonStream(fullInput, {
          proof: false,
          includeInputFactsInClosure: true,
        });

        const closureN3 = result?.closureN3 ? String(result.closureN3) : "";

        const messages = extractOutputStrings(closureN3);
        const hasRisk = !!messages || /\s+a\s+dpv:Risk\s*\./.test(closureN3);
        const hasMitigation = /\s:suggestAdd\s*\{/.test(closureN3);

        const cleanClosureN3 = stripSuggestAddBlocks(closureN3);
        riskOutput.textContent = cleanClosureN3;

        if (riskSummary) {
          riskSummary.textContent = messages || "No potential risks detected in this term. Review the input policy for any missing or incorrect statements.";
        }

        if (riskResult) {
          riskResult.classList.remove("visually-hidden");
        }

        if (hasRisk && hasMitigation) {
          const patchTTL = extractSuggestAddPatchTTL(closureN3);
          mitigationOutput.textContent = patchTTL;
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