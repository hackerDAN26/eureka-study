// EUREKA exam-board specification catalog — SERVER ONLY.
//
// Students pick their qualification, board and subjects; the tutor uses this catalog to
// align every answer with the right specification (spec code, board, assessment style)
// and, when a question is about the spec itself, to look up the official document on
// the board's own website. The browser only ever receives names (see publicCatalog);
// spec codes and lookup details stay here.
//
// A code of '' means "look it up on the board's site". Codes are the boards' published
// specification codes; when a board revises a spec, update the code here.

export const BOARDS = {
  aqa: { name: 'AQA', site: 'aqa.org.uk' },
  edexcel: { name: 'Pearson Edexcel', site: 'qualifications.pearson.com' },
  ocr: { name: 'OCR', site: 'ocr.org.uk' },
  eduqas: { name: 'WJEC Eduqas', site: 'eduqas.co.uk' },
  wjec: { name: 'WJEC', site: 'wjec.co.uk' },
  ccea: { name: 'CCEA', site: 'ccea.org.uk' },
  cambridge: { name: 'Cambridge International', site: 'cambridgeinternational.org' },
  edexcel_intl: { name: 'Pearson Edexcel International', site: 'qualifications.pearson.com' },
  oxfordaqa: { name: 'OxfordAQA', site: 'oxfordaqa.com' },
  ib: { name: 'International Baccalaureate', site: 'ibo.org' },
  collegeboard: { name: 'College Board', site: 'apcentral.collegeboard.org' },
  sqa: { name: 'SQA', site: 'sqa.org.uk' }
};

export const QUALIFICATIONS = [
  { id: 'gcse', name: 'GCSE', note: 'England, Wales & Northern Ireland', boards: ['aqa', 'edexcel', 'ocr', 'eduqas', 'wjec', 'ccea'] },
  { id: 'igcse', name: 'IGCSE / International GCSE', note: 'International', boards: ['cambridge', 'edexcel_intl', 'oxfordaqa'] },
  { id: 'alevel', name: 'A-Level', note: 'England, Wales & Northern Ireland', boards: ['aqa', 'edexcel', 'ocr', 'eduqas', 'wjec', 'ccea'] },
  { id: 'intl_alevel', name: 'International AS & A Level', note: 'International', boards: ['cambridge', 'edexcel_intl', 'oxfordaqa'] },
  { id: 'ib_dp', name: 'IB Diploma', note: 'International Baccalaureate', boards: ['ib'], levels: ['HL', 'SL'] },
  { id: 'ap', name: 'AP', note: 'Advanced Placement (US)', boards: ['collegeboard'] },
  { id: 'sqa_n5', name: 'National 5', note: 'Scotland', boards: ['sqa'] },
  { id: 'sqa_higher', name: 'Higher / Advanced Higher', note: 'Scotland', boards: ['sqa'] }
];

// 'Subject=code' entries separated by '|'
const RAW = {
  'aqa/gcse':
    'Biology=8461|Chemistry=8462|Physics=8463|Combined Science: Trilogy=8464|Combined Science: Synergy=8465|Mathematics=8300|Further Mathematics (Level 2)=8365|English Language=8700|English Literature=8702|History=8145|Geography=8035|Business=8132|Economics=8136|Computer Science=8525|Psychology=8182|Sociology=8192|Religious Studies A=8062|Citizenship Studies=8100|Design and Technology=8552|Food Preparation and Nutrition=8585|Physical Education=8582|Drama=8261|Music=8271|Media Studies=8572|Dance=8236|French=8658|German=8668|Spanish=8698',
  'aqa/alevel':
    'Biology=7402|Chemistry=7405|Physics=7408|Mathematics=7357|Further Mathematics=7367|Economics=7136|Business=7132|Accounting=7127|Psychology=7182|Sociology=7192|Computer Science=7517|History=7042|Geography=7037|English Literature A=7712|English Literature B=7717|English Language=7702|English Language and Literature=7707|Philosophy=7172|Politics=7152|Religious Studies=7062|Law=7162|Environmental Science=7447|Physical Education=7582|Drama and Theatre=7262|Media Studies=7572|Design and Technology: Product Design=7552|French=7652|German=7662|Spanish=7692',
  'edexcel/gcse':
    'Mathematics=1MA1|Statistics=1ST0|Biology=1BI0|Chemistry=1CH0|Physics=1PH0|Combined Science=1SC0|English Language=1EN0|English Literature=1ET0|History=1HI0|Geography A=1GA0|Geography B=1GB0|Business=1BS0|Computer Science=1CP2|Psychology=1PS0|Religious Studies A=1RA0|Religious Studies B=1RB0|Citizenship Studies=1CS0|Astronomy=1AS0|Physical Education=1PE0|Music=1MU0|Drama=1DR0|Design and Technology=1DT0|Arabic=1AA0|French=1FR1|German=1GN1|Spanish=1SP1',
  'edexcel/alevel':
    'Mathematics=9MA0|Further Mathematics=9FM0|Statistics=9ST0|Biology A (Salters-Nuffield)=9BN0|Biology B=9BI0|Chemistry=9CH0|Physics=9PH0|Economics A=9EC0|Economics B=9EB0|Business=9BS0|Psychology=9PS0|History=9HI0|Geography=9GE0|English Literature=9ET0|English Language=9EN0|English Language and Literature=9EL0|Politics=9PL0|Religious Studies=9RS0|Physical Education=9PE0|Music=9MU0|Drama and Theatre=9DR0|Design and Technology=9DT0|Arabic=9AA0|French=9FR0|German=9GN0|Spanish=9SP0',
  'ocr/gcse':
    'Biology A (Gateway)=J247|Chemistry A (Gateway)=J248|Physics A (Gateway)=J249|Combined Science A (Gateway)=J250|Biology B (Twenty First Century)=J257|Chemistry B (Twenty First Century)=J258|Physics B (Twenty First Century)=J259|Combined Science B (Twenty First Century)=J260|Mathematics=J560|Computer Science=J277|English Language=J351|English Literature=J352|History A (Explaining the Modern World)=J410|History B (Schools History Project)=J411|Geography A (Geographical Themes)=J383|Geography B (Geography for Enquiring Minds)=J384|Religious Studies=J625|Business=J204|Economics=J205|Psychology=J203|Classical Civilisation=J199|Ancient History=J198|Latin=J282|Citizenship Studies=J270|Media Studies=J200|Physical Education=J587|Music=J536|Drama=J316|Design and Technology=J310|Food Preparation and Nutrition=J309',
  'ocr/alevel':
    'Biology A=H420|Biology B (Advancing Biology)=H422|Chemistry A=H432|Chemistry B (Salters)=H433|Physics A=H556|Physics B (Advancing Physics)=H557|Mathematics A=H240|Mathematics B (MEI)=H640|Further Mathematics A=H245|Further Mathematics B (MEI)=H645|Computer Science=H446|Economics=H460|Business=H431|Psychology=H567|Sociology=H580|History A=H505|Geography=H481|English Literature=H472|English Language=H470|Religious Studies=H573|Classical Civilisation=H408|Ancient History=H407|Latin=H443|Law=H418|Media Studies=H409|Physical Education=H555',
  'eduqas/gcse':
    'Mathematics=|English Language=|English Literature=|Biology=|Chemistry=|Physics=|Combined Science=|History=|Geography A=|Geography B=|Religious Studies=|Computer Science=|Sociology=|Media Studies=|Film Studies=|Latin=|Electronics=|Music=|Drama=|French=|German=|Spanish=',
  'eduqas/alevel':
    'Biology=|Chemistry=|Physics=|English Literature=|English Language=|History=|Geography=|Economics=|Sociology=|Religious Studies=|Computer Science=|Law=|Film Studies=|Media Studies=|Latin=|Electronics=|Music=|Drama and Theatre=|French=|German=|Spanish=',
  'wjec/gcse':
    'Mathematics=|Mathematics – Numeracy=|English Language and Literature=|Welsh Language=|Science (Double Award)=|Biology=|Chemistry=|Physics=|History=|Geography=|Religious Studies=|Business=|Computer Science=|Digital Technology=|Sociology=|Physical Education=|Music=|Drama=|Film Studies=|French=|German=|Spanish=',
  'wjec/alevel':
    'Biology=|Chemistry=|Physics=|Mathematics=|Further Mathematics=|English Literature=|English Language=|History=|Geography=|Economics=|Business=|Psychology=|Sociology=|Law=|Criminology (Level 3 Diploma)=|Religious Studies=|Computer Science=|Welsh=|French=|German=|Spanish=',
  'ccea/gcse':
    'Mathematics=|Further Mathematics=|English Language=|English Literature=|Biology=|Chemistry=|Physics=|Double Award Science=|Single Award Science=|History=|Geography=|Religious Studies=|Business Studies=|Digital Technology=|Economics=|Government and Politics=|Home Economics: Food and Nutrition=|Learning for Life and Work=|Physical Education=|Music=|Drama=|French=|Irish=|Spanish=',
  'ccea/alevel':
    'Biology=|Chemistry=|Physics=|Mathematics=|Further Mathematics=|English Literature=|English Language=|History=|Geography=|Economics=|Business Studies=|Psychology=|Sociology=|Government and Politics=|Religious Studies=|Digital Technology=|Software Systems Development=|Environmental Technology=|Health and Social Care=|Life and Health Sciences=|Physical Education=|Music=|Drama and Theatre Studies=|French=|Irish=|Spanish=',
  'cambridge/igcse':
    'Biology=0610|Chemistry=0620|Physics=0625|Combined Science=0653|Co-ordinated Sciences (Double Award)=0654|Mathematics=0580|International Mathematics=0607|Additional Mathematics=0606|English – First Language=0500|English as a Second Language=0510|Literature in English=0475|Economics=0455|Business Studies=0450|Accounting=0452|Enterprise=0454|Computer Science=0478|Information and Communication Technology=0417|Geography=0460|History=0470|Sociology=0495|Psychology=0266|Global Perspectives=0457|Environmental Management=0680|Marine Science=0697|Agriculture=0600|Travel and Tourism=0471|Design and Technology=0445|Food and Nutrition=0648|Physical Education=0413|Art and Design=0400|Music=0410|Drama=0411|Religious Studies=0490|Islamiyat=0493|Pakistan Studies=0448|Arabic – First Language=0508|Arabic – Foreign Language=0544|Chinese – First Language=0509|Mandarin Chinese – Foreign Language=0547|French – Foreign Language=0520|German – Foreign Language=0525|Spanish – Foreign Language=0530|Hindi as a Second Language=0549',
  'edexcel_intl/igcse':
    'Mathematics A=4MA1|Mathematics B=4MB1|Further Pure Mathematics=4PM1|Biology=4BI1|Chemistry=4CH1|Physics=4PH1|Science (Double Award)=4SD0|Human Biology=4HB1|English Language A=4EA1|English Language B=4EB1|English as a Second Language=4ES1|English Literature=4ET1|Economics=4EC1|Business=4BS1|Accounting=4AC1|Commerce=4CM1|Computer Science=4CP0|Information and Communication Technology=4IT1|Geography=4GE1|History=4HI1|Global Citizenship=4GC1|Religious Studies=4RS1|Islamic Studies=4IS1|Pakistan Studies=4PA1|Arabic=4AA1|Chinese=4CN1|French=4FR1|German=4GN1|Spanish=4SP1',
  'oxfordaqa/igcse':
    'Biology=|Chemistry=|Physics=|Combined Science=|Mathematics=|English Language=|English as a Second Language=|English Literature=|Computer Science=|Business=|Economics=|Geography=|History=|Accounting=',
  'cambridge/intl_alevel':
    'Biology=9700|Chemistry=9701|Physics=9702|Mathematics=9709|Further Mathematics=9231|Economics=9708|Business=9609|Accounting=9706|Computer Science=9618|Information Technology=9626|Psychology=9990|Sociology=9699|History=9489|Geography=9696|English Language=9093|Literature in English=9695|Law=9084|Global Perspectives and Research=9239|Thinking Skills=9694|Media Studies=9607|Environmental Management=8291|Marine Science=9693|Travel and Tourism=9395|Physical Education=9396|Art and Design=9479|Music=9483|Islamic Studies=9488|Arabic=9680|Chinese=9715|French=9898|Spanish=9844|Urdu=9676',
  'edexcel_intl/intl_alevel':
    'Mathematics=YMA01|Further Mathematics=YFM01|Biology=YBI11|Chemistry=YCH11|Physics=YPH11|Economics=YEC11|Business=YBS11|Accounting=YAC11|Psychology=|English Language=|English Literature=|Information Technology=|Geography=|History=|Law=|Arabic=|French=|German=|Spanish=',
  'oxfordaqa/intl_alevel':
    'Biology=|Chemistry=|Physics=|Mathematics=|Further Mathematics=|Economics=|Business=|Accounting=|Psychology=|English Language=|English Literature=|Computer Science=|Geography=|History=',
  'ib/ib_dp':
    'Biology=|Chemistry=|Physics=|Mathematics: Analysis and Approaches=|Mathematics: Applications and Interpretation=|Economics=|Business Management=|Psychology=|History=|Geography=|Global Politics=|Philosophy=|Social and Cultural Anthropology=|Digital Society=|Computer Science=|Design Technology=|Sports, Exercise and Health Science=|Environmental Systems and Societies=|English A: Language and Literature=|English A: Literature=|Language B (French)=|Language B (Spanish)=|Language B (German)=|Language B (Arabic)=|Language B (Mandarin)=|Language ab initio=|Visual Arts=|Music=|Theatre=|Film=|Dance=|Theory of Knowledge (core)=|Extended Essay (core)=',
  'collegeboard/ap':
    'Biology=|Chemistry=|Environmental Science=|Physics 1: Algebra-Based=|Physics 2: Algebra-Based=|Physics C: Mechanics=|Physics C: Electricity and Magnetism=|Calculus AB=|Calculus BC=|Precalculus=|Statistics=|Computer Science A=|Computer Science Principles=|Macroeconomics=|Microeconomics=|Psychology=|United States History=|World History: Modern=|European History=|United States Government and Politics=|Comparative Government and Politics=|Human Geography=|English Language and Composition=|English Literature and Composition=|African American Studies=|Art History=|Music Theory=|Seminar=|Research=|Spanish Language and Culture=|French Language and Culture=|Chinese Language and Culture=|Latin=',
  'sqa/sqa_n5':
    'Biology=|Chemistry=|Physics=|Mathematics=|Applications of Mathematics=|English=|History=|Geography=|Modern Studies=|Business Management=|Computing Science=|Administration and IT=|Accounting=|Graphic Communication=|Design and Manufacture=|Physical Education=|Music=|Art and Design=|Religious, Moral and Philosophical Studies=|French=|German=|Spanish=|Gaelic (Learners)=',
  'sqa/sqa_higher':
    'Biology=|Human Biology=|Chemistry=|Physics=|Mathematics=|Applications of Mathematics=|English=|History=|Geography=|Modern Studies=|Business Management=|Economics=|Psychology=|Computing Science=|Accounting=|Graphic Communication=|Physical Education=|Music=|Art and Design=|Religious, Moral and Philosophical Studies=|French=|German=|Spanish=|Advanced Higher Biology=|Advanced Higher Chemistry=|Advanced Higher Physics=|Advanced Higher Mathematics=|Advanced Higher Mathematics of Mechanics=|Advanced Higher Statistics=|Advanced Higher English=|Advanced Higher History=|Advanced Higher Computing Science='
};

const slug = s =>
  s
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// id → { id, board, qualification, subject, code }
export const SPECS = new Map();
for (const [key, list] of Object.entries(RAW)) {
  const [board, qualification] = key.split('/');
  for (const entry of list.split('|')) {
    const [subject, code = ''] = entry.split('=');
    const id = `${board}.${qualification}.${slug(subject)}`;
    SPECS.set(id, { id, board, qualification, subject: subject.trim(), code: code.trim() });
  }
}

// What the browser may see: names only, for the subject picker.
export function publicCatalog() {
  return {
    qualifications: QUALIFICATIONS.map(q => ({
      id: q.id,
      name: q.name,
      note: q.note,
      levels: q.levels ?? null,
      boards: q.boards.map(b => ({
        id: b,
        name: BOARDS[b].name,
        subjects: [...SPECS.values()].filter(s => s.board === b && s.qualification === q.id).map(s => ({ id: s.id, name: s.subject }))
      }))
    }))
  };
}

const qualName = id => QUALIFICATIONS.find(q => q.id === id)?.name ?? id;

// Course descriptor from the browser → the hidden specification details.
export function resolveCourse(course) {
  if (!course || typeof course !== 'object') return null;
  const level = ['HL', 'SL'].includes(course.level) ? course.level : '';
  const spec = typeof course.id === 'string' ? SPECS.get(course.id) : null;
  if (spec) {
    const board = BOARDS[spec.board];
    return {
      label: `${board.name} ${qualName(spec.qualification)} ${spec.subject}${level ? ` ${level}` : ''}`,
      code: spec.code,
      site: board.site,
      board: board.name,
      qualification: qualName(spec.qualification),
      subject: spec.subject,
      level
    };
  }
  // A course the student typed in themselves.
  const clean = v => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').slice(0, 80).trim() : '');
  const subject = clean(course.subject);
  if (!subject) return null;
  const boardName = clean(course.board);
  const q = clean(course.qualification);
  return { label: [boardName, q, subject].filter(Boolean).join(' '), code: '', site: '', board: boardName, qualification: q, subject, level, custom: true };
}

export function courseInstruction(current, all, lookup) {
  const courses = (Array.isArray(all) ? all : []).slice(0, 20).map(resolveCourse).filter(Boolean);
  const focus = resolveCourse(current);
  if (!focus && !courses.length) return '';
  const line = c => `- ${c.label}${c.code ? ` (specification code ${c.code})` : ''}`;
  const lines = [];
  lines.push("The student's courses, from their EUREKA profile:");
  for (const c of courses) lines.push(line(c) + (focus && c.label === focus.label ? '  ← current focus' : ''));
  if (focus && !courses.some(c => c.label === focus.label)) lines.push(`${line(focus)}  ← current focus`);
  if (focus) {
    lines.push(
      '',
      `Align everything with the ${focus.label} specification${focus.code ? ` (${focus.code})` : ''}: its content, key terms and definitions, required practicals or set texts, command words, assessment objectives and ${focus.board || 'the board'}’s exam and mark-scheme style. Stay within that specification unless the student asks to go beyond it, and say clearly when something is beyond or not on it.`,
      focus.qualification === 'IB Diploma' && focus.level ? `They take this subject at ${focus.level}; mark HL-only content as such.` : '',
      lookup && focus.site
        ? `For this question, consult the official ${focus.label} specification on ${focus.site} with search before answering, and base spec-related claims on it (mention the topic or section).`
        : 'If you are not sure a detail is on this specification, say so rather than guessing.',
      'Treat this profile as background: don’t recite it or list spec codes unless the student asks.'
    );
  }
  return lines.filter(l => l !== '').join('\n');
}
