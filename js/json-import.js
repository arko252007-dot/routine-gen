/**
 * RoutineGen - JSON Routine Import & Real-Time Conflict Resolution Subsystem
 *
 * Architecture & Execution Flow:
 * - Direct Schedule Ingestion: Ingests declarative JSON payloads specifying global settings, faculty availability
 *   windows, and granular schedule entries (department, semester, day, period, subject, teacher, class type).
 * - Real-Time Conflict Detection Engine:
 *     1. Section Clashes: Detects duplicate period bookings within the same department and semester.
 *     2. Global Faculty Overlaps: Tracks busy clock-time intervals ([startMin, endMin)) across all sections,
 *        preventing a faculty member from being scheduled in two places simultaneously.
 *     3. Daily Availability Enforcement: Validates class intervals against teachers' declared college operating windows.
 *     4. Multi-Period Lookahead: Validates 2-period extended and lab classes for consecutive slot availability and tiffin avoidance.
 * - Interactive Clash Resolution:
 *     - Auto-Place: Algorithmic search that detects the earliest subsequent free slot without section or faculty conflicts.
 *     - Slot Substitution: Converts clash slots into filler activities (Library, Seminar, Project) to preserve continuity.
 * - Application Handshake: Serializes placed timetables into `sessionStorage` ('routine_maker_json_routine')
 *   and restores them into Step 4 of the main wizard.
 */

// ── Application Theme Initialization ────────────────────────────────────────

document.documentElement.setAttribute('data-bs-theme', 'dark');
localStorage.setItem('theme', 'dark');

// ── Chronological Calculation Helpers ───────────────────────────────────────

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_SETTINGS = { periods: 8, periodDuration: 45, startTime: '09:00', tiffinPeriod: 4, tiffinDuration: 30 };

/**
 * Converts a 24-hour time string ("HH:MM") into the number of elapsed minutes from midnight (00:00).
 *
 * @param {string} timeStr - Time formatted as "HH:MM". Defaults to "09:00" if undefined/empty.
 * @returns {number} Total elapsed minutes in the range [0, 1439].
 */
function parseTimeToMinutes(timeStr) {
  const [h, m] = (timeStr || '09:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Formats a minute-of-day integer into a localized 12-hour AM/PM label (e.g., 540 -> "9:00 AM").
 *
 * @param {number} totalMinutes - Minutes from midnight. Normalized with modulo arithmetic to handle wraps.
 * @returns {string} Human-readable clock time formatted as "H:MM AM|PM".
 */
function minutesToTimeLabel(totalMinutes) {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  let hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  if (hours === 0) hours = 12;
  return `${hours}:${minutes.toString().padStart(2, '0')} ${suffix}`;
}

/**
 * Computes period chronological boundaries (startMin, endMin) for a specific section timing config.
 *
 * @param {Object} timing - Section timing config.
 * @returns {Array<Object>} Period chronological boundaries.
 */
function calcPeriodTimesForTiming(timing) {
  const times = [];
  let current = parseTimeToMinutes(timing.startTime);
  const pDuration = timing.periodDuration || timing.duration || 45;
  const tDuration = timing.tiffinDuration || 30;
  const totalPeriods = timing.periods || 8;
  for (let p = 1; p <= totalPeriods; p++) {
    const duration = (p === timing.tiffinPeriod) ? tDuration : pDuration;
    const start = current;
    const end = current + duration;
    times.push({ period: p, startMin: start, endMin: end, start: minutesToTimeLabel(start), end: minutesToTimeLabel(end) });
    current = end;
  }
  return times;
}

/**
 * Mathematical interval intersection test.
 *
 * @param {number} aStart - Interval A start.
 * @param {number} aEnd - Interval A end.
 * @param {number} bStart - Interval B start.
 * @param {number} bEnd - Interval B end.
 * @returns {boolean} True if intervals overlap in non-zero time.
 */
function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sectionKey(deptName, semId) {
  return `${deptName}::${semId}`;
}

// --- CLASS TYPE DEFINITIONS (mirrors app.js) ---
const CLASS_TYPES = {
  theory:          { label: 'Theory',        periods: 1 },
  theory_extended: { label: 'Theory (Ext)',  periods: 2 },
  lab_mini:        { label: 'Lab',            periods: 1 },
  lab_extended:    { label: 'Lab (Ext)',      periods: 2 },
  theory_lab:      { label: 'Theory + Lab',   periods: 2 },
  filler:          { label: 'Other',          periods: 1 }
};
function typeInfo(type) {
  return CLASS_TYPES[type] || CLASS_TYPES.theory;
}
function isExtendedType(type) {
  return typeInfo(type).periods === 2;
}
function cellSubjectLabel(subject, type) {
  if (type === 'filler') return subject;
  if (type === 'lab_mini' || type === 'lab_extended') return `${subject} (LAB)`;
  if (type === 'theory_lab') return `${subject} (Theory + Lab)`;
  return subject;
}

// --- SAMPLE JSON ---
const SAMPLE_JSON = {
  settings: {
    periods: 5,
    periodDuration: 45,
    startTime: "12:00",
    tiffinPeriod: 3,
    tiffinDuration: 45,
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]
  },
  teachers: [
    // Optional - illustrates a restricted daily window. Omit any teacher
    // entirely (as all the others below are) to keep them available all day.
    { "name": "Mr. Amit", "availableFrom": "11:00", "availableTo": "18:00" }
  ],
  entries: [
    // BCA Semester 1 (Starts at 12:00 PM)
    { "department": "BCA", "semester": "Semester 1", "day": "Monday", "period": 1, "subject": "C Programming", "teacher": "Mr. Amit", "type": "theory", "timing": { "startTime": "12:00" } },
    { "department": "BCA", "semester": "Semester 1", "day": "Monday", "period": 2, "subject": "Digital Logic", "teacher": "Ms. Priya", "type": "theory", "timing": { "startTime": "12:00" } },
    { "department": "BCA", "semester": "Semester 1", "day": "Monday", "period": 4, "subject": "Programming Lab", "teacher": "Mr. Amit", "type": "lab_extended", "timing": { "startTime": "12:00" } },
    { "department": "BCA", "semester": "Semester 1", "day": "Tuesday", "period": 1, "subject": "Discrete Maths", "teacher": "Ms. Priya", "type": "theory_extended", "timing": { "startTime": "12:00" } },
    { "department": "BCA", "semester": "Semester 1", "day": "Wednesday", "period": 1, "subject": "Web Design", "teacher": "Mr. Amit", "type": "theory_lab", "timing": { "startTime": "12:00" } },
    { "department": "BCA", "semester": "Semester 1", "day": "Wednesday", "period": 4, "subject": "Library", "teacher": "-", "type": "filler", "periods": 1, "timing": { "startTime": "12:00" } },
    
    // BCA Semester 2 (Starts at 1:00 PM)
    { "department": "BCA", "semester": "Semester 2", "day": "Monday", "period": 1, "subject": "Data Structures", "teacher": "Mr. Amit", "type": "theory", "timing": { "startTime": "13:00" } },
    { "department": "BCA", "semester": "Semester 2", "day": "Monday", "period": 2, "subject": "DBMS", "teacher": "Ms. Priya", "type": "theory", "timing": { "startTime": "13:00" } },
    { "department": "BCA", "semester": "Semester 2", "day": "Monday", "period": 4, "subject": "DBMS Lab", "teacher": "Ms. Priya", "type": "lab_extended", "timing": { "startTime": "13:00" } },
    
    // BCA Semester 3 (Starts at 12:00 PM)
    { "department": "BCA", "semester": "Semester 3", "day": "Thursday", "period": 1, "subject": "Operating Systems", "teacher": "Dr. Sen", "type": "theory", "timing": { "startTime": "12:00" } },
    { "department": "BCA", "semester": "Semester 3", "day": "Thursday", "period": 2, "subject": "Java Tech", "teacher": "Mr. Amit", "type": "theory", "timing": { "startTime": "12:00" } },
    { "department": "BCA", "semester": "Semester 3", "day": "Thursday", "period": 4, "subject": "OS Lab", "teacher": "Dr. Sen", "type": "lab_extended", "timing": { "startTime": "12:00" } },
    
    // BCA Semester 4 (Starts at 1:00 PM)
    { "department": "BCA", "semester": "Semester 4", "day": "Thursday", "period": 1, "subject": "Software Eng", "teacher": "Dr. Sen", "type": "theory", "timing": { "startTime": "13:00" } },
    { "department": "BCA", "semester": "Semester 4", "day": "Thursday", "period": 2, "subject": "Computer Networks", "teacher": "Mr. Amit", "type": "theory", "timing": { "startTime": "13:00" } },
    { "department": "BCA", "semester": "Semester 4", "day": "Thursday", "period": 4, "subject": "Networks Lab", "teacher": "Mr. Amit", "type": "lab_extended", "timing": { "startTime": "13:00" } },

    // BBA Semester 1 (Starts at 12:00 PM)
    { "department": "BBA", "semester": "Semester 1", "day": "Monday", "period": 1, "subject": "Management Principles", "teacher": "Dr. Roy", "type": "theory", "timing": { "startTime": "12:00" } },
    { "department": "BBA", "semester": "Semester 1", "day": "Monday", "period": 2, "subject": "Business Comm", "teacher": "Ms. Sinha", "type": "theory", "timing": { "startTime": "12:00" } },
    
    // BBA Semester 2 (Starts at 1:00 PM)
    { "department": "BBA", "semester": "Semester 2", "day": "Monday", "period": 1, "subject": "Organizational Behavior", "teacher": "Dr. Roy", "type": "theory", "timing": { "startTime": "13:00" } },
    { "department": "BBA", "semester": "Semester 2", "day": "Monday", "period": 2, "subject": "Marketing Mgmt", "teacher": "Ms. Sinha", "type": "theory", "timing": { "startTime": "13:00" } },
    
    // BBA Semester 3 (Starts at 12:00 PM)
    { "department": "BBA", "semester": "Semester 3", "day": "Friday", "period": 1, "subject": "Financial Mgmt", "teacher": "Ms. Sinha", "type": "theory", "timing": { "startTime": "12:00" } },
    { "department": "BBA", "semester": "Semester 3", "day": "Friday", "period": 2, "subject": "Human Resource Mgmt", "teacher": "Dr. Roy", "type": "theory", "timing": { "startTime": "12:00" } },
    
    // BBA Semester 4 (Starts at 1:00 PM)
    { "department": "BBA", "semester": "Semester 4", "day": "Friday", "period": 1, "subject": "Strategic Mgmt", "teacher": "Dr. Roy", "type": "theory", "timing": { "startTime": "13:00" } },
    { "department": "BBA", "semester": "Semester 4", "day": "Friday", "period": 2, "subject": "Entrepreneurship", "teacher": "Ms. Sinha", "type": "theory", "timing": { "startTime": "13:00" } },

    // BBA-HOTEL Semester 1 (Starts at 12:00 PM)
    { "department": "BBA-HOTEL", "semester": "Semester 1", "day": "Tuesday", "period": 1, "subject": "Front Office Operations", "teacher": "Mr. Chef Gill", "type": "theory", "timing": { "startTime": "12:00" } },
    { "department": "BBA-HOTEL", "semester": "Semester 1", "day": "Tuesday", "period": 2, "subject": "Housekeeping Mgmt", "teacher": "Ms. Kapoor", "type": "theory", "timing": { "startTime": "12:00" } },
    
    // BBA-HOTEL Semester 2 (Starts at 1:00 PM)
    { "department": "BBA-HOTEL", "semester": "Semester 2", "day": "Tuesday", "period": 1, "subject": "Food Production", "teacher": "Mr. Chef Gill", "type": "theory", "timing": { "startTime": "13:00" } },
    { "department": "BBA-HOTEL", "semester": "Semester 2", "day": "Tuesday", "period": 4, "subject": "Kitchen Lab", "teacher": "Mr. Chef Gill", "type": "lab_extended", "timing": { "startTime": "13:00" } },
    
    // BBA-HOTEL Semester 3 (Starts at 12:00 PM)
    { "department": "BBA-HOTEL", "semester": "Semester 3", "day": "Wednesday", "period": 1, "subject": "Beverage Service", "teacher": "Ms. Kapoor", "type": "theory", "timing": { "startTime": "12:00" } },
    { "department": "BBA-HOTEL", "semester": "Semester 3", "day": "Wednesday", "period": 4, "subject": "Bar Operations Lab", "teacher": "Ms. Kapoor", "type": "lab_extended", "timing": { "startTime": "12:00" } },
    
    // BBA-HOTEL Semester 4 (Starts at 1:00 PM)
    { "department": "BBA-HOTEL", "semester": "Semester 4", "day": "Wednesday", "period": 2, "subject": "Hotel Accounting", "teacher": "Ms. Kapoor", "type": "theory", "timing": { "startTime": "13:00" } },
    { "department": "BBA-HOTEL", "semester": "Semester 4", "day": "Thursday", "period": 1, "subject": "Hospitality Marketing", "teacher": "Mr. Chef Gill", "type": "theory", "timing": { "startTime": "13:00" } },

    // BHM Semester 1 (Starts at 12:00 PM)
    { "department": "BHM", "semester": "Semester 1", "day": "Wednesday", "period": 1, "subject": "Culinary Arts", "teacher": "Mr. Chef Gill", "type": "theory", "timing": { "startTime": "12:00" } },
    { "department": "BHM", "semester": "Semester 1", "day": "Wednesday", "period": 2, "subject": "Bakery Science", "teacher": "Mr. Sharma", "type": "theory", "timing": { "startTime": "12:00" } },
    { "department": "BHM", "semester": "Semester 1", "day": "Wednesday", "period": 4, "subject": "Culinary Lab", "teacher": "Mr. Chef Gill", "type": "lab_extended", "timing": { "startTime": "12:00" } },
    
    // BHM Semester 2 (Starts at 1:00 PM)
    { "department": "BHM", "semester": "Semester 2", "day": "Wednesday", "period": 1, "subject": "Food Safety", "teacher": "Mr. Sharma", "type": "theory", "timing": { "startTime": "13:00" } },
    { "department": "BHM", "semester": "Semester 2", "day": "Wednesday", "period": 4, "subject": "Nutrition Lab", "teacher": "Mr. Sharma", "type": "lab_extended", "timing": { "startTime": "13:00" } },
    
    // BHM Semester 3 (Starts at 12:00 PM)
    { "department": "BHM", "semester": "Semester 3", "day": "Friday", "period": 1, "subject": "Catering Mgmt", "teacher": "Mr. Chef Gill", "type": "theory", "timing": { "startTime": "12:00" } },
    { "department": "BHM", "semester": "Semester 3", "day": "Friday", "period": 2, "subject": "Menu Planning", "teacher": "Mr. Sharma", "type": "theory", "timing": { "startTime": "12:00" } },
    
    // BHM Semester 4 (Starts at 1:00 PM)
    { "department": "BHM", "semester": "Semester 4", "day": "Friday", "period": 1, "subject": "Facility Design", "teacher": "Mr. Sharma", "type": "theory", "timing": { "startTime": "13:00" } },
    { "department": "BHM", "semester": "Semester 4", "day": "Friday", "period": 2, "subject": "Hotel Law", "teacher": "Mr. Chef Gill", "type": "theory", "timing": { "startTime": "13:00" } }
  ]
};

// ============================================================================
// 3. IN-MEMORY INGESTION & SCHEDULING STATE
// ============================================================================

/** @type {Object.<string, {deptName: string, semId: string, semLabel: string, timing: Object, periodTimes: Array<{start: string, end: string, startMin: number, endMin: number}>, schedule: Object.<string, Object.<string, Object>>}>} */
let sectionsMap = {};

/**
 * Registry of teacher schedule commitments across all departments and semesters.
 * Indexed by day name -> teacher name -> array of allocated intervals.
 * @type {Object.<string, Object.<string, Array<{start: number, end: number, subject: string, section: string}>>>}
 */
let teacherBusy = {};

/**
 * Optional daily working windows per teacher (in absolute minutes from midnight).
 * If undefined for a teacher, default availability spans the entire day.
 * @type {Object.<string, {start: number, end: number}>}
 */
let teacherAvailability = {};

/** @type {Array<Object>} Successfully scheduled entry records. */
let acceptedEntries = [];

/** @type {number} Running count of active/unresolved scheduling collisions. */
let conflictCount = 0;

/**
 * Backlog of unresolved timetable conflicts awaiting automated or manual resolution.
 * @type {Array<{entry: Object, globalSettings: Object, logIndex: number, resolved?: boolean}>}
 */
let conflictsList = [];

/** @type {string[]} Active instructional days for the current schedule cycle. */
let currentWorkingDays = [...DAYS_OF_WEEK];

/**
 * Validates whether a proposed time interval [startMin, endMin) fits within
 * an instructor's configured working window.
 *
 * @param {string} teacherName - Full name of the teacher.
 * @param {number} startMin - Interval start in minutes from midnight.
 * @param {number} endMin - Interval end in minutes from midnight.
 * @returns {boolean} True if within working window or if no restriction is set.
 */
function withinTeacherAvailability(teacherName, startMin, endMin) {
  const win = teacherAvailability[teacherName];
  if (!win) return true;
  return startMin >= win.start && endMin <= win.end;
}

const elJsonInput = document.getElementById('json-input');
const elError = document.getElementById('json-error');
const elLog = document.getElementById('build-log');
const elLogEmpty = document.getElementById('build-log-empty');
const elStatusAccepted = document.getElementById('status-accepted');
const elStatusConflicts = document.getElementById('status-conflicts');
const elTablesWrapper = document.getElementById('routine-tables-wrapper');
const elSendBtn = document.getElementById('btn-send-to-app');
const elClearConflictsBtn = document.getElementById('btn-clear-conflicts');

document.getElementById('btn-load-sample').addEventListener('click', () => {
  elJsonInput.value = JSON.stringify(SAMPLE_JSON, null, 2);
});

document.getElementById('btn-clear-json').addEventListener('click', () => {
  elJsonInput.value = '';
  elError.classList.add('d-none');
});

function showError(msg) {
  elError.textContent = msg;
  elError.classList.remove('d-none');
}

function hideError() {
  elError.classList.add('d-none');
}

/**
 * Resets all in-memory schedule matrices, collision indices, and UI output elements.
 */
function resetState() {
  sectionsMap = {};
  teacherBusy = {};
  teacherAvailability = {};
  acceptedEntries = [];
  conflictCount = 0;
  conflictsList = [];
  elLog.innerHTML = '';
  elTablesWrapper.innerHTML = '';
  elStatusAccepted.textContent = '0 placed';
  elStatusConflicts.textContent = '0 conflicts';
  elSendBtn.classList.add('d-none');
  if (elClearConflictsBtn) elClearConflictsBtn.classList.add('d-none');
  const card = document.getElementById('teacher-grid-card');
  if (card) card.classList.add('d-none');
}

/**
 * Toggles visibility of the global conflict resolution action button
 * based on the existence of unresolved collision items.
 */
function updateClearConflictsBtn() {
  if (!elClearConflictsBtn) return;
  const anyUnresolved = conflictsList.some(c => c && !c.resolved);
  elClearConflictsBtn.classList.toggle('d-none', !anyUnresolved);
}

/**
 * Prepends a structured activity item to the interactive build log.
 *
 * @param {'ok'|'conflict'} kind - Classification of the log message.
 * @param {string} text - Message text or embedded HTML markup.
 * @param {number} [id] - Optional DOM identifier suffix for subsequent in-place updates.
 */
function logEntry(kind, text, id) {
  const emptyEl = document.getElementById('build-log-empty');
  if (emptyEl) { emptyEl.remove(); }
  const div = document.createElement('div');
  div.className = `build-log-entry ${kind}`;
  if (id !== undefined) div.id = `log-entry-${id}`;
  div.innerHTML = `<i class="bi ${kind === 'ok' ? 'bi-check-circle-fill' : 'bi-x-octagon-fill'}"></i><span class="flex-grow-1">${text}</span>`;
  elLog.prepend(div);
}

/**
 * Retrieves an existing department/semester section or initializes a new one.
 * The section's timing schedule is locked upon initial registration to ensure period consistency.
 *
 * @param {string} deptName - Department name (e.g., "BCA").
 * @param {string} semLabel - Normalized semester label (e.g., "Semester 1").
 * @param {Object} timing - Bell schedule configuration for the section.
 * @returns {Object} Target section state object.
 */
function getOrCreateSection(deptName, semLabel, timing) {
  for (const key in sectionsMap) {
    const s = sectionsMap[key];
    if (s.deptName === deptName && s.semLabel === semLabel) return s;
  }
  const semId = uid('sem');
  const sec = {
    deptName,
    semId,
    semLabel,
    timing: { ...timing },
    periodTimes: calcPeriodTimesForTiming(timing),
    schedule: {}
  };
  DAYS_OF_WEEK.forEach(d => { sec.schedule[d] = {}; });
  sectionsMap[sectionKey(deptName, semId)] = sec;
  return sec;
}

/**
 * Validates and attempts to place an individual timetable entry into the target section.
 *
 * Enforces five critical validation layers:
 * 1. Completeness & valid calendar instructional day.
 * 2. Period boundary limits and Tiffin Break collision prevention.
 * 3. Multi-period lookahead availability for double-period classes (e.g. lab_extended).
 * 4. Instructor working window restrictions (if configured).
 * 5. Global clock-time collision detection across all departments and semesters, plus
 *    single-session daily limits per section.
 *
 * @param {Object} entry - Raw class allocation descriptor from JSON payload.
 * @param {Object} globalSettings - Fallback bell schedule timings.
 * @returns {{ok: boolean, reason: string, day?: string, periodKey?: string, sec?: Object}} Result status.
 */
function processEntry(entry, globalSettings) {
  const dept = (entry.department || '').toString().trim().toUpperCase();
  let rawSem = (entry.semester != null ? entry.semester.toString().trim() : '');
  const semLabel = (/^\d+$/.test(rawSem)) ? `Semester ${rawSem}` : rawSem;
  const day = (entry.day || '').toString().trim();
  const period = parseInt(entry.period, 10);
  const subject = (entry.subject || '').toString().trim();
  const teacher = (entry.teacher || '').toString().trim();
  const type = entry.type || 'theory';
  const rawTiming = entry.timing ? { ...globalSettings, ...entry.timing } : globalSettings;
  const timing = {
    ...rawTiming,
    periodDuration: rawTiming.periodDuration || rawTiming.duration || 45,
    tiffinDuration: rawTiming.tiffinDuration || 30,
    periods: rawTiming.periods || 8,
    startTime: rawTiming.startTime || '09:00',
    tiffinPeriod: rawTiming.tiffinPeriod || 4
  };

  if (!dept || !semLabel || !day || !period || !subject || !teacher) {
    return { ok: false, reason: `Skipped incomplete entry: ${JSON.stringify(entry)}` };
  }
  if (!DAYS_OF_WEEK.includes(day)) {
    return { ok: false, reason: `"${day}" is not a valid day for ${dept}/${semLabel}, ${subject}` };
  }

  const sec = getOrCreateSection(dept, semLabel, timing);

  if (period < 1 || period > sec.timing.periods) {
    return { ok: false, reason: `Period ${period} is out of range (1-${sec.timing.periods}) for ${dept}/${semLabel}` };
  }
  if (period === sec.timing.tiffinPeriod) {
    return { ok: false, reason: `Period ${period} is the Tiffin Break for ${dept}/${semLabel} - can't schedule ${subject} there` };
  }

  const periodKey = `Period ${period}`;
  const isFiller = type === 'filler';
  // Filler entries (e.g. Library) may span 1 or 2 periods and bypass teacher collision checks
  const isExtended = isFiller ? (Math.max(1, parseInt(entry.periods, 10) || 1) === 2) : isExtendedType(type);
  let startMin = sec.periodTimes[period - 1].startMin;
  let endMin = sec.periodTimes[period - 1].endMin;
  let nextPeriodIdx = null;

  // Lookahead validation for two-period spans
  if (isExtended) {
    nextPeriodIdx = period + 1;
    if (nextPeriodIdx > sec.timing.periods) {
      return { ok: false, reason: `"${subject}" at period ${period} has no following period to extend into for ${dept}/${semLabel}` };
    }
    if (nextPeriodIdx === sec.timing.tiffinPeriod) {
      return { ok: false, reason: `"${subject}" at period ${period} would run into the Tiffin Break for ${dept}/${semLabel}` };
    }
    if (sec.schedule[day][`Period ${nextPeriodIdx}`]) {
      return { ok: false, reason: `Period ${nextPeriodIdx} is already occupied - "${subject}" can't span into it (${dept}/${semLabel}, ${day})` };
    }
    endMin = sec.periodTimes[nextPeriodIdx - 1].endMin;
  }

  // Section internal slot check
  if (sec.schedule[day][periodKey]) {
    return { ok: false, reason: `${dept}/${semLabel} already has a class in ${periodKey} on ${day} - "${subject}" (${teacher}) clashes with it` };
  }

  if (!isFiller) {
    // 1. Instructor custom working window check
    if (!withinTeacherAvailability(teacher, startMin, endMin)) {
      const win = teacherAvailability[teacher];
      return {
        ok: false,
        reason: `${teacher} is only available ${minutesToTimeLabel(win.start)}-${minutesToTimeLabel(win.end)}, which doesn't cover ${subject} for ${dept}/${semLabel} at ${minutesToTimeLabel(startMin)}-${minutesToTimeLabel(endMin)}`
      };
    }

    // 2. Cross-institutional clock-time collision check
    if (!teacherBusy[day]) teacherBusy[day] = {};
    if (!teacherBusy[day][teacher]) teacherBusy[day][teacher] = [];

    const clash = teacherBusy[day][teacher].find(iv => intervalsOverlap(startMin, endMin, iv.start, iv.end));
    if (clash) {
      return {
        ok: false,
        reason: `${teacher} is already teaching ${clash.subject} for ${clash.section} on ${day} at ${minutesToTimeLabel(clash.start)}-${minutesToTimeLabel(clash.end)}, which overlaps ${subject} for ${dept}/${semLabel} at ${minutesToTimeLabel(startMin)}-${minutesToTimeLabel(endMin)}`
      };
    }

    // 3. Daily single-session limit per teacher per section
    const sameSectionClash = teacherBusy[day][teacher].find(iv => iv.section === `${dept}/${semLabel}`);
    if (sameSectionClash) {
      return {
        ok: false,
        reason: `${teacher} is already teaching ${sameSectionClash.subject} for ${dept}/${semLabel} on ${day}. In a day, a teacher can only teach at most one session per section.`
      };
    }

    teacherBusy[day][teacher].push({ start: startMin, end: endMin, subject, section: `${dept}/${semLabel}` });
  }

  // Slot assignment & span placeholder reservation
  if (isExtended) {
    sec.schedule[day][periodKey] = { kind: 'class', subject, teacher, type, span: 2 };
    sec.schedule[day][`Period ${nextPeriodIdx}`] = { kind: 'skip' };
  } else {
    sec.schedule[day][periodKey] = { kind: 'class', subject, teacher, type, span: 1 };
  }

  acceptedEntries.push({ dept, semLabel, semId: sec.semId, day, period, subject, teacher, type });

  return { ok: true, reason: `Placed "${subject}" (${teacher}) - ${dept}/${semLabel}, ${day} ${periodKey} (${minutesToTimeLabel(startMin)}-${minutesToTimeLabel(endMin)})`, day, periodKey, sec };
}

/**
 * Renders interactive timetable preview grids grouped by academic department and semester.
 * Emits HTML table elements formatted with responsive containers and timing headers.
 */
function renderTables() {
  elTablesWrapper.innerHTML = '';
  const byDept = {};
  Object.values(sectionsMap).forEach(sec => {
    if (!byDept[sec.deptName]) byDept[sec.deptName] = [];
    byDept[sec.deptName].push(sec);
  });

  Object.entries(byDept).forEach(([deptName, secs]) => {
    const card = document.createElement('div');
    card.className = 'card border-0 shadow-sm mb-4 overflow-hidden';
    let body = '';

    secs.forEach(sec => {
      const periods = Array.from({ length: sec.timing.periods }, (_, i) => `Period ${i + 1}`);
      let head = `<tr><th style="width:120px;" class="ps-3 text-secondary small">Day/Period</th>`;
      periods.forEach((p, idx) => {
        const t = sec.periodTimes[idx];
        head += `<th class="text-center text-secondary small"><div>${p}</div><div class="fw-normal text-muted" style="font-size:0.68em;">${t.start} - ${t.end}</div></th>`;
      });
      head += `</tr>`;

      let rows = '';
      currentWorkingDays.forEach(day => {
        const daySchedule = sec.schedule[day] || {};
        const hasAny = Object.keys(daySchedule).length > 0;
        if (!hasAny) return; // Only render instructional days containing scheduled items
        rows += `<tr><td class="fw-bold bg-light ps-3 text-dark">${day}</td>`;
        periods.forEach(period => {
          const cell = daySchedule[period];
          if (cell && cell.kind === 'skip') return;
          let cls = 'text-center align-middle';
          let html = `<small class="text-muted">-</small>`;
          let span = '';
          if (cell && cell.kind === 'class') {
            cls += ' text-dark fw-medium cell-placed';
            if (cell.type === 'filler') {
              if (cell.teacher && cell.teacher !== '-') {
                html = `<div class="small">${cell.subject}</div><div class="small text-muted fw-normal">${cell.teacher}</div>`;
              } else {
                html = `<div class="small">${cell.subject}</div>`;
              }
            } else {
              const label = cellSubjectLabel(cell.subject, cell.type || (cell.isLab ? 'lab_mini' : 'theory'));
              html = `<div class="small">${label}</div><div class="small text-muted fw-normal">${cell.teacher}</div>`;
            }
            if (cell.span > 1) span = ` colspan="${cell.span}"`;
          }
          rows += `<td class="${cls}"${span}>${html}</td>`;
        });
        rows += `</tr>`;
      });

      if (!rows) {
        rows = `<tr><td colspan="${periods.length + 1}" class="text-center text-muted py-3 small">No entries placed yet for this semester</td></tr>`;
      }

      body += `
        <div class="border-bottom border-light-subtle">
          <div class="px-3 py-2 bg-light bg-opacity-50 semester-mini-title fw-bold text-secondary">${sec.semLabel}</div>
          <div class="table-responsive">
            <table class="table table-bordered align-middle mb-0 routine-table">
              <thead class="table-light">${head}</thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="card-header bg-white border-0 py-3"><h5 class="mb-0 text-primary fw-bold">${deptName}</h5></div>
      <div class="card-body p-0">${body}</div>
    `;
    elTablesWrapper.appendChild(card);
  });
}

/**
 * Utility pause function for staggering DOM updates and asynchronous batch scheduling passes.
 * @param {number} ms - Milliseconds to delay execution.
 * @returns {Promise<void>}
 */
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// ============================================================================
// 4. AUTOMATED & MANUAL CONFLICT RESOLUTION
// ============================================================================

/**
 * Attempts to reallocate a conflicting entry to the earliest available valid slot
 * across all designated working days and periods for its section.
 *
 * Checks section availability, lookahead extensions for multi-period slots,
 * teacher working windows, and cross-institutional teacher overlap.
 *
 * @param {number} index - Index of the conflict within `conflictsList`.
 * @returns {boolean} True if successfully placed, false if no open slot satisfied constraints.
 */
function tryAutoPlaceConflict(index) {
  const c = conflictsList[index];
  if (!c || c.resolved) return false;

  const dept = (c.entry.department || '').toString().trim().toUpperCase();
  let rawSem = (c.entry.semester != null ? c.entry.semester.toString().trim() : '');
  const semLabel = (/^\d+$/.test(rawSem)) ? `Semester ${rawSem}` : rawSem;
  c.entry.department = dept;
  c.entry.semester = semLabel;

  const timing = c.entry.timing ? { ...c.globalSettings, ...c.entry.timing } : c.globalSettings;
  const sec = getOrCreateSection(dept, semLabel, timing);

  const isFiller = c.entry.type === 'filler';
  const isExtended = isFiller
    ? (Math.max(1, parseInt(c.entry.periods, 10) || 1) === 2)
    : isExtendedType(c.entry.type);

  for (const day of currentWorkingDays) {
    for (let p = 1; p <= sec.timing.periods; p++) {
      if (p === sec.timing.tiffinPeriod) continue;

      const periodKey = `Period ${p}`;
      if (sec.schedule[day][periodKey]) continue;

      const pTime = sec.periodTimes[p - 1];
      let startMin = pTime.startMin;
      let endMin = pTime.endMin;
      let nextPeriodIdx = null;

      if (isExtended) {
        nextPeriodIdx = p + 1;
        if (nextPeriodIdx > sec.timing.periods) continue;
        if (nextPeriodIdx === sec.timing.tiffinPeriod) continue;
        if (sec.schedule[day][`Period ${nextPeriodIdx}`]) continue;
        endMin = sec.periodTimes[nextPeriodIdx - 1].endMin;
      }

      if (!isFiller) {
        if (!withinTeacherAvailability(c.entry.teacher, startMin, endMin)) continue;

        if (!teacherBusy[day]) teacherBusy[day] = {};
        if (!teacherBusy[day][c.entry.teacher]) teacherBusy[day][c.entry.teacher] = [];

        const overlap = teacherBusy[day][c.entry.teacher].some(iv => intervalsOverlap(startMin, endMin, iv.start, iv.end));
        if (overlap) continue;
      }

      // Slot assignment
      if (isExtended) {
        sec.schedule[day][periodKey] = { kind: 'class', subject: c.entry.subject, teacher: isFiller ? '-' : c.entry.teacher, type: c.entry.type, span: 2 };
        sec.schedule[day][`Period ${nextPeriodIdx}`] = { kind: 'skip' };
      } else {
        sec.schedule[day][periodKey] = { kind: 'class', subject: c.entry.subject, teacher: isFiller ? '-' : c.entry.teacher, type: c.entry.type, span: 1 };
      }

      if (!isFiller) {
        teacherBusy[day][c.entry.teacher].push({
          start: startMin,
          end: endMin,
          subject: c.entry.subject,
          section: `${dept}/${semLabel}`
        });
      }

      acceptedEntries.push({
        dept,
        semLabel,
        semId: sec.semId,
        day,
        period: p,
        subject: c.entry.subject,
        teacher: isFiller ? '-' : c.entry.teacher,
        type: c.entry.type || 'theory',
        periods: isExtended ? 2 : 1
      });

      c.resolved = true;
      conflictCount--;
      elStatusAccepted.textContent = `${acceptedEntries.length} placed`;
      elStatusConflicts.textContent = `${conflictCount} conflicts`;
      updateClearConflictsBtn();

      const logEl = document.getElementById(`log-entry-${c.logIndex}`);
      if (logEl) {
        logEl.className = 'build-log-entry ok';
        logEl.innerHTML = `<i class="bi bi-check-circle-fill"></i><span>Auto-placed: Placed "${c.entry.subject}" (${c.entry.teacher}) at ${day} Period ${p} (${minutesToTimeLabel(startMin)}-${minutesToTimeLabel(endMin)})</span>`;
      }

      renderTables();
      renderTeacherGrid();

      if (acceptedEntries.length > 0) {
        elSendBtn.classList.remove('d-none');
      }

      return true;
    }
  }

  return false;
}

/**
 * Event handler for single-conflict auto-placement initiated from inline log action buttons.
 * @param {number} index - Index in conflictsList.
 */
window.autoPlaceConflict = function(index) {
  const c = conflictsList[index];
  if (!c) return;
  const placed = tryAutoPlaceConflict(index);
  if (!placed) {
    alert(`Could not automatically find any free slot for ${c.entry.teacher} / ${c.entry.subject} in ${c.entry.department.toUpperCase()}/${c.entry.semester}.`);
  }
};

/**
 * Batch resolves all active timetable conflicts iteratively.
 * Each sequential placement updates the shared teacher busy matrix and section schedule,
 * ensuring subsequent placements respect newly reserved intervals.
 */
window.clearAllConflicts = async function() {
  const targets = conflictsList
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) => c && !c.resolved);

  if (targets.length === 0) return;

  if (elClearConflictsBtn) {
    elClearConflictsBtn.disabled = true;
    elClearConflictsBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> Clearing...';
  }

  const stillStuck = [];
  for (const { c, idx } of targets) {
    const placed = tryAutoPlaceConflict(idx);
    if (!placed) stillStuck.push(`${c.entry.teacher} / ${c.entry.subject} (${c.entry.department.toUpperCase()}/${c.entry.semester})`);
    // eslint-disable-next-line no-await-in-loop
    await sleep(60);
  }

  if (elClearConflictsBtn) {
    elClearConflictsBtn.disabled = false;
    elClearConflictsBtn.innerHTML = '<i class="bi bi-magic"></i> Clear All Conflicts';
  }
  updateClearConflictsBtn();

  if (stillStuck.length > 0) {
    alert(`Placed everything that had room. ${stillStuck.length} conflict(s) still have no free, non-clashing slot available:\n\n${stillStuck.join('\n')}`);
  }
};

elClearConflictsBtn?.addEventListener('click', window.clearAllConflicts);

// ============================================================================
// 5. PLACEHOLDER / FILLER CLASS INJECTION MODAL
// ============================================================================

let fillerConflictIndex = null;
const jiFillerModalEl = document.getElementById('ji-filler-modal');
const jiFillerModal = jiFillerModalEl ? new bootstrap.Modal(jiFillerModalEl) : null;
const jiFillerChoiceEl = document.getElementById('ji-filler-choice');
const jiFillerOtherWrap = document.getElementById('ji-filler-other-wrap');
const jiFillerOtherNameEl = document.getElementById('ji-filler-other-name');
const jiFillerOtherTeacherEl = document.getElementById('ji-filler-other-teacher');
const jiFillerPeriodsEl = document.getElementById('ji-filler-periods');

const jiFillerSlotEl = document.getElementById('ji-filler-slot');
const jiFillerContextEl = document.getElementById('ji-filler-context');
const jiFillerSlotNoteEl = document.getElementById('ji-filler-slot-note');

jiFillerChoiceEl?.addEventListener('change', () => {
  jiFillerOtherWrap.classList.toggle('d-none', jiFillerChoiceEl.value !== '__other__');
});

/**
 * Opens the manual placeholder insertion modal for a specific conflicting entry.
 * Populates candidate slot options based on the section's schedule and highlights availability.
 *
 * @param {number} index - Index of the conflict within `conflictsList`.
 */
window.openFillerModalForConflict = function (index) {
  const c = conflictsList[index];
  if (!c || c.resolved || !jiFillerModal) return;
  fillerConflictIndex = index;
  jiFillerChoiceEl.value = 'Library';
  jiFillerOtherWrap.classList.add('d-none');
  jiFillerOtherNameEl.value = '';
  if (jiFillerOtherTeacherEl) jiFillerOtherTeacherEl.value = '';
  jiFillerPeriodsEl.value = '1';

  const dept = (c.entry.department || '').toString().trim().toUpperCase();
  let rawSem = (c.entry.semester != null ? c.entry.semester.toString().trim() : '');
  const semLabel = (/^\d+$/.test(rawSem)) ? `Semester ${rawSem}` : rawSem;
  c.entry.department = dept;
  c.entry.semester = semLabel;
  const timing = c.entry.timing ? { ...c.globalSettings, ...c.entry.timing } : c.globalSettings;
  const sec = getOrCreateSection(dept, semLabel, timing);

  const reqDay = c.entry.day;
  const reqPeriod = parseInt(c.entry.period, 10);

  if (jiFillerContextEl) {
    jiFillerContextEl.innerHTML = `<strong>${dept} / ${semLabel}</strong> &mdash; Conflict for <strong>${c.entry.subject}</strong> (${c.entry.teacher}) at ${reqDay} Period ${reqPeriod}`;
  }

  if (jiFillerSlotEl) {
    jiFillerSlotEl.innerHTML = '';
    const reqKey = `${reqDay}|${reqPeriod}`;
    let reqIsAvailable = true;
    let reqReason = '';

    if (reqPeriod === sec.timing.tiffinPeriod) {
      reqIsAvailable = false;
      reqReason = 'Tiffin Break';
    } else if (reqPeriod > sec.timing.periods) {
      reqIsAvailable = false;
      reqReason = 'Out of range';
    } else if (sec.schedule[reqDay] && sec.schedule[reqDay][`Period ${reqPeriod}`]) {
      reqIsAvailable = false;
      const existingSub = sec.schedule[reqDay][`Period ${reqPeriod}`].subject || 'Another class';
      reqReason = `Occupied by ${existingSub}`;
    }

    const reqOpt = document.createElement('option');
    reqOpt.value = reqKey;
    if (reqIsAvailable) {
      reqOpt.textContent = `${reqDay} - Period ${reqPeriod} (Requested slot)`;
      reqOpt.selected = true;
    } else {
      reqOpt.textContent = `${reqDay} - Period ${reqPeriod} (${reqReason} - unavailable)`;
      reqOpt.disabled = true;
    }
    jiFillerSlotEl.appendChild(reqOpt);

    let selectedAny = reqIsAvailable;
    currentWorkingDays.forEach(day => {
      for (let p = 1; p <= sec.timing.periods; p++) {
        if (p === sec.timing.tiffinPeriod) continue;
        if (day === reqDay && p === reqPeriod) continue;
        if (sec.schedule[day] && sec.schedule[day][`Period ${p}`]) continue;
        const opt = document.createElement('option');
        opt.value = `${day}|${p}`;
        opt.textContent = `${day} - Period ${p} (Free)`;
        if (!selectedAny) {
          opt.selected = true;
          selectedAny = true;
        }
        jiFillerSlotEl.appendChild(opt);
      }
    });

    if (jiFillerSlotNoteEl) {
      if (!reqIsAvailable) {
        jiFillerSlotNoteEl.textContent = `Note: The requested slot (${reqDay} Period ${reqPeriod}) cannot be used because it is ${reqReason}. Please select an open slot from the list above.`;
        jiFillerSlotNoteEl.className = 'small text-warning mt-1';
      } else {
        jiFillerSlotNoteEl.textContent = `The requested slot is open in this section.`;
        jiFillerSlotNoteEl.className = 'small text-muted mt-1';
      }
    }
  }

  jiFillerModal.show();
};

/**
 * Confirms and injects a filler session (Library, Seminar, etc.) into the chosen slot,
 * resolving the active conflict and updating preview tables.
 */
document.getElementById('ji-btn-confirm-filler')?.addEventListener('click', () => {
  if (fillerConflictIndex === null) return;
  const c = conflictsList[fillerConflictIndex];
  if (!c || c.resolved) return;

  const choice = jiFillerChoiceEl.value;
  const customName = jiFillerOtherNameEl.value.trim();
  const label = choice === '__other__' ? (customName || 'Other') : 'Library';
  const customTeacher = (choice === '__other__' && jiFillerOtherTeacherEl) ? jiFillerOtherTeacherEl.value.trim() : '';
  const teacher = customTeacher || '-';
  const periodsCount = parseInt(jiFillerPeriodsEl.value, 10) || 1;

  const dept = c.entry.department.toUpperCase();
  const semLabel = c.entry.semester;
  const timing = c.entry.timing ? { ...c.globalSettings, ...c.entry.timing } : c.globalSettings;
  const sec = getOrCreateSection(dept, semLabel, timing);

  const slotVal = jiFillerSlotEl && jiFillerSlotEl.value ? jiFillerSlotEl.value : `${c.entry.day}|${c.entry.period}`;
  const [day, startPeriodStr] = slotVal.split('|');
  const startPeriod = parseInt(startPeriodStr, 10);

  for (let i = 0; i < periodsCount; i++) {
    const p = startPeriod + i;
    if (p > sec.timing.periods) {
      alert(`Period ${p} exceeds the total periods (${sec.timing.periods}) for ${dept}/${semLabel}.`);
      return;
    }
    if (p === sec.timing.tiffinPeriod) {
      alert(`Period ${p} is the Tiffin Break for ${dept}/${semLabel}. Classes cannot be scheduled during Tiffin Break.`);
      return;
    }
    if (sec.schedule[day][`Period ${p}`]) {
      const occ = sec.schedule[day][`Period ${p}`].subject || 'another class';
      alert(`Period ${p} on ${day} is already occupied by "${occ}".`);
      return;
    }
  }

  for (let i = 0; i < periodsCount; i++) {
    const p = startPeriod + i;
    sec.schedule[day][`Period ${p}`] = i === 0
      ? { kind: 'class', subject: label, teacher, type: 'filler', span: periodsCount }
      : { kind: 'skip' };
  }

  acceptedEntries.push({ dept, semLabel, semId: sec.semId, day, period: startPeriod, subject: label, teacher, type: 'filler', periods: periodsCount });

  c.resolved = true;
  conflictCount--;
  elStatusAccepted.textContent = `${acceptedEntries.length} placed`;
  elStatusConflicts.textContent = `${conflictCount} conflicts`;
  updateClearConflictsBtn();

  const logEl = document.getElementById(`log-entry-${c.logIndex}`);
  if (logEl) {
    logEl.className = 'build-log-entry ok';
    const teacherNote = (teacher && teacher !== '-') ? ` (${teacher})` : '';
    logEl.innerHTML = `<i class="bi bi-check-circle-fill"></i><span>Inserted "${label}"${teacherNote} at ${dept}/${semLabel}, ${day} Period ${startPeriod}</span>`;
  }

  renderTables();
  renderTeacherGrid();
  if (acceptedEntries.length > 0) elSendBtn.classList.remove('d-none');

  jiFillerModal.hide();
});

// ============================================================================
// 6. TEACHER ALLOCATION MATRIX RENDERER
// ============================================================================

/**
 * Builds and displays a cross-departmental teacher commitment matrix.
 * Visualizes assigned class blocks, start-to-end times, and free slots per teacher across all working days.
 */
function renderTeacherGrid() {
  const card = document.getElementById('teacher-grid-card');
  const wrapper = document.getElementById('teacher-grid-wrapper');
  if (!card || !wrapper) return;

  const teacherNames = new Set();
  currentWorkingDays.forEach(day => {
    if (teacherBusy[day]) {
      Object.keys(teacherBusy[day]).forEach(t => teacherNames.add(t));
    }
  });

  if (teacherNames.size === 0) {
    card.classList.add('d-none');
    return;
  }

  card.classList.remove('d-none');
  
  let head = `<tr><th class="ps-3 text-secondary small">Teacher</th>`;
  currentWorkingDays.forEach(day => {
    head += `<th class="text-center text-secondary small">${day.slice(0, 3)}</th>`;
  });
  head += `</tr>`;

  let rows = '';
  Array.from(teacherNames).sort().forEach(t => {
    rows += `<tr><td class="fw-bold ps-3 text-dark align-middle">${t}</td>`;
    currentWorkingDays.forEach(day => {
      const busy = (teacherBusy[day] && teacherBusy[day][t]) || [];
      let cellHtml = '';
      if (busy.length === 0) {
        cellHtml = '<span class="text-muted small" style="font-size:0.75rem;">Free</span>';
      } else {
        busy.sort((a, b) => a.start - b.start);
        busy.forEach(iv => {
          cellHtml += `
            <div class="teacher-grid-slot text-start mb-1">
              <span class="badge bg-danger bg-opacity-10 text-danger border border-danger-subtle p-1 px-1.5 w-100 d-block" style="font-size:0.7rem; line-height: 1.15;">
                <span class="fw-bold">${minutesToTimeLabel(iv.start)}-${minutesToTimeLabel(iv.end)}</span>
                <div class="text-truncate opacity-75">${iv.section} / ${iv.subject}</div>
              </span>
            </div>
          `;
        });
      }
      rows += `<td class="align-middle text-center" style="min-width: 120px;">${cellHtml}</td>`;
    });
    rows += `</tr>`;
  });

  wrapper.innerHTML = `
    <div class="table-responsive">
      <table class="table table-bordered table-hover mb-0">
        <thead class="table-light">${head}</thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// 7. PAYLOAD INGESTION PIPELINE
// ============================================================================

/**
 * Main ingestion handler triggered by the "Process JSON & Build" button.
 * Parses JSON input, registers teacher availability windows, processes each class
 * allocation through collision checks, logs outcomes, and refreshes UI grids.
 */
async function processJson() {
  hideError();
  resetState();

  let payload;
  try {
    payload = JSON.parse(elJsonInput.value);
  } catch (e) {
    showError('That JSON could not be parsed: ' + e.message);
    return;
  }
  if (!payload || !Array.isArray(payload.entries)) {
    showError('JSON must have an "entries" array. Click "Load Sample" to see the expected shape.');
    return;
  }

  const rawGlobal = { ...DEFAULT_SETTINGS, ...(payload.settings || {}) };
  const globalSettings = {
    ...rawGlobal,
    periodDuration: rawGlobal.periodDuration || rawGlobal.duration || 45,
    tiffinDuration: rawGlobal.tiffinDuration || 30
  };
  currentWorkingDays = globalSettings.workingDays || DAYS_OF_WEEK;

  // Ingest optional per-teacher availability windows
  if (Array.isArray(payload.teachers)) {
    payload.teachers.forEach(t => {
      const name = (t.name || '').toString().trim();
      if (!name || !t.availableFrom || !t.availableTo) return;
      teacherAvailability[name] = { start: parseTimeToMinutes(t.availableFrom), end: parseTimeToMinutes(t.availableTo) };
    });
  }

  let logId = 0;
  const totalEntries = payload.entries.length;
  const isLarge = totalEntries > 40;
  const renderInterval = isLarge ? 12 : 1;
  const sleepMs = isLarge ? 10 : 60;

  for (let i = 0; i < totalEntries; i++) {
    const entry = payload.entries[i];
    const result = processEntry(entry, globalSettings);
    const currentLogId = logId++;
    if (result.ok) {
      logEntry('ok', result.reason, currentLogId);
    } else {
      conflictCount++;
      conflictsList.push({ entry, globalSettings, logIndex: currentLogId, resolved: false });
      const autoPlaceBtn = `<button class="btn btn-sm btn-primary py-0.5 px-2 ms-1 my-1" onclick="window.autoPlaceConflict(${conflictsList.length - 1})" title="Auto-place conflict"><i class="bi bi-magic"></i> <span class="d-none d-sm-inline">Auto-Place</span><span class="d-sm-none">Auto</span></button>`;
      const fillBtn = `<button class="btn btn-sm btn-outline-secondary py-0.5 px-2 ms-1 my-1" onclick="window.openFillerModalForConflict(${conflictsList.length - 1})" title="Add Library or other filler class"><i class="bi bi-plus-circle"></i> <span class="d-none d-sm-inline">Add Library/Other Class</span><span class="d-sm-none">Library/Other</span></button>`;
      logEntry('conflict', `${result.reason} ${autoPlaceBtn}${fillBtn}`, currentLogId);
    }

    if (i % renderInterval === 0 || i === totalEntries - 1) {
      renderTables();
      elStatusAccepted.textContent = `${acceptedEntries.length} placed`;
      elStatusConflicts.textContent = `${conflictCount} conflicts`;
      updateClearConflictsBtn();
    }
    // eslint-disable-next-line no-await-in-loop
    if (sleepMs > 0) await sleep(sleepMs);
  }

  renderTeacherGrid();

  if (acceptedEntries.length > 0) {
    elSendBtn.classList.remove('d-none');
  }
}

document.getElementById('btn-process-json').addEventListener('click', processJson);

// ============================================================================
// 8. MAIN APPLICATION HANDSHAKE (SERIALIZATION & REDIRECT)
// ============================================================================

/**
 * Serializes the finalized in-memory schedule into the primary application schema
 * and stores it in `sessionStorage` (`routine_maker_json_routine`) before redirecting
 * the browser back to `index.html`.
 */
elSendBtn.addEventListener('click', () => {
  if (acceptedEntries.length === 0) return;

  const globalSettings = (() => {
    try {
      const payload = JSON.parse(elJsonInput.value);
      return { ...DEFAULT_SETTINGS, ...(payload.settings || {}) };
    } catch (e) {
      return { ...DEFAULT_SETTINGS };
    }
  })();

  // 1. Rebuild Department and Semester entities
  const departments = [];
  const deptIndex = {};
  Object.values(sectionsMap).forEach(sec => {
    if (!deptIndex[sec.deptName]) {
      deptIndex[sec.deptName] = { name: sec.deptName, semesters: [] };
      departments.push(deptIndex[sec.deptName]);
    }
    const subjects = [];
    const seen = new Set();
    acceptedEntries
      .filter(e => e.dept === sec.deptName && e.semId === sec.semId)
      .forEach(e => {
        const k = `${e.subject}|${e.type}`;
        if (!seen.has(k)) { seen.add(k); subjects.push({ name: e.subject, type: e.type }); }
      });
    deptIndex[sec.deptName].semesters.push({
      id: sec.semId,
      label: sec.semLabel,
      timing: sec.timing,
      subjects
    });
  });

  // 2. Rebuild Teacher directory and assignments from scheduled sessions
  const teacherIndex = {};
  const teachers = [];
  acceptedEntries.forEach(e => {
    if (e.type === 'filler') return; // Placeholder sessions (e.g. Library) do not create teacher records
    if (!teacherIndex[e.teacher]) {
      teacherIndex[e.teacher] = { id: uid('t'), name: e.teacher, workingDays: [], assignments: [] };
      teachers.push(teacherIndex[e.teacher]);
    }
    const t = teacherIndex[e.teacher];
    if (!t.workingDays.includes(e.day)) t.workingDays.push(e.day);
    const assignKey = `${e.dept}|${e.semId}|${e.subject}|${e.type}`;
    if (!t.assignments.some(a => `${a.department}|${a.semesterId}|${a.subject}|${a.type}` === assignKey)) {
      t.assignments.push({ department: e.dept, semesterId: e.semId, semesterLabel: e.semLabel, subject: e.subject, type: e.type });
    }
  });

  // 3. Rebuild canonical section definitions
  const routineSections = Object.values(sectionsMap).map(sec => ({
    deptName: sec.deptName,
    semId: sec.semId,
    semLabel: sec.semLabel,
    timing: sec.timing,
    subjects: deptIndex[sec.deptName].semesters.find(s => s.id === sec.semId).subjects,
    periodTimes: sec.periodTimes
  }));

  // 4. Fill unallocated slots with explicit 'free' and 'tiffin' tokens
  const routineSchedules = {};
  Object.values(sectionsMap).forEach(sec => {
    const key = sectionKey(sec.deptName, sec.semId);
    const filled = {};
    DAYS_OF_WEEK.forEach(day => {
      filled[day] = {};
      for (let p = 1; p <= sec.timing.periods; p++) {
        const pk = `Period ${p}`;
        if (p === sec.timing.tiffinPeriod) {
          filled[day][pk] = { kind: 'tiffin' };
        } else {
          filled[day][pk] = (sec.schedule[day] && sec.schedule[day][pk]) || { kind: 'free' };
        }
      }
    });
    routineSchedules[key] = filled;
  });

  const outPayload = {
    settings: globalSettings,
    departments,
    teachers,
    routine: { sections: routineSections, schedules: routineSchedules }
  };

  sessionStorage.setItem('routine_maker_json_routine', JSON.stringify(outPayload));
  window.location.href = 'index.html';
});
