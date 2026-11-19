/**
 * StudyMate AI -- curriculum provenance registry.
 * One record per board|subject that was CHECKED against an official document. No record = unverified.
 * Adding a record never changes curriculum-data.js, so student progress keyed by topic name is never touched.
 *
 * Record fields: authority, document, url, licence, syllabusYear, version, retrieved (ISO date, when a human/agent read it),
 *   verifiedAt, scope ('content-areas' = top-level areas only; 'full' = subtopics too),
 *   match ('exact' | 'partial' | 'none') = how the app's topic list compares, note (plain-language difference).
 * Copyright: store titles, references and URLs only. Never paste copyrighted syllabus text here.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CURRICULUM_SOURCES = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const RECORDS = {
    'gcse|Mathematics': {
      authority: 'Department for Education (England)',
      document: 'GCSE mathematics: subject content and assessment objectives (DFE-00233-2013)',
      url: 'https://www.gov.uk/government/publications/gcse-mathematics-subject-content-and-assessment-objectives',
      licence: 'Open Government Licence v3.0',
      syllabusYear: 'First teaching 2015 (published 1 Nov 2013)',
      version: 'DFE-00233-2013',
      retrieved: '2026-11-08',
      verifiedAt: '2026-11-08',
      scope: 'content-areas',
      officialAreas: ['Number', 'Algebra', 'Ratio, proportion and rates of change', 'Geometry and measures', 'Probability', 'Statistics'],
      corroboratedBy: 'https://www.aqa.org.uk/subjects/mathematics/gcse/mathematics-8300/specification/subject-content',
      match: 'partial',
      note: 'The official content has six areas. StudyMate lists five: Probability and Statistics are combined, and Ratio is shortened.'
    }
  };
  // Records for imported syllabi (generated file, validated at build time).
  try {
    const imp = typeof window !== 'undefined' && window.CURRICULUM_IMPORTS;
    if (imp && imp.sources) Object.keys(imp.sources).forEach(k => { if (!RECORDS[k]) RECORDS[k] = imp.sources[k]; });
  } catch (_) { }
  const key = (board, subject) => String(board || '') + '|' + String(subject || '');
  function get(board, subject) { return RECORDS[key(board, subject)] || null; }
  /** Student-facing wording. Never says "official syllabus" about StudyMate's own list. */
  function describe(rec) {
    if (!rec) return { verified: false, text: 'Not checked against an official syllabus yet.' };
    const how = rec.match === 'exact' ? 'matches' : 'was checked against';
    return {
      verified: true,
      text: `Topic areas ${how} ${rec.authority}` + (rec.document ? ', ' + rec.document : '') + (rec.syllabusYear ? ` (${rec.syllabusYear})` : '') + '. ' + (rec.match === 'exact' ? '' : rec.note + ' ') + 'Subtopic detail is not verified.'
    };
  }
  return { RECORDS, get, describe, key };
});
