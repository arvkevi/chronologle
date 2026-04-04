(function () {
  'use strict';

  // --- Config ---
  const BASE_DATE = '2026-03-31';
  const INITIAL_EVENTS = 5;
  const RESERVE_EVENTS = 5;
  const TOTAL_POOL = INITIAL_EVENTS + RESERVE_EVENTS;
  const MIN_EVENTS = 3;
  const STORAGE_KEY = 'chronologle';
  const CATEGORY_HINT_COST = 1;
  function getDecadeHintCost() {
    return Math.max(0, activeEvents.length - 3);
  }

  // --- Modes ---
  const MODES = [
    { id: 'all', label: 'Grab Bag', categories: null },
    { id: 'movies-tv', label: 'Movies & TV', categories: ['movies', 'tv'] },
    { id: 'music', label: 'Music', categories: ['music'] },
    { id: 'sports', label: 'Sports', categories: ['sports'] },
    { id: 'tech-gaming', label: 'Tech & Gaming', categories: ['tech', 'gaming', 'internet'] },
    { id: 'pop-culture', label: 'Pop Culture', categories: ['pop culture', 'celebrity', 'viral', 'fashion', 'food', 'social media'] },
    { id: 'history', label: 'History', categories: ['history', 'politics'] },
    { id: 'science-space', label: 'Science & Space', categories: ['science', 'space', 'medicine', 'disaster'] },
  ];

  // --- State ---
  let allEvents = [];
  let currentMode = 'all';
  let modeEvents = [];         // events filtered to current mode
  let activeEvents = [];
  let reserveEvents = [];
  let revealedCategories = new Set();
  let revealedDecades = new Set();
  let drawnEvents = [];
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
      year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  function getDecade(dateStr) {
    const year = parseInt(dateStr.substring(0, 4));
    return Math.floor(year / 10) * 10 + 's';
  }

  function getHintPenalty() {
    return revealedCategories.size * CATEGORY_HINT_COST +
           revealedDecades.size * getDecadeHintCost();
  }

  // --- Mode helpers ---
  function getModeById(id) {
    return MODES.find(m => m.id === id) || MODES[0];
  }

  function getStorageKey() {
    return STORAGE_KEY + (currentMode === 'all' ? '' : '-' + currentMode);
  }

  function filterEventsByMode() {
    const mode = getModeById(currentMode);
    if (!mode.categories) {
      modeEvents = allEvents;
    } else {
      const cats = new Set(mode.categories);
      modeEvents = allEvents.filter(e => cats.has(e.category));
    }
  }

  function getModeFromHash() {
    const hash = window.location.hash.replace('#', '');
    if (hash && MODES.some(m => m.id === hash)) return hash;
    return 'all';
  }

  // --- Local storage ---
  function saveResult(dateStr, result) {
    const key = getStorageKey();
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    data[dateStr] = result;
    localStorage.setItem(key, JSON.stringify(data));
  }

  function loadResult(dateStr) {
    const key = getStorageKey();
    const data = JSON.parse(localStorage.getItem(key) || '{}');
    return data[dateStr] || null;
  }

  // --- Core game logic ---
  function selectDailyEvents(dateStr) {
    const seed = hashString(dateStr + '-' + currentMode);
    const rng = mulberry32(seed);
    const shuffled = seededShuffle(modeEvents, rng);

    if (currentMode === 'all') {
      // Grab bag: prefer category diversity
      const selected = [];
      const usedCategories = {};
      for (const ev of shuffled) {
        if (selected.length >= TOTAL_POOL) break;
        const cat = ev.category || 'misc';
        if (!usedCategories[cat]) usedCategories[cat] = 0;
        if (usedCategories[cat] < 3) {
          selected.push(ev);
          usedCategories[cat]++;
        }
      }
      if (selected.length < TOTAL_POOL) {
        for (const ev of shuffled) {
          if (selected.length >= TOTAL_POOL) break;
          if (!selected.includes(ev)) selected.push(ev);
        }
      }
      return selected.slice(0, TOTAL_POOL);
    } else {
      return shuffled.slice(0, TOTAL_POOL);
    }
  }

  function sortByDate(events) {
    return events.slice().sort((a, b) => {
      if (a.date < b.date) return -1;
      if (a.date > b.date) return 1;
      return 0;
    });
  }

  function scoreForDistance(n, distance) {
    if (distance === 0) return n;
    if (distance === 1) return 2;
    if (distance === 2) return 1;
    return -1; // off by 3+: active penalty
  }

  function calculateScore(userOrder, correctOrder) {
    const n = userOrder.length;
    let totalPoints = 0;
    const perEvent = [];

    for (let i = 0; i < n; i++) {
      const correctIdx = correctOrder.findIndex(
        ce => ce.event === userOrder[i].event && ce.date === userOrder[i].date
      );
      const distance = Math.abs(i - correctIdx);
      const points = scoreForDistance(n, distance);
      totalPoints += points;
      perEvent.push({ points, maxPoints: n, distance, isCorrect: distance === 0 });
    }

    const maxScore = n * n;
    const correct = perEvent.filter(e => e.isCorrect).length;
    const hintPenalty = getHintPenalty();
    const finalScore = Math.max(0, totalPoints - hintPenalty);

    return { correct, attempted: n, score: finalScore, maxScore, hintPenalty, perEvent };
  }

  // --- Mode selector rendering ---
  function renderModeSelector() {
    const container = document.getElementById('mode-selector');
    container.innerHTML = '';
    MODES.forEach(mode => {
      const btn = document.createElement('button');
      btn.className = 'mode-pill' + (mode.id === currentMode ? ' active' : '');
      btn.textContent = mode.label;
      btn.dataset.mode = mode.id;
      btn.addEventListener('click', () => switchMode(mode.id));
      container.appendChild(btn);
    });
  }

  function switchMode(modeId) {
    if (modeId === currentMode) return;
    currentMode = modeId;
    window.location.hash = modeId === 'all' ? '' : modeId;
    resetGameState();
    filterEventsByMode();
    renderModeSelector();
    startPuzzle();
  }

  function resetGameState() {
    activeEvents = [];
    reserveEvents = [];
    drawnEvents = [];
    revealedCategories = new Set();
    revealedDecades = new Set();
    submitted = false;
    document.getElementById('game').classList.add('hidden');
    document.getElementById('results').classList.add('hidden');
    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('loading').textContent = 'Loading…';
  }

  // --- Rendering ---
  function renderPuzzleInfo(dateStr) {
    const num = getPuzzleNumber(dateStr);
    const displayDate = formatDate(dateStr);
    const mode = getModeById(currentMode);
    const modeLabel = currentMode === 'all' ? '' : ` · ${mode.label}`;
    document.getElementById('puzzle-info').textContent =
      `Puzzle #${num}${modeLabel} — ${displayDate}`;
  }

  function updateScorePreview() {
    const n = activeEvents.length;
    const penalty = getHintPenalty();
    const maxRaw = n * n;
    const maxNet = Math.max(0, maxRaw - penalty);

    document.getElementById('current-max').textContent = maxNet;
    if (penalty > 0) {
      document.getElementById('hint-penalty-display').textContent = `(−${penalty} hints)`;
      document.getElementById('hint-penalty-display').classList.remove('hidden');
    } else {
      document.getElementById('hint-penalty-display').classList.add('hidden');
    }

    document.querySelectorAll('.scale-tier').forEach(el => {
      const tierN = parseInt(el.dataset.n);
      el.classList.toggle('active', tierN === n);
    });
  }

  function updateRemainingCount() {
    const count = reserveEvents.length;
    const btn = document.getElementById('add-event-btn');
    const countEl = document.getElementById('remaining-count');
    countEl.textContent = `(${count} remaining)`;
    btn.disabled = count === 0;
    btn.classList.toggle('btn-disabled', count === 0);
  }

  function updateRemoveButton() {
    const btn = document.getElementById('remove-event-btn');
    btn.classList.toggle('hidden', drawnEvents.length === 0);
  }

  function renderEventList() {
    const list = document.getElementById('event-list');
    list.innerHTML = '';
    activeEvents.forEach((ev, idx) => {
      list.appendChild(createEventCard(ev, idx));
    });
    updateScorePreview();
    updateRemainingCount();
    updateRemoveButton();
  }

  function createEventCard(ev, index) {
    const card = document.createElement('div');
    card.className = 'event-card';
    card.dataset.index = index;
    card.draggable = true;

    const catRevealed = revealedCategories.has(ev.event);
    const decRevealed = revealedDecades.has(ev.event);
    const showCatHint = currentMode === 'all';

    card.innerHTML = `
      <span class="card-grip">⠿</span>
      <span class="card-number">${index + 1}</span>
      <div class="card-body">
        <span class="card-event-name">${escapeHtml(ev.event)}</span>
        <div class="card-hints-row">
          ${showCatHint ? `
            <button class="hint-btn hint-category-btn ${catRevealed ? 'hidden' : ''}" title="Costs ${CATEGORY_HINT_COST} pt">Category <span class="hint-cost">−${CATEGORY_HINT_COST}</span></button>
            <span class="hint-revealed hint-cat-value ${catRevealed ? '' : 'hidden'}">${escapeHtml(ev.category || '')}</span>
          ` : ''}
          <button class="hint-btn hint-decade-btn ${decRevealed ? 'hidden' : ''}" title="Costs ${getDecadeHintCost()} pts">Decade <span class="hint-cost">−${getDecadeHintCost()}</span></button>
          <span class="hint-revealed hint-dec-value ${decRevealed ? '' : 'hidden'}">${getDecade(ev.date)}</span>
        </div>
      </div>
    `;

    const catBtn = card.querySelector('.hint-category-btn');
    if (catBtn) {
      catBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (revealedCategories.has(ev.event)) return;
        if (!confirm(`Reveal category? This costs ${CATEGORY_HINT_COST} point.`)) return;
        revealedCategories.add(ev.event);
        catBtn.classList.add('hidden');
        card.querySelector('.hint-cat-value').classList.remove('hidden');
        updateScorePreview();
      });
    }

    card.querySelector('.hint-decade-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      if (revealedDecades.has(ev.event)) return;
      if (!confirm(`Reveal decade? This costs ${getDecadeHintCost()} points.`)) return;
      revealedDecades.add(ev.event);
      card.querySelector('.hint-decade-btn').classList.add('hidden');
      card.querySelector('.hint-dec-value').classList.remove('hidden');
      updateScorePreview();
    });

    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragend', onDragEnd);
    card.addEventListener('dragover', onDragOver);
    card.addEventListener('dragleave', onDragLeave);
    card.addEventListener('drop', onDrop);
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
    if (e.target.closest('.hint-btn')) { e.preventDefault(); return; }
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
    card.classList.add(e.clientY < midY ? 'drag-over-above' : 'drag-over-below');
  }

  function onDragLeave(e) {
    const card = e.target.closest('.event-card');
    if (card) card.classList.remove('drag-over-above', 'drag-over-below');
  }

  function onDrop(e) {
    e.preventDefault();
    const card = e.target.closest('.event-card');
    if (!card) return;
    const dropIndex = parseInt(card.dataset.index);
    if (dragSrcIndex === null || dragSrcIndex === dropIndex) return;
    const rect = card.getBoundingClientRect();
    let targetIndex = e.clientY < rect.top + rect.height / 2 ? dropIndex : dropIndex + 1;
    if (targetIndex > dragSrcIndex) targetIndex--;
    const [moved] = activeEvents.splice(dragSrcIndex, 1);
    activeEvents.splice(targetIndex, 0, moved);
    renderEventList();
  }

  function clearDragIndicators() {
    document.querySelectorAll('.event-card').forEach(c =>
      c.classList.remove('drag-over-above', 'drag-over-below'));
  }

  // --- Touch Drag & Drop ---
  let touchDragIndex = null;
  let touchGhost = null;
  let touchCurrentCard = null;

  function onTouchStart(e) {
    if (submitted) return;
    if (e.target.closest('.hint-btn')) return;
    const card = e.target.closest('.event-card');
    if (!card) return;
    touchDragIndex = parseInt(card.dataset.index);
    card._touchTimer = setTimeout(() => {
      e.preventDefault();
      card.classList.add('dragging');
      createTouchGhost(card, e.touches[0]);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    }, 150);
    card.addEventListener('touchend', function cancel() {
      clearTimeout(card._touchTimer);
      card.removeEventListener('touchend', cancel);
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
    if (touchGhost) touchGhost.style.top = touch.clientY - touchGhost.offsetHeight / 2 + 'px';
    clearDragIndicators();
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const card = el ? el.closest('.event-card') : null;
    touchCurrentCard = card;
    if (card && parseInt(card.dataset.index) !== touchDragIndex) {
      const rect = card.getBoundingClientRect();
      card.classList.add(touch.clientY < rect.top + rect.height / 2 ? 'drag-over-above' : 'drag-over-below');
    }
  }

  function onTouchEnd(e) {
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd);
    if (touchGhost) { touchGhost.remove(); touchGhost = null; }
    clearDragIndicators();
    document.querySelectorAll('.event-card.dragging').forEach(c => c.classList.remove('dragging'));
    if (touchCurrentCard && touchDragIndex !== null) {
      const dropIndex = parseInt(touchCurrentCard.dataset.index);
      if (touchDragIndex !== dropIndex) {
        const touch = e.changedTouches[0];
        const rect = touchCurrentCard.getBoundingClientRect();
        let targetIndex = touch.clientY < rect.top + rect.height / 2 ? dropIndex : dropIndex + 1;
        if (targetIndex > touchDragIndex) targetIndex--;
        const [moved] = activeEvents.splice(touchDragIndex, 1);
        activeEvents.splice(targetIndex, 0, moved);
        renderEventList();
      }
    }
    touchDragIndex = null;
    touchCurrentCard = null;
  }

  // --- Add / Remove events (stack-based) ---
  function addEvent() {
    if (reserveEvents.length === 0 || submitted) return;
    const ev = reserveEvents.shift();
    activeEvents.push(ev);
    drawnEvents.push(ev);
    renderEventList();
    const list = document.getElementById('event-list');
    const lastCard = list.lastElementChild;
    if (lastCard) {
      lastCard.classList.add('just-added');
      lastCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => lastCard.classList.remove('just-added'), 600);
    }
  }

  function removeLastDrawn() {
    if (drawnEvents.length === 0 || submitted) return;
    const ev = drawnEvents.pop();
    const idx = activeEvents.findIndex(
      ae => ae.event === ev.event && ae.date === ev.date
    );
    if (idx !== -1) activeEvents.splice(idx, 1);
    revealedCategories.delete(ev.event);
    revealedDecades.delete(ev.event);
    reserveEvents.unshift(ev);
    renderEventList();
  }

  // --- Submit ---
  function submit() {
    if (submitted || activeEvents.length < MIN_EVENTS) return;
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

    const pct = result.maxScore > 0 ? result.score / result.maxScore : 0;
    let title = 'Nice try!';
    if (pct === 1) title = 'Perfect! 🎯';
    else if (pct >= 0.8) title = 'Excellent!';
    else if (pct >= 0.6) title = 'Well done!';
    else if (pct >= 0.4) title = 'Not bad!';
    document.getElementById('results-title').textContent = title;

    document.getElementById('results-score').textContent =
      `${result.score} / ${result.maxScore}`;

    let breakdown = `${result.correct} perfect out of ${result.attempted} events`;
    if (result.hintPenalty > 0) breakdown += ` (−${result.hintPenalty} hint penalty)`;
    document.getElementById('results-breakdown').textContent = breakdown;

    const emojiStr = result.perEvent.map(e => {
      if (e.distance === 0) return '🟩';
      if (e.distance === 1) return '🟨';
      if (e.distance === 2) return '🟧';
      return '🟥';
    }).join('');
    document.getElementById('results-emoji').textContent = emojiStr;

    const container = document.getElementById('correct-order');
    container.innerHTML = '';

    correctOrder.forEach((ev, i) => {
      const userIdx = activeEvents.findIndex(
        ae => ae.event === ev.event && ae.date === ev.date
      );
      const distance = Math.abs(userIdx - i);
      const points = scoreForDistance(result.attempted, distance);
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
            <span class="result-points">${points > 0 ? '+' + points : points}</span>
          </div>
        </div>
      `;
      container.appendChild(card);
    });

    document.getElementById('share-btn').onclick = () => shareResults(result, dateStr);
  }

  function shareResults(result, dateStr) {
    const num = getPuzzleNumber(dateStr);
    const mode = getModeById(currentMode);
    const modeLabel = currentMode === 'all' ? '' : ` [${mode.label}]`;
    const emoji = result.perEvent.map(e => {
      if (e.distance === 0) return '🟩';
      if (e.distance === 1) return '🟨';
      if (e.distance === 2) return '🟧';
      return '🟥';
    }).join('');
    const text = `⏱️ Chronologle #${num}${modeLabel}\nScore: ${result.score}/${result.maxScore} (${result.attempted} events)\n${emoji}`;

    navigator.clipboard.writeText(text).then(() => {
      const msg = document.getElementById('copied-msg');
      msg.classList.remove('hidden');
      setTimeout(() => msg.classList.add('hidden'), 2000);
    }).catch(() => {
      prompt('Copy your results:', text);
    });
  }

  // --- Restore previous result ---
  function restorePreviousResult(dateStr) {
    const saved = loadResult(dateStr);
    if (!saved) return false;

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

    const pool = selectDailyEvents(dateStr);
    const correctOrder = saved.correctEvents
      ? saved.correctEvents.map(name => pool.find(e => e.event === name) || { event: name, date: '?' })
      : sortByDate(pool.slice(0, saved.attempted));

    activeEvents = saved.events
      ? saved.events.map(name => pool.find(e => e.event === name) || { event: name, date: '?' })
      : [];

    showResults(result, correctOrder, dateStr);
    return true;
  }

  // --- Start puzzle for current mode ---
  function startPuzzle() {
    if (modeEvents.length < TOTAL_POOL) {
      document.getElementById('loading').textContent =
        `Not enough events for this mode (need ${TOTAL_POOL}, have ${modeEvents.length}).`;
      return;
    }

    const dateStr = getTodayString();
    renderPuzzleInfo(dateStr);

    if (restorePreviousResult(dateStr)) return;

    const pool = selectDailyEvents(dateStr);
    const rng = mulberry32(hashString(dateStr + '-' + currentMode + '-display'));
    const shuffledPool = seededShuffle(pool, rng);
    activeEvents = shuffledPool.slice(0, INITIAL_EVENTS);
    reserveEvents = shuffledPool.slice(INITIAL_EVENTS, TOTAL_POOL);

    document.getElementById('loading').classList.add('hidden');
    document.getElementById('game').classList.remove('hidden');
    renderEventList();
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

    // Open "How to Play" on first visit, collapsed for returning players
    const howToPlay = document.getElementById('how-to-play');
    if (!localStorage.getItem('chronologle-seen')) {
      howToPlay.open = true;
      localStorage.setItem('chronologle-seen', '1');
    }

    currentMode = getModeFromHash();
    filterEventsByMode();
    renderModeSelector();
    startPuzzle();

    document.getElementById('add-event-btn').addEventListener('click', addEvent);
    document.getElementById('remove-event-btn').addEventListener('click', removeLastDrawn);
    document.getElementById('submit-btn').addEventListener('click', () => {
      if (activeEvents.length < MIN_EVENTS) return;
      submit();
    });

    window.addEventListener('hashchange', () => {
      const newMode = getModeFromHash();
      if (newMode !== currentMode) switchMode(newMode);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
