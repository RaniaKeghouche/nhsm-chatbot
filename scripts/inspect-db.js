/**
 * DB Inspector — dumps real documents from each collection
 * to help write accurate evaluation test cases
 * Run: node scripts/inspect-db.js
 */
const dns = require('dns'); dns.setServers(['8.8.8.8', '8.8.4.4']);
const mongoose = require('c:/Users/kegho/Desktop/web/NHSM/node_modules/mongoose');
const config   = require('c:/Users/kegho/Desktop/web/NHSM/src/config/config');
const { MathTip, GeneralFAQ, Resource, Wellness, StudyTip, TeacherInfo, Specialty, StudentExperience, Humor } = require('c:/Users/kegho/Desktop/web/NHSM/src/models');

const COLLECTIONS = [
  { name: 'Specialty',         model: Specialty },
  { name: 'TeacherInfo',       model: TeacherInfo },
  { name: 'StudyTip',          model: StudyTip },
  { name: 'Resource',          model: Resource },
  { name: 'Wellness',          model: Wellness },
  { name: 'GeneralFAQ',        model: GeneralFAQ },
  { name: 'MathTip',           model: MathTip },
  { name: 'StudentExperience', model: StudentExperience },
  { name: 'Humor',             model: Humor },
];

async function main() {
  await mongoose.connect(config.mongoURI);
  console.log('Connected.\n');
  for (const col of COLLECTIONS) {
    const docs = await col.model.find({}).limit(5).lean();
    console.log(`\n${'='.repeat(60)}`);
    console.log(`COLLECTION: ${col.name}  (${docs.length} shown)`);
    console.log('='.repeat(60));
    docs.forEach(d => {
      console.log(`\n  id      : ${d.id || d._id}`);
      console.log(`  question: ${(d.question||'').substring(0,120)}`);
      console.log(`  answer  : ${(d.answer||'').substring(0,200)}`);
      console.log(`  tags    : ${JSON.stringify(d.tags||[])}`);
    });
  }
  await mongoose.disconnect();
}
main().catch(console.error);
