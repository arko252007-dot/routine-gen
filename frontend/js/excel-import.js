/**
 * RoutineGen - Excel (.xlsx) Ingestion & Template Generation Subsystem
 *
 * Architecture & Ingestion Pipeline:
 * - 3-Sheet Unified Workbook Architecture:
 *     1. "Departments & Timing": Defines academic streams, semester labels, and independent schedule timings
 *        (periods per day, period duration in minutes, start clock time, tiffin break placement and duration).
 *     2. "Subjects & Labs": Declarative curricula lists. Subjects identified in the Labs column automatically
 *        generate both single-period and 2-period extended lab options in addition to regular theory.
 *     3. "Teachers": Faculty directory specifying name, working day tokens, and optional clock-time availability windows.
 *
 * Ingestion Resilience:
 * - Fuzzy Header Normalization: Strips whitespace and punctuation to match columns across diverse spreadsheet layouts.
 * - Fractional Day Conversion: Translates native Excel decimal fractions of a 24-hour day (e.g. 0.375 -> "09:00")
 *   as well as string-based 12h/24h timestamps into normalized "HH:MM" 24-hour format.
 * - Reactive Application Sync: Ingested rows are seamlessly merged into the runtime reactive data structures
 *   (`departments`, `teachers`, `settings`) and saved to sessionStorage.
 */

(function () {
  'use strict';

  // ── Fuzzy Column Matching & Normalization Heuristics ────────────────────────

  /**
   * Normalizes arbitrary spreadsheet header strings into stripped lowercase alphanumeric tokens.
   *
   * @param {*} str - Raw cell content from row 0.
   * @returns {string} Cleaned alphanumeric token.
   */
  function normalizeHeader(str) {
    return (str || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function isDeptCol(h) {
    return h.includes('dept') || h.includes('depart') || h.includes('course') || h.includes('branch') || h.includes('stream');
  }

  function isSemCol(h) {
    return h.includes('sem') || h.includes('semester') || h.includes('year') || h.includes('class');
  }

  function isSubCol(h) {
    return (h.includes('sub') || h.includes('theory')) && !h.includes('lab');
  }

  function isLabCol(h) {
    return h.includes('lab') || h.includes('practical');
  }

  function isTypeCol(h) {
    return h.includes('type') || h.includes('classtype');
  }

  function isPeriodsCol(h) {
    return h.includes('period') && (h.includes('day') || !h.includes('dur'));
  }

  function isDurCol(h) {
    return (h.includes('dur') || h.includes('duration')) && !h.includes('tiffin');
  }

  function isStartCol(h) {
    return h.includes('start') || h.includes('time');
  }

  function isTiffinPCol(h) {
    return h.includes('tiffin') && (h.includes('period') || h.includes('after'));
  }

  function isTiffinDCol(h) {
    return h.includes('tiffin') && (h.includes('dur') || h.includes('duration'));
  }

  function isTeacherNameCol(h) {
    return h.includes('teacher') || h.includes('faculty') || h.includes('prof') || (h.includes('name') && !isDeptCol(h) && !isSubCol(h));
  }

  function isDayCol(h) {
    return h.includes('day') || h.includes('days');
  }

  function isFromCol(h) {
    return h.includes('from') || (h.includes('start') && !isDeptCol(h));
  }

  function isToCol(h) {
    return h.includes('to') || h.includes('end');
  }

  // ── Timestamp & Day Normalization Utilities ─────────────────────────────────

  /**
   * Translates native Excel timestamp values (numbers or strings) into standard 24-hour "HH:MM" format.
   *
   * Handles:
   * - Excel decimal fractional days (e.g. 0.375 -> 9:00 AM -> "09:00").
   * - Whole integer hour values (e.g. 9 -> "09:00").
   * - 12-hour strings with meridiem (e.g. "1:30 pm" -> "13:30").
   * - Standard 24-hour strings (e.g. "14:00").
   *
   * @param {number|string} val - Raw cell value from workbook.
   * @returns {string|null} Normalized "HH:MM" string or null if invalid.
   */
  function formatExcelTime(val) {
    if (val == null || val === '') return null;
    if (typeof val === 'number') {
      if (val >= 0 && val < 1) {
        const totalMinutes = Math.round(val * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const mins = totalMinutes % 60;
        return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
      }
      if (val >= 1 && val <= 24) {
        return `${String(Math.floor(val)).padStart(2, '0')}:00`;
      }
    }
    const str = val.toString().trim();
    if (!str) return null;
    const match = str.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const meridiem = (match[3] || '').toLowerCase();
      if (meridiem === 'pm' && h < 12) h += 12;
      if (meridiem === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
    return null;
  }

  /**
   * Parses free-form comma/semicolon-separated weekday text into an array of canonical day names.
   *
   * @param {string} daysStr - E.g. "Mon, Wed, Fri" or "Monday; Tuesday".
   * @returns {Array<string>} Filtered canonical weekday names preserved in standard chronological order.
   */
  function mapWorkingDays(daysStr) {
    if (!daysStr) return [];
    const tokens = daysStr.toString().split(/[,;/|]+/);
    const mapped = new Set();
    const map = {
      mon: 'Monday', monday: 'Monday',
      tue: 'Tuesday', tues: 'Tuesday', tuesday: 'Tuesday',
      wed: 'Wednesday', wednesday: 'Wednesday',
      thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday', thursday: 'Thursday',
      fri: 'Friday', friday: 'Friday',
      sat: 'Saturday', saturday: 'Saturday'
    };

    tokens.forEach(tok => {
      const clean = tok.trim().toLowerCase();
      if (map[clean]) {
        mapped.add(map[clean]);
      } else {
        const prefix3 = clean.slice(0, 3);
        if (map[prefix3]) mapped.add(map[prefix3]);
      }
    });

    const canonicalDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return canonicalDays.filter(d => mapped.has(d));
  }

  function normalizeSemesterLabel(sem) {
    if (sem == null) return '';
    const str = sem.toString().trim();
    const matchNum = str.match(/^\s*(?:sem(?:ester)?[-_\s]*)?(\d+)\s*$/i);
    if (matchNum) {
      return `Semester ${matchNum[1]}`;
    }
    return str;
  }

  function cleanSubjectName(name) {
    if (!name) return '';
    const trimmed = name.toString().trim().replace(/\s*\(?theory\)?\s*/gi, '').trim();
    if (trimmed === trimmed.toLowerCase()) {
      return (typeof toCapitalCase === 'function')
        ? toCapitalCase(trimmed)
        : trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    }
    return trimmed;
  }

  function normalizeSubKey(s) {
    return (s || '')
      .toString()
      .toLowerCase()
      .replace(/\s*\(?lab(?: extended)?\)?\s*/gi, '')
      .replace(/\s*\(?theory\)?\s*/gi, '')
      .replace(/[^a-z0-9]/g, '');
  }

  function normalizeClassType(rawType) {
    if (!rawType) return 'theory';
    const clean = rawType.toString().trim().toLowerCase().replace(/[-\s]/g, '_');
    if (clean === 'lab') return 'lab_mini';
    if (clean === 'theory') return 'theory';
    if (clean === 'theory_extended' || clean === 'theoryext') return 'theory_extended';
    if (clean === 'lab_mini' || clean === 'minilab') return 'lab_mini';
    if (clean === 'lab_extended' || clean === 'labext') return 'lab_extended';
    if (clean === 'theory_lab' || clean === 'theorylab') return 'theory_lab';
    return clean;
  }

  function addSubjectToSem(semObj, name, type) {
    if (!name || !type) return false;
    const cleanName = cleanSubjectName(name);
    if (!cleanName) return false;
    const exists = semObj.subjects.some(
      s => s.name.toLowerCase() === cleanName.toLowerCase() && s.type === type
    );
    if (!exists) {
      semObj.subjects.push({ name: cleanName, type });
      return true;
    }
    return false;
  }

  function renderStatusAlert(containerId, statusType, message, detailsList) {
    const el = document.getElementById(containerId);
    if (!el) return;

    el.className = `alert alert-${statusType} mb-4 small`;
    el.classList.remove('d-none');

    let detailsHtml = '';
    if (detailsList && detailsList.length > 0) {
      const items = detailsList.map(item => `<li>${item}</li>`).join('');
      detailsHtml = `
        <details class="mt-2" style="cursor: pointer;">
          <summary class="fw-semibold">View Details / Warnings (${detailsList.length})</summary>
          <ul class="mb-0 mt-1 ps-3" style="max-height: 180px; overflow-y: auto;">${items}</ul>
        </details>
      `;
    }

    el.innerHTML = `
      <div class="d-flex justify-content-between align-items-start">
        <div>${message}</div>
        <button type="button" class="btn-close ms-2" aria-label="Close" onclick="document.getElementById('${containerId}').classList.add('d-none')"></button>
      </div>
      ${detailsHtml}
    `;
  }

  // ── Template Workbook Generation (3 Sheets) ────────────────────────────────

  /**
   * Generates and downloads a clean, pre-formatted 3-sheet starter Excel workbook (`routine_template.xlsx`).
   *
   * Sheets:
   * 1. "Departments & Timing": Department and semester names with schedule configurations.
   * 2. "Subjects & Labs": Comma-delimited list of theory and lab subjects per semester.
   * 3. "Teachers": Faculty names, active weekdays, and optional availability intervals.
   */
  function downloadRoutineTemplate() {
    if (typeof XLSX === 'undefined') {
      alert('SheetJS library is not loaded. Please ensure an active internet connection to load the CDN.');
      return;
    }

    const wb = XLSX.utils.book_new();

    // Sheet 1: Departments & Timing
    const timingData = [
      ['Department', 'Semester', 'Periods/Day', 'Period Duration (mins)', 'Start Time', 'Tiffin After Period #', 'Tiffin Duration (mins)'],
      ['BCA', 'Semester 1', 8, 45, '09:00', 4, 30],
      ['BCA', 'Semester 2', 8, 45, '10:00', 4, 30],
      ['BBA', 'Semester 1', 6, 50, '09:30', 3, 30],
      ['BBA', 'Semester 2', 6, 50, '09:30', 3, 30]
    ];
    const wsTiming = XLSX.utils.aoa_to_sheet(timingData);
    wsTiming['!cols'] = [
      { wch: 16 }, // Department
      { wch: 16 }, // Semester
      { wch: 14 }, // Periods/Day
      { wch: 24 }, // Period Duration
      { wch: 14 }, // Start Time
      { wch: 24 }, // Tiffin After Period
      { wch: 24 }  // Tiffin Duration
    ];
    XLSX.utils.book_append_sheet(wb, wsTiming, 'Departments & Timing');

    // Sheet 2: Subjects & Labs
    const quickSubData = [
      ['Department', 'Semester', 'Subjects', 'Labs'],
      ['BCA', 'Semester 1', 'OS, DSA, Disaster Management', 'OS, DSA'],
      ['BCA', 'Semester 2', 'DBMS, Computer Networks, Software Engineering', 'DBMS, Computer Networks'],
      ['BBA', 'Semester 1', 'Principles of Management, Business Economics, Financial Accounting', ''],
      ['BBA', 'Semester 2', 'Marketing Management, Human Resource Management, Business Law', '']
    ];
    const wsQuickSub = XLSX.utils.aoa_to_sheet(quickSubData);
    wsQuickSub['!cols'] = [
      { wch: 16 }, // Department
      { wch: 16 }, // Semester
      { wch: 54 }, // Subjects
      { wch: 36 }  // Labs
    ];
    XLSX.utils.book_append_sheet(wb, wsQuickSub, 'Subjects & Labs');

    // Sheet 3: Teachers Directory
    const teachersData = [
      ['Teacher Name', 'Working Days', 'Available From', 'Available To'],
      ['Dr. Krish', 'Mon,Tue,Wed,Thu,Fri', '09:00', '17:00'],
      ['Dr. Arko', 'Monday, Tuesday, Thursday', '12:00', '15:00']
    ];
    const wsTeachers = XLSX.utils.aoa_to_sheet(teachersData);
    wsTeachers['!cols'] = [
      { wch: 24 }, // Teacher Name
      { wch: 34 }, // Working Days
      { wch: 18 }, // Available From
      { wch: 18 }  // Available To
    ];
    XLSX.utils.book_append_sheet(wb, wsTeachers, 'Teachers');

    XLSX.writeFile(wb, 'routine_template.xlsx');
  }

  // ── Master Workbook Ingestion Pipeline ──────────────────────────────────────

  /**
   * File input event handler for reading uploaded `.xlsx` or `.xls` workbooks.
   *
   * @param {Event} e - Input change event containing the file reference.
   * @param {string|number} sourceStep - Source trigger context: 'header', 2 (Depts), or 3 (Faculty).
   */
  function handleFileUpload(e, sourceStep) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (evt) {
      try {
        const data = new Uint8Array(evt.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        processMasterWorkbook(wb, sourceStep);
      } catch (err) {
        const statusId = sourceStep === 'header' ? 'header-excel-status' : (sourceStep === 3 ? 'teacher-excel-status' : 'dept-excel-status');
        renderStatusAlert(statusId, 'danger', `<strong>Failed to read Excel file:</strong> ${err.message}`, []);
      }
      e.target.value = '';
    };
    reader.readAsArrayBuffer(file);
  }

  /**
   * Parses, validates, and incorporates an uploaded Excel workbook into the application state.
   * Inspects all sheets, matches headers fuzzily, extracts timing overrides, curricula, and faculty records.
   *
   * @param {Object} wb - SheetJS workbook instance.
   * @param {string|number} sourceStep - Upload invocation context.
   */
  function processMasterWorkbook(wb, sourceStep) {
    const sheetNames = wb.SheetNames || [];
    const statusId = sourceStep === 'header' ? 'header-excel-status' : (sourceStep === 3 ? 'teacher-excel-status' : 'dept-excel-status');

    if (sheetNames.length === 0) {
      renderStatusAlert(statusId, 'danger', '<strong>Empty workbook:</strong> The uploaded file contains no sheets.', []);
      return;
    }

    const depts = (typeof departments !== 'undefined') ? departments : (window.departments || []);
    const teacherList = (typeof teachers !== 'undefined') ? teachers : (window.teachers || []);
    const defaultSettings = (typeof settings !== 'undefined') ? settings : { periods: 8, periodDuration: 45, startTime: '09:00', tiffinPeriod: 4, tiffinDuration: 30 };

    const issues = [];
    let deptsAdded = 0;
    let semsAdded = 0;
    let subjectsAdded = 0;
    let teachersAdded = 0;

    // Helper: get or create department
    function getOrCreateDept(deptName) {
      let dept = depts.find(d => d.name === deptName);
      if (!dept) {
        dept = { name: deptName, semesters: [] };
        depts.push(dept);
        deptsAdded++;
      }
      return dept;
    }

    // Helper: get or create semester
    function getOrCreateSem(deptObj, semLabel, timing) {
      let sem = deptObj.semesters.find(s => s.label === semLabel);
      if (!sem) {
        sem = {
          id: (typeof uid === 'function') ? uid('sem') : `sem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          label: semLabel,
          timing: timing ? { ...timing } : { ...defaultSettings },
          subjects: []
        };
        deptObj.semesters.push(sem);
        semsAdded++;
      } else if (timing) {
        sem.timing = { ...timing };
      }
      return sem;
    }

    // Iterate through all sheets in workbook
    sheetNames.forEach(sheetName => {
      const ws = wb.Sheets[sheetName];
      if (!ws) return;
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (!rows || rows.length <= 1) return;

      const headers = rows[0].map(normalizeHeader);
      const colDept = headers.findIndex(isDeptCol);
      const colSem = headers.findIndex(isSemCol);
      const colSubs = headers.findIndex(isSubCol);
      const colLabs = headers.findIndex(isLabCol);
      const colType = headers.findIndex(isTypeCol);
      const colPeriods = headers.findIndex(isPeriodsCol);
      const colDur = headers.findIndex(isDurCol);
      const colStart = headers.findIndex(isStartCol);
      const colTiffinP = headers.findIndex(isTiffinPCol);
      const colTiffinD = headers.findIndex(isTiffinDCol);

      const colTeacherName = headers.findIndex(isTeacherNameCol);
      const colTeacherDays = headers.findIndex(isDayCol);
      const colTeacherFrom = headers.findIndex(isFromCol);
      const colTeacherTo = headers.findIndex(isToCol);

      // 1. Process Teachers sheet/rows
      if (colTeacherName !== -1 && colTeacherDays !== -1) {
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          const rawName = (row[colTeacherName] || '').toString().trim();
          const rawDays = (row[colTeacherDays] || '').toString().trim();
          const rawFrom = colTeacherFrom !== -1 ? row[colTeacherFrom] : '';
          const rawTo = colTeacherTo !== -1 ? row[colTeacherTo] : '';

          if (!rawName && !rawDays) continue;
          if (!rawName) {
            issues.push(`Sheet "${sheetName}" Row ${i + 1}: Skipped row with missing Teacher Name.`);
            continue;
          }

          if (teacherList.some(t => t.name.toLowerCase() === rawName.toLowerCase())) {
            issues.push(`Sheet "${sheetName}" Row ${i + 1}: Skipped "${rawName}" — already exists in directory.`);
            continue;
          }

          const workingDays = mapWorkingDays(rawDays || 'Monday,Tuesday,Wednesday,Thursday,Friday');
          if (workingDays.length === 0) {
            issues.push(`Sheet "${sheetName}" Row ${i + 1}: Skipped "${rawName}" — no valid working days found in "${rawDays}".`);
            continue;
          }

          const availStart = formatExcelTime(rawFrom);
          const availEnd = formatExcelTime(rawTo);

          teacherList.push({
            id: Date.now() + Math.floor(Math.random() * 100000) + i,
            name: rawName,
            workingDays,
            availStart: (availStart && availEnd) ? availStart : null,
            availEnd: (availStart && availEnd) ? availEnd : null,
            assignments: []
          });
          teachersAdded++;
        }
      }

      // 2. Process Departments & Semesters
      if (colDept !== -1) {
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          if (!row || row.length === 0) continue;
          const rawDept = (row[colDept] || '').toString().trim();
          const rawSem = colSem !== -1 ? (row[colSem] || '').toString().trim() : '';

          if (!rawDept && !rawSem) continue;
          if (!rawDept) continue;

          const deptName = rawDept.toUpperCase();
          const deptObj = getOrCreateDept(deptName);

          if (!rawSem) continue;
          const semLabel = normalizeSemesterLabel(rawSem);

          // Extract timing if columns are present
          let timing = null;
          if (colPeriods !== -1 || colStart !== -1 || colDur !== -1) {
            timing = {
              periods: (colPeriods !== -1 && parseInt(row[colPeriods], 10)) ? parseInt(row[colPeriods], 10) : defaultSettings.periods,
              periodDuration: (colDur !== -1 && parseInt(row[colDur], 10)) ? parseInt(row[colDur], 10) : defaultSettings.periodDuration,
              startTime: colStart !== -1 ? (formatExcelTime(row[colStart]) || defaultSettings.startTime) : defaultSettings.startTime,
              tiffinPeriod: (colTiffinP !== -1 && parseInt(row[colTiffinP], 10)) ? parseInt(row[colTiffinP], 10) : defaultSettings.tiffinPeriod,
              tiffinDuration: (colTiffinD !== -1 && parseInt(row[colTiffinD], 10)) ? parseInt(row[colTiffinD], 10) : defaultSettings.tiffinDuration
            };
          }

          const semObj = getOrCreateSem(deptObj, semLabel, timing);

          // A) Comma-separated Subjects and Labs format (Sheet 2)
          if (colLabs !== -1 || (colSubs !== -1 && colType === -1)) {
            const rawSubs = colSubs !== -1 ? (row[colSubs] || '').toString().trim() : '';
            const rawLabs = colLabs !== -1 ? (row[colLabs] || '').toString().trim() : '';

            const subTokens = rawSubs ? rawSubs.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean) : [];
            const labTokens = rawLabs ? rawLabs.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean) : [];

            const hasLabVariant = (subName) => {
              const k = normalizeSubKey(subName);
              return labTokens.some(l => normalizeSubKey(l) === k);
            };

            // Add each subject from the Subjects column
            subTokens.forEach(sub => {
              // Always add Theory
              if (addSubjectToSem(semObj, sub, 'theory')) subjectsAdded++;

              // If this subject is also in Labs, add both Lab and Lab Extended variants
              if (hasLabVariant(sub)) {
                if (addSubjectToSem(semObj, sub, 'lab_mini')) subjectsAdded++;
                if (addSubjectToSem(semObj, sub, 'lab_extended')) subjectsAdded++;
              }
            });

            // Add any lab subjects that were not listed in the Subjects column
            labTokens.forEach(lab => {
              const cleanLab = lab.replace(/\s*\(?lab(?: extended)?\)?\s*/gi, '').trim() || lab;
              const k = normalizeSubKey(cleanLab);
              const alreadyHandled = subTokens.some(s => normalizeSubKey(s) === k);
              if (!alreadyHandled) {
                if (addSubjectToSem(semObj, cleanLab, 'theory')) subjectsAdded++;
                if (addSubjectToSem(semObj, cleanLab, 'lab_mini')) subjectsAdded++;
                if (addSubjectToSem(semObj, cleanLab, 'lab_extended')) subjectsAdded++;
              }
            });
          }
          // B) Single row-by-row subject + type (legacy or all-in-one format)
          else if (colSubs !== -1 && colType !== -1) {
            const rawSub = (row[colSubs] || '').toString().trim();
            const rawType = (row[colType] || '').toString().trim();
            if (rawSub) {
              const cleanType = normalizeClassType(rawType);
              if (addSubjectToSem(semObj, rawSub, cleanType)) subjectsAdded++;
            }
          }
        }
      }
    });

    // --- RE-RENDER APPLICATION STATE ---
    if (depts.length > 0) {
      let idxToSelect = 0;
      if (typeof selectedDeptIndex !== 'undefined' && selectedDeptIndex !== null && selectedDeptIndex < depts.length) {
        idxToSelect = selectedDeptIndex;
      }
      if (typeof window.selectDepartment === 'function') {
        window.selectDepartment(idxToSelect);
      } else {
        if (typeof renderDepartments === 'function') renderDepartments();
        if (typeof renderSemesterPanel === 'function') renderSemesterPanel();
      }
    } else {
      if (typeof renderDepartments === 'function') renderDepartments();
      if (typeof renderSemesterPanel === 'function') renderSemesterPanel();
    }

    if (typeof populateAssignSelects === 'function') populateAssignSelects();
    if (typeof renderTeachers === 'function') renderTeachers();
    if (typeof saveSession === 'function') saveSession();

    const totalCount = deptsAdded + semsAdded + subjectsAdded + teachersAdded;

    if (totalCount === 0) {
      if (issues.length > 0) {
        renderStatusAlert(
          statusId,
          'danger',
          '<strong>No data imported:</strong> Rows were skipped due to formatting or duplicate entries.',
          issues
        );
      } else {
        renderStatusAlert(
          statusId,
          'warning',
          '<strong>No recognizable data found:</strong> Please ensure the Excel file contains valid headers (e.g. Department, Semester, Subjects, Labs, or Teachers) with data rows.',
          []
        );
      }
    } else {
      let parts = [];
      if (deptsAdded > 0) parts.push(`<strong>${deptsAdded}</strong> department(s)`);
      if (semsAdded > 0) parts.push(`<strong>${semsAdded}</strong> semester(s)`);
      if (subjectsAdded > 0) parts.push(`<strong>${subjectsAdded}</strong> subject entries (with lab variants)`);
      if (teachersAdded > 0) parts.push(`<strong>${teachersAdded}</strong> teacher(s)`);

      const summary = `<strong>Import Complete:</strong> Added ${parts.join(', ')}.`;
      const alertType = issues.length > 0 ? 'warning' : 'success';
      renderStatusAlert(statusId, alertType, summary, issues);

      // Change "View Excel Guide" to "Go to Builder"
      updateHeaderModalToGoToBuilder();
    }
  }

  // --- HEADER MODAL "GO TO BUILDER" CONTROLS ---

  function updateHeaderModalToGoToBuilder() {
    const footerText = document.getElementById('header-excel-footer-text');
    if (footerText) {
      footerText.className = 'text-success small fw-semibold d-flex align-items-center gap-1';
      footerText.innerHTML = '<i class="bi bi-check-circle-fill"></i> Data loaded!';
    }
    const footerAction = document.getElementById('header-excel-footer-action');
    if (footerAction) {
      footerAction.innerHTML = `
        <button type="button" class="btn btn-sm btn-primary fw-bold px-3 py-1.5 d-flex align-items-center gap-1.5 shadow-sm" id="btn-header-excel-builder" onclick="window.goToBuilderFromModal()">
          <span>Go to Builder</span>
          <i class="bi bi-arrow-right-circle"></i>
        </button>
      `;
    }
  }

  function resetHeaderModalFooter() {
    const footerText = document.getElementById('header-excel-footer-text');
    if (footerText) {
      footerText.className = 'text-muted small';
      footerText.textContent = 'Need help with columns or rules?';
    }
    const footerAction = document.getElementById('header-excel-footer-action');
    if (footerAction) {
      footerAction.innerHTML = `
        <a href="help.html#excel" class="btn btn-sm btn-outline-secondary fw-semibold" id="btn-header-excel-guide">
          <i class="bi bi-book me-1"></i> View Excel Guide
        </a>
      `;
    }
  }

  window.goToBuilderFromModal = function () {
    // 1. Close the Excel bulk setup modal
    const modalEl = document.getElementById('excelActionModal');
    if (modalEl && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
      const modalInstance = bootstrap.Modal.getInstance(modalEl);
      if (modalInstance) {
        modalInstance.hide();
      }
    }

    // 2. Switch to Step 2 (Departments tab)
    if (typeof goToStep === 'function') {
      goToStep(2);
    } else if (typeof window.goToStep === 'function') {
      window.goToStep(2);
    }

    // 3. Auto-select first department if available
    const depts = (typeof departments !== 'undefined') ? departments : (window.departments || []);
    if (depts.length > 0 && typeof window.selectDepartment === 'function') {
      window.selectDepartment(0);
    }

    // Smooth scroll to top of step 2
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // --- INITIALIZE DOM LISTENERS ---

  function initExcelImport() {
    // Step 2 Buttons
    const btnDownloadDept = document.getElementById('btn-download-dept-template');
    const btnImportDept = document.getElementById('btn-import-dept-excel');
    const fileInputDept = document.getElementById('excel-file-dept');

    if (btnDownloadDept) {
      btnDownloadDept.onclick = downloadRoutineTemplate;
    }
    if (btnImportDept && fileInputDept) {
      btnImportDept.onclick = () => fileInputDept.click();
      fileInputDept.onchange = (e) => handleFileUpload(e, 2);
    }

    // Step 3 Buttons
    const btnDownloadTeacher = document.getElementById('btn-download-teacher-template');
    const btnImportTeacher = document.getElementById('btn-import-teacher-excel');
    const fileInputTeacher = document.getElementById('excel-file-teacher');

    if (btnDownloadTeacher) {
      btnDownloadTeacher.onclick = downloadRoutineTemplate;
    }
    if (btnImportTeacher && fileInputTeacher) {
      btnImportTeacher.onclick = () => fileInputTeacher.click();
      fileInputTeacher.onchange = (e) => handleFileUpload(e, 3);
    }

    // Header Quick Action Modal Button & Modal Show Reset Listener
    const fileInputHeader = document.getElementById('header-excel-file');
    if (fileInputHeader) {
      fileInputHeader.onchange = (e) => handleFileUpload(e, 'header');
    }

    const modalEl = document.getElementById('excelActionModal');
    if (modalEl) {
      modalEl.addEventListener('show.bs.modal', function () {
        const statusEl = document.getElementById('header-excel-status');
        if (statusEl) {
          statusEl.className = 'alert d-none mb-3 small';
          statusEl.innerHTML = '';
        }
        const fInput = document.getElementById('header-excel-file');
        if (fInput) fInput.value = '';
        resetHeaderModalFooter();
      });

      // Auto-open modal if requested via URL param (e.g. from help.html)
      try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('openExcel') === 'true' && typeof bootstrap !== 'undefined' && bootstrap.Modal) {
          setTimeout(() => {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
          }, 250);
        }
      } catch (e) {}
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initExcelImport);
  } else {
    initExcelImport();
  }

  // Export functions onto window
  window.downloadRoutineTemplate = downloadRoutineTemplate;
  window.routineExcelImport = {
    downloadRoutineTemplate,
    processMasterWorkbook,
    mapWorkingDays,
    formatExcelTime,
    normalizeSemesterLabel,
    normalizeClassType
  };
})();
