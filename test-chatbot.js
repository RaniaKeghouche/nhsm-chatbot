/**
 * NHSM Chatbot - Automated Test Suite
 * Tests the full pipeline: keyword extraction → DB retrieval → AI response
 * Run: node test-chatbot.js
 */

const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

const mongoose = require('c:/Users/kegho/Desktop/web/NHSM/node_modules/mongoose');
const config   = require('c:/Users/kegho/Desktop/web/NHSM/src/config/config');
const aiService = require('c:/Users/kegho/Desktop/web/NHSM/src/services/aiService');
const kbService = require('c:/Users/kegho/Desktop/web/NHSM/src/services/knowledgeBaseService');

// ──────────────────────────────────────────────
// Test cases: one per DB collection + edge cases
// ──────────────────────────────────────────────
const TEST_CASES = [
  // Specialty collection
  { id: 'specialty-1', query: 'quelles sont les spécialités disponibles à NHSM?', mustContainInSources: ['specialty','Specialty'], lang: 'fr' },
  { id: 'specialty-2', query: 'what is the CCS specialty?', mustContainInSources: ['CCS'], lang: 'en' },
  { id: 'specialty-3', query: 'explique moi la spécialité SESA', mustContainInSources: ['SESA'], lang: 'fr' },
  { id: 'specialty-4', query: 'what are the job prospects for MS graduates?', mustContainInSources: ['MS','ms_jobs'], lang: 'en' },

  // TeacherInfo collection
  { id: 'teacher-1', query: 'who are the professors at NHSM?', mustContainInSources: ['teacher','Teacher','professor'], lang: 'en' },
  { id: 'teacher-2', query: 'qui est le meilleur professeur à NHSM?', mustContainInSources: ['teacher','Teacher'], lang: 'fr' },

  // StudyTip collection
  { id: 'study-1', query: 'comment bien étudier les mathématiques?', mustContainInSources: ['study','Study','StudyTip'], lang: 'fr' },
  { id: 'study-2', query: 'give me tips to improve my study habits', mustContainInSources: ['study','Study'], lang: 'en' },

  // Resource collection
  { id: 'resource-1', query: 'i need online resources to study math', mustContainInSources: ['resource','Resource'], lang: 'en' },

  // Wellness collection
  { id: 'wellness-1', query: 'how to manage stress during exams?', mustContainInSources: ['wellness','Wellness'], lang: 'en' },

  // GeneralFAQ collection
  { id: 'faq-1', query: 'what is NHSM?', mustContainInSources: ['FAQ','faq','General'], lang: 'en' },
  { id: 'faq-2', query: "c'est quoi l'NHSM?", mustContainInSources: ['FAQ','faq','General'], lang: 'fr' },

  // Algerian Derdja (bonus)
  { id: 'derdja-1', query: 'وش هوما تخصصات لي كاينين ف ليكول', mustContainInSources: ['specialty','Specialty','SESA','CCS','MS'], lang: 'ar' },

  // Edge cases
  { id: 'edge-greeting', query: 'hi', mustContainInSources: [], lang: 'any', expectContext: false, minLength: 3 },
  { id: 'edge-unknown', query: 'what is the recipe for chocolate cake?', mustContainInSources: [], lang: 'any', expectContext: false },
];

// ──────────────────────────────────────────────
// Colours for terminal output
// ──────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';

function pass(msg) { console.log(`  ${GREEN}✅ PASS${RESET}  ${msg}`); }
function fail(msg) { console.log(`  ${RED}❌ FAIL${RESET}  ${msg}`); }
function warn(msg) { console.log(`  ${YELLOW}⚠️  WARN${RESET}  ${msg}`); }
function info(msg) { console.log(`  ${CYAN}ℹ️  INFO${RESET}  ${msg}`); }

// ──────────────────────────────────────────────
// Run a single test
// ──────────────────────────────────────────────
async function runTest(tc) {
  console.log(`\n${BOLD}[${tc.id}]${RESET} Query: "${tc.query}"`);

  // 1. Keyword extraction
  let keywords = [];
  try {
    const kwStr = await aiService.rewriteQueryForSearch(tc.query);
    keywords = kwStr.split(',').map(k => k.trim()).filter(Boolean);
    info(`Keywords: ${JSON.stringify(keywords)}`);
  } catch (e) {
    fail(`Keyword extraction failed: ${e.message}`);
    return { id: tc.id, result: 'FAIL', reason: 'keyword extraction error' };
  }

  // 2. DB retrieval
  let candidates = [];
  try {
    candidates = await kbService.findRelevantInfoWithKeywords(keywords);
    info(`DB returned ${candidates.length} candidates`);
  } catch (e) {
    fail(`DB retrieval failed: ${e.message}`);
    return { id: tc.id, result: 'FAIL', reason: 'DB retrieval error' };
  }

  // 3. Context filter (negative answer filter)
  const finalContext = candidates
    .filter(doc => {
      const ans = (doc.answer || '').toLowerCase();
      return !ans.startsWith('currently no available') && !ans.startsWith('no information');
    })
    .slice(0, 5);

  info(`Context items: ${finalContext.length}`);

  // 4. Check context expectation
  const expectCtx = tc.expectContext !== false; // default true
  if (expectCtx && finalContext.length === 0) {
    fail(`Expected context but none found`);
    return { id: tc.id, result: 'FAIL', reason: 'no context found' };
  }
  if (!expectCtx && finalContext.length === 0) {
    pass(`Correctly returned no context for off-topic query`);
  }

  // 5. Check that relevant sources appear
  if (tc.mustContainInSources && tc.mustContainInSources.length > 0) {
    const sourceStr = JSON.stringify(finalContext.map(d => `${d.id} ${d.category} ${d.question}`)).toLowerCase();
    const found = tc.mustContainInSources.some(kw => sourceStr.includes(kw.toLowerCase()));
    if (found) {
      pass(`Relevant source found (one of: ${tc.mustContainInSources})`);
    } else {
      fail(`None of the expected sources found: ${tc.mustContainInSources}`);
      info(`Actual source IDs: ${finalContext.map(d => d.id).join(', ')}`);
      return { id: tc.id, result: 'FAIL', reason: `missing expected sources: ${tc.mustContainInSources}` };
    }
  }

  // 6. Generate AI response
  let answer = '';
  try {
    answer = await aiService.generateResponse(tc.query, finalContext);
    info(`Response (first 200 chars): "${answer.substring(0, 200)}..."`);
  } catch (e) {
    fail(`AI response failed: ${e.message}`);
    return { id: tc.id, result: 'FAIL', reason: 'AI response error' };
  }

  // 7. Basic quality checks
  if (!answer || answer.length < (tc.minLength || 20)) {
    fail(`Response too short or empty (${answer.length} chars, min ${tc.minLength || 20})`);
    return { id: tc.id, result: 'FAIL', reason: 'response too short' };
  }
  if (answer.toLowerCase().includes("i'm sorry, i encountered a technical problem")) {
    fail(`Response is the fallback error message`);
    return { id: tc.id, result: 'FAIL', reason: 'fallback error message' };
  }

  pass(`Response generated successfully (${answer.length} chars)`);
  return { id: tc.id, result: 'PASS' };
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
async function main() {
  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${CYAN}   NHSM Chatbot — Automated Test Suite${RESET}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);

  console.log('\nConnecting to MongoDB...');
  await mongoose.connect(config.mongoURI);
  console.log('✅ Connected.\n');

  const results = [];
  for (const tc of TEST_CASES) {
    const r = await runTest(tc);
    results.push(r);
  }

  await mongoose.disconnect();

  // Summary
  const passed = results.filter(r => r.result === 'PASS').length;
  const failed = results.filter(r => r.result === 'FAIL').length;

  console.log(`\n${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}   TEST RESULTS SUMMARY${RESET}`);
  console.log(`${BOLD}${CYAN}═══════════════════════════════════════════════════${RESET}`);
  console.log(`  Total : ${results.length}`);
  console.log(`  ${GREEN}Passed : ${passed}${RESET}`);
  console.log(`  ${RED}Failed : ${failed}${RESET}`);
  console.log(`\nFailed tests:`);
  results.filter(r => r.result === 'FAIL').forEach(r => {
    console.log(`  ${RED}✗ [${r.id}]${RESET} → ${r.reason}`);
  });
  console.log(`\n${passed === results.length ? GREEN + '🎉 ALL TESTS PASSED!' : RED + '⚠️  SOME TESTS FAILED'}${RESET}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
