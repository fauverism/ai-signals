// Deterministic title analysis for dedupe: tokens (for Jaccard / TF-IDF) and entities (for clustering and trend).

const STOP = new Set(
  `a an the and or but of to in on for with at by from as is are was were be been it its this that these those
   how why what when who which your you we our their can will new now just more not no vs via about into over after
   before up out do does has have had using use may than then so if all any get gets one two`.split(/\s+/),
);

// Headline filler that appears in almost every story and says nothing about which story it is.
const GENERIC = new Set(
  `ai llm llms model models announce announces announced launch launches launched introducing introduces introduce
   release releases released unveil unveils unveiled says report reports update updates generative machine learning
   open source`.split(/\s+/),
);

// "Top 10", "Part 2", "Step 3" are not versions.
const NO_JOIN = new Set(
  `top part step tip level phase week day chapter episode vol issue lesson season round page number way ways reason
   reasons thing things tool tools tips lessons steps q fy`.split(/\s+/),
);

const stem = (t) => (t.length > 3 && t.endsWith('s') && !t.endsWith('ss') && !/\d/.test(t) ? t.slice(0, -1) : t);

/** Lowercased, accent-free, version-joined ("GPT-5" and "GPT 5" both become gpt5) array of tokens. */
function rawTokens(title) {
  const s = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/'s\b/gi, '')
    .replace(/\b([A-Za-z]{3,})[-\s](\d{1,2}(?:\.\d+)?[a-z]?)\b/g, (m, word, num) =>
      STOP.has(word.toLowerCase()) || NO_JOIN.has(word.toLowerCase()) ? m : `${word}${num}`,
    );
  return s.toLowerCase().match(/[a-z0-9]+(?:\.\d+)*/g) ?? [];
}

/** Set of normalized content tokens (stopwords, filler and bare numbers removed, light plural stemming). */
export function tokenize(title) {
  const out = new Set();
  for (const t of rawTokens(title)) {
    if (t.length < 2 || STOP.has(t) || GENERIC.has(t) || /^\d+(\.\d+)*$/.test(t)) continue;
    out.add(stem(t));
  }
  return out;
}

export function jaccard(a, b) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared === 0 ? 0 : shared / (a.size + b.size - shared);
}

export const sharedCount = (a, b) => {
  let n = 0;
  for (const t of a) if (b.has(t)) n++;
  return n;
};

/** Model/product tokens like gpt5, llama4, atlas2, h100. */
export const isVersionToken = (t) => /^[a-z]{2,}\d+(\.\d+)?[a-z]?$/.test(t) && !/^(q|fy|top|part|step)\d/.test(t);

const KNOWN = [
  'openai', 'anthropic', 'google', 'deepmind', 'meta', 'microsoft', 'nvidia', 'apple', 'amazon', 'aws', 'xai',
  'mistral', 'deepseek', 'qwen', 'alibaba', 'tesla', 'hugging face', 'cohere', 'stability', 'midjourney',
  'perplexity', 'databricks', 'snowflake', 'intel', 'amd', 'tsmc', 'samsung', 'huawei', 'baidu', 'tencent',
  'bytedance', 'moonshot', 'claude', 'gemini', 'gemma', 'gpt', 'chatgpt', 'codex', 'llama', 'sora', 'copilot',
  'grok', 'mixtral', 'github', 'pytorch', 'tensorflow', 'langchain', 'ollama', 'cursor', 'cerebras', 'groq',
  'palantir', 'oracle', 'salesforce', 'ibm', 'adobe', 'spotify', 'netflix', 'uber', 'waymo', 'nist', 'ftc',
  'congress', 'white house', 'european union', 'eu', 'china', 'macos', 'ios', 'android', 'windows', 'linux',
];
const KNOWN_RE = KNOWN.map((name) => [name, new RegExp(`(?<![a-z0-9])${name}(?![a-z0-9])`)]);

const GENERIC_ACRONYMS = new Set(
  'LLM LLMS GPU GPUS CPU API APIS CEO CTO USA NEW FAQ PDF RAG SAAS NLP CNN RNN AGI SDK CLI'.split(' '),
);
const COMMON_CAPS = new Set(
  `the a an and or but how why what when who where new top best first show ask tell is are can will your you we our my i
   in on for to of with from by at as this that these those it its here introducing announcing building using getting
   monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september
   october november december`.split(/\s+/),
);

/** Set of lowercase entity strings: known companies/products, model versions, acronyms, brand-cased and proper nouns. */
export function entitiesOf(title) {
  const out = new Set();
  const lower = title.toLowerCase();
  for (const [name, re] of KNOWN_RE) if (re.test(lower)) out.add(name);
  for (const t of rawTokens(title)) if (isVersionToken(t)) out.add(t);

  const words = title.match(/[A-Za-z][A-Za-z0-9.+'-]*/g) ?? [];
  const long = words.filter((w) => w.length >= 4);
  const titleCase = long.length >= 4 && long.filter((w) => /^[A-Z]/.test(w)).length / long.length >= 0.7;
  words.forEach((w, i) => {
    const word = w.replace(/'s$/i, '');
    if (/^[A-Z]{3,}$/.test(word)) {
      if (!GENERIC_ACRONYMS.has(word)) out.add(word.toLowerCase());
    } else if (/^[A-Z][a-z]+[A-Z]|^[a-z]+[A-Z]/.test(word)) {
      out.add(word.toLowerCase()); // OpenAI, DeepMind, iPhone
    } else if (!titleCase && i > 0 && /^[A-Z][a-z]{2,}$/.test(word) && !COMMON_CAPS.has(word.toLowerCase())) {
      out.add(word.toLowerCase()); // proper noun mid-sentence
    }
  });
  return out;
}
