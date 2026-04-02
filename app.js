(function () {
  'use strict';

  // --- Config ---
  const BASE_DATE = '2026-03-31';
  const INITIAL_EVENTS = 5;
  const RESERVE_EVENTS = 5;
  const TOTAL_POOL = INITIAL_EVENTS + RESERVE_EVENTS;
  const STORAGE_KEY = 'chronologle';

  // --- State ---
  let allEvents = [];
  let dailyPool = [];       // 10 events for today (sorted by date)
  let activeEvents = [];     // events currently shown (user's order)
  let reserveEvents = [];    // events not yet drawn
  let revealedHints = new Set(); // event names that had category revealed
  let submitted = false;

  // --- Seeded PRNG (mulberry32) ---
  function mulberry32(seed) {
    return function () {
      seed |= 0;
      seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function hashString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return h;
  }

  function seededShuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // --- Date helpers ---
  function getTodayString() {
    const now = new Date();
    return now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
  }

  function getPuzzleNumber(dateStr) {
    const base = new Date(BASE_DATE + 'T00:00:00');
    const today = new Date(dateStr + 'T00:00:00');
    return Math.floor((today - base) / 86400000) + 1;
  }

  function formatDate(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  // --- Local storage ---
  function saveResult(dateStr, result) {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    data[dateStr] = result;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }

  function loadResult(dateStr) {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return data[dateStr] || null;
  }

  // --- Core game logic ---
  function selectDailyEvents(dateStr) {
    const seed = hashString(dateStr);
    const rng = mulberry32(seed);
    const shuffled = seededShuffle(allEvents, rng);
    // Pick TOTAL_POOL events, preferring diversity of categories
    const selected = [];
    const usedCategories = {};
    // First pass: one per category
    for (const ev of shuffled) {
      if (selected.length >= TOTAL_POOL) break;
      const cat = ev.category || 'misc';
      if (!usedCategories[cat]) {
        usedCategories[cat] = 0;
      }
      if (usedCategories[cat] < 3) {
        selected.push(ev);
        usedCategories[cat]++;
      }
    }
    // Fill remaining if needed
    if (selected.length < TOTAL_POOL) {
      for (const ev of shuffled) {
        if (selected.length >= TOTAL_POOL) break;
        if (!selected.includes(ev)) {
          selected.push(ev);
        }
      }
    }
    return selected.slice(0, TOTAL_POOL);
  }

  function sortByDate(events) {
    return events.slice().sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    });
  }

  function calculateScore(userOrder, correctOrder) {
    const n = userOrder.length;
    let totalPoints = 0;
    const perEvent = []; // { points, maxPoints, distance, isCorrect }

    for (let i = 0; i < n; i++) {
      // Find where this user-placed event belongs in correct order
      const correctIdx = correctOrder.findIndex(
        ce => ce.event === userOrder[i].event && ce.date === userOrder[i].date
      );
      const distance = Math.abs(i - correctIdx);
      const points = Math.max(0, n - distance);
      totalPoints += points;
      perEvent.push({
        points,
        maxPoints: n,
        distance,
        isCorrect: distance === 0
      });
    }

    const maxScore = n * n;
    const correct = perEvent.filter(e => e.isCorrect).length;
    const hintPenalty = revealedHints.size;
    const finalScore = Math.max(0, totalPoints - hintPenalty);

    return {
      correct,
      attempted: n,
      score: finalScore,
      maxScore,
      hintPenalty,
      perEvent
    };
  }

  // --- Rendering ---
  function renderPuzzleInfo(dateStr) {
    const num = getPuzzleNumber(dateStr);
    const displayDate = formatDate(dateStr);
    document.getElementById('puzzle-info').textContent =
      `Puzzle #${num} — ${displayDate}`;
  }

  function updateScorePreview() {
    const n = activeEvents.length;
    const hints = revealedHints.size;
    document.getElementById('multiplier-value').textContent = `${n}`;
    const maxWithPenalty = Math.max(0, n * n - hints);
    document.getElementById('max-value').textContent = hints > 0
      ? `${maxWithPenalty} (−${hints} hint${hints > 1 ? 's' : ''})`
      : `${n * n}`;
  }

  function updateRemainingCount() {
    const count = reserveEvents.length;
    const btn = document.getElementById('add-event-btn');
    const countEl = document.getElementById('remaining-count');
    countEl.textContent = `(${count} remaining)`;
    if (count === 0) {
      btn.disabled = true;
      btn.classList.add('hidden');
    }
  }

  function renderEventList() {
    const list = document.getElementById('event-list');
    list.innerHTML = '';
    activeEvents.forEach((ev, idx) => {
      const card = createEventCard(ev, idx);
      list.appendChild(card);
    });
    updateScorePreview();
    updateRemainingCount();
  }

  function createEventCard(ev, index) {
    const card = document.createElement('div');
    card.className = 'event-card';
    card.dataset.index = index;
    card.draggable = true;

    card.innerHTML = `
      <span class="card-grip">⠿</span>
      <span class="card-number">${index + 1}</span>
      <span class="card-event-name">${escapeHtml(ev.event)}</span>
      <button class="card-hint-btn" data-event-idx="${index}" title="Reveal category (−1 pt)">?</button>
      <span class="card-category hidden" data-cat-idx="${index}">${escapeHtml(ev.category)}</span>
    `;

    // Hint button
    const hintBtn = card.querySelector('.card-hint-btn');
    const catSpan = card.querySelector('.card-category');
    if (revealedHints.has(ev.event)) {
      hintBtn.classList.add('hidden');
      catSpan.classList.remove('hidden');
    }
    hintBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!revealedHints.has(ev.event)) {
        revealedHints.add(ev.event);
        hintBtn.classList.add('hidden');
        catSpan.classList.remove('hidden');
        updateScorePreview();
      }
    });

    // Desktop drag events
    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragend', onDragEnd);
    card.addEventListener('dragover', onDragOver);
    card.addEventListener('dragleave', onDragLeave);
    card.addEventListener('drop', onDrop);

    // Touch events for mobile
    card.addEventListener('touchstart', onTouchStart, { passive: false });

    return card;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // --- Desktop Drag & Drop ---
  let dragSrcIndex = null;

  function onDragStart(e) {
    const card = e.target.closest('.event-card');
    if (!card) return;
    dragSrcIndex = parseInt(card.dataset.index);
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrcIndex);
  }

  function onDragEnd(e) {
    const card = e.target.closest('.event-card');
    if (card) card.classList.remove('dragging');
    clearDragIndicators();
    dragSrcIndex = null;
  }

  function onDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.event-card');
    if (!card || parseInt(card.dataset.index) === dragSrcIndex) return;
    clearDragIndicators();
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    if (e.clientY < midY) {
      card.classList.add('drag-over-above');
    } else {
      card.classList.add('drag-over-below');
    }
  }

  function onDragLeave(e) {
    const card = e.target.closest('.event-card');
    if (card) {
      card.classList.remove('drag-over-above', 'drag-over-below');
    }
  }

  function onDrop(e) {
    e.preventDefault();
    const card = e.target.closest('.event-card');
    if (!card) return;
    const dropIndex = parseInt(card.dataset.index);
    if (dragSrcIndex === null || dragSrcIndex === dropIndex) return;

    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    let targetIndex = e.clientY < midY ? dropIndex : dropIndex + 1;
    if (targetIndex > dragSrcIndex) targetIndex--;

    const [moved] = activeEvents.splice(dragSrcIndex, 1);
    activeEvents.splice(targetIndex, 0, moved);
    renderEventList();
  }

  function clearDragIndicators() {
    document.querySelectorAll('.event-card').forEach(c => {
      c.classList.remove('drag-over-above', 'drag-over-below');
    });
  }

  // --- Touch Drag & Drop ---
  let touchDragIndex = null;
  let touchGhost = null;
  let touchStartY = 0;
  let touchCurrentCard = null;

  function onTouchStart(e) {
    if (submitted) return;
    const card = e.target.closest('.event-card');
    if (!card) return;

    touchDragIndex = parseInt(card.dataset.index);
    touchStartY = e.touches[0].clientY;

    // Delay to distinguish tap from drag
    card._touchTimer = setTimeout(() => {
      e.preventDefault();
      card.classList.add('dragging');
      createTouchGhost(card, e.touches[0]);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    }, 150);

    card.addEventListener('touchend', function cancelTimer() {
      clearTimeout(card._touchTimer);
      card.removeEventListener('touchend', cancelTimer);
    }, { once: true });
  }

  function createTouchGhost(card, touch) {
    touchGhost = card.cloneNode(true);
    touchGhost.classList.add('drag-ghost');
    const rect = card.getBoundingClientRect();
    touchGhost.style.width = rect.width + 'px';
    touchGhost.style.left = rect.left + 'px';
    touchGhost.style.top = touch.clientY - rect.height / 2 + 'px';
    document.body.appendChild(touchGhost);
  }

  function onTouchMove(e) {
    e.preventDefault();
    const touch = e.touches[0];
    if (touchGhost) {
      const rect = touchGhost.getBoundingClientRect();
      touchGhost.style.top = touch.clientY - rect.height / 2 + 'px';
    }

    clearDragIndicators();
    const elementBelow = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = elementBelow ? elementBelow.closest('.event-card') : null;
    touchCurrentCard = card;
    if (card && parseInt(card.dataset.index) !== touchDragIndex) {
      const rect = card.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      if (touch.clientY < midY) {
        card.classList.add('drag-over-above');
      } else {
        card.classList.add('drag-over-below');
      }
    }
  }

  function onTouchEnd(e) {
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);

    if (touchGhost) {
      touchGhost.remove();
      touchGhost = null;
    }

    clearDragIndicators();
    document.querySelectorAll('.event-card.dragging').forEach(c => c.classList.remove('dragging'));

    if (touchCurrentCard && touchDragIndex !== null) {
      const dropIndex = parseInt(touchCurrentCard.dataset.index);
      if (touchDragIndex !== dropIndex) {
        const touch = e.changedTouches[0];
        const rect = touchCurrentCard.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        let targetIndex = touch.clientY < midY ? dropIndex : dropIndex + 1;
        if (targetIndex > touchDragIndex) targetIndex--;

        const [moved] = activeEvents.splice(touchDragIndex, 1);
        activeEvents.splice(targetIndex, 0, moved);
        renderEventList();
      }
    }

    touchDragIndex = null;
    touchCurrentCard = null;
  }

  // --- Add event ---
  function addEvent() {
    if (reserveEvents.length === 0 || submitted) return;
    const ev = reserveEvents.shift();
    activeEvents.push(ev);
    renderEventList();
    // Highlight the new card
    const list = document.getElementById('event-list');
    const lastCard = list.lastElementChild;
    if (lastCard) {
      lastCard.classList.add('just-added');
      lastCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => lastCard.classList.remove('just-added'), 600);
    }
  }

  // --- Submit ---
  function submit() {
    if (submitted) return;
    submitted = true;

    const correctOrder = sortByDate(activeEvents);
    const result = calculateScore(activeEvents, correctOrder);

    const dateStr = getTodayString();
    saveResult(dateStr, {
      score: result.score,
      maxScore: result.maxScore,
      correct: result.correct,
      attempted: result.attempted,
      hintPenalty: result.hintPenalty,
      perEvent: result.perEvent,
      events: activeEvents.map(e => e.event),
      correctEvents: correctOrder.map(e => e.event)
    });

    showResults(result, correctOrder, dateStr);
  }

  function showResults(result, correctOrder, dateStr) {
    document.getElementById('game').classList.add('hidden');
    document.getElementById('results').classList.remove('hidden');

    // Title
    const pct = result.maxScore > 0 ? result.score / result.maxScore : 0;
    let title = 'Nice try!';
    if (pct === 1) title = 'Perfect! 🎯';
    else if (pct >= 0.8) title = 'Excellent!';
    else if (pct >= 0.6) title = 'Well done!';
    else if (pct >= 0.4) title = 'Not bad!';
    document.getElementById('results-title').textContent = title;

    // Score
    document.getElementById('results-score').textContent =
      `${result.score} / ${result.maxScore}`;

    // Breakdown
    let breakdown = `${result.correct} perfect out of ${result.attempted} events`;
    if (result.hintPenalty > 0) {
      breakdown += ` (−${result.hintPenalty} hint penalty)`;
    }
    document.getElementById('results-breakdown').textContent = breakdown;

    // Emoji — green=perfect, yellow=off by 1, orange=off by 2, red=off by 3+
    const emoji = result.perEvent.map(e => {
      if (e.distance === 0) return '🟩';
      if (e.distance === 1) return '🟨';
      if (e.distance === 2) return '🟧';
      return '🟥';
    }).join('');
    document.getElementById('results-emoji').textContent = emoji;

    // Correct order timeline
    const container = document.getElementById('correct-order');
    container.innerHTML = '';

    correctOrder.forEach((ev, i) => {
      const userIdx = activeEvents.findIndex(
        ae => ae.event === ev.event && ae.date === ev.date
      );
      const distance = Math.abs(userIdx - i);
      const points = Math.max(0, result.attempted - distance);
      const isCorrect = distance === 0;
      const isClose = distance === 1;
      const year = ev.date.split('-')[0];

      const card = document.createElement('div');
      card.className = `result-card ${isCorrect ? 'correct' : isClose ? 'close' : 'incorrect'}`;

      let posLabel = '';
      if (!isCorrect) {
        posLabel = `<div class="result-position">You placed #${userIdx + 1} — off by ${distance}</div>`;
      }

      card.innerHTML = `
        <div class="result-year">${year}</div>
        <div class="result-node">
          ${i > 0 ? '<div class="result-node-top-line"></div>' : ''}
        </div>
        <div class="result-content">
          <div class="result-content-inner">
            <div class="result-info">
              <div class="result-event-name">${escapeHtml(ev.event)}</div>
              <div class="result-date">${formatDate(ev.date)}</div>
              ${posLabel}
            </div>
            <span class="result-points">+${points}</span>
          </div>
        </div>
      `;
      container.appendChild(card);
    });

    // Share button
    document.getElementById('share-btn').onclick = () => shareResults(result, dateStr);
  }

  function shareResults(result, dateStr) {
    const num = getPuzzleNumber(dateStr);
    const emoji = result.perEvent.map(e => {
      if (e.distance === 0) return '🟩';
      if (e.distance === 1) return '🟨';
      if (e.distance === 2) return '🟧';
      return '🟥';
    }).join('');
    const text = `⏱️ Chronologle #${num}\nScore: ${result.score}/${result.maxScore} (${result.attempted} events)\n${emoji}`;

    navigator.clipboard.writeText(text).then(() => {
      const msg = document.getElementById('copied-msg');
      msg.classList.remove('hidden');
      setTimeout(() => msg.classList.add('hidden'), 2000);
    }).catch(() => {
      // Fallback: prompt
      prompt('Copy your results:', text);
    });
  }

  // --- Restore previous result ---
  function restorePreviousResult(dateStr) {
    const saved = loadResult(dateStr);
    if (!saved) return false;

    // Rebuild result from saved data
    renderPuzzleInfo(dateStr);
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('results').classList.remove('hidden');

    submitted = true;

    const result = {
      score: saved.score,
      maxScore: saved.maxScore,
      correct: saved.correct,
      attempted: saved.attempted,
      hintPenalty: saved.hintPenalty || 0,
      perEvent: saved.perEvent || []
    };

    // Rebuild the events from saved data
    const pool = selectDailyEvents(dateStr);
    const sorted = sortByDate(pool.slice(0, saved.attempted));

    // Try to reconstruct from saved event names
    const correctOrder = saved.correctEvents
      ? saved.correctEvents.map(name => pool.find(e => e.event === name) || { event: name, date: '?' })
      : sorted;

    activeEvents = saved.events
      ? saved.events.map(name => pool.find(e => e.event === name) || { event: name, date: '?' })
      : [];

    showResults(result, correctOrder, dateStr);
    return true;
  }

  // --- Init ---
  async function init() {
    try {
      const resp = await fetch('events.json');
      if (!resp.ok) throw new Error('Failed to load events');
      allEvents = await resp.json();
    } catch (err) {
      document.getElementById('loading').textContent =
        'Failed to load events. Make sure to serve this via a web server (e.g. npx serve).';
      return;
    }

    if (allEvents.length < TOTAL_POOL) {
      document.getElementById('loading').textContent =
        `Need at least ${TOTAL_POOL} events, found ${allEvents.length}.`;
      return;
    }

    const dateStr = getTodayString();
    renderPuzzleInfo(dateStr);

    // Check for saved result
    if (restorePreviousResult(dateStr)) return;

    // Select today's events
    const pool = selectDailyEvents(dateStr);
    dailyPool = sortByDate(pool);

    // Shuffle the initial events for presentation (not sorted!)
    const rng = mulberry32(hashString(dateStr + '-display'));
    const shuffledPool = seededShuffle(pool, rng);
    activeEvents = shuffledPool.slice(0, INITIAL_EVENTS);
    reserveEvents = shuffledPool.slice(INITIAL_EVENTS, TOTAL_POOL);

    // Show game
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    renderEventList();

    // Wire up buttons
    document.getElementById('add-event-btn').addEventListener('click', addEvent);
    document.getElementById('submit-btn').addEventListener('click', () => {
      if (activeEvents.length < 2) return;
      submit();
    });
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
