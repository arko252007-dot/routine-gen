/**
 * RoutineGen - Core Application Controller & Routine Scheduling Engine
 *
 * Architecture & Data Flow:
 * - 4-Step Wizard Lifecycle:
 *     1. Step 1 (Global Configuration): Default period count, period duration, start time, and tiffin break settings.
 *     2. Step 2 (Departments & Semesters): Hierarchical curricula structure. Each semester can override
 *        global timings with its own periods, durations, and independent break slots.
 *     3. Step 3 (Faculty & Subject Assignments): Faculty directory with active working days, daily clock-time
 *        availability windows, and cascading subject assignment bindings.
 *     4. Step 4 (Schedule Generation & Export): Greedy workload-balanced scheduling engine with cross-semester
 *        clock-minute collision detection, manual conflict resolution modals, and landscape PDF generation.
 *
 * Critical Algorithmic Principles:
 * - Clock-Minute Interval Arithmetic: Collision detection maps all class spans to absolute minutes from
 *   midnight ([startMin, endMin)). This allows departments with divergent period lengths to safely share teachers.
 * - Workload Leveling: Among eligible candidates for any open slot, the algorithm prioritizes the faculty member
 *   with the lowest accumulated teaching periods to achieve uniform load distribution.
 * - Multi-Period Lookahead: Extended classes (2 consecutive periods) require forward verification to guarantee
 *   the subsequent period exists, is not a tiffin break, and has not already been scheduled.
 */

// ── Global Reactive State ───────────────────────────────────────────────────

let currentStep = 1;

const settings = {
  periods: 8,
  periodDuration: 45,
  startTime: '09:00',
  tiffinPeriod: 4,
  tiffinDuration: 30
};

let departments = [];
let teachers = [];
window.departments = departments;
window.teachers = teachers;

let tempAssignments = [];
let builderSubjects = [];       // Subjects staged in the semester form before persistence

let selectedDeptIndex = null;   // Active department index whose semester curricula panel is open
let semBuilderTiming = null;    // Custom timing override object for the semester currently being edited
let semBuilderLabel = '';
let editingSemesterId = null;   // Active semester ID when editing an existing record, null when adding new
let editingTeacherId = null;    // Active teacher ID when editing an existing faculty record, null when adding new

const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let generatedRoutines = null;   // Compiled output: { sections: [...], schedules: { [sectionKey]: { [day]: { [periodKey]: cell } } } }

const sections = [
  document.getElementById('step1'),
  document.getElementById('step2'),
  document.getElementById('step3'),
  document.getElementById('step4')
];
const progressSteps = document.querySelectorAll('.step-item');

// ── Utility helpers ───────────────────────────────────────────────────────────

function toCapitalCase(str) {
  return str
    .split(' ')
    .map(word => {
      if (word.length === 0) return '';
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}
window.toCapitalCase = toCapitalCase;

// Generates a collision-resistant id string, e.g. "sem_1718000000_a3f9k2"
function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Composite lookup key that uniquely identifies a dept+semester combination
function sectionKey(deptName, semId) {
  return `${deptName}::${semId}`;
}

// ── Class type registry ───────────────────────────────────────────────────────
// Each type controls how many contiguous periods it occupies and what badge
// styling appears on subject chips in the UI.
//   theory          → 1 period, no extra label
//   theory_extended → 2 contiguous periods, displayed identically to theory
//                     (students recognise it by spanning two columns)
//   lab_mini        → 1 period, shown with "(LAB)"
//   lab_extended    → 2 contiguous periods, shown with "(LAB)"
//   theory_lab      → 2 contiguous periods, shown with "(Theory + Lab)"
//   filler          → placeholder slot (e.g. Library, Seminar)
const CLASS_TYPES = {
  theory:          { label: 'Theory',        periods: 1, badge: 'bg-secondary bg-opacity-10 text-secondary border border-secondary-subtle' },
  theory_extended: { label: 'Theory (Ext)',  periods: 2, badge: 'bg-primary bg-opacity-10 text-primary border border-primary-subtle' },
  lab_mini:        { label: 'Lab',           periods: 1, badge: 'bg-info bg-opacity-10 text-info border border-info-subtle' },
  lab_extended:    { label: 'Lab (Ext)',     periods: 2, badge: 'bg-warning bg-opacity-10 text-warning border border-warning-subtle' },
  theory_lab:      { label: 'Theory + Lab',  periods: 2, badge: 'bg-success bg-opacity-10 text-success border border-success-subtle' },
  filler:          { label: 'Other',         periods: 1, badge: 'bg-light text-dark border' }
};

function typeInfo(type) {
  return CLASS_TYPES[type] || CLASS_TYPES.theory;
}

function isExtendedType(type) {
  return typeInfo(type).periods === 2;
}

// Returns the display label for a cell. Theory and theory_extended look
// identical in the table — the span across two columns is the only difference.
function cellSubjectLabel(subject, type) {
  if (type === 'filler') return subject;
  if (type === 'lab_mini' || type === 'lab_extended') return `${subject} (LAB)`;
  if (type === 'theory_lab') return `${subject} (Theory + Lab)`;
  return subject;
}

// Lock the app permanently to dark theme on load
document.documentElement.setAttribute('data-bs-theme', 'dark');
localStorage.setItem('theme', 'dark');

// ── Session persistence ───────────────────────────────────────────────────────

function saveSession() {
  const state = {
    currentStep,
    settings,
    departments,
    teachers,
    tempAssignments,
    builderSubjects,
    selectedDeptIndex,
    semBuilderTiming,
    semBuilderLabel,
    editingSemesterId,
    generatedRoutines
  };
  try {
    sessionStorage.setItem('routine_maker_session', JSON.stringify(state));
  } catch (e) {
    console.warn('Could not persist session to sessionStorage:', e);
  }
}
window.saveSession = saveSession;

function loadSessionState(saved) {
  currentStep = saved.currentStep || 1;
  Object.assign(settings, saved.settings);
  departments = saved.departments || [];
  teachers = saved.teachers || [];
  tempAssignments = saved.tempAssignments || [];
  builderSubjects = saved.builderSubjects || [];
  selectedDeptIndex = (typeof saved.selectedDeptIndex === 'number') ? saved.selectedDeptIndex : null;
  semBuilderTiming = saved.semBuilderTiming || null;
  semBuilderLabel = saved.semBuilderLabel || '';
  editingSemesterId = saved.editingSemesterId || null;
  generatedRoutines = saved.generatedRoutines || null;

  // Sync the Step 1 form inputs with the restored settings values
  document.getElementById('settings-periods').value = settings.periods;
  document.getElementById('settings-duration').value = settings.periodDuration;
  document.getElementById('settings-time').value = settings.startTime;
  document.getElementById('settings-tiffin-period').value = settings.tiffinPeriod;
  document.getElementById('settings-tiffin-duration').value = settings.tiffinDuration;

  renderDepartments();
  renderSemesterPanel();
  renderTeachers();
  renderTempAssignments();

  if (currentStep === 4) {
    // If the routine wasn't serialised (too large) try regenerating it from data
    if (!generatedRoutines && departments.length > 0 && teachers.length > 0) {
      try {
        generatedRoutines = runSchedulingAlgorithm();
      } catch (err) {
        console.error('Failed to auto-regenerate routines on restore:', err);
      }
    }

    if (generatedRoutines) {
      renderRoutines();
      goToStep(4);
    } else {
      goToStep(3);
    }
  } else {
    goToStep(currentStep);
  }
}

function checkSavedSession() {
  // Priority 1: data injected by the JSON Import page — skip the restore dialog
  const jsonImportStr = sessionStorage.getItem('routine_maker_json_routine');
  if (jsonImportStr) {
    try {
      const payload = JSON.parse(jsonImportStr);
      if (payload && payload.settings) Object.assign(settings, payload.settings);
      if (payload && payload.departments) departments = payload.departments;
      if (payload && payload.teachers) teachers = payload.teachers;
      if (payload && payload.routine) {
        generatedRoutines = payload.routine;
        sessionStorage.removeItem('routine_maker_json_routine');
        document.getElementById('settings-periods').value = settings.periods;
        document.getElementById('settings-duration').value = settings.periodDuration;
        document.getElementById('settings-time').value = settings.startTime;
        document.getElementById('settings-tiffin-period').value = settings.tiffinPeriod;
        document.getElementById('settings-tiffin-duration').value = settings.tiffinDuration;
        renderDepartments();
        renderTeachers();
        renderRoutines();
        goToStep(4);
        saveSession();
        return;
      }
    } catch (e) {
      console.error('Error loading JSON-import routine', e);
      sessionStorage.removeItem('routine_maker_json_routine');
    }
  }

  // Priority 2: regular session saved by a previous visit — ask the user
  const savedDataStr = sessionStorage.getItem('routine_maker_session');
  if (savedDataStr) {
    try {
      const savedData = JSON.parse(savedDataStr);
      const hasProgress = (savedData.departments && savedData.departments.length > 0) ||
        (savedData.teachers && savedData.teachers.length > 0) ||
        (savedData.currentStep > 1);

      if (hasProgress) {
        const restoreModalEl = document.getElementById('restoreModal');
        const restoreModal = (typeof bootstrap !== 'undefined' && bootstrap.Modal && bootstrap.Modal.getOrCreateInstance)
          ? bootstrap.Modal.getOrCreateInstance(restoreModalEl)
          : new bootstrap.Modal(restoreModalEl);

        // Bootstrap sometimes leaves a stale backdrop if the modal is dismissed
        // programmatically; this helper cleans that up in all cases.
        function cleanupModalBackdrops() {
          document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
          document.body.classList.remove('modal-open');
          document.body.style.removeProperty('overflow');
          document.body.style.removeProperty('padding-right');
        }

        document.getElementById('btn-resume-session').onclick = function () {
          try {
            restoreModal.hide();
          } catch (e) {
            console.warn('Error hiding restore modal:', e);
          }
          cleanupModalBackdrops();
          setTimeout(cleanupModalBackdrops, 350);
          try {
            loadSessionState(savedData);
          } catch (err) {
            console.error('Failed to restore session state:', err);
            goToStep(1);
          }
        };

        document.getElementById('btn-start-new').onclick = function () {
          sessionStorage.removeItem('routine_maker_session');
          try {
            restoreModal.hide();
          } catch (e) {
            console.warn('Error hiding restore modal:', e);
          }
          cleanupModalBackdrops();
          setTimeout(cleanupModalBackdrops, 350);
          goToStep(1);
        };

        restoreModalEl.addEventListener('hidden.bs.modal', cleanupModalBackdrops);

        restoreModal.show();
        return;
      }
    } catch (e) {
      console.error("Error parsing saved session", e);
    }
  }
  goToStep(1);
}

// ── Wizard step navigation ────────────────────────────────────────────────────

function goToStep(stepNumber) {
  // Each step has a side-effect to run before it becomes visible
  if (stepNumber === 2) updateSettings();
  if (stepNumber === 3) populateAssignSelects();
  if (stepNumber === 4) {
    // Auto-generate if we have data but no cached routine yet
    if (!generatedRoutines && departments.length > 0 && teachers.length > 0) {
      try {
        generatedRoutines = runSchedulingAlgorithm();
      } catch (err) {
        console.error('Failed to auto-regenerate routines on step 4:', err);
      }
    }
    const viewer = document.getElementById('routine-viewer');
    if (generatedRoutines && viewer && viewer.children.length === 0) {
      renderRoutines();
    }
  }

  currentStep = stepNumber;
  saveSession();

  sections.forEach((sec, idx) => {
    if (idx + 1 === currentStep) sec.classList.remove('hidden');
    else sec.classList.add('hidden');
  });

  progressSteps.forEach((step, idx) => {
    step.classList.remove('active', 'text-primary', 'fw-bold', 'text-muted');
    if (idx + 1 === currentStep) {
      step.classList.add('active', 'fw-bold');
    } else {
      step.classList.add('text-muted');
    }
  });
}
window.goToStep = goToStep;

function updateSettings() {
  settings.periods = parseInt(document.getElementById('settings-periods').value) || 8;
  settings.periodDuration = parseInt(document.getElementById('settings-duration').value) || 45;
  settings.startTime = document.getElementById('settings-time').value || '09:00';
  settings.tiffinPeriod = parseInt(document.getElementById('settings-tiffin-period').value) || 4;
  settings.tiffinDuration = parseInt(document.getElementById('settings-tiffin-duration').value) || 30;
  saveSession();
}

// ── Departments ───────────────────────────────────────────────────────────────

document.getElementById('dept-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('dept-name');
  const name = nameInput.value.trim().toUpperCase();

  // Prevent duplicates; auto-select the newly added department
  if (name && !departments.some(d => d.name === name)) {
    departments.push({ name, semesters: [] });
    nameInput.value = '';
    selectedDeptIndex = departments.length - 1;
    resetSemesterBuilder();
    renderDepartments();
    renderSemesterPanel();
    saveSession();
  }
});

function removeDepartment(name) {
  const idx = departments.findIndex(d => d.name === name);
  departments = departments.filter(d => d.name !== name);
  // Keep selectedDeptIndex pointing at the correct entry after removal
  if (selectedDeptIndex === idx) {
    selectedDeptIndex = null;
    resetSemesterBuilder();
  } else if (selectedDeptIndex !== null && idx < selectedDeptIndex) {
    selectedDeptIndex -= 1;
  }
  renderDepartments();
  renderSemesterPanel();
  saveSession();
}
window.removeDepartment = removeDepartment;

function selectDepartment(idx) {
  selectedDeptIndex = idx;
  resetSemesterBuilder();
  renderDepartments();
  renderSemesterPanel();
  saveSession();
}
window.selectDepartment = selectDepartment;

function removeSemester(deptIdx, semId) {
  const dept = departments[deptIdx];
  if (!dept) return;
  dept.semesters = dept.semesters.filter(s => s.id !== semId);
  renderDepartments();
  renderSemesterPanel();
  saveSession();
}
window.removeSemester = removeSemester;

function editSemester(deptIdx, semId) {
  const dept = departments[deptIdx];
  const sem = dept && dept.semesters.find(s => s.id === semId);
  if (!sem) return;
  // Load the semester's data into the builder form
  selectedDeptIndex = deptIdx;
  editingSemesterId = semId;
  semBuilderLabel = sem.label;
  semBuilderTiming = { ...sem.timing };
  builderSubjects = sem.subjects.map(s => ({ ...s }));
  renderDepartments();
  renderSemesterPanel();
  saveSession();
}
window.editSemester = editSemester;

function renderDepartments() {
  const list = document.getElementById('dept-list');
  const empty = document.getElementById('dept-empty');
  const nextBtn = document.getElementById('btn-next-dept');
  const countBadge = document.getElementById('dept-count-badge');

  list.innerHTML = '';

  if (countBadge) {
    countBadge.textContent = departments.length;
  }

  if (departments.length === 0) {
    empty.style.display = 'block';
    list.classList.add('d-none');
    nextBtn.disabled = true;
  } else {
    empty.style.display = 'none';
    list.classList.remove('d-none');
    // "Next" is only enabled once at least one dept has a semester with subjects
    const ready = departments.some(d => (d.semesters || []).some(s => (s.subjects || []).length > 0));
    nextBtn.disabled = !ready;

    departments.forEach((dept, idx) => {
      const isSelected = idx === selectedDeptIndex;
      const li = document.createElement('li');
      li.className = `dept-card list-group-item p-3 p-sm-4 mb-3 rounded-3 transition-all ${isSelected ? 'dept-card-active' : ''}`;
      li.setAttribute('style', 'padding: 16px 24px !important;');

      const semCount = (dept.semesters || []).length;
      const semBadges = (dept.semesters || []).map(sem => {
        const subCount = (sem.subjects || []).length;
        return `
          <span class="sem-chip badge rounded-pill px-2.5 py-1.5 d-inline-flex align-items-center gap-1.5 shadow-sm"
                role="button"
                onclick="event.stopPropagation(); selectDepartment(${idx}); editSemester(${idx}, '${sem.id}');"
                title="Click to edit ${sem.label} (${subCount} subject${subCount === 1 ? '' : 's'})">
            <span class="fw-semibold text-light">${sem.label}</span>
            <span class="badge bg-secondary-subtle text-secondary rounded-pill px-1.5 py-0.5 font-monospace" style="font-size:0.68rem;">
              ${subCount} ${subCount === 1 ? 'sub' : 'subs'}
            </span>
          </span>
        `;
      }).join('');

      li.innerHTML = `
        <div class="d-flex justify-content-between align-items-center gap-2 mb-2">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <span class="badge ${isSelected ? 'bg-white text-dark' : 'bg-dark border border-secondary-subtle text-light'} fw-bold px-2.5 py-1 rounded-2 font-monospace" style="font-size: 0.9rem; letter-spacing: 0.02em;">
              ${dept.name}
            </span>
            ${isSelected ? '<span class="badge bg-success bg-opacity-15 text-success border border-success-subtle rounded-pill px-2 py-0.5 d-inline-flex align-items-center gap-1" style="font-size: 0.68rem;"><i class="bi bi-check-circle-fill"></i> Selected</span>' : ''}
            <span class="text-muted small">${semCount} semester${semCount === 1 ? '' : 's'}</span>
          </div>
          <div class="d-flex gap-1.5 align-items-center">
            <button class="btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline-secondary'} px-2.5 py-1 d-flex align-items-center gap-1" onclick="selectDepartment(${idx})" title="Manage semesters for ${dept.name}">
              <i class="bi bi-layers${isSelected ? '-fill' : ''}"></i>
              <span class="d-none d-sm-inline">${isSelected ? 'Managing' : 'Manage Semesters'}</span>
              <span class="d-sm-none">${isSelected ? 'Active' : 'Manage'}</span>
            </button>
            <button class="btn btn-sm btn-outline-danger px-2 py-1 d-flex align-items-center" onclick="removeDepartment('${dept.name}')" title="Remove department" aria-label="Remove department">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </div>
        <div class="d-flex flex-wrap gap-2 mt-2.5">
          ${semCount === 0 ? '<span class="text-muted small fst-italic"><i class="bi bi-info-circle me-1"></i>No semesters yet &mdash; click Manage Semesters to add</span>' : semBadges}
        </div>
      `;
      list.appendChild(li);
    });
  }
}
window.renderDepartments = renderDepartments;

// ── Semester builder ──────────────────────────────────────────────────────────

function resetSemesterBuilder() {
  editingSemesterId = null;
  semBuilderLabel = '';
  semBuilderTiming = { ...settings }; // default timing from global settings
  builderSubjects = [];
}

function renderSemesterPanel() {
  const panel = document.getElementById('semester-panel');
  const placeholder = document.getElementById('semester-panel-placeholder');

  if (selectedDeptIndex === null || !departments[selectedDeptIndex]) {
    panel.classList.add('d-none');
    placeholder.classList.remove('d-none');
    return;
  }

  panel.classList.remove('d-none');
  placeholder.classList.add('d-none');

  const dept = departments[selectedDeptIndex];
  document.getElementById('semester-panel-dept-name').textContent = dept.name;

  if (!semBuilderTiming) semBuilderTiming = { ...settings };

  // Populate form inputs from the in-memory builder state
  document.getElementById('sem-label').value = semBuilderLabel;
  document.getElementById('sem-periods').value = semBuilderTiming.periods;
  document.getElementById('sem-duration').value = semBuilderTiming.periodDuration;
  document.getElementById('sem-start-time').value = semBuilderTiming.startTime;
  document.getElementById('sem-tiffin-period').value = semBuilderTiming.tiffinPeriod;
  document.getElementById('sem-tiffin-duration').value = semBuilderTiming.tiffinDuration;

  // Button label changes to "Update" when editing an existing semester
  document.getElementById('btn-save-semester').textContent = editingSemesterId ? 'Update Semester' : 'Save Semester';

  renderBuilderSubjects();

  // Render the list of already-saved semesters for this department
  const existingList = document.getElementById('existing-semester-list');
  existingList.innerHTML = '';
  if (dept.semesters.length === 0) {
    existingList.innerHTML = '<p class="text-muted small mb-0">No semesters added for this department yet.</p>';
  } else {
    dept.semesters.forEach(sem => {
      const isEditing = editingSemesterId === sem.id;
      const div = document.createElement('div');
      div.className = `semester-item d-flex justify-content-between align-items-center px-4 py-3 rounded-3 border mb-3 transition-all ${isEditing ? 'border-primary bg-primary bg-opacity-10 shadow-sm' : 'border-light-subtle bg-dark bg-opacity-50'}`;
      div.setAttribute('style', 'padding: 16px 24px !important;');
      div.innerHTML = `
        <div>
          <div class="d-flex align-items-center gap-2">
            <span class="fw-bold text-light small">${sem.label}</span>
            ${isEditing ? '<span class="badge bg-primary text-dark rounded-pill px-2 py-0.5" style="font-size: 0.65rem;">Editing Now</span>' : ''}
          </div>
          <div class="text-muted mt-0.5" style="font-size: 0.72rem;">
            ${sem.subjects.length} subject${sem.subjects.length === 1 ? '' : 's'} &bull; ${sem.timing.periods} periods &bull; starts ${sem.timing.startTime}
          </div>
        </div>
        <div class="d-flex gap-1.5 align-items-center">
          <button type="button" class="btn btn-sm ${isEditing ? 'btn-primary' : 'btn-outline-secondary'} px-2.5 py-1 d-flex align-items-center gap-1" onclick="editSemester(${selectedDeptIndex}, '${sem.id}')" title="Edit semester" aria-label="Edit semester">
            <i class="bi bi-pencil-square"></i> <span class="d-none d-sm-inline">${isEditing ? 'Editing' : 'Edit'}</span>
          </button>
          <button type="button" class="btn btn-sm btn-outline-danger px-2 py-1 d-flex align-items-center" onclick="removeSemester(${selectedDeptIndex}, '${sem.id}')" title="Remove semester" aria-label="Remove semester">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      `;
      existingList.appendChild(div);
    });
  }
}
window.renderSemesterPanel = renderSemesterPanel;

// Preset buttons (Sem 1–4) fill the label field and update state immediately
document.querySelectorAll('.sem-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('sem-label').value = btn.dataset.label;
    semBuilderLabel = btn.dataset.label;
    saveSession();
  });
});

document.getElementById('sem-label').addEventListener('input', (e) => {
  semBuilderLabel = e.target.value;
});

// Keep semBuilderTiming in sync whenever any timing field changes
['sem-periods', 'sem-duration', 'sem-start-time', 'sem-tiffin-period', 'sem-tiffin-duration'].forEach(id => {
  document.getElementById(id).addEventListener('input', syncSemBuilderTiming);
});

function syncSemBuilderTiming() {
  if (!semBuilderTiming) semBuilderTiming = { ...settings };
  semBuilderTiming.periods = parseInt(document.getElementById('sem-periods').value) || 8;
  semBuilderTiming.periodDuration = parseInt(document.getElementById('sem-duration').value) || 45;
  semBuilderTiming.startTime = document.getElementById('sem-start-time').value || '09:00';
  semBuilderTiming.tiffinPeriod = parseInt(document.getElementById('sem-tiffin-period').value) || 4;
  semBuilderTiming.tiffinDuration = parseInt(document.getElementById('sem-tiffin-duration').value) || 30;
}

document.getElementById('btn-add-subject-to-list').addEventListener('click', () => {
  const nameInput = document.getElementById('subject-input-name');
  const typeSelect = document.getElementById('subject-input-type');
  const name = toCapitalCase(nameInput.value.trim());
  const type = typeSelect.value;

  // Ignore if the exact same name+type combo is already staged
  if (name && !builderSubjects.some(s => s.name === name && s.type === type)) {
    builderSubjects.push({ name, type });
    nameInput.value = '';
    typeSelect.value = 'theory';
    renderBuilderSubjects();
    saveSession();
  }
});

function renderBuilderSubjects() {
  const container = document.getElementById('builder-subjects-list');
  const saveBtn = document.getElementById('btn-save-semester');
  container.innerHTML = '';

  // Save is only enabled when there is a label AND at least one subject staged
  const labelFilled = document.getElementById('sem-label').value.trim().length > 0;
  saveBtn.disabled = !(builderSubjects.length > 0 && labelFilled);

  builderSubjects.forEach((s, idx) => {
    const info = typeInfo(s.type);
    const div = document.createElement('div');
    div.className = `subject-chip badge ${info.badge} p-2 d-flex align-items-center justify-content-between gap-2`;
    div.innerHTML = `
      <span class="badge-text">${s.name} <small class="opacity-75">(${info.label})</small></span>
      <button onclick="removeBuilderSubject(${idx})" type="button" class="btn-close btn-close-sm flex-shrink-0" style="font-size: 0.55rem;" aria-label="Close" title="Remove subject"></button>
    `;
    container.appendChild(div);
  });
}

window.removeBuilderSubject = function (index) {
  builderSubjects.splice(index, 1);
  renderBuilderSubjects();
  saveSession();
};

// Re-validate the Save button whenever the label field changes
document.getElementById('sem-label').addEventListener('input', renderBuilderSubjects);

document.getElementById('btn-save-semester').addEventListener('click', () => {
  if (selectedDeptIndex === null || !departments[selectedDeptIndex]) return;
  syncSemBuilderTiming();
  const label = document.getElementById('sem-label').value.trim();
  if (!label || builderSubjects.length === 0) return;

  const dept = departments[selectedDeptIndex];

  if (editingSemesterId) {
    // Update existing semester in-place
    const sem = dept.semesters.find(s => s.id === editingSemesterId);
    if (sem) {
      sem.label = label;
      sem.timing = { ...semBuilderTiming };
      sem.subjects = [...builderSubjects];
    }
  } else {
    if (dept.semesters.some(s => s.label === label)) {
      alert(`"${label}" already exists for ${dept.name}.`);
      return;
    }
    dept.semesters.push({
      id: uid('sem'),
      label,
      timing: { ...semBuilderTiming },
      subjects: [...builderSubjects]
    });
  }

  resetSemesterBuilder();
  renderDepartments();
  renderSemesterPanel();
  saveSession();
});

document.getElementById('btn-cancel-semester').addEventListener('click', () => {
  resetSemesterBuilder();
  renderSemesterPanel();
  saveSession();
});

// ── Teachers & assignments ────────────────────────────────────────────────────

const assignDept = document.getElementById('assign-dept');
const assignSem = document.getElementById('assign-sem');
const assignSub = document.getElementById('assign-sub');
const btnAddAssign = document.getElementById('btn-add-assign');
const tempAssignList = document.getElementById('temp-assignments-list');
const btnAddTeacher = document.getElementById('btn-add-teacher');
const teacherNameInput = document.getElementById('teacher-name');
const teacherAvailStartInput = document.getElementById('teacher-avail-start');
const teacherAvailEndInput = document.getElementById('teacher-avail-end');
const btnCancelTeacher = document.getElementById('btn-cancel-teacher');

// Rebuild the Dept dropdown from the current departments array (called on step 3 entry)
function populateAssignSelects() {
  assignDept.innerHTML = '<option value="">-- Select Dept --</option>';
  departments.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.name;
    opt.textContent = d.name;
    assignDept.appendChild(opt);
  });
  assignSem.innerHTML = '<option value="">-- Select Semester --</option>';
  assignSem.disabled = true;
  assignSub.innerHTML = '<option value="">-- Select Subject --</option>';
  assignSub.disabled = true;
  validateAssignmentBtn();
}
window.populateAssignSelects = populateAssignSelects;

// Cascade: dept → semester list
assignDept.addEventListener('change', () => {
  const deptName = assignDept.value;
  assignSem.innerHTML = '<option value="">-- Select Semester --</option>';
  assignSub.innerHTML = '<option value="">-- Select Subject --</option>';
  assignSub.disabled = true;

  if (deptName) {
    const deptObj = departments.find(d => d.name === deptName);
    if (deptObj && deptObj.semesters.length > 0) {
      deptObj.semesters.forEach(sem => {
        const opt = document.createElement('option');
        opt.value = sem.id;
        opt.textContent = sem.label;
        assignSem.appendChild(opt);
      });
      assignSem.disabled = false;
    } else {
      assignSem.disabled = true;
    }
  } else {
    assignSem.disabled = true;
  }
  validateAssignmentBtn();
});

// Cascade: semester → subject list
assignSem.addEventListener('change', () => {
  const deptName = assignDept.value;
  const semId = assignSem.value;
  assignSub.innerHTML = '<option value="">-- Select Subject --</option>';

  if (deptName && semId) {
    const deptObj = departments.find(d => d.name === deptName);
    const sem = deptObj && deptObj.semesters.find(s => s.id === semId);
    if (sem && sem.subjects.length > 0) {
      sem.subjects.forEach(s => {
        const opt = document.createElement('option');
        opt.value = `${s.name}|${s.type}`;
        // Show the type label only when there are multiple variants of the same subject name
        const hasVariants = sem.subjects.some(other => other.name.toLowerCase() === s.name.toLowerCase() && other.type !== s.type);
        if (hasVariants || s.type !== 'theory') {
          opt.textContent = `${s.name} (${typeInfo(s.type).label})`;
        } else {
          opt.textContent = s.name;
        }
        assignSub.appendChild(opt);
      });
      assignSub.disabled = false;
    } else {
      assignSub.disabled = true;
    }
  } else {
    assignSub.disabled = true;
  }
  validateAssignmentBtn();
});

assignSub.addEventListener('change', validateAssignmentBtn);

function validateAssignmentBtn() {
  btnAddAssign.disabled = !(assignDept.value && assignSem.value && assignSub.value);
}

btnAddAssign.addEventListener('click', (e) => {
  e.preventDefault();

  const dept = assignDept.value;
  const semId = assignSem.value;
  const deptObj = departments.find(d => d.name === dept);
  const semObj = deptObj && deptObj.semesters.find(s => s.id === semId);
  const [sub, type] = assignSub.value.split("|");
  const subObj = semObj?.subjects.find(s => s.name === sub && s.type === type);

  const exists = tempAssignments.some(
    a => a.department === dept && a.semesterId === semId && a.subject === sub && a.type === type
  );

  if (!exists && dept && semId && sub && semObj) {
    tempAssignments.push({
      department: dept,
      semesterId: semId,
      semesterLabel: semObj.label,
      subject: sub,
      type: subObj ? subObj.type : type
    });

    renderTempAssignments();
    validateTeacherForm();
    saveSession();
  }

  // Keep dept + semester selected so the user can quickly add more subjects
  // from the same semester without re-picking them.
  assignSub.value = '';
  validateAssignmentBtn();
});

function removeTempAssignment(index) {
  tempAssignments.splice(index, 1);
  renderTempAssignments();
  validateTeacherForm();
  saveSession();
}
window.removeTempAssignment = removeTempAssignment;

function renderTempAssignments() {
  tempAssignList.innerHTML = '';
  tempAssignments.forEach((a, idx) => {
    let typeLabel = '';
    if (a.type !== 'theory') {
      typeLabel = ` (${typeInfo(a.type).label})`;
    } else {
      // Add "(Theory)" only if there are other variants of this subject,
      // so the user can tell them apart in the badge list.
      const deptObj = departments.find(d => d.name === a.department);
      const semObj = deptObj?.semesters?.find(s => s.id === a.semesterId);
      const hasVariants = semObj?.subjects?.some(other => other.name && other.name.toLowerCase() === (a.subject || '').toLowerCase() && other.type !== 'theory');
      if (hasVariants) typeLabel = ' (Theory)';
    }

    const div = document.createElement('div');
    div.className = "assignment-chip badge bg-light text-dark border p-2 d-flex align-items-center justify-content-between gap-2 w-100 w-sm-auto";
    div.innerHTML = `
      <span class="badge-text">${a.department} <span class="text-muted">/</span> ${a.semesterLabel} <i class="bi bi-arrow-right mx-1 text-muted"></i> <span class="text-primary fw-semibold">${a.subject}${typeLabel}</span></span>
      <button onclick="removeTempAssignment(${idx})" type="button" class="btn-close btn-close-sm flex-shrink-0" style="font-size: 0.55rem;" aria-label="Close" title="Remove assignment"></button>
    `;
    tempAssignList.appendChild(div);
  });
}

function getSelectedDays() {
  const checkboxes = document.querySelectorAll('#teacher-days input[type="checkbox"]:checked');
  return Array.from(checkboxes).map(cb => cb.value);
}

document.querySelectorAll('#teacher-days input').forEach(cb => {
  cb.addEventListener('change', validateTeacherForm);
});
teacherNameInput.addEventListener('input', validateTeacherForm);

function validateTeacherForm() {
  const name = teacherNameInput.value.trim();
  const days = getSelectedDays();
  const valid = name.length > 0 && days.length > 0;
  btnAddTeacher.disabled = !valid;
}

function resetTeacherForm() {
  editingTeacherId = null;
  teacherNameInput.value = '';
  teacherAvailStartInput.value = '';
  teacherAvailEndInput.value = '';
  document.querySelectorAll('#teacher-days input').forEach(cb => cb.checked = false);
  tempAssignments = [];
  renderTempAssignments();
  validateTeacherForm();
  assignDept.value = '';
  assignSem.innerHTML = '<option value="">-- Select Semester --</option>';
  assignSem.disabled = true;
  assignSub.innerHTML = '<option value="">-- Select Subject --</option>';
  assignSub.disabled = true;
  validateAssignmentBtn();
  if (btnCancelTeacher) btnCancelTeacher.classList.add('d-none');
  const heading = document.querySelector('#step3 .col-lg-5 h5');
  if (heading) heading.textContent = 'Add New Teacher';
  btnAddTeacher.innerHTML = '<i class="bi bi-plus-lg me-1"></i> Add Teacher';
}

if (btnCancelTeacher) {
  btnCancelTeacher.addEventListener('click', resetTeacherForm);
}

btnAddTeacher.addEventListener('click', (e) => {
  e.preventDefault();
  const name = teacherNameInput.value.trim();
  const workingDays = getSelectedDays();
  // null means "available all day" — the scheduler treats missing avail window as no restriction
  const availStart = teacherAvailStartInput.value || null;
  const availEnd = teacherAvailEndInput.value || null;

  if (name && workingDays.length > 0) {
    if (editingTeacherId !== null) {
      const existing = teachers.find(t => t.id === editingTeacherId);
      if (existing) {
        existing.name = name;
        existing.workingDays = workingDays;
        existing.availStart = availStart;
        existing.availEnd = availEnd;
        existing.assignments = [...tempAssignments];
      }
    } else {
      teachers.push({
        id: Date.now(),
        name,
        workingDays,
        availStart,
        availEnd,
        assignments: [...tempAssignments]
      });
    }

    resetTeacherForm();
    renderTeachers();
    saveSession();
  }
});

function editTeacher(id) {
  const teacher = teachers.find(t => t.id === id);
  if (!teacher) return;
  editingTeacherId = id;
  teacherNameInput.value = teacher.name;
  teacherAvailStartInput.value = teacher.availStart || '';
  teacherAvailEndInput.value = teacher.availEnd || '';
  document.querySelectorAll('#teacher-days input').forEach(cb => {
    cb.checked = (teacher.workingDays || []).includes(cb.value);
  });
  tempAssignments = teacher.assignments ? [...teacher.assignments] : [];
  renderTempAssignments();
  validateTeacherForm();

  // Pre-select the last used dept+semester so the user can add more subjects
  // to the same section without re-picking from scratch.
  if (tempAssignments.length > 0) {
    const last = tempAssignments[tempAssignments.length - 1];
    if (last && last.department && departments.some(d => d.name === last.department)) {
      assignDept.value = last.department;
      assignDept.dispatchEvent(new Event('change'));
      if (last.semesterId) {
        assignSem.value = last.semesterId;
        assignSem.dispatchEvent(new Event('change'));
      }
    }
  } else {
    assignDept.value = '';
    assignSem.innerHTML = '<option value="">-- Select Semester --</option>';
    assignSem.disabled = true;
    assignSub.innerHTML = '<option value="">-- Select Subject --</option>';
    assignSub.disabled = true;
    validateAssignmentBtn();
  }

  if (btnCancelTeacher) btnCancelTeacher.classList.remove('d-none');
  const heading = document.querySelector('#step3 .col-lg-5 h5');
  if (heading) heading.textContent = `Assign / Edit: ${teacher.name}`;
  btnAddTeacher.innerHTML = '<i class="bi bi-check-lg me-1"></i> Save Teacher & Assignments';

  const formCard = document.querySelector('#step3 .col-lg-5');
  if (formCard) formCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
window.editTeacher = editTeacher;

function removeTeacher(id) {
  if (editingTeacherId === id) resetTeacherForm();
  teachers = teachers.filter(t => t.id !== id);
  renderTeachers();
  saveSession();
}
window.removeTeacher = removeTeacher;

function removeTeacherAssignment(teacherId, assignmentIndex) {
  const teacher = teachers.find(t => t.id === teacherId);
  if (!teacher) return;
  teacher.assignments.splice(assignmentIndex, 1);
  renderTeachers();
  saveSession();
}
window.removeTeacherAssignment = removeTeacherAssignment;

function renderTeachers() {
  const list = document.getElementById('teacher-list');
  const empty = document.getElementById('teacher-empty');
  const generateBtn = document.getElementById('btn-generate');

  list.innerHTML = '';

  const countBadge = document.getElementById('teacher-count-badge');
  if (countBadge) {
    countBadge.textContent = teachers.length;
  }

  // The wrapper now uses .teacher-table-wrapper (not .table-responsive)
  const wrapper = list.closest('.teacher-table-wrapper');
  if (teachers.length === 0) {
    empty.style.display = 'block';
    if (wrapper) wrapper.classList.add('d-none');
    generateBtn.disabled = true;
  } else {
    empty.style.display = 'none';
    if (wrapper) wrapper.classList.remove('d-none');
    // Generate is only enabled when at least one teacher has subject assignments
    const hasAssigned = teachers.some(t => t.assignments && t.assignments.length > 0);
    generateBtn.disabled = !hasAssigned;

    teachers.forEach(teacher => {
      const tr = document.createElement('tr');

      let daysHtml = '';
      if (teacher.workingDays && teacher.workingDays.length > 0) {
        const standardDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const allDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const isStandard = standardDays.every(d => teacher.workingDays.includes(d)) && teacher.workingDays.length === 5;
        const isAll = allDays.every(d => teacher.workingDays.includes(d)) && teacher.workingDays.length === 6;

        // Collapse common patterns to a single readable badge
        if (isAll) {
          daysHtml = `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary-subtle">Mon–Sat</span>`;
        } else if (isStandard) {
          daysHtml = `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary-subtle">Mon–Fri</span>`;
        } else {
          daysHtml = teacher.workingDays.map(d => `<span class="badge bg-secondary bg-opacity-10 text-secondary border border-secondary-subtle me-1 mb-1">${d.slice(0, 3)}</span>`).join('');
        }
      } else {
        daysHtml = `<span class="text-muted small">None</span>`;
      }

      const availHtml = (teacher.availStart && teacher.availEnd)
        ? `<span class="badge bg-primary bg-opacity-10 text-primary border border-primary-subtle" style="white-space:nowrap;">${minutesToTimeLabel(parseTimeToMinutes(teacher.availStart))} – ${minutesToTimeLabel(parseTimeToMinutes(teacher.availEnd))}</span>`
        : `<span class="text-muted small">All day</span>`;

      const assignHtml = (teacher.assignments && teacher.assignments.length > 0)
        ? teacher.assignments.map((a, aIdx) => {
            let typeLabel = '';
            if (a.type !== 'theory') {
              typeLabel = ` (${typeInfo(a.type).label})`;
            } else {
              const deptObj = departments.find(d => d.name === a.department);
              const semObj = deptObj?.semesters?.find(s => s.id === a.semesterId);
              const hasVariants = semObj?.subjects?.some(other => other.name && other.name.toLowerCase() === (a.subject || '').toLowerCase() && other.type !== 'theory');
              if (hasVariants) typeLabel = ' (Theory)';
            }
            return `<span class="assignment-table-badge badge bg-light text-dark border me-1 mb-1 d-inline-flex align-items-center justify-content-between gap-1.5" style="font-size:0.75rem; white-space: normal; text-align: left; max-width: 100%; line-height: 1.35; padding: 6px 10px;">
              <span class="badge-text" style="word-break: break-word;">${a.department}/${a.semesterLabel} → <span class="text-primary fw-semibold">${a.subject}${typeLabel}</span></span>
              <button onclick="removeTeacherAssignment(${teacher.id}, ${aIdx})" type="button" class="btn-close flex-shrink-0 ms-1.5" style="font-size:0.5rem;" aria-label="Remove assignment" title="Remove this assignment"></button>
            </span>`;
          }).join('')
        : `<span class="text-muted small fst-italic text-nowrap">No assignments</span>`;

      tr.innerHTML = `
        <td class="fw-medium ps-3 text-light" style="white-space: nowrap;">${teacher.name}</td>
        <td><div class="d-flex flex-wrap gap-1 align-items-center">${daysHtml}</div></td>
        <td>${availHtml}</td>
        <td><div class="d-flex flex-wrap gap-1 align-items-center">${assignHtml}</div></td>
        <td class="text-center px-2" style="white-space:nowrap;">
          <div class="d-flex gap-1 justify-content-center">
            <button class="btn btn-sm btn-outline-primary px-2 d-flex align-items-center gap-1" onclick="editTeacher(${teacher.id})" title="Edit teacher" aria-label="Edit">
              <i class="bi bi-pencil-square"></i> Edit
            </button>
            <button class="btn btn-sm btn-outline-danger px-2 d-flex align-items-center" onclick="removeTeacher(${teacher.id})" title="Remove teacher" aria-label="Remove">
              <i class="bi bi-trash"></i>
            </button>
          </div>
        </td>
      `;
      list.appendChild(tr);
    });
  }
}
window.renderTeachers = renderTeachers;

// ── Clock-Time Arithmetic & Interval Calculations ───────────────────────────

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
  const minutesStr = minutes.toString().padStart(2, '0');
  return `${hours}:${minutesStr} ${suffix}`;
}

/**
 * Computes the chronological boundary coordinates (startMin, endMin, start, end) for every
 * period in a curriculum section based on its specific timing configuration.
 *
 * Distinct per-semester timing configs allow independent start times, period durations,
 * and tiffin break placements across departments.
 *
 * @param {Object} timing - Section timing config (startTime, periods, periodDuration, tiffinPeriod, tiffinDuration).
 * @returns {Array<{ period: number, startMin: number, endMin: number, start: string, end: string }>}
 */
function calcPeriodTimesForTiming(timing) {
  const times = [];
  let current = parseTimeToMinutes(timing.startTime);
  for (let p = 1; p <= timing.periods; p++) {
    const duration = (p === timing.tiffinPeriod) ? timing.tiffinDuration : timing.periodDuration;
    const start = current;
    const end = current + duration;
    times.push({
      period: p,
      startMin: start,
      endMin: end,
      start: minutesToTimeLabel(start),
      end: minutesToTimeLabel(end)
    });
    current = end;
  }
  return times;
}

/**
 * Compatibility wrapper providing period boundary calculations for the global fallback settings object.
 *
 * @returns {Array<Object>}
 */
function calculatePeriodTimes() {
  return calcPeriodTimesForTiming(settings);
}

/**
 * Evaluates whether a proposed class span [startMin, endMin) fits entirely within a faculty member's
 * declared daily availability window.
 *
 * @param {Object} teacher - Teacher profile containing optional `availStart` and `availEnd` strings ("HH:MM").
 * @param {number} startMin - Proposed class start in elapsed minutes from midnight.
 * @param {number} endMin - Proposed class end in elapsed minutes from midnight.
 * @returns {boolean} True if the teacher is unrestricted or if the class sits within their available hours.
 */
function withinTeacherAvailability(teacher, startMin, endMin) {
  if (!teacher.availStart || !teacher.availEnd) return true;
  const availStart = parseTimeToMinutes(teacher.availStart);
  const availEnd = parseTimeToMinutes(teacher.availEnd);
  return startMin >= availStart && endMin <= availEnd;
}

// ── Core Scheduling Engine ──────────────────────────────────────────────────

/**
 * Transforms the nested Department -> Semester hierarchy into a flat list of schedulable
 * curriculum sections, resolving local timing configurations and precomputing period clock boundaries.
 *
 * @returns {Array<Object>} Array of section descriptors containing precomputed period coordinates.
 */
function buildSections() {
  const list = [];
  departments.forEach(dept => {
    (dept.semesters || []).forEach(sem => {
      const timing = sem.timing || { ...settings };
      list.push({
        deptName: dept.name,
        semId: sem.id,
        semLabel: sem.label,
        timing: timing,
        subjects: sem.subjects || [],
        periodTimes: calcPeriodTimesForTiming(timing)
      });
    });
  });
  return list;
}

/**
 * Mathematical interval overlap test.
 * Two intervals [aStart, aEnd) and [bStart, bEnd) intersect if and only if:
 * aStart < bEnd AND bStart < aEnd.
 *
 * Comparing absolute clock minutes rather than period indices enables collision detection
 * between sections with asynchronous periods (e.g. 45-minute vs. 60-minute blocks).
 *
 * @param {number} aStart - Interval A start minute.
 * @param {number} aEnd - Interval A end minute.
 * @param {number} bStart - Interval B start minute.
 * @param {number} bEnd - Interval B end minute.
 * @returns {boolean} True if both intervals share any non-zero duration.
 */
function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Lookahead validator for multi-period blocks (e.g. 2-period lab or extended theory classes).
 * Verifies that the subsequent period slot exists, is not a scheduled tiffin break,
 * and has not already been populated by an earlier placement.
 *
 * @param {Object} section - Section descriptor.
 * @param {number} periodIdx - Current 1-based period index.
 * @param {string} day - Day of the week.
 * @param {Object} sectionSchedule - Target schedule matrix for the section.
 * @returns {boolean} True if the next slot is valid and free for consecutive assignment.
 */
function canScheduleExtended(section, periodIdx, day, sectionSchedule) {
  const timing = section.timing;
  const nextPeriodIdx = periodIdx + 1;
  if (nextPeriodIdx > timing.periods) return false;
  if (nextPeriodIdx === timing.tiffinPeriod) return false;
  if (sectionSchedule[day][`Period ${nextPeriodIdx}`]) return false;
  return true;
}

/**
 * Core Greedy Scheduling Engine with Global Resource Reservation.
 *
 * Invariants & Constraints:
 * 1. Global Resource Lock: Once a teacher is assigned a time interval [startMin, endMin) on a given day,
 *    that interval is blocked globally across all other departments and semesters.
 * 2. Section Daily Teacher Limit: A teacher conducts at most one session per section per day.
 * 3. Section Daily Subject Limit: A subject appears at most once per section per day.
 * 4. Extended Block Quota: At most one 2-period block (lab/extended) is scheduled per section per day.
 * 5. Workload Distribution Heuristic: When multiple eligible candidates qualify for an open slot,
 *    the candidate with the lowest accumulated weekly teaching periods is selected first.
 * 6. Conflict Attribution: If structurally assigned faculty members exist for a subject but every
 *    candidate is blocked by an active time clash or daily quota, a 'conflict' cell is emitted with
 *    candidate telemetry for manual interactive resolution.
 *
 * @returns {{ sections: Array<Object>, schedules: Object }} Generated routine structures.
 */
function runSchedulingAlgorithm() {
  const secs = buildSections();
  const schedules = {};

  secs.forEach(sec => {
    const key = sectionKey(sec.deptName, sec.semId);
    schedules[key] = {};
    daysOfWeek.forEach(day => { schedules[key][day] = {}; });
  });

  const teacherWorkload = {};
  teachers.forEach(t => { teacherWorkload[t.id] = 0; });

  daysOfWeek.forEach(day => {
    // Reset global daily busy intervals. Faculty availability resets at the start of each weekday.
    const busyIntervals = {};
    teachers.forEach(t => { busyIntervals[t.id] = []; });

    const extendedUsedToday = {};

    secs.forEach(sec => {
      const key = sectionKey(sec.deptName, sec.semId);
      extendedUsedToday[key] = false;
      const timing = sec.timing;
      const sectionSchedule = schedules[key];

      const sectionTeachersToday = new Set();
      const sectionSubjectsToday = new Set();

      for (let periodIdx = 1; periodIdx <= timing.periods; periodIdx++) {
        const periodKey = `Period ${periodIdx}`;

        if (periodIdx === timing.tiffinPeriod) {
          sectionSchedule[day][periodKey] = { kind: 'tiffin' };
          continue;
        }

        // Skip slot if already populated as the second period of a preceding 2-period block
        if (sectionSchedule[day][periodKey]) continue;

        const pTime = sec.periodTimes[periodIdx - 1];

        const candidates = []; // Faculty legally eligible and fully available
        const attempted = [];  // Structurally assigned faculty who encountered a clash or limit

        teachers.forEach(t => {
          if (!t.workingDays.includes(day)) return;

          t.assignments.forEach(assignment => {
            if (assignment.department !== sec.deptName || assignment.semesterId !== sec.semId) return;

            let startMin = pTime.startMin;
            let endMin = pTime.endMin;
            const isExtended = isExtendedType(assignment.type);
            let nextPeriodIdx = null;

            if (isExtended) {
              if (extendedUsedToday[key]) return;
              if (!canScheduleExtended(sec, periodIdx, day, sectionSchedule)) return;
              nextPeriodIdx = periodIdx + 1;
              endMin = sec.periodTimes[nextPeriodIdx - 1].endMin;
            }

            attempted.push({ teacher: t.name, subject: assignment.subject, type: assignment.type });

            // Enforce single session per teacher per section per day
            if (sectionTeachersToday.has(t.id)) return;

            // Enforce single session per subject per section per day
            if (sectionSubjectsToday.has(assignment.subject.toLowerCase())) return;

            // Enforce teacher non-overlap across all sections and teacher availability window
            const busyConflict = busyIntervals[t.id].some(iv => intervalsOverlap(startMin, endMin, iv.start, iv.end));
            const outsideAvailability = !withinTeacherAvailability(t, startMin, endMin);
            if (busyConflict || outsideAvailability) return;

            candidates.push({ teacher: t, assignment, startMin, endMin, isExtended, nextPeriodIdx });
          });
        });

        if (candidates.length > 0) {
          // Select candidate with the lowest accumulated workload to balance distribution
          candidates.sort((a, b) => teacherWorkload[a.teacher.id] - teacherWorkload[b.teacher.id]);
          const sel = candidates[0];

          if (sel.isExtended) {
            sectionSchedule[day][periodKey] = {
              kind: 'class', subject: sel.assignment.subject, teacher: sel.teacher.name, type: sel.assignment.type, span: 2
            };
            // Mark continuation slot with 'skip' sentinel so the renderer emits a colspan cell
            sectionSchedule[day][`Period ${sel.nextPeriodIdx}`] = { kind: 'skip' };
            teacherWorkload[sel.teacher.id] += 2;
            extendedUsedToday[key] = true;
          } else {
            sectionSchedule[day][periodKey] = {
              kind: 'class', subject: sel.assignment.subject, teacher: sel.teacher.name, type: sel.assignment.type, span: 1
            };
            teacherWorkload[sel.teacher.id] += 1;
          }

          busyIntervals[sel.teacher.id].push({ start: sel.startMin, end: sel.endMin });
          sectionTeachersToday.add(sel.teacher.id);
          sectionSubjectsToday.add(sel.assignment.subject.toLowerCase());
        } else if (attempted.length > 0) {
          // Eligible teachers existed but were blocked by a time clash or quota
          sectionSchedule[day][periodKey] = { kind: 'conflict', attempts: attempted };
        } else {
          sectionSchedule[day][periodKey] = { kind: 'free' };
        }
      }
    });
  });

  return { sections: secs, schedules };
}

function generateRoutine() {
  generatedRoutines = runSchedulingAlgorithm();
  renderRoutines();
  goToStep(4);
}

// ── Routine renderer ──────────────────────────────────────────────────────────

function renderRoutines() {
  const container = document.getElementById('routine-viewer');
  container.innerHTML = `
    <div class="d-flex justify-content-between mb-4 align-items-center bg-white p-3 rounded-4 shadow-sm border border-light-subtle">
      <button class="btn btn-outline-secondary px-3 px-sm-4 fw-semibold d-flex align-items-center gap-2" onclick="goToStep(3)" title="Edit Settings">
        <i class="bi bi-arrow-left"></i> <span class="d-none d-sm-inline">Edit Settings</span><span class="d-sm-none">Edit</span>
      </button>
      <button class="btn btn-primary px-3 px-sm-4 fw-semibold shadow-sm d-flex align-items-center gap-2" onclick="exportAllPDFs()" title="Export All PDFs">
        <i class="bi bi-printer"></i> <span class="d-none d-sm-inline">Export All PDFs</span><span class="d-sm-none">Export All</span>
      </button>
    </div>
  `;

  if (!generatedRoutines || !generatedRoutines.sections.length) {
    container.innerHTML += `<p class="text-muted text-center py-5">No sections to display yet. Add departments, semesters and subjects first.</p>`;
    return;
  }

  // Collect all conflict cells so they can be listed in a summary card at the top
  const conflictsFound = [];
  generatedRoutines.sections.forEach(sec => {
    const key = sectionKey(sec.deptName, sec.semId);
    const sched = generatedRoutines.schedules[key];
    daysOfWeek.forEach(day => {
      Object.keys(sched[day] || {}).forEach(periodKey => {
        const cell = sched[day][periodKey];
        if (cell && cell.kind === 'conflict') {
          conflictsFound.push({ deptName: sec.deptName, semId: sec.semId, semLabel: sec.semLabel, day, periodKey, attempts: cell.attempts || [] });
        }
      });
    });
  });

  if (conflictsFound.length > 0) {
    const conflictCard = document.createElement('div');
    conflictCard.className = 'card border-0 shadow-sm mb-4';
    const rows = conflictsFound.map(c => `
      <div class="d-flex justify-content-between align-items-center border-bottom border-light-subtle py-2 px-3">
        <div class="small">
          <strong class="text-dark">${c.deptName} / ${c.semLabel}</strong> &mdash; ${c.day}, ${c.periodKey}<br>
          <span class="text-muted">${c.attempts.map(a => `${a.teacher} (${typeInfo(a.type).label} &middot; ${a.subject})`).join(', ') || 'Teacher clash'}</span>
        </div>
        <button class="btn btn-sm btn-outline-danger fw-semibold d-flex align-items-center gap-1" onclick="resolveConflict('${c.deptName.replace(/'/g, "\\'")}', '${c.semId}', '${c.day}', '${c.periodKey}')" title="Resolve conflict" aria-label="Resolve conflict">
          <i class="bi bi-magic"></i> <span class="d-none d-sm-inline">Resolve</span>
        </button>
      </div>
    `).join('');
    conflictCard.innerHTML = `
      <div class="card-header bg-white border-0 d-flex justify-content-between align-items-center py-3">
        <h5 class="mb-0 text-danger fw-bold"><i class="bi bi-exclamation-triangle-fill me-2"></i>${conflictsFound.length} Conflict(s) Detected</h5>
        <button class="btn btn-sm btn-outline-danger fw-semibold d-flex align-items-center gap-1" onclick="clearAllRoutineConflicts()" title="Clear all conflicts">
          <i class="bi bi-magic"></i> <span class="d-none d-sm-inline">Clear All Conflicts</span><span class="d-sm-none">Clear All</span>
        </button>
      </div>
      <div class="card-body p-0">${rows}</div>
    `;
    container.appendChild(conflictCard);
  }

  // Group sections by department so each gets one card with one table per semester
  const byDept = {};
  generatedRoutines.sections.forEach(sec => {
    if (!byDept[sec.deptName]) byDept[sec.deptName] = [];
    byDept[sec.deptName].push(sec);
  });

  Object.entries(byDept).forEach(([deptName, secList]) => {
    const card = document.createElement('div');
    card.className = 'card border-0 shadow-sm mb-4 overflow-hidden';

    let bodyHtml = '';

    secList.forEach(sec => {
      const key = sectionKey(sec.deptName, sec.semId);
      const deptSchedule = generatedRoutines.schedules[key];
      const periods = Array.from({ length: sec.timing.periods }, (_, i) => `Period ${i + 1}`);

      let tableHead = `<tr><th style="width: 140px;" class="ps-3 text-secondary small">Day / Period</th>`;
      periods.forEach((p, idx) => {
        const t = sec.periodTimes[idx];
        tableHead += `
          <th class="text-center text-secondary small">
            <div>${p}</div>
            <div class="fw-normal text-muted" style="font-size: 0.7em;">${t.start} - ${t.end}</div>
          </th>
        `;
      });
      tableHead += `</tr>`;

      let tableBody = '';
      daysOfWeek.forEach(day => {
        tableBody += `<tr><td class="fw-bold bg-light ps-3 text-dark">${day}</td>`;
        periods.forEach((period) => {
          const cell = deptSchedule[day][period] || { kind: 'free' };
          // "skip" cells are the continuation slots of an extended block — no <td> emitted
          if (cell.kind === 'skip') return;

          let cellClass = "text-center align-middle";
          let cellHtml;

          if (cell.kind === 'tiffin') {
            cellClass += " table-warning text-warning-emphasis fw-bold";
            cellHtml = `<small class="small">TIFFIN BREAK</small>`;
          } else if (cell.kind === 'free') {
            cellClass += " text-muted bg-light bg-opacity-25";
            cellHtml = `<small class="small">FREE</small>`;
          } else if (cell.kind === 'conflict') {
            cellClass += " cell-conflict";
            const attemptText = (cell.attempts || []).map(a => `${a.teacher} (${a.subject})`).join(' vs ');
            cellHtml = `
              <div class="small fw-bold">CONFLICT</div>
              <div class="text-muted" style="font-size: 0.68em;">${attemptText}</div>
              <button class="btn btn-sm btn-outline-danger mt-1 py-0 px-2" style="font-size:0.68rem;" onclick="resolveConflict('${sec.deptName.replace(/'/g, "\\'")}', '${sec.semId}', '${day}', '${period}')">Resolve</button>
            `;
          } else if (cell.kind === 'filler' || cell.type === 'filler') {
            cellClass += " text-dark fw-medium";
            if (cell.teacher && cell.teacher !== '-') {
              cellHtml = `
                <div class="small">${cell.subject || cell.label}</div>
                <div class="small text-muted fw-normal">${cell.teacher}</div>
              `;
            } else {
              cellHtml = `<div class="small">${cell.subject || cell.label}</div>`;
            }
          } else {
            cellClass += " text-dark fw-medium";
            const subjectLabel = cellSubjectLabel(cell.subject, cell.type || (cell.isLab ? 'lab_mini' : 'theory'));
            cellHtml = `
              <div class="small">${subjectLabel}</div>
              <div class="small text-muted fw-normal">${cell.teacher}</div>
            `;
          }

          // Extended blocks use colspan to visually span two columns
          const colSpanAttr = cell.span && cell.span > 1 ? ` colspan="${cell.span}"` : '';
          tableBody += `<td class="${cellClass}"${colSpanAttr}>${cellHtml}</td>`;
        });
        tableBody += `</tr>`;
      });

      bodyHtml += `
        <div class="border-bottom border-light-subtle">
          <div class="d-flex justify-content-between align-items-center px-3 py-2 bg-light bg-opacity-50">
            <h6 class="mb-0 fw-bold text-secondary">${sec.semLabel}</h6>
            <button class="btn btn-sm btn-outline-primary px-2.5 px-sm-3 fw-semibold d-flex align-items-center gap-1" onclick="exportPDF('${deptName}', '${sec.semId}')" title="Save PDF">
              <i class="bi bi-download"></i> <span class="d-none d-sm-inline">Save PDF</span><span class="d-sm-none">PDF</span>
            </button>
          </div>
          <div class="table-responsive">
            <table class="table table-bordered align-middle mb-0 routine-table">
              <thead class="table-light">${tableHead}</thead>
              <tbody>${tableBody}</tbody>
            </table>
          </div>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="card-header bg-white border-0 d-flex justify-content-between align-items-center py-3">
        <h4 class="mb-0 text-primary fw-bold">${deptName}</h4>
      </div>
      <div class="card-body p-0">${bodyHtml}</div>
    `;
    container.appendChild(card);
  });
}

function findSection(deptName, semId) {
  return generatedRoutines.sections.find(s => s.deptName === deptName && s.semId === semId);
}

// ── Conflict resolution ───────────────────────────────────────────────────────
// A conflict slot means every eligible teacher for that section/period was
// already busy elsewhere at that clock time, or exceeded the daily limit.
// The user resolves it by inserting a filler class (e.g. Library) via the modal.

let fillerTarget = null; // { deptName, semId, day, periodKey }
const fillerModalEl = document.getElementById('fillerModal');
const fillerModal = fillerModalEl ? new bootstrap.Modal(fillerModalEl) : null;
const fillerChoiceEl = document.getElementById('filler-choice');
const fillerOtherWrap = document.getElementById('filler-other-wrap');
const fillerOtherNameEl = document.getElementById('filler-other-name');
const fillerOtherTeacherEl = document.getElementById('filler-other-teacher');
const fillerPeriodsEl = document.getElementById('filler-periods');
const fillerSlotEl = document.getElementById('filler-slot');
const fillerContextEl = document.getElementById('filler-context');

// Show/hide the custom name+teacher fields based on the dropdown selection
fillerChoiceEl?.addEventListener('change', () => {
  fillerOtherWrap.classList.toggle('d-none', fillerChoiceEl.value !== '__other__');
});

function resolveConflict(deptName, semId, day, periodKey) {
  if (!fillerModal) return;
  fillerTarget = { deptName, semId, day, periodKey };

  const sec = findSection(deptName, semId);
  if (!sec) return;
  const key = sectionKey(deptName, semId);
  const sched = generatedRoutines.schedules[key];

  if (fillerContextEl) {
    fillerContextEl.innerHTML = `<strong>${deptName} / ${sec.semLabel}</strong> &mdash; Conflict at <strong>${day}, ${periodKey}</strong>`;
  }

  // Build the slot dropdown: skip tiffin, label each option with its current status
  if (fillerSlotEl) {
    fillerSlotEl.innerHTML = '';
    for (let p = 1; p <= sec.timing.periods; p++) {
      if (p === sec.timing.tiffinPeriod) continue;
      const pk = `Period ${p}`;
      const existing = sched[day] && sched[day][pk];
      const opt = document.createElement('option');
      opt.value = pk;
      const tInfo = (sec.periodTimes && sec.periodTimes[p - 1]) ? ` (${sec.periodTimes[p - 1].start} - ${sec.periodTimes[p - 1].end})` : '';

      if (pk === periodKey) {
        opt.textContent = `${pk}${tInfo} [Conflict slot]`;
        opt.selected = true;
      } else if (!existing || existing.kind === 'free' || existing.kind === 'conflict') {
        opt.textContent = `${pk}${tInfo} [Available]`;
      } else {
        const subName = existing.subject || 'Occupied';
        opt.textContent = `${pk}${tInfo} [${subName}]`;
      }
      fillerSlotEl.appendChild(opt);
    }
  }

  fillerChoiceEl.value = 'Library';
  fillerOtherWrap.classList.add('d-none');
  fillerOtherNameEl.value = '';
  if (fillerOtherTeacherEl) fillerOtherTeacherEl.value = '';
  fillerPeriodsEl.value = '1';
  fillerModal.show();
}
window.resolveConflict = resolveConflict;

document.getElementById('btn-confirm-filler')?.addEventListener('click', () => {
  if (!fillerTarget || !generatedRoutines) return;
  const choice = fillerChoiceEl.value;
  const customName = fillerOtherNameEl.value.trim();
  const label = choice === '__other__' ? (customName || 'Other') : 'Library';
  const customTeacher = (choice === '__other__' && fillerOtherTeacherEl) ? fillerOtherTeacherEl.value.trim() : '';
  const teacher = customTeacher || '-';
  const periodsCount = parseInt(fillerPeriodsEl.value, 10) || 1;

  const { deptName, semId, day } = fillerTarget;
  const targetPeriodKey = (fillerSlotEl && fillerSlotEl.value) ? fillerSlotEl.value : fillerTarget.periodKey;

  const applied = placeFillerClass(deptName, semId, day, targetPeriodKey, label, teacher, periodsCount);
  if (!applied) {
    alert('Not enough free, contiguous periods at that slot for that duration (cannot cross Tiffin Break or total periods). Try 1 period, or select an open slot.');
    return;
  }

  fillerModal.hide();
  renderRoutines();
  saveSession();
});

/**
 * Writes a filler or placeholder class spanning `periodsCount` contiguous slots starting at `periodKey`.
 *
 * Validation Rules:
 * - The block cannot extend beyond the section's total periods count.
 * - The block cannot cross or intersect a scheduled tiffin break.
 * - The block cannot overwrite existing scheduled classes, only free or conflict slots.
 *
 * @param {string} deptName - Target department name.
 * @param {string} semId - Target semester identifier.
 * @param {string} day - Weekday name.
 * @param {string} periodKey - Starting period identifier (e.g. "Period 3").
 * @param {string} label - Display label for the slot (e.g. "Library").
 * @param {string} teacherName - Assigned instructor or "-" for unassigned.
 * @param {number} periodsCount - Number of contiguous periods (1 or 2).
 * @returns {boolean} True if successfully committed, false if validation rejected the span.
 */
function placeFillerClass(deptName, semId, day, periodKey, label, teacherName, periodsCount) {
  const sec = findSection(deptName, semId);
  if (!sec) return false;
  const key = sectionKey(deptName, semId);
  const sched = generatedRoutines.schedules[key];
  const startIdx = parseInt(periodKey.replace('Period ', ''), 10);

  const slots = [];
  for (let i = 0; i < periodsCount; i++) {
    const idx = startIdx + i;
    const pk = `Period ${idx}`;
    if (idx > sec.timing.periods || idx === sec.timing.tiffinPeriod) return false;
    const existing = sched[day][pk];
    if (existing && existing.kind !== 'conflict' && existing.kind !== 'free' && pk !== periodKey) return false;
    slots.push(pk);
  }

  const teacher = (teacherName && teacherName.trim() && teacherName.trim() !== '-') ? teacherName.trim() : '-';
  sched[day][slots[0]] = { kind: 'filler', subject: label, teacher, type: 'filler', span: periodsCount };
  for (let i = 1; i < slots.length; i++) {
    sched[day][slots[i]] = { kind: 'skip' };
  }
  return true;
}

/**
 * Bulk conflict resolution utility: replaces all unresolved clash cells across the entire
 * institution with a standardized placeholder slot (defaults to "Library").
 */
function clearAllRoutineConflicts() {
  if (!generatedRoutines) return;
  const name = prompt('Fill every remaining conflict slot with which class? (e.g. "Library")', 'Library');
  if (name === null) return;
  const label = name.trim() || 'Library';

  let count = 0;
  generatedRoutines.sections.forEach(sec => {
    const key = sectionKey(sec.deptName, sec.semId);
    const sched = generatedRoutines.schedules[key];
    daysOfWeek.forEach(day => {
      Object.keys(sched[day] || {}).forEach(periodKey => {
        const cell = sched[day][periodKey];
        if (cell && cell.kind === 'conflict') {
          sched[day][periodKey] = { kind: 'filler', subject: label, type: 'filler', span: 1 };
          count++;
        }
      });
    });
  });

  renderRoutines();
  saveSession();
  alert(`Filled ${count} conflict slot(s) with "${label}".`);
}
window.clearAllRoutineConflicts = clearAllRoutineConflicts;

// ── PDF Export Engine ───────────────────────────────────────────────────────

/**
 * Generates and downloads an academic timetable PDF document for a specific curriculum section.
 * Utilizes jsPDF with AutoTable in landscape orientation, highlighting breaks and multi-span periods.
 *
 * @param {string} deptName - Target department name.
 * @param {string} semId - Target semester identifier.
 */
function exportPDF(deptName, semId) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');
  const sec = findSection(deptName, semId);
  if (!sec) return;
  const key = sectionKey(deptName, semId);
  const deptRoutine = generatedRoutines.schedules[key];
  const periods = Array.from({ length: sec.timing.periods }, (_, i) => `Period ${i + 1}`);

  doc.setFontSize(22);
  doc.setTextColor(30, 41, 59);
  doc.text(`${deptName} - ${sec.semLabel} - Class Routine`, 14, 20);

  const tableColumn = ["Day", ...periods.map((p, idx) => `${p}\n${sec.periodTimes[idx].start} - ${sec.periodTimes[idx].end}`)];
  const tableRows = [];

  daysOfWeek.forEach(day => {
    const rowData = [day];
    periods.forEach(period => {
      const cell = deptRoutine[day][period] || { kind: 'free' };
      if (cell.kind === 'skip') return;

      if (cell.kind === 'tiffin') {
        rowData.push('TIFFIN BREAK');
      } else if (cell.kind === 'free') {
        rowData.push('FREE');
      } else if (cell.kind === 'conflict') {
        rowData.push('UNRESOLVED CONFLICT');
      } else if (cell.kind === 'filler' || cell.type === 'filler') {
        const text = (cell.teacher && cell.teacher !== '-') ? `${cell.subject || cell.label}\n${cell.teacher}` : (cell.subject || cell.label);
        if (cell.span && cell.span > 1) {
          rowData.push({ content: text, colSpan: cell.span });
        } else {
          rowData.push(text);
        }
      } else {
        const subjectLabel = cellSubjectLabel(cell.subject, cell.type || (cell.isLab ? 'lab_mini' : 'theory'));
        const text = `${subjectLabel}\n${cell.teacher}`;
        if (cell.span && cell.span > 1) {
          rowData.push({ content: text, colSpan: cell.span });
        } else {
          rowData.push(text);
        }
      }
    });
    tableRows.push(rowData);
  });

  doc.autoTable({
    head: [tableColumn],
    body: tableRows,
    startY: 28,
    theme: 'grid',
    headStyles: { fillColor: [13, 110, 253], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 249, 250] },
    styles: { cellPadding: 3, fontSize: 8, valign: 'middle', halign: 'center' },
    columnStyles: { 0: { fontStyle: 'bold', halign: 'left', fillColor: [241, 245, 249] } },
    didParseCell: function (data) {
      // Highlight tiffin break cells with a warm yellow background
      if (data.row.section === 'body' && data.cell.raw && data.cell.raw.toString().indexOf('TIFFIN BREAK') !== -1) {
        data.cell.styles.fillColor = [255, 243, 205];
        data.cell.styles.textColor = [102, 77, 3];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  doc.save(`${deptName}_${sec.semLabel.replace(/\s+/g, '_')}_Routine.pdf`);
}
window.exportPDF = exportPDF;

/**
 * Bulk exports individual PDF routines for all active sections.
 * Staggers downloads by 500ms intervals to prevent browser download concurrency throttling.
 */
function exportAllPDFs() {
  generatedRoutines.sections.forEach((sec, index) => {
    setTimeout(() => {
      exportPDF(sec.deptName, sec.semId);
    }, index * 500);
  });
}
window.exportAllPDFs = exportAllPDFs;
window.generateRoutine = generateRoutine;
window.goToStep = goToStep;

// ── Bootstrap ─────────────────────────────────────────────────────────────────
checkSavedSession();
