// ============================================================
//  Lab Booking App — Main Logic (Firebase Firestore)
// ============================================================

import {
  db, collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot
} from './firebase-config.js';

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────
  const MAX_OVERLAP = 2;

  let currentYear, currentMonth; // 0-indexed month
  let selectedDate = null;
  let currentLang = localStorage.getItem('lab-lang');
  if (!currentLang) {
    const browserLang = navigator.language || '';
    currentLang = browserLang.startsWith('it') ? 'it' : 'en';
  }

  // In-memory cache (synced with Firestore via onSnapshot)
  let bookingsCache = {};
  let closuresCache = {};
  let isSaving = false; // Guard flag to prevent onSnapshot re-renders during save/delete
  let dataLoaded = false;

  const TRANSLATIONS = {
    it: {
      title: "Prenotazione Laboratorio Robotica",
      subtitle: "Prenotazione laboratorio",
      today: "Oggi",
      months: ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'],
      days: { mon: 'Lun', tue: 'Mar', wed: 'Mer', thu: 'Gio', fri: 'Ven', sat: 'Sab', sun: 'Dom' },
      legend: {
        student: "Studente",
        absence: "Assenza tutor",
        closed: "Lab chiuso"
      },
      guide: {
        title: "📖 Guida rapida",
        blue: "<strong>Azzurro</strong> — Prenotazione studente",
        blue_detail: "Clicca sul giorno per prenotare il lab con nome e orario.",
        pink: "<strong>Rosa</strong> — Assenza tutor",
        pink_detail: "Il tutor segnala le ore in cui non sarà disponibile.",
        red: "<strong>Rosso</strong> — Lab chiuso",
        red_detail: "Il tutor ha chiuso il laboratorio per l'intera giornata. Non è possibile prenotare.",
        yellow: "<strong>Giallo</strong> — Fascia oraria piena",
        yellow_detail: "Max <strong>2 studenti</strong> possono sovrapporsi. Se una fascia è piena, il badge diventa giallo."
      },
      modal: {
        closed_toggle: "Lab chiuso per la giornata",
        closed_label: "🔒 Lab chiuso",
        full_label: "⚠ {n}/{max} studenti",
        confirm_delete: "Eliminare questa prenotazione?",
        entries_title: "Prenotazioni",
        student_label: "Prenotazione studente",
        tutor_label: "Assenza tutor"
      },
      form: {
        title: "Nuova prenotazione",
        type: "Tipo",
        student_booking: "Studente — Prenota lab",
        tutor_absence: "Tutor — Assenza",
        name: "Nome",
        name_placeholder: "Il tuo nome",
        time: "Orario",
        optional: "(opzionale)",
        notes: "Note",
        notes_placeholder: "Es: progetto droni, esperimenti, ecc.",
        add: "Aggiungi",
        saving: "Salvataggio…"
      },
      errors: {
        save: "Errore salvataggio:",
        conn: "Errore di connessione. Riprova."
      }
    },
    en: {
      title: "Robotics Lab Booking",
      subtitle: "Lab reservation system",
      today: "Today",
      months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      days: { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' },
      legend: {
        student: "Student",
        absence: "Tutor absence",
        closed: "Lab closed"
      },
      guide: {
        title: "📖 Quick Guide",
        blue: "<strong>Blue</strong> — Student booking",
        blue_detail: "Click on a day to book the lab with your name and time.",
        pink: "<strong>Pink</strong> — Tutor absence",
        pink_detail: "Tutor marks hours when they won't be available.",
        red: "<strong>Red</strong> — Lab closed",
        red_detail: "Tutor closed the lab for the entire day. Booking is not possible.",
        yellow: "<strong>Yellow</strong> — Full slot",
        yellow_detail: "Max <strong>2 students</strong> can overlap. If a slot is full, the badge turns yellow."
      },
      modal: {
        closed_toggle: "Lab closed for the day",
        closed_label: "🔒 Lab closed",
        full_label: "⚠ {n}/{max} students",
        confirm_delete: "Delete this booking?",
        entries_title: "Bookings",
        student_label: "Student booking",
        tutor_label: "Tutor absence"
      },
      form: {
        title: "New booking",
        type: "Type",
        student_booking: "Student — Book lab",
        tutor_absence: "Tutor — Absence",
        name: "Name",
        name_placeholder: "Your name",
        time: "Time",
        optional: "(optional)",
        notes: "Notes",
        notes_placeholder: "e.g. drone project, experiments, etc.",
        add: "Add",
        saving: "Saving…"
      },
      errors: {
        save: "Save error:",
        conn: "Connection error. Please try again."
      }
    }
  };

  function t(path, params = {}) {
    const keys = path.split('.');
    let result = TRANSLATIONS[currentLang];
    for (const key of keys) {
      result = result ? result[key] : null;
    }
    if (typeof result === 'string') {
      for (const [p, v] of Object.entries(params)) {
        result = result.replace(`{${p}}`, v);
      }
    }
    return result || path;
  }

  function updateLanguage() {
    // Update static HTML elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.dataset.i18n;
      el.innerHTML = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.dataset.i18nPlaceholder;
      el.placeholder = t(key);
    });
    document.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.dataset.i18nTitle;
      document.title = t(key);
    });

    // Update active button state
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.lang === currentLang);
    });

    renderCalendar();
    if (selectedDate) {
      renderEntries(selectedDate);
      $modalTitle.textContent = formatDateForTitle(selectedDate);
    }
    console.log(`[i18n] Language updated to: ${currentLang}`);
  }

  // Expose to window for debugging/subagent
  window.setLanguage = (lang) => {
    if (TRANSLATIONS[lang]) {
      currentLang = lang;
      localStorage.setItem('lab-lang', lang);
      updateLanguage();
    }
  };

  // ── DOM References ─────────────────────────────────────────
  const $grid = document.getElementById('calendar-grid');
  const $monthLabel = document.getElementById('month-label');
  const $yearLabel = document.getElementById('year-label');
  const $btnPrev = document.getElementById('btn-prev');
  const $btnNext = document.getElementById('btn-next');
  const $btnToday = document.getElementById('btn-today');
  const $overlay = document.getElementById('modal-overlay');
  const $modalTitle = document.getElementById('modal-title');
  const $modalClose = document.getElementById('modal-close');
  const $entries = document.getElementById('entries-section');
  const $formSection = document.getElementById('form-section');
  const $inputName = document.getElementById('entry-name');
  const $inputNote = document.getElementById('entry-note');
  const $inputFrom = document.getElementById('entry-time-from');
  const $inputTo = document.getElementById('entry-time-to');
  const $btnAdd = document.getElementById('btn-add');
  const $toggleClosed = document.getElementById('toggle-closed');
  const $overlapWarn = document.getElementById('overlap-warning');
  const $overlapText = document.getElementById('overlap-warning-text');

  // ── Firestore Helpers ─────────────────────────────────────
  async function saveEntries(dateStr, entries) {
    const ref = doc(db, 'bookings', dateStr);
    if (entries.length === 0) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { entries });
    }
  }

  async function saveClosure(dateStr, closed) {
    const ref = doc(db, 'closures', dateStr);
    if (closed) {
      await setDoc(ref, { closed: true });
    } else {
      await deleteDoc(ref);
    }
  }

  // ── Cache Accessors (synchronous, from in-memory cache) ───
  function isDayClosed(dateStr) {
    // Weekends (Saturday=6, Sunday=0) are automatically closed
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) return true;

    return !!closuresCache[dateStr];
  }

  function getEntries(dateStr) {
    return bookingsCache[dateStr] || [];
  }

  async function addEntry(dateStr, entry) {
    if (!bookingsCache[dateStr]) bookingsCache[dateStr] = [];
    bookingsCache[dateStr].push(entry);
    isSaving = true;
    try { await saveEntries(dateStr, bookingsCache[dateStr]); }
    finally { isSaving = false; }
  }

  async function removeEntry(dateStr, entryId) {
    if (bookingsCache[dateStr]) {
      bookingsCache[dateStr] = bookingsCache[dateStr].filter(e => e.id !== entryId);
      if (bookingsCache[dateStr].length === 0) delete bookingsCache[dateStr];
      isSaving = true;
      try { await saveEntries(dateStr, bookingsCache[dateStr] || []); }
      finally { isSaving = false; }
    }
  }

  async function setDayClosed(dateStr, closed) {
    if (closed) closuresCache[dateStr] = true;
    else delete closuresCache[dateStr];
    isSaving = true;
    try { await saveClosure(dateStr, closed); }
    finally { isSaving = false; }
  }

  // ── Time Overlap Helpers ───────────────────────────────────
  /** Convert "HH:MM" to minutes since midnight. Returns NaN if empty. */
  function timeToMin(t) {
    if (!t) return NaN;
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  }

  /** Check if two time ranges overlap. Ranges with missing times are treated as full-day. */
  function rangesOverlap(fromA, toA, fromB, toB) {
    const a0 = isNaN(timeToMin(fromA)) ? 0 : timeToMin(fromA);
    const a1 = isNaN(timeToMin(toA)) ? 1440 : timeToMin(toA);
    const b0 = isNaN(timeToMin(fromB)) ? 0 : timeToMin(fromB);
    const b1 = isNaN(timeToMin(toB)) ? 1440 : timeToMin(toB);
    return a0 < b1 && b0 < a1;
  }

  /**
   * Count how many STUDENT bookings overlap with a given time range on a date.
   * Excludes the entry with excludeId (for editing).
   */
  function countOverlapping(dateStr, fromTime, toTime, excludeId) {
    const entries = getEntries(dateStr).filter(e => e.type === 'booking' && e.id !== excludeId);
    let count = 0;
    for (const e of entries) {
      if (rangesOverlap(fromTime, toTime, e.timeFrom, e.timeTo)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Return the STUDENT bookings that overlap with a given time range.
   */
  function getOverlappingEntries(dateStr, fromTime, toTime, excludeId) {
    return getEntries(dateStr)
      .filter(e => e.type === 'booking' && e.id !== excludeId)
      .filter(e => rangesOverlap(fromTime, toTime, e.timeFrom, e.timeTo));
  }

  /**
   * For a given date, compute "slot fullness" — find max overlapping students
   * at any point, using an event-line sweep.
   */
  function getMaxConcurrentStudents(dateStr) {
    const bookings = getEntries(dateStr).filter(e => e.type === 'booking');
    if (bookings.length < 2) return bookings.length;

    const events = [];
    for (const b of bookings) {
      const start = isNaN(timeToMin(b.timeFrom)) ? 0 : timeToMin(b.timeFrom);
      const end = isNaN(timeToMin(b.timeTo)) ? 1440 : timeToMin(b.timeTo);
      events.push({ time: start, type: 1 });
      events.push({ time: end, type: -1 });
    }
    events.sort((a, b) => a.time - b.time || a.type - b.type);

    let max = 0, cur = 0;
    for (const ev of events) {
      cur += ev.type;
      if (cur > max) max = cur;
    }
    return max;
  }

  // ── Date Helpers ───────────────────────────────────────────
  function toDateStr(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  function todayStr() {
    const t = new Date();
    return toDateStr(t.getFullYear(), t.getMonth(), t.getDate());
  }

  function formatDateForTitle(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const dayIndex = (date.getDay() + 6) % 7;
    const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
    const dayName = t(`days.${dayKeys[dayIndex]}`);
    const monthName = t('months')[m - 1];
    return `${dayName} ${d} ${monthName} ${y}`;
  }

  function formatTime(from, to) {
    if (!from && !to) return '';
    const parts = [];
    if (from) parts.push(from);
    if (to) parts.push(to);
    return parts.join(' – ');
  }

  // ── Escape helper ──────────────────────────────────────────
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // ── Calendar Rendering ─────────────────────────────────────
  function renderCalendar() {
    $monthLabel.textContent = t('months')[currentMonth];
    $yearLabel.textContent = currentYear;

    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();

    let startWeekday = (firstDay.getDay() + 6) % 7;
    const prevLast = new Date(currentYear, currentMonth, 0).getDate();

    const today = todayStr();
    const MAX_BADGES = 3;

    let html = '';

    // Previous month padding
    for (let i = startWeekday - 1; i >= 0; i--) {
      const d = prevLast - i;
      html += `<div class="day-cell other-month"><span class="day-number">${d}</span></div>`;
    }

    // Current month
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = toDateStr(currentYear, currentMonth, d);
      const isToday = dateStr === today;
      const dow = (new Date(currentYear, currentMonth, d).getDay() + 6) % 7;
      const isWeekend = dow >= 5;
      const closed = isDayClosed(dateStr);
      const entries = getEntries(dateStr);
      const maxConcurrent = getMaxConcurrentStudents(dateStr);

      let classes = 'day-cell';
      if (isToday) classes += ' today';
      if (isWeekend) classes += ' weekend';
      if (closed) classes += ' day-closed';

      let badgesHtml = '<div class="day-entries">';

      // Closed label
      if (closed) {
        badgesHtml += `<div class="day-closed-label">${t('modal.closed_label')}</div>`;
      }

      // Full indicator
      if (!closed && maxConcurrent >= MAX_OVERLAP) {
        badgesHtml += `<div class="day-badge day-badge--full">${t('modal.full_label', { n: maxConcurrent, max: MAX_OVERLAP })}</div>`;
      }

      const shown = entries.slice(0, closed ? 0 : MAX_BADGES);
      for (const e of shown) {
        const cls = e.type === 'absence' ? 'day-badge--absence' : 'day-badge--booking';
        const icon = e.type === 'absence' ? '✕ ' : '';
        const timeStr = formatTime(e.timeFrom, e.timeTo);
        const timeTag = timeStr ? `<br><span class="badge-time">${timeStr}</span>` : '';
        badgesHtml += `<div class="day-badge ${cls}">${icon}${escapeHtml(e.name)}${timeTag}</div>`;
      }

      const remaining = entries.length - shown.length;
      if (remaining > 0) {
        const moreTxt = currentLang === 'it' ? `+${remaining} altro` : `+${remaining} more`;
        badgesHtml += `<div class="day-badge day-badge--more">${moreTxt}</div>`;
      }

      badgesHtml += '</div>';

      html += `<div class="${classes}" data-date="${dateStr}">
        <span class="day-number">${d}</span>
        ${badgesHtml}
      </div>`;
    }

    // Next month padding
    const totalCells = startWeekday + daysInMonth;
    const remaining = (7 - (totalCells % 7)) % 7;
    for (let d = 1; d <= remaining; d++) {
      html += `<div class="day-cell other-month"><span class="day-number">${d}</span></div>`;
    }

    $grid.innerHTML = html;

    // Click handlers
    $grid.querySelectorAll('.day-cell:not(.other-month)').forEach(cell => {
      cell.addEventListener('click', () => openModal(cell.dataset.date));
    });
  }

  // ── Modal ──────────────────────────────────────────────────
  function openModal(dateStr) {
    selectedDate = dateStr;
    $modalTitle.textContent = formatDateForTitle(dateStr);
    renderEntries(dateStr);

    // Reset form
    $inputName.value = '';
    $inputNote.value = '';
    $inputFrom.value = '09:00';
    $inputTo.value = '13:00';
    document.querySelector('input[name="entry-type"][value="booking"]').checked = true;

    // Toggle state
    const closed = isDayClosed(dateStr);
    $toggleClosed.checked = closed;
    updateFormDisabled(closed);
    updateOverlapWarning();

    $overlay.classList.add('active');
    $overlay.setAttribute('aria-hidden', 'false');
    setTimeout(() => $inputName.focus(), 220);
  }

  function closeModal() {
    $overlay.classList.remove('active');
    $overlay.setAttribute('aria-hidden', 'true');
    selectedDate = null;
  }

  function updateFormDisabled(closed) {
    if (closed) {
      $formSection.classList.add('form-disabled');
    } else {
      $formSection.classList.remove('form-disabled');
    }
  }

  function updateOverlapWarning() {
    const type = document.querySelector('input[name="entry-type"]:checked').value;
    if (type !== 'booking' || !selectedDate) {
      $overlapWarn.style.display = 'none';
      $btnAdd.disabled = false;
      return;
    }
    const from = $inputFrom.value;
    const to = $inputTo.value;
    const overlapping = getOverlappingEntries(selectedDate, from, to, null);
    if (overlapping.length >= MAX_OVERLAP) {
      // Build detailed message with student names and time ranges
      const details = overlapping.map(e => {
        const t = formatTime(e.timeFrom, e.timeTo);
        return `<strong>${escapeHtml(e.name)}</strong>${t ? ' (' + t + ')' : ''}`;
      }).join(', ');
      $overlapText.innerHTML = `Fascia oraria occupata da ${overlapping.length} studenti: ${details}.<br>Non puoi prenotare in sovrapposizione con più di <strong>${MAX_OVERLAP}</strong> studenti.`;
      $overlapWarn.style.display = 'flex';
      $btnAdd.disabled = true;
    } else {
      $overlapWarn.style.display = 'none';
      $btnAdd.disabled = false;
    }
  }

  function renderEntries(dateStr) {
    const entries = getEntries(dateStr);
    if (entries.length === 0) {
      $entries.innerHTML = '';
      return;
    }

    let html = '<div class="entries-list">';
    html += `<p class="entries-heading">${t('modal.entries_title')}</p>`;

    for (const e of entries) {
      const cls = e.type === 'absence' ? 'entry-card--absence' : 'entry-card--booking';
      const typeLabel = e.type === 'absence' ? t('modal.tutor_label') : t('modal.student_label');
      const timeStr = formatTime(e.timeFrom, e.timeTo);
      html += `
        <div class="entry-card ${cls}">
          <div class="entry-indicator"></div>
          <div class="entry-info">
            <div class="entry-name">${escapeHtml(e.name)}</div>
            <div class="entry-type-label">${typeLabel}</div>
            ${timeStr ? `<div class="entry-time">🕐 ${timeStr}</div>` : ''}
            ${e.note ? `<div class="entry-note">${escapeHtml(e.note)}</div>` : ''}
          </div>
          <button class="entry-delete" data-id="${e.id}" aria-label="Elimina">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6"/>
              <path d="M14 11v6"/>
              <path d="M9 6V4h6v2"/>
            </svg>
          </button>
        </div>`;
    }

    html += '</div>';
    $entries.innerHTML = html;

    // Delete handlers
    $entries.querySelectorAll('.entry-delete').forEach(btn => {
      btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        const id = btn.dataset.id;
        if (confirm(t('modal.confirm_delete'))) {
          await removeEntry(dateStr, id);
          renderEntries(dateStr);
          renderCalendar();
          updateOverlapWarning();
        }
      });
    });
  }

  // ── Add Entry ──────────────────────────────────────────────
  async function handleAdd() {
    if (isDayClosed(selectedDate)) return;

    const name = $inputName.value.trim();
    if (!name) {
      $inputName.focus();
      $inputName.style.borderColor = 'var(--danger)';
      setTimeout(() => { $inputName.style.borderColor = ''; }, 1500);
      return;
    }

    const type = document.querySelector('input[name="entry-type"]:checked').value;
    const note = $inputNote.value.trim();
    const timeFrom = $inputFrom.value || '';
    const timeTo = $inputTo.value || '';

    // Overlap check for students
    if (type === 'booking') {
      const overlap = countOverlapping(selectedDate, timeFrom, timeTo, null);
      if (overlap >= MAX_OVERLAP) {
        updateOverlapWarning();
        return;
      }
    }

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      type,
      name,
      timeFrom,
      timeTo,
      note,
      createdAt: new Date().toISOString()
    };

    // Disable button while saving
    $btnAdd.disabled = true;
    $btnAdd.querySelector('span').textContent = t('form.saving');

    try {
      await addEntry(selectedDate, entry);
      renderEntries(selectedDate);
      renderCalendar();

      // Reset form
      $inputName.value = '';
      $inputNote.value = '';
      $inputFrom.value = '09:00';
      $inputTo.value = '13:00';
      $inputName.focus();
      updateOverlapWarning();
    } catch (err) {
      console.error(t('errors.save'), err);
      alert(t('errors.conn'));
    } finally {
      $btnAdd.disabled = false;
      $btnAdd.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        <span data-i18n="form.add">${t('form.add')}</span>`;
    }
  }

  // ── Navigation ─────────────────────────────────────────────
  function goToMonth(y, m) {
    currentYear = y;
    currentMonth = m;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderCalendar();
  }

  // ── Real-time Listeners ────────────────────────────────────
  function setupRealtimeListeners() {
    // Listen to bookings collection
    onSnapshot(collection(db, 'bookings'), (snapshot) => {
      if (isSaving) return; // Skip re-render during local save/delete
      bookingsCache = {};
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        if (data.entries && data.entries.length > 0) {
          bookingsCache[docSnap.id] = data.entries;
        }
      });
      renderCalendar();
      // Also update modal if open
      if (selectedDate) {
        renderEntries(selectedDate);
        updateOverlapWarning();
      }
    });

    // Listen to closures collection
    onSnapshot(collection(db, 'closures'), (snapshot) => {
      if (isSaving) return; // Skip re-render during local save/delete
      closuresCache = {};
      snapshot.forEach(docSnap => {
        closuresCache[docSnap.id] = true;
      });
      renderCalendar();
      // Update modal toggle if open
      if (selectedDate) {
        const closed = isDayClosed(selectedDate);
        $toggleClosed.checked = closed;
        updateFormDisabled(closed);
      }
    });
  }

  // ── Init ───────────────────────────────────────────────────
  function init() {
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();

    updateLanguage();

    // Start real-time sync
    setupRealtimeListeners();

    // Navigation
    $btnPrev.addEventListener('click', () => goToMonth(currentYear, currentMonth - 1));
    $btnNext.addEventListener('click', () => goToMonth(currentYear, currentMonth + 1));
    $btnToday.addEventListener('click', () => {
      const t = new Date();
      goToMonth(t.getFullYear(), t.getMonth());
    });

    // Modal
    $modalClose.addEventListener('click', closeModal);
    $overlay.addEventListener('click', (e) => {
      if (e.target === $overlay) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    // Closed toggle
    $toggleClosed.addEventListener('change', async () => {
      if (!selectedDate) return;
      const closed = $toggleClosed.checked;
      await setDayClosed(selectedDate, closed);
      updateFormDisabled(closed);
      renderCalendar();
    });

    // Overlap check on type / time change
    document.querySelectorAll('input[name="entry-type"]').forEach(radio => {
      radio.addEventListener('change', updateOverlapWarning);
    });
    $inputFrom.addEventListener('change', updateOverlapWarning);
    $inputTo.addEventListener('change', updateOverlapWarning);

    // Language Toggle
    document.querySelectorAll('.lang-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentLang = btn.dataset.lang;
        localStorage.setItem('lab-lang', currentLang);
        updateLanguage();
      });
    });

    // Add entry
    $btnAdd.addEventListener('click', handleAdd);
    $inputName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAdd();
    });
  }

  init();
  console.log('[App] Initialized with language:', currentLang);
})();
