// src/services/knowledgeBaseService.js
const { MathTip, GeneralFAQ, Resource, Wellness, StudyTip, TeacherInfo, Specialty, StudentExperience, Humor } = require('../models');

const collectionNameMap = {
    'MathTip': 'Math Tip', 'GeneralFAQ': 'General FAQ', 'Resource': 'Resource', 'Wellness': 'Wellness Tip',
    'StudyTip': 'Study Tip', 'TeacherInfo': 'Teacher Information', 'Specialty': 'Specialty Information',
    'StudentExperience': 'Student Experience', 'Humor': 'Humor Item'
};

class KnowledgeBaseService {
  constructor() {
    console.log('[KBService Constructor] Initializing...');
    this.collectionSearchConfig = [
      { model: MathTip, name: 'MathTip', fields: ['question', 'answer', 'tags'] },
      { model: GeneralFAQ, name: 'GeneralFAQ', fields: ['question', 'answer', 'tags'] },
      { model: Resource, name: 'Resource', fields: ['question', 'answer', 'tags'] },
      { model: Wellness, name: 'Wellness', fields: ['question', 'answer', 'tags'] },
      { model: StudyTip, name: 'StudyTip', fields: ['question', 'answer', 'tags'] },
      { model: TeacherInfo, name: 'TeacherInfo', fields: ['id', 'name', 'question', 'answer', 'tags'] },
      { model: Specialty, name: 'Specialty', fields: ['id', 'question', 'answer', 'tags'] },
      { model: StudentExperience, name: 'StudentExperience', fields: ['question', 'answer', 'tags'] },
      { model: Humor, name: 'Humor', fields: ['question', 'answer', 'tags'] }
    ];
    this.validCollectionsToSearch = this.collectionSearchConfig.filter(c => c.model && typeof c.model.find === 'function');
    console.log(`[KBService Constructor] Initialized. Valid collections: ${this.validCollectionsToSearch.length}.`);
  }
   
  async findRelevantInfoWithKeywords(keywords = []) {
        console.log(`[KBService.findRelevantInfoWithKeywords] START - Pre-processed Keywords: ${JSON.stringify(keywords)}`);
        console.time('KBService.findRelevantInfoWithKeywords_TotalTime');

        if (keywords.length === 0) {
            console.log('[KBService.findRelevantInfoWithKeywords] No keywords provided.');
            console.timeEnd('KBService.findRelevantInfoWithKeywords_TotalTime');
            return [];
        }

        const resultsPromises = this.validCollectionsToSearch.map(config =>
            this.searchAndScore(config, keywords)
        );

        const allScoredResults = (await Promise.all(resultsPromises)).flat();
        
        allScoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

        console.log(`[KBService.findRelevantInfoWithKeywords] Found ${allScoredResults.length} potential items. Top score: ${allScoredResults.length > 0 ? allScoredResults[0].relevanceScore : 'N/A'}`);
        
        const uniqueResults = this.deduplicateAndNormalizeResults(allScoredResults);
        console.log(`[KBService.findRelevantInfoWithKeywords] Unique relevant info items prepared: ${uniqueResults.length}`);
        console.timeEnd('KBService.findRelevantInfoWithKeywords_TotalTime');
        return uniqueResults;
    }

  async findRelevantInfo(query) {
    console.log(`[KBService.findRelevantInfo] START - Query: "${query}"`);
    console.time('KBService.findRelevantInfo_TotalTime');
    const lowerQuery = query.toLowerCase();

    if (lowerQuery.includes('all teachers') || lowerQuery.includes('list of teachers')) {
        return this.fetchAllFromCollection('TeacherInfo');
    }

    const keywords = this.extractKeywords(lowerQuery);
    console.log(`[KBService.findRelevantInfo] Extracted keywords: ${JSON.stringify(keywords)}`);

    if (keywords.length === 0) {
        console.log('[KBService.findRelevantInfo] No relevant keywords extracted.');
        console.timeEnd('KBService.findRelevantInfo_TotalTime');
        return [];
    }

    const resultsPromises = this.validCollectionsToSearch.map(config =>
        this.searchAndScore(config, keywords)
    );

    const allScoredResults = (await Promise.all(resultsPromises)).flat();
    
    // Trier TOUS les résultats de TOUTES les collections par score de pertinence
    allScoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore);

    console.log(`[KBService.findRelevantInfo] Found ${allScoredResults.length} potential items. Top score: ${allScoredResults.length > 0 ? allScoredResults[0].relevanceScore : 'N/A'}`);
    
    const uniqueResults = this.deduplicateAndNormalizeResults(allScoredResults);
    console.log(`[KBService.findRelevantInfo] Unique relevant info items prepared: ${uniqueResults.length}`);
    console.timeEnd('KBService.findRelevantInfo_TotalTime');
    return uniqueResults;
  }
  
  // Dans src/services/knowledgeBaseService.js

// Dans src/services/knowledgeBaseService.js

// ... gardez le reste du fichier intact ...

  async searchAndScore(config, keywords) {
    try {
        const regexPattern = keywords.join('|');
        const query = {
            $or: config.fields.map(field => ({
                [field]: { $regex: regexPattern, $options: 'i' }
            }))
        };
        
        const candidates = await config.model.find(query).lean();

        // SCORING AMÉLIORÉ
        return candidates.map(doc => {
            let relevanceScore = 0;
            const questionText = (doc.question || '').toLowerCase();
            const answerText = (doc.answer || '').toLowerCase();
            const tagsText = (doc.tags || []).join(' ').toLowerCase();

            keywords.forEach(keyword => {
                // On donne des poids différents
                if (questionText.includes(keyword)) {
                    relevanceScore += 5; // Un mot dans la question est TRES pertinent
                }
                if (tagsText.includes(keyword)) {
                    relevanceScore += 3; // Un mot dans les tags est pertinent
                }
                if (answerText.includes(keyword)) {
                    relevanceScore += 1; // Un mot dans la réponse l'est moins
                }
            });
            
            return { ...doc, _collectionName: config.name, relevanceScore };
        });
    } catch (error) {
        console.error(`[KBService] Error scoring collection ${config.name}:`, error);
        return [];
    }
  }

// ... gardez le reste du fichier intact ...

  extractKeywords(query) {
    const stopWords = new Set([
        'a', 'about', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'i', 
        'in', 'is', 'it', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what', 'when',
        'where', 'who', 'will', 'with', 'tell', 'me', 'school', 'find', 'can', 'show', 'list'
    ]);
    const tokens = query.toLowerCase().replace(/['’]/g, '').split(/[^a-z0-9]+/u)
      .filter(word => word.length > 2 && !stopWords.has(word) && !/^\d+$/.test(word));
    return [...new Set(tokens)];
  }

  // Fonctions utilitaires (pas de changement ici)
  async fetchAllFromCollection(collectionName) {
    const config = this.collectionSearchConfig.find(c => c.name === collectionName);
    if (!config) return [];
    const allItems = await config.model.find({}).lean();
    return this.deduplicateAndNormalizeResults(allItems.map(doc => ({...doc, _collectionName: config.name})));
  }

  deduplicateAndNormalizeResults(results) {
    const uniqueResultsMap = new Map();
    results.forEach(current => {
      const idField = current.id || (current._id ? current._id.toString() : null);
      if (idField && !uniqueResultsMap.has(idField)) {
        uniqueResultsMap.set(idField, {
          id: idField,
          name: current.name || null,
          question: current.question || `Info: ${current.name || idField}`,
          answer: current.answer || 'Details available.',
          category: current.category || (current._collectionName ? collectionNameMap[current._collectionName] : 'General'),
          tags: current.tags || [],
          _collectionName: current._collectionName
        });
      }
    });
    return Array.from(uniqueResultsMap.values());
  }
}

module.exports = new KnowledgeBaseService();