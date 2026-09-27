/**
 * StudyMate AI — Global Curriculum Data Model
 * ─────────────────────────────────────────────────────────────────────────
 * Country → Exam Board → Subject → Topic → Subtopic
 *
 * This file is the single source of truth for "what can a student study".
 * Nothing about country/exam/subject content should be hardcoded in
 * index.html — the UI reads from CURRICULUM at runtime.
 *
 * HOW TO ADD A NEW COUNTRY OR EXAM (no rebuild required):
 *   1. Add an entry to COUNTRIES (code, name, flag, examBoards: [...codes]).
 *   2. Add one entry per exam to EXAM_BOARDS keyed by a unique code.
 *      Each exam board needs: label, hint, country, level, subjects[].
 *   3. Each subject needs: emoji, color, placeholder (for the Ask screen),
 *      and optionally topics[] (topic → subtopics[]) for deeper features
 *      (practice mode, weakness profile, mock exams). Subjects without a
 *      topics[] array still work everywhere — they just can't be broken
 *      down below "subject" level yet. Fill topics[] in as you go; the
 *      app treats a missing topics[] as "not yet available" and hides
 *      topic-level UI for that subject rather than showing empty state.
 *
 * Everything here is plain data — safe to extend without touching any
 * screen logic in index.html.
 */

window.CURRICULUM = (function () {

  // ── COUNTRIES ─────────────────────────────────────────────────────────
  // Every country gets a '-tertiary' board appended automatically (see the
  // loop right after this array) so university-level students are covered
  // everywhere, not just secondary school — see TERTIARY_SUBJECTS below.
  const COUNTRIES = [
    { code: 'ng',   name: 'Nigeria',        flag: '🇳🇬', examBoards: ['waec', 'neco', 'jamb', 'nabteb'] },
    { code: 'gh',   name: 'Ghana',          flag: '🇬🇭', examBoards: ['wassce-gh'] },
    { code: 'ke',   name: 'Kenya',          flag: '🇰🇪', examBoards: ['kcse'] },
    { code: 'za',   name: 'South Africa',   flag: '🇿🇦', examBoards: ['nsc'] },
    { code: 'gb',   name: 'United Kingdom', flag: '🇬🇧', examBoards: ['gcse', 'alevel'] },
    { code: 'us',   name: 'United States',  flag: '🇺🇸', examBoards: ['sat', 'act', 'ap'] },
    { code: 'ca',   name: 'Canada',         flag: '🇨🇦', examBoards: ['ca-provincial'] },
    { code: 'in',   name: 'India',          flag: '🇮🇳', examBoards: ['cbse', 'jee'] },
    { code: 'au',   name: 'Australia',      flag: '🇦🇺', examBoards: ['hsc'] },
    { code: 'ae',   name: 'UAE',            flag: '🇦🇪', examBoards: ['igcse', 'ib'] },
    { code: 'intl', name: 'International',  flag: '🌍', examBoards: ['igcse', 'ib'] }
  ];
  COUNTRIES.forEach(c => c.examBoards.push(`${c.code}-tertiary`));

  // Shared subject building blocks (kept DRY across exam boards that teach
  // near-identical syllabi). Topic depth is filled in for a representative
  // subject per exam family so the schema — and features built on it, like
  // the Weakness Profile — has real data to work with; the rest can be
  // extended the same way over time.
  const MATH_TOPICS_WAEC = [
    { name: 'Number & Numeration', subtopics: ['Indices', 'Logarithms', 'Surds', 'Sequences & Series'] },
    { name: 'Algebra', subtopics: ['Linear Equations', 'Quadratic Equations', 'Simultaneous Equations', 'Factorization', 'Inequalities'] },
    { name: 'Geometry & Trigonometry', subtopics: ['Circle Theorems', 'Mensuration', 'Trigonometric Ratios', 'Bearings'] },
    { name: 'Statistics & Probability', subtopics: ['Mean/Median/Mode', 'Probability', 'Data Presentation'] },
    { name: 'Calculus', subtopics: ['Differentiation', 'Integration'] }
  ];

  const MATH_TOPICS_GCSE = [
    { name: 'Number', subtopics: ['Fractions', 'Percentages', 'Standard Form'] },
    { name: 'Algebra', subtopics: ['Linear Equations', 'Quadratic Equations', 'Simultaneous Equations', 'Sequences'] },
    { name: 'Ratio & Proportion', subtopics: ['Ratio', 'Direct & Inverse Proportion'] },
    { name: 'Geometry & Measures', subtopics: ['Angles', 'Circle Theorems', 'Pythagoras & Trigonometry', 'Vectors'] },
    { name: 'Statistics & Probability', subtopics: ['Averages', 'Probability', 'Data Handling'] }
  ];

  const MATH_TOPICS_SAT = [
    { name: 'Algebra', subtopics: ['Linear Equations', 'Linear Inequalities', 'Systems of Equations'] },
    { name: 'Advanced Math', subtopics: ['Quadratics', 'Exponentials', 'Polynomials'] },
    { name: 'Problem Solving & Data Analysis', subtopics: ['Ratios & Rates', 'Percentages', 'Statistics'] },
    { name: 'Geometry & Trigonometry', subtopics: ['Area & Volume', 'Circles', 'Right Triangle Trig'] }
  ];

  // ── EXAM BOARDS ──────────────────────────────────────────────────────
  const EXAM_BOARDS = {

    // Nigeria
    waec: {
      label: 'WAEC', hint: 'West African Examinations Council', country: 'ng', level: 'secondary',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Find the value of x if 2x + 5 = 13...', topics: MATH_TOPICS_WAEC },
        { name: 'Physics',     emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. A car accelerates from rest at 5 m/s² for 6 seconds. Find its final velocity...' },
        { name: 'Chemistry',   emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Balance the equation: Fe + O2 → Fe2O3...' },
        { name: 'Biology',     emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Describe the process of osmosis in plant cells...' },
        { name: 'English',     emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Identify the figure of speech in "The wind whispered through the trees"...' },
        { name: 'Economics',   emoji: '📊', color: '#00D4AA', placeholder: 'e.g. Explain the law of diminishing marginal utility...' },
        { name: 'Government',  emoji: '🏛️', color: '#B39DDB', placeholder: 'e.g. State three functions of the legislature...' },
        { name: 'Literature',  emoji: '📚', color: '#FFB74D', placeholder: 'e.g. Discuss the theme of ambition in Macbeth...' }
      ]
    },
    neco: {
      label: 'NECO', hint: 'National Examinations Council', country: 'ng', level: 'secondary',
      subjects: [] // intentionally mirrors WAEC's subject list at runtime — see resolveSubjects()
    },
    jamb: {
      label: 'JAMB / UTME', hint: 'Joint Admissions and Matriculation Board', country: 'ng', level: 'secondary',
      subjects: []
    },
    nabteb: {
      label: 'NABTEB', hint: 'National Business and Technical Examinations Board', country: 'ng', level: 'secondary',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Find the value of x if 2x + 5 = 13...', topics: MATH_TOPICS_WAEC },
        { name: 'English',     emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Identify the figure of speech...' },
        { name: 'Technical Drawing', emoji: '📏', color: '#4FC3F7', placeholder: 'e.g. Describe orthographic projection...' },
        { name: 'Bookkeeping', emoji: '📒', color: '#00D4AA', placeholder: 'e.g. Explain the double-entry principle...' }
      ]
    },

    // Ghana
    'wassce-gh': {
      label: 'WASSCE', hint: 'West African Senior School Certificate Examination', country: 'gh', level: 'secondary',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Find the value of x if 2x + 5 = 13...', topics: MATH_TOPICS_WAEC },
        { name: 'Integrated Science', emoji: '🔬', color: '#64DC64', placeholder: 'e.g. Explain the water cycle...' },
        { name: 'English', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Identify the figure of speech...' },
        { name: 'Social Studies', emoji: '🌍', color: '#FFD166', placeholder: 'e.g. Discuss the causes of rural-urban migration...' }
      ]
    },

    // Kenya
    kcse: {
      label: 'KCSE', hint: 'Kenya Certificate of Secondary Education', country: 'ke', level: 'secondary',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Solve for x: 3x - 7 = 11...', topics: MATH_TOPICS_WAEC },
        { name: 'Physics', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. Define moment of a force...' },
        { name: 'Chemistry', emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Explain the mole concept...' },
        { name: 'Biology', emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Describe mitosis...' },
        { name: 'English', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Explain the use of imagery in this passage...' },
        { name: 'Kiswahili', emoji: '🗣️', color: '#B39DDB', placeholder: 'e.g. Eleza maana ya methali hii...' }
      ]
    },

    // South Africa
    nsc: {
      label: 'NSC (Matric)', hint: 'National Senior Certificate', country: 'za', level: 'secondary',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Solve for x: 3x - 7 = 11...', topics: MATH_TOPICS_WAEC },
        { name: 'Physical Sciences', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. State Newton\'s second law...' },
        { name: 'Life Sciences', emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Describe the process of photosynthesis...' },
        { name: 'English Home Language', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Analyse the tone of this poem...' },
        { name: 'Accounting', emoji: '📒', color: '#00D4AA', placeholder: 'e.g. Prepare a bank reconciliation statement...' }
      ]
    },

    // United Kingdom
    gcse: {
      label: 'GCSE', hint: 'General Certificate of Secondary Education', country: 'gb', level: 'secondary',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Solve 2x + 5 = 13...', topics: MATH_TOPICS_GCSE },
        { name: 'Physics', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. Explain how a transformer works...' },
        { name: 'Chemistry', emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Describe fractional distillation of crude oil...' },
        { name: 'Biology', emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Explain the process of osmosis...' },
        { name: 'English Language', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Analyse the writer\'s use of language in this extract...' },
        { name: 'History', emoji: '📜', color: '#FFB74D', placeholder: 'e.g. Explain the causes of World War One...' }
      ]
    },
    alevel: {
      label: 'A-Level', hint: 'Advanced Level', country: 'gb', level: 'senior secondary',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Differentiate y = 3x² + 2x...', topics: [
          { name: 'Pure Mathematics', subtopics: ['Algebra', 'Trigonometry', 'Differentiation', 'Integration', 'Vectors'] },
          { name: 'Statistics', subtopics: ['Probability', 'Hypothesis Testing', 'Distributions'] },
          { name: 'Mechanics', subtopics: ['Kinematics', 'Forces', 'Moments'] }
        ] },
        { name: 'Physics', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. Derive the equations of motion...' },
        { name: 'Chemistry', emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Explain the mechanism of nucleophilic substitution...' },
        { name: 'Biology', emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Explain the process of oxidative phosphorylation...' },
        { name: 'Economics', emoji: '📊', color: '#00D4AA', placeholder: 'e.g. Explain market failure using an example...' }
      ]
    },

    // United States
    sat: {
      label: 'SAT', hint: 'Scholastic Assessment Test', country: 'us', level: 'college admissions',
      subjects: [
        { name: 'Math', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. If 3x + 7 = 22, what is x?', topics: MATH_TOPICS_SAT },
        { name: 'Reading', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. What is the main idea of this passage?' },
        { name: 'Writing & Language', emoji: '✍️', color: '#FFB74D', placeholder: 'e.g. Which choice fixes this sentence fragment?' }
      ]
    },
    act: {
      label: 'ACT', hint: 'American College Testing', country: 'us', level: 'college admissions',
      subjects: [
        { name: 'Math', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Solve for x: 2x + 5 = 13...', topics: MATH_TOPICS_SAT },
        { name: 'English', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Which choice is most concise?' },
        { name: 'Science', emoji: '🔬', color: '#64DC64', placeholder: 'e.g. Interpret this experiment\'s data table...' },
        { name: 'Reading', emoji: '📘', color: '#FFD166', placeholder: 'e.g. What can be inferred about the narrator?' }
      ]
    },
    ap: {
      label: 'AP', hint: 'Advanced Placement', country: 'us', level: 'college-level high school',
      subjects: [
        { name: 'AP Calculus', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Find the derivative of f(x) = x³ - 4x...' },
        { name: 'AP Physics', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. Explain conservation of momentum...' },
        { name: 'AP Chemistry', emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Explain Le Chatelier\'s principle...' },
        { name: 'AP Biology', emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Explain natural selection with an example...' },
        { name: 'AP US History', emoji: '📜', color: '#FFB74D', placeholder: 'e.g. Explain the causes of the Great Depression...' }
      ]
    },

    // Canada
    'ca-provincial': {
      label: 'Provincial Diploma', hint: 'e.g. Ontario, Alberta, BC high school diplomas', country: 'ca', level: 'secondary',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Solve 2x + 5 = 13...', topics: MATH_TOPICS_GCSE },
        { name: 'Physics', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. Explain Newton\'s laws of motion...' },
        { name: 'Chemistry', emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Balance this chemical equation...' },
        { name: 'Biology', emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Explain cellular respiration...' },
        { name: 'English', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Analyse the theme of this short story...' }
      ]
    },

    // India
    cbse: {
      label: 'CBSE (Class 10/12)', hint: 'Central Board of Secondary Education', country: 'in', level: 'secondary',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Solve the quadratic x² - 5x + 6 = 0...', topics: MATH_TOPICS_WAEC },
        { name: 'Physics', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. State Ohm\'s law...' },
        { name: 'Chemistry', emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Explain the periodic trend in atomic radius...' },
        { name: 'Biology', emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Explain the process of photosynthesis...' },
        { name: 'English', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Explain the theme of this poem...' }
      ]
    },
    jee: {
      label: 'JEE', hint: 'Joint Entrance Examination (engineering admissions)', country: 'in', level: 'college admissions',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Find the roots of x² - 5x + 6 = 0...' },
        { name: 'Physics', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. Derive the equation for time period of a pendulum...' },
        { name: 'Chemistry', emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Explain hybridization in methane...' }
      ]
    },

    // Australia
    hsc: {
      label: 'HSC', hint: 'Higher School Certificate', country: 'au', level: 'secondary',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Solve 2x + 5 = 13...', topics: MATH_TOPICS_GCSE },
        { name: 'Physics', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. Explain projectile motion...' },
        { name: 'Chemistry', emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Explain acid-base equilibria...' },
        { name: 'Biology', emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Explain the process of DNA replication...' },
        { name: 'English', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Analyse the central theme of this text...' }
      ]
    },

    // International
    igcse: {
      label: 'IGCSE', hint: 'International General Certificate of Secondary Education', country: 'intl', level: 'secondary',
      subjects: [
        { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Solve 2x + 5 = 13...', topics: MATH_TOPICS_GCSE },
        { name: 'Physics', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. Explain how a transformer works...' },
        { name: 'Chemistry', emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Describe fractional distillation...' },
        { name: 'Biology', emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Explain the process of osmosis...' },
        { name: 'English as a Second Language', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Summarise the main points of this passage...' }
      ]
    },
    ib: {
      label: 'IB Diploma', hint: 'International Baccalaureate', country: 'intl', level: 'senior secondary',
      subjects: [
        { name: 'Mathematics AA', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Find the derivative of f(x) = x³ - 4x...' },
        { name: 'Physics', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. Explain the photoelectric effect...' },
        { name: 'Chemistry', emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Explain the concept of chemical equilibrium...' },
        { name: 'Biology', emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Explain the role of enzymes in metabolism...' },
        { name: 'English A: Language & Literature', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Analyse the narrative perspective in this extract...' }
      ]
    }
  };

  // NECO and JAMB share WAEC's subject catalogue in practice (same national
  // curriculum) — resolved at lookup time rather than duplicated in data.
  EXAM_BOARDS.neco.subjects = EXAM_BOARDS.waec.subjects;
  EXAM_BOARDS.jamb.subjects = EXAM_BOARDS.waec.subjects;

  // ── TERTIARY / UNIVERSITY ────────────────────────────────────────────
  // One generic tertiary board per country (auto-added to every country's
  // examBoards list above). This is deliberately broad — a general
  // undergraduate core subject set, not a specific university's degree
  // curriculum, since modeling actual degree programs per country would be
  // its own enormous project. Good enough for "help a university student
  // studying core subjects", not a substitute for a real course syllabus.
  const TERTIARY_SUBJECTS = [
    { name: 'Mathematics', emoji: '📐', color: '#6C63FF', placeholder: 'e.g. Evaluate the integral of x²...' },
    { name: 'Physics', emoji: '⚛️', color: '#4FC3F7', placeholder: 'e.g. Derive the work-energy theorem...' },
    { name: 'Chemistry', emoji: '🧪', color: '#FFD166', placeholder: 'e.g. Explain the mechanism of an SN2 reaction...' },
    { name: 'Biology', emoji: '🧬', color: '#64DC64', placeholder: 'e.g. Explain the process of cellular respiration...' },
    { name: 'Computer Science', emoji: '💻', color: '#00D4AA', placeholder: 'e.g. Explain how a binary search tree works...' },
    { name: 'Economics', emoji: '📊', color: '#00D4AA', placeholder: 'e.g. Explain the concept of comparative advantage...' },
    { name: 'Business Studies', emoji: '💼', color: '#FFB74D', placeholder: 'e.g. Explain Porter\'s Five Forces...' },
    { name: 'English / Communication', emoji: '📖', color: '#FF8A8A', placeholder: 'e.g. Explain how to structure a persuasive essay...' }
  ];
  COUNTRIES.forEach(c => {
    EXAM_BOARDS[`${c.code}-tertiary`] = {
      label: 'University / Tertiary', hint: 'General undergraduate studies — broad subject set, not degree-specific',
      country: c.code, level: 'tertiary', subjects: TERTIARY_SUBJECTS
    };
  });

  // ── CLASS / YEAR LEVELS ──────────────────────────────────────────────
  // Per-country naming for "what class/year are you in" — used by
  // onboarding instead of one hardcoded Nigerian list (JSS1–SS3) shown to
  // every student regardless of where they actually are.
  const CLASS_LEVELS = {
    ng: { secondary: ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'], tertiary: ['100 Level', '200 Level', '300 Level', '400 Level', '500 Level'] },
    gh: { secondary: ['JHS1', 'JHS2', 'JHS3', 'SHS1', 'SHS2', 'SHS3'], tertiary: ['Year 1', 'Year 2', 'Year 3', 'Year 4'] },
    ke: { secondary: ['Form 1', 'Form 2', 'Form 3', 'Form 4'], tertiary: ['Year 1', 'Year 2', 'Year 3', 'Year 4'] },
    za: { secondary: ['Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'], tertiary: ['1st Year', '2nd Year', '3rd Year', '4th Year'] },
    gb: { secondary: ['Year 9', 'Year 10', 'Year 11', 'Year 12 (Lower Sixth)', 'Year 13 (Upper Sixth)'], tertiary: ['1st Year', '2nd Year', '3rd Year', 'Postgraduate'] },
    us: { secondary: ['9th Grade (Freshman)', '10th Grade (Sophomore)', '11th Grade (Junior)', '12th Grade (Senior)'], tertiary: ['Freshman', 'Sophomore', 'Junior', 'Senior', 'Graduate'] },
    ca: { secondary: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'], tertiary: ['1st Year', '2nd Year', '3rd Year', '4th Year'] },
    in: { secondary: ['Class 9', 'Class 10', 'Class 11', 'Class 12'], tertiary: ['1st Year', '2nd Year', '3rd Year', '4th Year'] },
    au: { secondary: ['Year 9', 'Year 10', 'Year 11', 'Year 12'], tertiary: ['1st Year', '2nd Year', '3rd Year', '4th Year'] },
    ae: { secondary: ['Grade 9', 'Grade 10', 'Grade 11', 'Grade 12'], tertiary: ['1st Year', '2nd Year', '3rd Year', '4th Year'] },
    intl: { secondary: ['Year 10', 'Year 11', 'Year 12', 'Year 13'], tertiary: ['1st Year', '2nd Year', '3rd Year', '4th Year'] }
  };

  function getClassLevels(countryCode, level) {
    const c = CLASS_LEVELS[countryCode] || CLASS_LEVELS.intl;
    const list = (level === 'tertiary') ? c.tertiary : c.secondary;
    return [...list, 'Other'];
  }

  // ── LOOKUP HELPERS ───────────────────────────────────────────────────
  function getCountries() {
    return COUNTRIES;
  }

  function getExamBoardsForCountry(countryCode) {
    const country = COUNTRIES.find(c => c.code === countryCode);
    if (!country) return [];
    return country.examBoards.map(code => ({ code, ...EXAM_BOARDS[code] }));
  }

  function getExamBoard(examCode) {
    if (!EXAM_BOARDS[examCode]) return null;
    return { code: examCode, ...EXAM_BOARDS[examCode] };
  }

  function getAllExamBoards() {
    return Object.keys(EXAM_BOARDS).map(code => ({ code, ...EXAM_BOARDS[code] }));
  }

  function getSubjects(examCode) {
    const exam = EXAM_BOARDS[examCode];
    return exam ? exam.subjects : [];
  }

  function getSubject(examCode, subjectName) {
    return getSubjects(examCode).find(s => s.name === subjectName) || null;
  }

  function getTopics(examCode, subjectName) {
    const subject = getSubject(examCode, subjectName);
    return (subject && subject.topics) ? subject.topics : [];
  }

  // Fallback default so the app has something sane to render before a
  // student picks a country (keeps existing Nigeria-first behavior as the
  // *default*, not a hardcoded ceiling — every other country is one tap away).
  const DEFAULT_COUNTRY = 'ng';
  const DEFAULT_EXAM = 'waec';

  return {
    getCountries,
    getExamBoardsForCountry,
    getExamBoard,
    getAllExamBoards,
    getClassLevels,
    getSubjects,
    getSubject,
    getTopics,
    DEFAULT_COUNTRY,
    DEFAULT_EXAM
  };
})();
