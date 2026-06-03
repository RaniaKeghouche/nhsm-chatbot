/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  NHSM Chatbot — LLM-as-Judge Deep Evaluation Suite          ║
 * ║  60 tests | Groq judges every response | HTML report         ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Scoring: Groq evaluates each response on 5 dimensions (1–5 each = 25 max)
 *   • Factual Accuracy   — Did it use DB info correctly?
 *   • Completeness       — Did it cover all key points?
 *   • Language Match     — Did it reply in the right language?
 *   • Quality            — Is it structured and clear like ChatGPT?
 *   • Tone               — Is it helpful, friendly, professional?
 *
 * Run: node scripts/deep-eval.js
 * Output: scripts/eval-report.html  (open in browser)
 */

const dns = require('dns'); dns.setServers(['8.8.8.8', '8.8.4.4']);
const fs       = require('fs');
const path     = require('path');
const mongoose = require('c:/Users/kegho/Desktop/web/NHSM/node_modules/mongoose');
const Groq     = require('c:/Users/kegho/Desktop/web/NHSM/node_modules/groq-sdk');
const config   = require('c:/Users/kegho/Desktop/web/NHSM/src/config/config');
const aiService = require('c:/Users/kegho/Desktop/web/NHSM/src/services/aiService');
const kbService = require('c:/Users/kegho/Desktop/web/NHSM/src/services/knowledgeBaseService');

const groq = new Groq({ apiKey: config.groqApiKey });

// ─────────────────────────────────────────────────────────────
// 60 TEST CASES — based on real DB content
// ─────────────────────────────────────────────────────────────
const TESTS = [
// ══════════════════════════════════════════════════════
// SPECIALTY (12 tests)
// ══════════════════════════════════════════════════════
{id:'SP-01',cat:'Specialty',lang:'fr',
 query:"quelles sont toutes les spécialités disponibles à l'NHSM?",
 goldPoints:["SESA","CCS","MS","spécialité"]},
{id:'SP-02',cat:'Specialty',lang:'en',
 query:"What exactly is the CCS specialty and what does it cover?",
 goldPoints:["Cryptography","Coding","Security","mathematics"]},
{id:'SP-03',cat:'Specialty',lang:'fr',
 query:"Explique moi la spécialité SESA en détail",
 goldPoints:["statistique","actuarielle","économétrie","SESA"]},
{id:'SP-04',cat:'Specialty',lang:'en',
 query:"Tell me everything about the MS specialty",
 goldPoints:["modeling","simulation","MS","differential"]},
{id:'SP-05',cat:'Specialty',lang:'en',
 query:"What jobs can I get after graduating from CCS?",
 goldPoints:["security","cryptography","career","job"]},
{id:'SP-06',cat:'Specialty',lang:'fr',
 query:"Quels sont les débouchés professionnels de la spécialité SESA?",
 goldPoints:["emploi","statistique","actuariat","finance"]},
{id:'SP-07',cat:'Specialty',lang:'en',
 query:"What skills will I develop in the MS specialty?",
 goldPoints:["modeling","simulation","skills","mathematics"]},
{id:'SP-08',cat:'Specialty',lang:'fr',
 query:"À quel moment choisit-on sa spécialité à l'NHSM?",
 goldPoints:["année","spécialité","troisième","choix"]},
{id:'SP-09',cat:'Specialty',lang:'ar',
 query:"وش هوما تخصصات لي كاينين ف ليكول",
 goldPoints:["CCS","SESA","MS"]},
{id:'SP-10',cat:'Specialty',lang:'fr',
 query:"Quelle spécialité est la meilleure à NHSM pour trouver du travail rapidement?",
 goldPoints:["spécialité","travail","emploi"]},
{id:'SP-11',cat:'Specialty',lang:'en',
 query:"Is there an IMM or Astrophysics specialty at NHSM?",
 goldPoints:["information","available","specialty"]},
{id:'SP-12',cat:'Specialty',lang:'fr',
 query:"Combien y a-t-il de spécialités à l'NHSM?",
 goldPoints:["trois","3","spécialité","SESA","CCS","MS"]},

// ══════════════════════════════════════════════════════
// TEACHERS (8 tests)
// ══════════════════════════════════════════════════════
{id:'TC-01',cat:'TeacherInfo',lang:'en',
 query:"Who is Professor Djemmada at NHSM?",
 goldPoints:["Djemmada","mathematics","professor","NHSM"]},
{id:'TC-02',cat:'TeacherInfo',lang:'fr',
 query:"Qui est le professeur Farhi et quelle est sa spécialité?",
 goldPoints:["Farhi","mathématique","professeur","NHSM"]},
{id:'TC-03',cat:'TeacherInfo',lang:'en',
 query:"Tell me about Professor Fatima Goura",
 goldPoints:["Goura","professor","NHSM","mathematics"]},
{id:'TC-04',cat:'TeacherInfo',lang:'fr',
 query:"Qui est le meilleur professeur à l'NHSM selon les étudiants?",
 goldPoints:["Djemmada","professeur","NHSM"]},
{id:'TC-05',cat:'TeacherInfo',lang:'en',
 query:"How should I communicate with my professors at NHSM?",
 goldPoints:["office hours","email","professor","communication"]},
{id:'TC-06',cat:'TeacherInfo',lang:'fr',
 query:"Comment parler à mes professeurs à l'NHSM?",
 goldPoints:["email","professeur","respect","communication"]},
{id:'TC-07',cat:'TeacherInfo',lang:'ar',
 query:"شكون هو أحسن أستاذ في المدرسة؟",
 goldPoints:["Djemmada","أستاذ"]},
{id:'TC-08',cat:'TeacherInfo',lang:'en',
 query:"List the professors who teach cryptography at NHSM",
 goldPoints:["cryptography","professor","NHSM"]},

// ══════════════════════════════════════════════════════
// STUDY TIPS (8 tests)
// ══════════════════════════════════════════════════════
{id:'ST-01',cat:'StudyTip',lang:'fr',
 query:"Comment créer un bon planning d'étude?",
 goldPoints:["planning","étude","organis","horaire"]},
{id:'ST-02',cat:'StudyTip',lang:'en',
 query:"What is the Pomodoro technique and how do I use it?",
 goldPoints:["pomodoro","25","break","focus","minute"]},
{id:'ST-03',cat:'StudyTip',lang:'en',
 query:"How does active recall work for studying?",
 goldPoints:["active recall","memory","quiz","test yourself"]},
{id:'ST-04',cat:'StudyTip',lang:'fr',
 query:"Qu'est-ce que le spaced repetition?",
 goldPoints:["répétition","espacée","mémoire","intervalle"]},
{id:'ST-05',cat:'StudyTip',lang:'en',
 query:"How should I take notes effectively?",
 goldPoints:["notes","method","organize","key points"]},
{id:'ST-06',cat:'StudyTip',lang:'fr',
 query:"Comment améliorer ma concentration quand j'étudie?",
 goldPoints:["concentration","distraction","focus","étude"]},
{id:'ST-07',cat:'StudyTip',lang:'en',
 query:"What is the best study environment?",
 goldPoints:["environment","quiet","distraction","study"]},
{id:'ST-08',cat:'StudyTip',lang:'fr',
 query:"Comment éviter la procrastination?",
 goldPoints:["procrastination","commencer","délai","motivation"]},

// ══════════════════════════════════════════════════════
// RESOURCES (5 tests)
// ══════════════════════════════════════════════════════
{id:'RS-01',cat:'Resource',lang:'en',
 query:"What online platforms can I use to study math at NHSM level?",
 goldPoints:["Khan Academy","platform","mathematics","online"]},
{id:'RS-02',cat:'Resource',lang:'fr',
 query:"Quelles chaînes YouTube recommandez-vous pour les maths?",
 goldPoints:["YouTube","chaîne","mathématique","vidéo"]},
{id:'RS-03',cat:'Resource',lang:'en',
 query:"Is there a Telegram group for NHSM students with books?",
 goldPoints:["Telegram","books","NHSM","resources"]},
{id:'RS-04',cat:'Resource',lang:'fr',
 query:"Comment trouver des exercices corrigés en mathématiques?",
 goldPoints:["exercices","corrigés","mathématique","ressource"]},
{id:'RS-05',cat:'Resource',lang:'en',
 query:"Recommend me a resource for learning linear algebra",
 goldPoints:["linear algebra","resource","mathematics","learning"]},

// ══════════════════════════════════════════════════════
// WELLNESS (7 tests)
// ══════════════════════════════════════════════════════
{id:'WL-01',cat:'Wellness',lang:'en',
 query:"What are the signs that I'm not getting enough sleep?",
 goldPoints:["fatigue","focus","memory","sleep deprivation","signs"]},
{id:'WL-02',cat:'Wellness',lang:'fr',
 query:"Comment améliorer la qualité de mon sommeil?",
 goldPoints:["sommeil","qualité","habitude","routine"]},
{id:'WL-03',cat:'Wellness',lang:'en',
 query:"Should I nap during the day as a student?",
 goldPoints:["nap","minutes","alertness","sleep"]},
{id:'WL-04',cat:'Wellness',lang:'fr',
 query:"L'exercice aide-t-il à mieux dormir?",
 goldPoints:["exercice","sommeil","stress","bien-être"]},
{id:'WL-05',cat:'Wellness',lang:'en',
 query:"How to manage stress and anxiety during exams?",
 goldPoints:["stress","anxiety","exam","breathing","sleep"]},
{id:'WL-06',cat:'Wellness',lang:'fr',
 query:"Comment éviter le burn-out en tant qu'étudiant à l'NHSM?",
 goldPoints:["burn-out","pause","repos","surmenage"]},
{id:'WL-07',cat:'Wellness',lang:'en',
 query:"Does eating late at night affect my studies?",
 goldPoints:["eating","sleep","digestion","bedtime"]},

// ══════════════════════════════════════════════════════
// GENERAL FAQ (7 tests)
// ══════════════════════════════════════════════════════
{id:'GF-01',cat:'GeneralFAQ',lang:'en',
 query:"What is NHSM and what makes it different from other schools?",
 goldPoints:["NHSM","mathematics","engineering","Algeria","specialized"]},
{id:'GF-02',cat:'GeneralFAQ',lang:'fr',
 query:"Comment s'inscrire à l'NHSM?",
 goldPoints:["inscription","NHSM","dossier","admission"]},
{id:'GF-03',cat:'GeneralFAQ',lang:'en',
 query:"What happens if a course I want is full? How do waitlists work?",
 goldPoints:["waitlist","course","full","enrollment","registration"]},
{id:'GF-04',cat:'GeneralFAQ',lang:'fr',
 query:"Comment planifier mes cours pour les prochains semestres?",
 goldPoints:["cours","planification","semestre","cursus","prérequis"]},
{id:'GF-05',cat:'GeneralFAQ',lang:'en',
 query:"What is orientation week like at NHSM?",
 goldPoints:["orientation","new students","campus","academic","social"]},
{id:'GF-06',cat:'GeneralFAQ',lang:'fr',
 query:"Est-ce que l'NHSM garantit un emploi après la diplomation?",
 goldPoints:["emploi","garantie","diplôme","carrière"]},
{id:'GF-07',cat:'GeneralFAQ',lang:'en',
 query:"How do I change my specialty at NHSM?",
 goldPoints:["specialty","change","administration","major"]},

// ══════════════════════════════════════════════════════
// STUDENT EXPERIENCE (6 tests)
// ══════════════════════════════════════════════════════
{id:'SE-01',cat:'StudentExperience',lang:'en',
 query:"What is student life like at NHSM?",
 goldPoints:["difficult","pressure","experience","NHSM","challenges"]},
{id:'SE-02',cat:'StudentExperience',lang:'fr',
 query:"Comment se passe la vie étudiante à l'NHSM?",
 goldPoints:["difficile","pression","expérience","NHSM"]},
{id:'SE-03',cat:'StudentExperience',lang:'en',
 query:"What advice do NHSM students give to newcomers?",
 goldPoints:["advice","attend","classes","patience","trust"]},
{id:'SE-04',cat:'StudentExperience',lang:'fr',
 query:"Est-ce que l'NHSM est difficile? Comment les étudiants le vivent?",
 goldPoints:["difficile","pression","matières","résilience"]},
{id:'SE-05',cat:'StudentExperience',lang:'en',
 query:"What happens if you repeat a year at NHSM?",
 goldPoints:["repeat","year","resilience","NHSM","challenging"]},
{id:'SE-06',cat:'StudentExperience',lang:'en',
 query:"How does studying at NHSM affect your personal development?",
 goldPoints:["patience","logical thinking","limits","perspective","NHSM"]},

// ══════════════════════════════════════════════════════
// HUMOR / CULTURE (2 tests)
// ══════════════════════════════════════════════════════
{id:'HM-01',cat:'Humor',lang:'fr',
 query:"C'est quoi le fameux 'ARD' et 'الحفلة' dans la culture NHSM?",
 goldPoints:["ARD","حفلة","joke","inside","étudiant"]},
{id:'HM-02',cat:'Humor',lang:'fr',
 query:"T'as des blagues sur la vie étudiante à l'NHSM?",
 goldPoints:["Algeria Post","bourse","étudiant","joke"]},

// ══════════════════════════════════════════════════════
// EDGE CASES / ROBUSTNESS (5 tests)
// ══════════════════════════════════════════════════════
{id:'EG-01',cat:'Edge',lang:'any',
 query:"hi",
 goldPoints:["hello","bonjour"],
 isEdge:true},
{id:'EG-02',cat:'Edge',lang:'any',
 query:"what is the capital of Japan?",
 goldPoints:["Tokyo","capital"],
 isEdge:true,
 forbiddenWords:["NHSM","specialty","spécialité"]},
{id:'EG-03',cat:'Edge',lang:'fr',
 query:"L'NHSM c'est nul, tu peux pas m'aider",
 goldPoints:["comprends","aide","NHSM"],
 isEdge:true},
{id:'EG-04',cat:'Edge',lang:'fr',
 query:"كيفاش نذاكر باش نجح في ليكول؟",
 goldPoints:["étudier","cours","méthode","spécialité"],
 isEdge:false},
{id:'EG-05',cat:'Edge',lang:'any',
 query:"zzzzzz aaaaaa random gibberish 12345",
 goldPoints:[],
 isEdge:true},
];

// ─────────────────────────────────────────────────────────────
// LLM-AS-JUDGE: asks Groq to score the chatbot's response
// ─────────────────────────────────────────────────────────────
async function judgeResponse(query, response, goldPoints, isEdge = false, attempt = 0) {
  const judgePrompt = `You are an expert AI evaluator. A specialized chatbot for NHSM (National Higher School of Mathematics in Algeria) gave the following response. Evaluate it strictly.

USER QUESTION: "${query}"
CHATBOT RESPONSE: "${response.substring(0, 1200)}"
KEY POINTS EXPECTED IN THE ANSWER: ${JSON.stringify(goldPoints)}
IS THIS AN EDGE CASE (greeting/off-topic): ${isEdge}

Score each dimension from 1 to 5:
1. factual_accuracy: Are the facts in the response correct and grounded? (Not invented, consistent with NHSM context)
   - 5: Perfectly accurate, all facts verifiable
   - 3: Mostly correct, minor issues
   - 1: Wrong or hallucinated facts

2. completeness: Does it cover the key expected points?
   - 5: Covers all key points thoroughly
   - 3: Covers some key points
   - 1: Misses most key points

3. language_match: Is the response in the SAME language as the user's question?
   - 5: Perfect match (FR→FR, EN→EN, Arabic/Derdja→Arabic)
   - 1: Wrong language

4. response_quality: Is it well-structured, clear, comprehensive like ChatGPT?
   - 5: Excellent structure, markdown formatting, very clear
   - 3: Decent structure
   - 1: Unstructured, confusing, too short

5. tone_helpfulness: Is it helpful, friendly, professional, not dismissive?
   - 5: Excellent tone, warm but professional
   - 3: Acceptable tone
   - 1: Dismissive, cold, or unhelpful

Output ONLY this JSON (no explanation outside JSON):
{"factual_accuracy":N,"completeness":N,"language_match":N,"response_quality":N,"tone_helpfulness":N,"comment":"one sentence critique"}`;

  try {
    const result = await groq.chat.completions.create({
      messages: [{ role: 'user', content: judgePrompt }],
      model: 'llama-3.1-8b-instant',
      temperature: 0.0,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(result.choices[0].message.content);
    const total = (parsed.factual_accuracy||0) + (parsed.completeness||0) +
                  (parsed.language_match||0) + (parsed.response_quality||0) +
                  (parsed.tone_helpfulness||0);
    return { ...parsed, total, maxTotal: 25 };
  } catch(e) {
    // Retry on rate limit (429) with exponential backoff
    if ((e.status === 429 || e.message?.includes('429')) && attempt < 4) {
      const wait = (attempt + 1) * 8000;
      process.stdout.write(` [rate-limit, retry in ${wait/1000}s]`);
      await new Promise(r => setTimeout(r, wait));
      return judgeResponse(query, response, goldPoints, isEdge, attempt + 1);
    }
    return { factual_accuracy:0, completeness:0, language_match:0,
             response_quality:0, tone_helpfulness:0, total:0, maxTotal:25,
             comment:`Judge error: ${e.message?.substring(0,80)}` };
  }
}


// ─────────────────────────────────────────────────────────────
// Run one test
// ─────────────────────────────────────────────────────────────
async function runTest(tc) {
  const t = { ...tc, response:'', scores:null, error:null, timeMs:0 };
  const start = Date.now();
  try {
    const kwStr    = await aiService.rewriteQueryForSearch(tc.query);
    const keywords = kwStr.split(',').map(k => k.trim()).filter(Boolean);
    const candidates = await kbService.findRelevantInfoWithKeywords(keywords);
    const context = candidates
      .filter(d => {
        const a = (d.answer||'').toLowerCase();
        return !a.startsWith('currently no available') && !a.startsWith('no information');
      })
      .slice(0, 5);
    t.response   = await aiService.generateResponse(tc.query, context);
    t.sourcesUsed = context.length;
    t.sourceIds   = context.map(d => d.id || '?');
    t.scores      = await judgeResponse(tc.query, t.response, tc.goldPoints, tc.isEdge);
  } catch(e) {
    t.error  = e.message;
    t.scores = { factual_accuracy:0, completeness:0, language_match:0,
                 response_quality:0, tone_helpfulness:0, total:0, maxTotal:25,
                 comment:'Runtime error' };
  }
  t.timeMs = Date.now() - start;
  return t;
}

// ─────────────────────────────────────────────────────────────
// Build HTML report
// ─────────────────────────────────────────────────────────────
function buildHtmlReport(results) {
  const avg = arr => arr.length ? (arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(1) : 0;
  const overallAvgPct = Math.round(results.reduce((a,r)=>a+(r.scores.total/25*100),0)/results.length);
  const cats = [...new Set(results.map(r=>r.cat))];

  const catRows = cats.map(cat => {
    const rs = results.filter(r=>r.cat===cat);
    const avgScore = Math.round(rs.reduce((a,r)=>a+(r.scores.total/25*100),0)/rs.length);
    const color = avgScore>=90?'#22c55e':avgScore>=75?'#3b82f6':avgScore>=60?'#f59e0b':'#ef4444';
    return `<tr>
      <td><b>${cat}</b></td>
      <td>${rs.length}</td>
      <td style="color:${color};font-weight:bold">${avgScore}%</td>
      <td>${avg(rs.map(r=>r.scores.factual_accuracy))}/5</td>
      <td>${avg(rs.map(r=>r.scores.completeness))}/5</td>
      <td>${avg(rs.map(r=>r.scores.language_match))}/5</td>
      <td>${avg(rs.map(r=>r.scores.response_quality))}/5</td>
      <td>${avg(rs.map(r=>r.scores.tone_helpfulness))}/5</td>
    </tr>`;
  }).join('');

  const testRows = results.map(r => {
    const pct = Math.round(r.scores.total/25*100);
    const color = pct>=90?'#22c55e':pct>=75?'#3b82f6':pct>=60?'#f59e0b':'#ef4444';
    const badge = pct>=90?'A':pct>=75?'B':pct>=60?'C':'F';
    return `<tr>
      <td><code>${r.id}</code></td>
      <td>${r.cat}</td>
      <td>${r.lang}</td>
      <td class="query-cell">${r.query.replace(/</g,'&lt;')}</td>
      <td style="color:${color};font-weight:bold">${badge} ${pct}%</td>
      <td>${r.scores.factual_accuracy}</td>
      <td>${r.scores.completeness}</td>
      <td>${r.scores.language_match}</td>
      <td>${r.scores.response_quality}</td>
      <td>${r.scores.tone_helpfulness}</td>
      <td class="comment-cell">${(r.scores.comment||'').replace(/</g,'&lt;')}</td>
      <td class="response-cell">${(r.response||r.error||'').substring(0,300).replace(/</g,'&lt;')}...</td>
      <td>${r.timeMs}ms</td>
    </tr>`;
  }).join('');

  const metricsAvg = {
    factual: avg(results.map(r=>r.scores.factual_accuracy)),
    completeness: avg(results.map(r=>r.scores.completeness)),
    language: avg(results.map(r=>r.scores.language_match)),
    quality: avg(results.map(r=>r.scores.response_quality)),
    tone: avg(results.map(r=>r.scores.tone_helpfulness)),
  };

  const gradeColor = overallAvgPct>=90?'#22c55e':overallAvgPct>=75?'#3b82f6':overallAvgPct>=60?'#f59e0b':'#ef4444';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NHSM Chatbot — Deep Evaluation Report</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px}
  h1{font-size:2rem;margin-bottom:4px;background:linear-gradient(135deg,#6366f1,#a855f7);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  h2{font-size:1.2rem;color:#94a3b8;margin:32px 0 12px}
  .subtitle{color:#64748b;margin-bottom:32px}
  .hero{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:32px}
  .card{background:#1e293b;border-radius:16px;padding:24px;flex:1;min-width:180px;text-align:center;border:1px solid #334155}
  .card .value{font-size:3rem;font-weight:800}
  .card .label{color:#64748b;font-size:.85rem;margin-top:4px}
  .bar-wrap{background:#0f172a;border-radius:8px;height:12px;margin-top:8px;overflow:hidden}
  .bar{height:100%;border-radius:8px;transition:width .4s}
  table{width:100%;border-collapse:collapse;margin-bottom:32px;font-size:.82rem}
  th{background:#1e293b;padding:10px 8px;text-align:left;color:#94a3b8;font-weight:600;position:sticky;top:0}
  td{padding:8px;border-bottom:1px solid #1e293b;vertical-align:top}
  tr:hover td{background:#1e293b55}
  .query-cell{max-width:220px;font-style:italic;color:#cbd5e1}
  .response-cell{max-width:300px;font-size:.75rem;color:#94a3b8}
  .comment-cell{max-width:200px;color:#f59e0b;font-size:.75rem}
  code{background:#334155;padding:2px 5px;border-radius:4px;font-size:.75rem}
  .metric-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-bottom:32px}
  .metric{background:#1e293b;border-radius:12px;padding:16px;text-align:center;border:1px solid #334155}
  .metric .val{font-size:2rem;font-weight:700}
  .metric .lbl{font-size:.75rem;color:#64748b;margin-top:4px}
  .scroll-wrap{overflow-x:auto}
</style>
</head>
<body>
<h1>🧠 NHSM Chatbot — Deep Evaluation Report</h1>
<p class="subtitle">LLM-as-Judge methodology | ${TESTS.length} tests | ${new Date().toLocaleString()} | Groq llama-3.1-8b-instant</p>

<div class="hero">
  <div class="card">
    <div class="value" style="color:${gradeColor}">${overallAvgPct}%</div>
    <div class="label">Overall Score</div>
    <div class="bar-wrap"><div class="bar" style="width:${overallAvgPct}%;background:${gradeColor}"></div></div>
  </div>
  <div class="card">
    <div class="value" style="color:#22c55e">${results.filter(r=>r.scores.total/25>=.9).length}</div>
    <div class="label">Grade A (≥90%)</div>
  </div>
  <div class="card">
    <div class="value" style="color:#3b82f6">${results.filter(r=>{const p=r.scores.total/25;return p>=.75&&p<.9}).length}</div>
    <div class="label">Grade B (75-89%)</div>
  </div>
  <div class="card">
    <div class="value" style="color:#f59e0b">${results.filter(r=>{const p=r.scores.total/25;return p>=.6&&p<.75}).length}</div>
    <div class="label">Grade C (60-74%)</div>
  </div>
  <div class="card">
    <div class="value" style="color:#ef4444">${results.filter(r=>r.scores.total/25<.6).length}</div>
    <div class="label">Grade F (<60%)</div>
  </div>
  <div class="card">
    <div class="value">${Math.round(results.reduce((a,r)=>a+r.timeMs,0)/1000)}s</div>
    <div class="label">Total Runtime</div>
  </div>
</div>

<h2>📊 Metric Averages (out of 5)</h2>
<div class="metric-grid">
  ${Object.entries({
    '🎯 Factual Accuracy': metricsAvg.factual,
    '📋 Completeness': metricsAvg.completeness,
    '🌐 Language Match': metricsAvg.language,
    '✨ Response Quality': metricsAvg.quality,
    '😊 Tone': metricsAvg.tone
  }).map(([lbl,val])=>{
    const pct=Math.round(val/5*100);
    const c=pct>=90?'#22c55e':pct>=75?'#3b82f6':pct>=60?'#f59e0b':'#ef4444';
    return `<div class="metric">
      <div class="val" style="color:${c}">${val}</div>
      <div class="lbl">${lbl}</div>
      <div class="bar-wrap"><div class="bar" style="width:${pct}%;background:${c}"></div></div>
    </div>`;
  }).join('')}
</div>

<h2>📂 Results by Category</h2>
<div class="scroll-wrap">
<table>
  <thead><tr><th>Category</th><th>Tests</th><th>Avg Score</th><th>Factual</th><th>Completeness</th><th>Language</th><th>Quality</th><th>Tone</th></tr></thead>
  <tbody>${catRows}</tbody>
</table>
</div>

<h2>🔬 All Test Results</h2>
<div class="scroll-wrap">
<table>
  <thead><tr><th>ID</th><th>Cat</th><th>Lang</th><th>Query</th><th>Score</th><th>Fact</th><th>Cmpl</th><th>Lang</th><th>Qual</th><th>Tone</th><th>Judge Comment</th><th>Response Preview</th><th>Time</th></tr></thead>
  <tbody>${testRows}</tbody>
</table>
</div>
<p style="color:#475569;text-align:center;margin-top:32px">NHSM Chatbot Deep Evaluation — ${new Date().getFullYear()}</p>
</body></html>`;
}

// ─────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────
const C = { reset:'\x1b[0m',bold:'\x1b[1m',green:'\x1b[32m',red:'\x1b[31m',yellow:'\x1b[33m',cyan:'\x1b[36m',dim:'\x1b[2m' };

async function main() {
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════╗`);
  console.log(`║  NHSM Chatbot — LLM-as-Judge Deep Evaluation (${TESTS.length} tests)  ║`);
  console.log(`╚══════════════════════════════════════════════════════════╝${C.reset}\n`);
  await mongoose.connect(config.mongoURI);
  console.log(`${C.green}✅ MongoDB connected${C.reset}\n`);

  const results = [];
  for (let i = 0; i < TESTS.length; i++) {
    const tc = TESTS[i];
    process.stdout.write(`  [${String(i+1).padStart(2,'0')}/${TESTS.length}] ${C.bold}${tc.id}${C.reset} ${tc.query.substring(0,45).padEnd(45)} `);
    const r = await runTest(tc);
    results.push(r);
    const pct = Math.round(r.scores.total/25*100);
    const clr = pct>=90?C.green:pct>=75?C.cyan:pct>=60?C.yellow:C.red;
    console.log(`${clr}${pct}%${C.reset} ${C.dim}(${r.timeMs}ms)${C.reset}`);
  }

  await mongoose.disconnect();

  // Category summary
  const cats = [...new Set(results.map(r=>r.cat))];
  console.log(`\n${C.bold}${C.cyan}═══ CATEGORY RESULTS ═══${C.reset}`);
  cats.forEach(cat => {
    const rs = results.filter(r=>r.cat===cat);
    const avg = Math.round(rs.reduce((a,r)=>a+(r.scores.total/25*100),0)/rs.length);
    const clr = avg>=90?C.green:avg>=75?C.cyan:avg>=60?C.yellow:C.red;
    const bar = '█'.repeat(Math.round(avg/5))+'░'.repeat(20-Math.round(avg/5));
    console.log(`  ${cat.padEnd(18)} ${bar} ${clr}${avg}%${C.reset} (${rs.length} tests)`);
  });

  // Worst tests
  const sorted = [...results].sort((a,b)=>a.scores.total-b.scores.total);
  console.log(`\n${C.bold}${C.cyan}═══ LOWEST SCORING TESTS ═══${C.reset}`);
  sorted.slice(0,8).forEach(r => {
    const pct = Math.round(r.scores.total/25*100);
    console.log(`  ${C.red}${pct}%${C.reset}  [${r.id}] ${r.query.substring(0,60)}`);
    console.log(`  ${C.dim}     Judge: ${r.scores.comment}${C.reset}`);
  });

  // Overall
  const overallAvgPct = Math.round(results.reduce((a,r)=>a+(r.scores.total/25*100),0)/results.length);
  console.log(`\n${C.bold}${C.cyan}╔══════════════════════════════╗`);
  console.log(`║  OVERALL: ${String(overallAvgPct+'%').padEnd(20)}║`);
  console.log(`╚══════════════════════════════╝${C.reset}`);

  // HTML report
  const reportPath = path.join(__dirname, 'eval-report.html');
  fs.writeFileSync(reportPath, buildHtmlReport(results));
  console.log(`\n  ${C.green}📄 HTML Report saved:${C.reset} ${reportPath}`);
  console.log(`  Open it in your browser for the full interactive report!\n`);

  process.exit(overallAvgPct < 70 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
