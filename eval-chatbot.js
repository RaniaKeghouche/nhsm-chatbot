/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║   NHSM Chatbot — Comprehensive Evaluation Suite          ║
 * ║   Tests: 40+  |  Scoring: 0-100  |  Metrics: 6          ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * Metrics evaluated per test:
 *   1. DB Retrieval    — Did the right collection appear in context?
 *   2. Source Quality  — Do expected keywords appear in retrieved sources?
 *   3. Response Lang   — Does the response language match the query language?
 *   4. Completeness    — Is the response substantive (not a stub)?
 *   5. Anti-hallucin.  — Does the response avoid forbidden/wrong claims?
 *   6. Relevance       — Do expected answer keywords appear in response?
 *
 * Run: node eval-chatbot.js
 */

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose  = require('c:/Users/kegho/Desktop/web/NHSM/node_modules/mongoose');
const config    = require('c:/Users/kegho/Desktop/web/NHSM/src/config/config');
const aiService = require('c:/Users/kegho/Desktop/web/NHSM/src/services/aiService');
const kbService = require('c:/Users/kegho/Desktop/web/NHSM/src/services/knowledgeBaseService');

// ─────────────────────────────────────────────────────────────
// ANSI colours
// ─────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', blue: '\x1b[34m', magenta: '\x1b[35m', white: '\x1b[37m'
};
const bar = (pct, width=20) => {
  const filled = Math.round(pct / 100 * width);
  return C.green + '█'.repeat(filled) + C.dim + '░'.repeat(width - filled) + C.reset;
};

// ─────────────────────────────────────────────────────────────
// Language detection helper (simple heuristic)
// ─────────────────────────────────────────────────────────────
function detectLang(text) {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  const arabicChars = (t.match(/[\u0600-\u06FF]/g) || []).length;
  if (arabicChars > 5) return 'ar';
  const frWords = ['le ', 'la ', 'les ', 'de ', 'du ', 'des ', 'est ', 'sont ', 'je ', 'vous ', 'nous ', 'un ', 'une ', 'ce ', 'et '];
  const enWords = ['the ', 'is ', 'are ', 'this ', 'that ', 'you ', 'we ', 'for ', 'of ', 'in ', 'to ', ' i ', 'it '];
  const frCount = frWords.filter(w => t.includes(w)).length;
  const enCount = enWords.filter(w => t.includes(w)).length;
  if (frCount > enCount) return 'fr';
  if (enCount > frCount) return 'en';
  return 'any';
}

// ─────────────────────────────────────────────────────────────
// TEST CASES — 40+ diverse questions across all collections
// ─────────────────────────────────────────────────────────────
const TEST_CASES = [

  // ── SPECIALTIES (10 tests) ──────────────────────────────────
  {
    id: 'SP-01', category: 'Specialty', lang: 'fr',
    query: "quelles sont les spécialités disponibles à l'NHSM?",
    expectedCollections: ['Specialty'],
    expectedKeywordsInSources: ['sesa', 'ccs', 'ms'],
    expectedKeywordsInResponse: ['sesa', 'ccs', 'ms', 'spécialité'],
    forbiddenInResponse: ['recipe', 'cuisine']
  },
  {
    id: 'SP-02', category: 'Specialty', lang: 'en',
    query: "what is the CCS specialty at NHSM?",
    expectedCollections: ['Specialty'],
    expectedKeywordsInSources: ['ccs'],
    expectedKeywordsInResponse: ['cryptography', 'coding', 'security', 'ccs'],
    forbiddenInResponse: []
  },
  {
    id: 'SP-03', category: 'Specialty', lang: 'fr',
    query: "c'est quoi la spécialité SESA?",
    expectedCollections: ['Specialty'],
    expectedKeywordsInSources: ['sesa'],
    expectedKeywordsInResponse: ['statistique', 'sesa', 'actuarielle', 'probabilité'],
    forbiddenInResponse: []
  },
  {
    id: 'SP-04', category: 'Specialty', lang: 'en',
    query: "describe the MS modeling and simulation specialty",
    expectedCollections: ['Specialty'],
    expectedKeywordsInSources: ['ms'],
    expectedKeywordsInResponse: ['modeling', 'simulation', 'differential', 'ms'],
    forbiddenInResponse: []
  },
  {
    id: 'SP-05', category: 'Specialty', lang: 'en',
    query: "what jobs can I get after CCS specialty?",
    expectedCollections: ['Specialty'],
    expectedKeywordsInSources: ['ccs'],
    expectedKeywordsInResponse: ['job', 'career', 'security', 'cryptograph'],
    forbiddenInResponse: []
  },
  {
    id: 'SP-06', category: 'Specialty', lang: 'fr',
    query: "quels sont les débouchés de la spécialité MS?",
    expectedCollections: ['Specialty'],
    expectedKeywordsInSources: ['ms'],
    expectedKeywordsInResponse: ['emploi', 'modélisation', 'simulation', 'ms'],
    forbiddenInResponse: []
  },
  {
    id: 'SP-07', category: 'Specialty', lang: 'fr',
    query: "quelles compétences on acquiert en SESA?",
    expectedCollections: ['Specialty'],
    expectedKeywordsInSources: ['sesa'],
    expectedKeywordsInResponse: ['statistique', 'compétence', 'sesa'],
    forbiddenInResponse: []
  },
  {
    id: 'SP-08', category: 'Specialty', lang: 'en',
    query: "how many specialties does NHSM have?",
    expectedCollections: ['Specialty'],
    expectedKeywordsInSources: ['nhsm_academic_overview'],
    expectedKeywordsInResponse: ['four', 'trois', '3', '4', 'specialt'],
    forbiddenInResponse: []
  },
  {
    id: 'SP-09', category: 'Specialty', lang: 'ar',
    query: "وش هوما تخصصات لي كاينين ف ليكول",
    expectedCollections: ['Specialty'],
    expectedKeywordsInSources: ['sesa', 'ccs', 'ms', 'specialty'],
    expectedKeywordsInResponse: ['ccs', 'sesa'],
    forbiddenInResponse: []
  },
  {
    id: 'SP-10', category: 'Specialty', lang: 'fr',
    query: "après quelle année choisit-on sa spécialité à NHSM?",
    expectedCollections: ['Specialty'],
    expectedKeywordsInSources: ['nhsm_academic_overview', 'academic'],
    expectedKeywordsInResponse: ['troisième', 'année', 'spécialité', 'third'],
    forbiddenInResponse: []
  },

  // ── TEACHERS (7 tests) ──────────────────────────────────────
  {
    id: 'TC-01', category: 'TeacherInfo', lang: 'en',
    query: "who are the professors at NHSM?",
    expectedCollections: ['TeacherInfo'],
    expectedKeywordsInSources: ['teacher', 'professor'],
    expectedKeywordsInResponse: ['professor', 'nhsm', 'mathematics'],
    forbiddenInResponse: []
  },
  {
    id: 'TC-02', category: 'TeacherInfo', lang: 'fr',
    query: "qui est le meilleur professeur à l'NHSM selon les étudiants?",
    expectedCollections: ['TeacherInfo', 'StudentExperience'],
    expectedKeywordsInSources: ['teacher', 'djemmada'],
    expectedKeywordsInResponse: ['professeur', 'nhsm'],
    forbiddenInResponse: []
  },
  {
    id: 'TC-03', category: 'TeacherInfo', lang: 'en',
    query: "who is Professor Djemmada at NHSM?",
    expectedCollections: ['TeacherInfo'],
    expectedKeywordsInSources: ['djemmada'],
    expectedKeywordsInResponse: ['djemmada', 'mathematics', 'nhsm'],
    forbiddenInResponse: []
  },
  {
    id: 'TC-04', category: 'TeacherInfo', lang: 'fr',
    query: "quelles sont les spécialisations du professeur Farhi?",
    expectedCollections: ['TeacherInfo'],
    expectedKeywordsInSources: ['farhi'],
    expectedKeywordsInResponse: ['farhi', 'mathématique', 'théorie des nombres'],
    forbiddenInResponse: []
  },
  {
    id: 'TC-05', category: 'TeacherInfo', lang: 'en',
    query: "list all teachers at NHSM",
    expectedCollections: ['TeacherInfo'],
    expectedKeywordsInSources: ['teacher'],
    expectedKeywordsInResponse: ['professor', 'nhsm'],
    forbiddenInResponse: []
  },
  {
    id: 'TC-06', category: 'TeacherInfo', lang: 'fr',
    query: "qui enseigne la cryptographie à NHSM?",
    expectedCollections: ['TeacherInfo'],
    expectedKeywordsInSources: ['djemmada', 'cryptograph', 'bahache'],
    expectedKeywordsInResponse: ['cryptograph', 'nhsm'],
    forbiddenInResponse: []
  },
  {
    id: 'TC-07', category: 'TeacherInfo', lang: 'en',
    query: "what is professor Bezia's research area?",
    expectedCollections: ['TeacherInfo'],
    expectedKeywordsInSources: ['bezia'],
    expectedKeywordsInResponse: ['bezia', 'mathematics'],
    forbiddenInResponse: []
  },

  // ── STUDY TIPS (5 tests) ─────────────────────────────────────
  {
    id: 'ST-01', category: 'StudyTip', lang: 'fr',
    query: "comment bien étudier les mathématiques?",
    expectedCollections: ['StudyTip', 'MathTip'],
    expectedKeywordsInSources: ['study', 'math'],
    expectedKeywordsInResponse: ['étudier', 'mathématique', 'méthode'],
    forbiddenInResponse: []
  },
  {
    id: 'ST-02', category: 'StudyTip', lang: 'en',
    query: "give me tips to improve my study habits",
    expectedCollections: ['StudyTip'],
    expectedKeywordsInSources: ['study'],
    expectedKeywordsInResponse: ['study', 'habit', 'tip', 'schedule'],
    forbiddenInResponse: []
  },
  {
    id: 'ST-03', category: 'StudyTip', lang: 'en',
    query: "what is the pomodoro technique?",
    expectedCollections: ['StudyTip'],
    expectedKeywordsInSources: ['pomodoro', 'study'],
    expectedKeywordsInResponse: ['pomodoro', 'minute', 'break', 'focus'],
    forbiddenInResponse: []
  },
  {
    id: 'ST-04', category: 'StudyTip', lang: 'fr',
    query: "comment faire un bon planning d'étude?",
    expectedCollections: ['StudyTip'],
    expectedKeywordsInSources: ['study', 'planning', 'schedule'],
    expectedKeywordsInResponse: ['planning', 'horaire', 'étude', 'organis'],
    forbiddenInResponse: []
  },
  {
    id: 'ST-05', category: 'StudyTip', lang: 'en',
    query: "how to use active recall when studying?",
    expectedCollections: ['StudyTip'],
    expectedKeywordsInSources: ['recall', 'active', 'study'],
    expectedKeywordsInResponse: ['recall', 'active', 'memory', 'quiz'],
    forbiddenInResponse: []
  },

  // ── RESOURCES (4 tests) ──────────────────────────────────────
  {
    id: 'RS-01', category: 'Resource', lang: 'en',
    query: "what online resources can I use to study math?",
    expectedCollections: ['Resource'],
    expectedKeywordsInSources: ['resource'],
    expectedKeywordsInResponse: ['khan', 'coursera', 'online', 'resource'],
    forbiddenInResponse: []
  },
  {
    id: 'RS-02', category: 'Resource', lang: 'fr',
    query: "quels sites web utiliser pour apprendre les maths?",
    expectedCollections: ['Resource'],
    expectedKeywordsInSources: ['resource'],
    expectedKeywordsInResponse: ['site', 'ressource', 'mathématique', 'ligne'],
    forbiddenInResponse: []
  },
  {
    id: 'RS-03', category: 'Resource', lang: 'en',
    query: "recommend YouTube channels for mathematics",
    expectedCollections: ['Resource'],
    expectedKeywordsInSources: ['resource'],
    expectedKeywordsInResponse: ['youtube', 'video', 'channel', 'math'],
    forbiddenInResponse: []
  },
  {
    id: 'RS-04', category: 'Resource', lang: 'fr',
    query: "comment utiliser les ressources en ligne efficacement?",
    expectedCollections: ['Resource'],
    expectedKeywordsInSources: ['resource'],
    expectedKeywordsInResponse: ['ressource', 'ligne', 'efficacement', 'utiliser'],
    forbiddenInResponse: []
  },

  // ── WELLNESS (4 tests) ───────────────────────────────────────
  {
    id: 'WL-01', category: 'Wellness', lang: 'en',
    query: "how to manage stress during exams?",
    expectedCollections: ['Wellness'],
    expectedKeywordsInSources: ['wellness', 'stress'],
    expectedKeywordsInResponse: ['stress', 'exam', 'relax', 'sleep'],
    forbiddenInResponse: []
  },
  {
    id: 'WL-02', category: 'Wellness', lang: 'fr',
    query: "j'ai du mal à dormir pendant les examens que faire?",
    expectedCollections: ['Wellness'],
    expectedKeywordsInSources: ['wellness', 'sleep'],
    expectedKeywordsInResponse: ['sommeil', 'dormir', 'repos'],
    forbiddenInResponse: []
  },
  {
    id: 'WL-03', category: 'Wellness', lang: 'en',
    query: "how many hours of sleep does a student need?",
    expectedCollections: ['Wellness'],
    expectedKeywordsInSources: ['wellness', 'sleep'],
    expectedKeywordsInResponse: ['hours', 'sleep', 'rest'],
    forbiddenInResponse: []
  },
  {
    id: 'WL-04', category: 'Wellness', lang: 'fr',
    query: "comment éviter le burn-out étudiant?",
    expectedCollections: ['Wellness'],
    expectedKeywordsInSources: ['wellness', 'burnout', 'burn'],
    expectedKeywordsInResponse: ['burn', 'épuisement', 'pause', 'repos'],
    forbiddenInResponse: []
  },

  // ── GENERAL FAQ (5 tests) ────────────────────────────────────
  {
    id: 'GF-01', category: 'GeneralFAQ', lang: 'en',
    query: "what is NHSM?",
    expectedCollections: ['GeneralFAQ'],
    expectedKeywordsInSources: ['faq', 'nhsm'],
    expectedKeywordsInResponse: ['nhsm', 'mathematics', 'school', 'algier'],
    forbiddenInResponse: []
  },
  {
    id: 'GF-02', category: 'GeneralFAQ', lang: 'fr',
    query: "c'est quoi l'NHSM?",
    expectedCollections: ['GeneralFAQ'],
    expectedKeywordsInSources: ['faq', 'nhsm'],
    expectedKeywordsInResponse: ['nhsm', 'mathématique', 'école', 'algérie'],
    forbiddenInResponse: []
  },
  {
    id: 'GF-03', category: 'GeneralFAQ', lang: 'en',
    query: "how do I apply to NHSM?",
    expectedCollections: ['GeneralFAQ'],
    expectedKeywordsInSources: ['admiss', 'faq'],
    expectedKeywordsInResponse: ['admiss', 'apply', 'nhsm'],
    forbiddenInResponse: []
  },
  {
    id: 'GF-04', category: 'GeneralFAQ', lang: 'fr',
    query: "comment changer de spécialité à NHSM?",
    expectedCollections: ['GeneralFAQ'],
    expectedKeywordsInSources: ['major', 'specialty', 'change'],
    expectedKeywordsInResponse: ['spécialité', 'changement', 'administration'],
    forbiddenInResponse: []
  },
  {
    id: 'GF-05', category: 'GeneralFAQ', lang: 'en',
    query: "does NHSM guarantee jobs after graduation?",
    expectedCollections: ['Specialty', 'GeneralFAQ'],
    expectedKeywordsInSources: ['employment', 'job', 'graduate'],
    expectedKeywordsInResponse: ['job', 'employment', 'guarantee'],
    forbiddenInResponse: []
  },

  // ── MATH TIPS (2 tests) ──────────────────────────────────────
  {
    id: 'MT-01', category: 'MathTip', lang: 'en',
    query: "how do I get better at solving math problems?",
    expectedCollections: ['MathTip', 'StudyTip'],
    expectedKeywordsInSources: ['math', 'problem'],
    expectedKeywordsInResponse: ['practice', 'problem', 'math', 'step'],
    forbiddenInResponse: []
  },
  {
    id: 'MT-02', category: 'MathTip', lang: 'fr',
    query: "comment comprendre les démonstrations mathématiques?",
    expectedCollections: ['MathTip'],
    expectedKeywordsInSources: ['math', 'proof', 'démonstrat'],
    expectedKeywordsInResponse: ['démonstration', 'mathématique', 'comprendre'],
    forbiddenInResponse: []
  },

  // ── STUDENT EXPERIENCE (2 tests) ────────────────────────────
  {
    id: 'SE-01', category: 'StudentExperience', lang: 'en',
    query: "what is student life like at NHSM?",
    expectedCollections: ['StudentExperience'],
    expectedKeywordsInSources: ['experience', 'student'],
    expectedKeywordsInResponse: ['student', 'nhsm', 'life', 'experience'],
    forbiddenInResponse: []
  },
  {
    id: 'SE-02', category: 'StudentExperience', lang: 'fr',
    query: "comment se passe la vie étudiante à l'NHSM?",
    expectedCollections: ['StudentExperience'],
    expectedKeywordsInSources: ['experience', 'student'],
    expectedKeywordsInResponse: ['nhsm', 'étudiant', 'vie'],
    forbiddenInResponse: []
  },

  // ── EDGE CASES / ROBUSTNESS (4 tests) ───────────────────────
  {
    id: 'EG-01', category: 'Edge', lang: 'any',
    query: "hi",
    expectedCollections: [],
    expectedKeywordsInSources: [],
    expectedKeywordsInResponse: [],
    forbiddenInResponse: [],
    minLength: 3, maxLength: 200,
    note: 'Simple greeting — short response expected'
  },
  {
    id: 'EG-02', category: 'Edge', lang: 'any',
    query: "what is the capital of France?",
    expectedCollections: [],
    expectedKeywordsInSources: [],
    expectedKeywordsInResponse: [],
    forbiddenInResponse: ['ccs', 'sesa', 'specialty'],
    note: 'Off-topic question — should not hallucinate school info'
  },
  {
    id: 'EG-03', category: 'Edge', lang: 'fr',
    query: "NHSM cest nul",
    expectedCollections: [],
    expectedKeywordsInSources: [],
    expectedKeywordsInResponse: [],
    forbiddenInResponse: [],
    note: 'Negative sentiment — should respond politely'
  },
  {
    id: 'EG-04', category: 'Edge', lang: 'any',
    query: "شكون هو أحسن أستاذ في المدرسة",
    expectedCollections: ['TeacherInfo', 'StudentExperience'],
    expectedKeywordsInSources: ['teacher', 'djemmada'],
    expectedKeywordsInResponse: [],
    note: 'Arabic MSA query about best teacher'
  },
];

// ─────────────────────────────────────────────────────────────
// Scoring Engine
// ─────────────────────────────────────────────────────────────
function scoreTest(tc, keywords, candidates, finalContext, answer) {
  const scores = {};
  const answerLower = (answer || '').toLowerCase();
  const sourcesStr  = JSON.stringify(finalContext.map(d =>
    `${d.id || ''} ${d.category || ''} ${d.question || ''} ${(d.tags || []).join(' ')}`
  )).toLowerCase();

  // 1. DB Retrieval (20 pts) — did ANY expected collection appear?
  if (tc.expectedCollections.length === 0) {
    scores.retrieval = 20; // Edge case — no expected collection
  } else {
    const found = tc.expectedCollections.some(col =>
      sourcesStr.includes(col.toLowerCase())
    );
    scores.retrieval = found ? 20 : 0;
  }

  // 2. Source Quality (20 pts) — expected keywords in sources?
  if (tc.expectedKeywordsInSources.length === 0) {
    scores.sourceQuality = 20;
  } else {
    const matchCount = tc.expectedKeywordsInSources.filter(kw =>
      sourcesStr.includes(kw.toLowerCase())
    ).length;
    scores.sourceQuality = Math.round(20 * matchCount / tc.expectedKeywordsInSources.length);
  }

  // 3. Language Match (15 pts)
  const expectedLang = tc.lang;
  if (expectedLang === 'any') {
    scores.langMatch = 15;
  } else {
    const detectedLang = detectLang(answer);
    scores.langMatch = (detectedLang === expectedLang || detectedLang === 'any') ? 15 : 0;
  }

  // 4. Completeness (15 pts)
  const minLen = tc.minLength || 30;
  const maxLen = tc.maxLength || 9999;
  const alen = answerLower.length;
  if (alen >= minLen && alen <= maxLen) {
    scores.completeness = 15;
  } else if (alen < minLen) {
    scores.completeness = Math.round(15 * alen / minLen);
  } else {
    scores.completeness = 10; // Too long but not penalized heavily
  }

  // 5. Anti-Hallucination (15 pts)
  const hallucinationPhrases = [
    "i'm sorry, i encountered a technical problem",
    "i cannot provide",
    ...( tc.forbiddenInResponse || [])
  ];
  const hasHallucination = hallucinationPhrases.some(phrase =>
    answerLower.includes(phrase.toLowerCase())
  );
  scores.antiHallucination = hasHallucination ? 0 : 15;

  // 6. Relevance (15 pts) — expected keywords in response
  if (tc.expectedKeywordsInResponse.length === 0) {
    scores.relevance = 15;
  } else {
    const matchCount = tc.expectedKeywordsInResponse.filter(kw =>
      answerLower.includes(kw.toLowerCase())
    ).length;
    scores.relevance = Math.round(15 * matchCount / tc.expectedKeywordsInResponse.length);
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  return { scores, total, maxTotal: 100 };
}

// ─────────────────────────────────────────────────────────────
// Run one test
// ─────────────────────────────────────────────────────────────
async function runTest(tc) {
  const result = { id: tc.id, category: tc.category, query: tc.query, error: null };

  try {
    // 1. Keyword extraction
    const kwStr  = await aiService.rewriteQueryForSearch(tc.query);
    const keywords = kwStr.split(',').map(k => k.trim()).filter(Boolean);

    // 2. DB retrieval
    const candidates = await kbService.findRelevantInfoWithKeywords(keywords);

    // 3. Context (negative-answer filter)
    const finalContext = candidates
      .filter(doc => {
        const ans = (doc.answer || '').toLowerCase();
        return !ans.startsWith('currently no available') && !ans.startsWith('no information');
      })
      .slice(0, 5);

    // 4. AI response
    const answer = await aiService.generateResponse(tc.query, finalContext);

    // 5. Score
    const { scores, total } = scoreTest(tc, keywords, candidates, finalContext, answer);

    result.keywords    = keywords;
    result.candidates  = candidates.length;
    result.context     = finalContext.length;
    result.sourceIds   = finalContext.map(d => d.id || d.category || '?');
    result.answer      = answer;
    result.answerLang  = detectLang(answer);
    result.scores      = scores;
    result.total       = total;
    result.grade       = total >= 85 ? 'A' : total >= 70 ? 'B' : total >= 50 ? 'C' : 'F';
  } catch (err) {
    result.error  = err.message;
    result.total  = 0;
    result.grade  = 'F';
    result.scores = {};
  }

  return result;
}

// ─────────────────────────────────────────────────────────────
// Print one test result
// ─────────────────────────────────────────────────────────────
function printResult(r) {
  const gradeColor = r.grade === 'A' ? C.green : r.grade === 'B' ? C.cyan :
                     r.grade === 'C' ? C.yellow : C.red;
  console.log(`\n${C.bold}[${r.id}] ${r.category}${C.reset}  ${gradeColor}${C.bold}${r.grade} (${r.total}/100)${C.reset}`);
  console.log(`  ${C.dim}Query  : "${r.query.substring(0, 70)}"${C.reset}`);
  if (r.error) {
    console.log(`  ${C.red}ERROR  : ${r.error}${C.reset}`);
    return;
  }
  console.log(`  ${C.dim}KWs    : ${(r.keywords || []).slice(0, 5).join(', ')}${C.reset}`);
  console.log(`  ${C.dim}Sources: ${(r.sourceIds || []).join(', ')}${C.reset}`);
  console.log(`  ${C.dim}Answer : "${(r.answer || '').substring(0, 100)}..."${C.reset}`);
  const s = r.scores;
  console.log(`  ${bar(r.total)} ` +
    `Ret:${s.retrieval}/20 Src:${s.sourceQuality}/20 Lang:${s.langMatch}/15 ` +
    `Cmpl:${s.completeness}/15 AntiH:${s.antiHallucination}/15 Rel:${s.relevance}/15`
  );
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}${C.cyan}╔═══════════════════════════════════════════════════════╗`);
  console.log(`║   NHSM Chatbot — Comprehensive Evaluation Suite       ║`);
  console.log(`║   ${TEST_CASES.length} tests | 6 metrics | Scored 0-100 per test        ║`);
  console.log(`╚═══════════════════════════════════════════════════════╝${C.reset}\n`);

  await mongoose.connect(config.mongoURI);
  console.log(`${C.green}✅ MongoDB connected.${C.reset}\n`);

  const results = [];
  const categoryScores = {};

  for (const tc of TEST_CASES) {
    process.stdout.write(`  Running ${C.bold}${tc.id}${C.reset} ${tc.query.substring(0,40)}... `);
    const r = await runTest(tc);
    results.push(r);
    const gradeColor = r.grade === 'A' ? C.green : r.grade === 'B' ? C.cyan :
                       r.grade === 'C' ? C.yellow : C.red;
    console.log(`${gradeColor}${r.grade} (${r.total}/100)${C.reset}`);

    // Accumulate per-category
    if (!categoryScores[r.category]) categoryScores[r.category] = [];
    categoryScores[r.category].push(r.total);
  }

  await mongoose.disconnect();

  // ── Detailed results
  console.log(`\n${C.bold}${C.cyan}═══ DETAILED RESULTS ═══${C.reset}`);
  results.forEach(printResult);

  // ── Category breakdown
  console.log(`\n${C.bold}${C.cyan}═══ CATEGORY BREAKDOWN ═══${C.reset}`);
  for (const [cat, scores] of Object.entries(categoryScores)) {
    const avg = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const gradeColor = avg >= 85 ? C.green : avg >= 70 ? C.cyan : avg >= 50 ? C.yellow : C.red;
    console.log(`  ${C.bold}${cat.padEnd(18)}${C.reset} ${bar(avg)} ${gradeColor}${avg}/100${C.reset} (${scores.length} tests)`);
  }

  // ── Metric breakdown
  console.log(`\n${C.bold}${C.cyan}═══ METRIC AVERAGES ═══${C.reset}`);
  const metricKeys = ['retrieval','sourceQuality','langMatch','completeness','antiHallucination','relevance'];
  const metricMax  = [20, 20, 15, 15, 15, 15];
  const metricNames = ['DB Retrieval   ','Source Quality ','Language Match ','Completeness   ','Anti-Hallucin. ','Relevance      '];
  metricKeys.forEach((key, i) => {
    const vals = results.filter(r => r.scores && r.scores[key] !== undefined).map(r => r.scores[key]);
    const avg  = vals.length ? vals.reduce((a,b) => a+b,0) / vals.length : 0;
    const pct  = Math.round(avg / metricMax[i] * 100);
    const gradeColor = pct >= 85 ? C.green : pct >= 70 ? C.cyan : pct >= 50 ? C.yellow : C.red;
    console.log(`  ${metricNames[i]} ${bar(pct, 15)} ${gradeColor}${avg.toFixed(1)}/${metricMax[i]}${C.reset} (${pct}%)`);
  });

  // ── Overall summary
  const totalScore   = results.reduce((a, r) => a + r.total, 0);
  const avgScore     = Math.round(totalScore / results.length);
  const grades       = { A: 0, B: 0, C: 0, F: 0 };
  results.forEach(r => grades[r.grade]++);
  const overallGradeColor = avgScore >= 85 ? C.green : avgScore >= 70 ? C.cyan : avgScore >= 50 ? C.yellow : C.red;

  console.log(`\n${C.bold}${C.cyan}╔═══════════════════════════════════════════════════════╗`);
  console.log(`║   OVERALL EVALUATION SUMMARY                          ║`);
  console.log(`╚═══════════════════════════════════════════════════════╝${C.reset}`);
  console.log(`  Total tests : ${results.length}`);
  console.log(`  Avg score   : ${overallGradeColor}${C.bold}${avgScore}/100${C.reset}  ${bar(avgScore)}`);
  console.log(`  ${C.green}A (≥85)${C.reset}: ${grades.A}  ${C.cyan}B (≥70)${C.reset}: ${grades.B}  ${C.yellow}C (≥50)${C.reset}: ${grades.C}  ${C.red}F (<50)${C.reset}: ${grades.F}`);
  console.log(`\n  Failed tests:`);
  results.filter(r => r.grade === 'F').forEach(r =>
    console.log(`    ${C.red}✗ [${r.id}]${C.reset} ${r.query.substring(0,50)} → ${r.error || `${r.total}/100`}`)
  );

  const verdict = avgScore >= 85 ? `${C.green}🏆 EXCELLENT — Le modèle fonctionne très bien !` :
                  avgScore >= 70 ? `${C.cyan}✅ BON — Quelques améliorations possibles` :
                  avgScore >= 50 ? `${C.yellow}⚠️  PASSABLE — Des problèmes importants à corriger` :
                                   `${C.red}❌ INSUFFISANT — Le modèle nécessite une révision`;
  console.log(`\n  Verdict: ${verdict}${C.reset}\n`);

  process.exit(grades.F > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
