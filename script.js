/* =======================================================================
   BALLOONS & TWISTERS — script.js
   Game ular tangga dengan tema Balon Udara (naik) & Tornado (turun).
   Semua aset visual berasal dari folder assets/ (tidak ada gambar baru).
   ======================================================================= */

(function () {
  'use strict';

  /* ---------------------------------------------------------------------
     SOUND HELPER
     --------------------------------------------------------------------- */

  function playSound(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => {});
  }

  // Untuk efek suara yang bisa terpicu berkali-kali dengan sangat cepat
  // (mis. pion_move per kotak), pakai node audio baru tiap panggilan supaya
  // tidak saling memotong/menimpa di browser manapun.
  function playSoundOverlap(id) {
    const base = document.getElementById(id);
    if (!base) return;
    try {
      const node = base.cloneNode(true);
      node.volume = base.volume;
      node.play().catch(() => {});
    } catch (e) {
      playSound(id);
    }
  }

  /* ---------------------------------------------------------------------
     KONSTANTA ATURAN PERMAINAN
     --------------------------------------------------------------------- */

  // Kotak Balon Udara (berfungsi seperti tangga -> naik)
  const BALLOONS = { 3: 22, 10: 31, 46: 76, 52: 94 };

  // Kotak Tornado (berfungsi seperti ular -> turun)
  const TORNADOES = { 33: 7, 57: 16, 81: 41, 96: 62 };

  const PION_COLORS = ['red', 'blue', 'green', 'yellow'];

  // Koordinat grid papan (dalam persen) hasil pengukuran dari assets/gameboard.png
  // Papan adalah grid 10x10 dengan pola "boustrophedon" (ular tangga klasik):
  // baris bawah (1-10) ke kanan, baris berikutnya (11-20) ke kiri, dst.
  const GRID = {
    left: 3.8651315789473686,
    top: 1.694915254237288,
    width: 92.2697368421,
    height: 94.4444444444,
  };
  const CELL_W = GRID.width / 10;
  const CELL_H = GRID.height / 10;

  const DICE_TICK_MS = 90;
  const DICE_TICKS = 20; // fallback jika audio durasi tidak terbaca: 20 × 90ms = 1800ms
  const STEP_MOVE_MS = 220;
  const SPECIAL_PAUSE_MS = 550;
  const SPECIAL_ANIM_MS = 650;
  const BOT_THINK_MS = 1100;
  const BOUNCE_PAUSE_MS = 260; // jeda singkat sebelum pion memantul mundur ke belakang

  /* ---------------------------------------------------------------------
     STATE GLOBAL
     --------------------------------------------------------------------- */

  const state = {
    mode: null,          // 'hvh' | 'hvb' | 'bvb'
    players: [],          // [{id,label,color,isBot,position}]
    pionEls: [],
    currentIndex: 0,
    paused: false,
    busy: false,
    gameOver: false,
    sessionId: 0,
    toastTimer: null,
  };

  // Variabel sementara untuk proses pemilihan pion
  let pickSequenceLabels = [];   // label langkah pemilihan manual, mis. ['Pemain 1','Pemain 2']
  let pickedColorsInOrder = [];  // hasil warna terpilih, urut sesuai slot pemain
  let pionLocked = false;        // mengunci klik saat bot sedang "memilih"

  let musicPlaying = false;

  /* ---------------------------------------------------------------------
     UTIL: HITUNG POSISI KOTAK PADA PAPAN (dalam persen)
     --------------------------------------------------------------------- */

  function cellPosition(n, slotIndex, totalSlots) {
    const idx0 = n - 1;
    const r = Math.floor(idx0 / 10);          // baris dari bawah (0-9)
    const idxInRow = idx0 % 10;
    const c = (r % 2 === 0) ? idxInRow : (9 - idxInRow); // kolom kiri->kanan (0-9)
    const rowFromTop = 9 - r;

    let xPct = GRID.left + (c + 0.5) * CELL_W;
    const yPct = GRID.top + (rowFromTop + 0.5) * CELL_H;

    // Jika lebih dari satu pion berada di kotak yang sama, sebar posisinya
    // sedikit secara horizontal agar tidak saling menumpuk sempurna.
    if (totalSlots > 1) {
      const spread = CELL_W * 0.34;
      const offset = (slotIndex - (totalSlots - 1) / 2) * spread;
      xPct += offset;
    }
    return { x: xPct, y: yPct };
  }

  function getPositionGroups() {
    const groups = {};
    state.players.forEach((p, i) => {
      (groups[p.position] = groups[p.position] || []).push(i);
    });
    return groups;
  }

  /* ---------------------------------------------------------------------
     NAVIGASI ANTAR HALAMAN
     --------------------------------------------------------------------- */

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('is-active'));
    const target = document.getElementById(id);
    target.classList.add('is-active');
    restartIntroAnimations(target);

    if (id === 'screen-menu') {
      bgm.pause();
      tryAutoplayAwalMusic();
    }
  }

  function restartIntroAnimations(container) {
    container.querySelectorAll('.anim-title').forEach((el) => {
      el.style.animation = 'none';
      // force reflow supaya animasi bisa diulang dari awal
      // eslint-disable-next-line no-unused-expressions
      el.offsetHeight;
      el.style.animation = '';
    });
  }

  function openOverlay(id) {
    document.getElementById(id).classList.add('is-active');
  }
  function closeOverlay(id) {
    document.getElementById(id).classList.remove('is-active');
  }

  /* ---------------------------------------------------------------------
     HALAMAN 1: MAIN MENU
     --------------------------------------------------------------------- */

  const btnPlay = document.getElementById('btn-play');
  btnPlay.addEventListener('click', () => {
    playSound('sfx-click');
    // reset pilihan mode lawan setiap kali mulai dari menu utama
    document.querySelectorAll('.opponent-btn').forEach((b) => b.classList.remove('selected'));
    state.mode = null;
    showScreen('screen-opponent');
  });

  /* ---------------------------------------------------------------------
     HALAMAN 2: SELECT OPPONENT
     --------------------------------------------------------------------- */

  let opponentTransitioning = false;

  document.querySelectorAll('.opponent-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (opponentTransitioning) return;
      opponentTransitioning = true;
      playSound('sfx-click');

      document.querySelectorAll('.opponent-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.mode = btn.dataset.mode;

      setTimeout(() => {
        opponentTransitioning = false;
        setupPionSelection();
        showScreen('screen-pion');
      }, 380);
    });
  });

  document.getElementById('btn-back-opponent').addEventListener('click', () => {
    playSound('sfx-click');
    showScreen('screen-menu');
  });

  /* ---------------------------------------------------------------------
     HALAMAN 3: SELECT PION
     --------------------------------------------------------------------- */

  const pionStatusEl = document.getElementById('pion-status');
  const btnStartGame = document.getElementById('btn-start-game');

  function setupPionSelection() {
    pickedColorsInOrder = [];
    pionLocked = false;
    btnStartGame.disabled = true;

    document.querySelectorAll('.pion-btn').forEach((b) => {
      b.classList.remove('selected', 'taken', 'disabled', 'picking');
      b.disabled = false;
    });

    if (state.mode === 'hvh') {
      pickSequenceLabels = ['Pemain 1', 'Pemain 2'];
    } else if (state.mode === 'hvb') {
      pickSequenceLabels = ['Pemain'];
    } else {
      pickSequenceLabels = [];
    }

    updatePionStatus();

    if (state.mode === 'bvb') {
      // Bot vs Bot: kedua pion dipilih otomatis dengan animasi singkat
      autoPickBothBots();
    }
  }

  function updatePionStatus(done) {
    if (done) {
      pionStatusEl.textContent = 'Pion siap! Tekan START GAME';
      return;
    }
    if (state.mode === 'bvb') {
      pionStatusEl.textContent = 'Bot 1 & Bot 2 memilih pion...';
      return;
    }
    const idx = pickedColorsInOrder.length;
    if (idx < pickSequenceLabels.length) {
      pionStatusEl.textContent = `${pickSequenceLabels[idx]}: Pilih Pion`;
    }
  }

  document.querySelectorAll('.pion-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (pionLocked) return;
      if (state.mode === 'bvb') return;
      if (pickedColorsInOrder.length >= pickSequenceLabels.length) return;
      if (btn.classList.contains('taken')) return;

      playSound('sfx-pion');
      const color = btn.dataset.color;
      pickedColorsInOrder.push(color);
      btn.classList.add('selected', 'taken');
      updatePionStatus();

      if (pickedColorsInOrder.length >= pickSequenceLabels.length) {
        if (state.mode === 'hvb') {
          botAutoPickRemaining();
        } else {
          finalizePionSelection();
        }
      }
    });
  });

  function botAutoPickRemaining() {
    pionLocked = true;
    pionStatusEl.textContent = 'Bot sedang memilih pion...';

    const remaining = PION_COLORS.filter((c) => !pickedColorsInOrder.includes(c));
    const btns = remaining.map((c) => document.querySelector(`.pion-btn[data-color="${c}"]`));
    btns.forEach((b) => b.classList.add('picking'));

    setTimeout(() => {
      btns.forEach((b) => b.classList.remove('picking'));
      const chosen = remaining[Math.floor(Math.random() * remaining.length)];
      pickedColorsInOrder.push(chosen);
      document.querySelector(`.pion-btn[data-color="${chosen}"]`).classList.add('selected', 'taken');
      finalizePionSelection();
    }, 900);
  }

  function autoPickBothBots() {
    pionLocked = true;
    const shuffled = [...PION_COLORS].sort(() => Math.random() - 0.5);
    const c1 = shuffled[0];
    const c2 = shuffled[1];
    const btn1 = document.querySelector(`.pion-btn[data-color="${c1}"]`);
    const btn2 = document.querySelector(`.pion-btn[data-color="${c2}"]`);

    [btn1, btn2].forEach((b) => b.classList.add('picking'));

    setTimeout(() => {
      btn1.classList.remove('picking');
      btn1.classList.add('selected', 'taken');
      pickedColorsInOrder.push(c1);
    }, 550);

    setTimeout(() => {
      btn2.classList.remove('picking');
      btn2.classList.add('selected', 'taken');
      pickedColorsInOrder.push(c2);
      finalizePionSelection();
    }, 1050);
  }

  function finalizePionSelection() {
    document.querySelectorAll('.pion-btn').forEach((b) => {
      if (!b.classList.contains('selected')) {
        b.classList.add('disabled');
        b.disabled = true;
      }
    });
    btnStartGame.disabled = false;
    updatePionStatus(true);
  }

  document.getElementById('btn-back-pion').addEventListener('click', () => {
    playSound('sfx-click');
    showScreen('screen-opponent');
  });

  btnStartGame.addEventListener('click', () => {
    playSound('sfx-click');
    startGame();
  });

  /* ---------------------------------------------------------------------
     HALAMAN 4: GAME PLAY
     --------------------------------------------------------------------- */

  const pionsLayer = document.getElementById('pions-layer');
  const toastEl = document.getElementById('toast');
  const diceBtn = document.getElementById('btn-dice');
  const diceImg = document.getElementById('dice-img');
  const diceHint = document.getElementById('dice-hint');
  const turnCard = document.getElementById('turn-card');
  const turnPionImg = document.getElementById('turn-pion-img');
  const turnLabel = document.getElementById('turn-label');

  function buildPlayerLabel(mode, slot) {
    if (mode === 'hvh') return slot === 0 ? 'Pemain 1' : 'Pemain 2';
    if (mode === 'hvb') return slot === 0 ? 'Pemain' : 'Bot';
    return slot === 0 ? 'Bot 1' : 'Bot 2';
  }

  function startGame() {
    state.sessionId += 1;
    const session = state.sessionId;

    state.mode = state.mode;
    state.players = [0, 1].map((slot) => ({
      id: slot,
      color: pickedColorsInOrder[slot],
      isBot: state.mode === 'bvb' ? true : (state.mode === 'hvb' ? slot === 1 : false),
      label: buildPlayerLabel(state.mode, slot),
      position: 1,
    }));
    state.currentIndex = 0;
    state.paused = false;
    state.busy = false;
    state.gameOver = false;

    renderPions();
    updateTurnIndicator();
    stopAwalMusic();
    showScreen('screen-game');
    tryAutoplayMusic();

    maybeAutoBotRoll(session);
  }

  function renderPions() {
    pionsLayer.innerHTML = '';
    state.pionEls = [];
    const groups = getPositionGroups();

    state.players.forEach((p, i) => {
      const group = groups[p.position];
      const slotIndex = group.indexOf(i);
      const pos = cellPosition(p.position, slotIndex, group.length);

      const el = document.createElement('div');
      el.className = 'pion-token';
      el.style.left = pos.x + '%';
      el.style.top = pos.y + '%';

      const img = document.createElement('img');
      img.src = `assets/${p.color}_pion.png`;
      img.alt = p.label;
      el.appendChild(img);

      pionsLayer.appendChild(el);
      state.pionEls[i] = el;
    });
  }

  function updatePionPositions(animateJump) {
    const groups = getPositionGroups();
    state.players.forEach((p, i) => {
      const group = groups[p.position];
      const slotIndex = group.indexOf(i);
      const pos = cellPosition(p.position, slotIndex, group.length);
      const el = state.pionEls[i];
      if (!el) return;
      el.classList.toggle('jump', !!animateJump);
      el.style.left = pos.x + '%';
      el.style.top = pos.y + '%';
    });
  }

  function updateTurnIndicator() {
    const current = state.players[state.currentIndex];
    turnPionImg.src = `assets/${current.color}_pion.png`;
    turnLabel.textContent = `Giliran: ${current.label}`;
    turnCard.classList.toggle('bot-turn', current.isBot);
    setDiceEnabled(true);
  }

  function setDiceEnabled(enabled) {
    const current = state.players[state.currentIndex];
    const allow = enabled && !state.paused && !state.gameOver && !state.busy && !current.isBot;
    diceBtn.disabled = !allow;
    if (state.gameOver) {
      diceHint.textContent = 'Permainan selesai';
    } else if (state.paused) {
      diceHint.textContent = 'Permainan dijeda';
    } else if (current.isBot) {
      diceHint.textContent = `${current.label} sedang bermain...`;
    } else {
      diceHint.textContent = 'Ketuk dadu untuk melempar';
    }
  }

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
  }

  /* --- Dadu & Pergerakan Pion --- */

  const sfxDice = document.getElementById('sfx-dice');

  // Baca durasi audio dadu secara dinamis, supaya jika file audio diganti
  // dengan durasi berbeda, animasi kocokan dadu otomatis menyesuaikan.
  function getDiceRollDurationMs() {
    if (sfxDice && isFinite(sfxDice.duration) && sfxDice.duration > 0) {
      return sfxDice.duration * 1000;
    }
    return DICE_TICK_MS * DICE_TICKS; // fallback jika metadata audio belum siap
  }

  function rollDice() {
    if (state.busy || state.paused || state.gameOver) return;
    const session = state.sessionId;

    state.busy = true;
    setDiceEnabled(false);
    diceBtn.classList.add('rolling');

    // Sinkronkan durasi animasi kocokan dadu dengan durasi audio yang sebenarnya
    const totalDurationMs = getDiceRollDurationMs();
    const totalTicks = Math.max(6, Math.round(totalDurationMs / DICE_TICK_MS));
    const tickIntervalMs = totalDurationMs / totalTicks;

    if (sfxDice) {
      sfxDice.currentTime = 0;
      sfxDice.play().catch(() => {});
    }

    let ticks = 0;
    const timer = setInterval(() => {
      if (state.sessionId !== session) { clearInterval(timer); return; }
      const v = 1 + Math.floor(Math.random() * 6);
      diceImg.src = `assets/dice_${v}.png`;
      ticks += 1;

      if (ticks >= totalTicks) {
        clearInterval(timer);
        diceBtn.classList.remove('rolling');

        // Pastikan audio dadu berhenti tepat saat animasi kocokan selesai,
        // sehingga tidak terpotong dan tidak terus berbunyi setelah hasil muncul.
        if (sfxDice) {
          sfxDice.pause();
          sfxDice.currentTime = 0;
        }

        const finalVal = 1 + Math.floor(Math.random() * 6);
        diceImg.src = `assets/dice_${finalVal}.png`;

        // animasi "menetap" singkat saat hasil akhir muncul
        diceBtn.classList.add('settle');
        setTimeout(() => diceBtn.classList.remove('settle'), 300);

        handleDiceResult(finalVal, session);
      }
    }, tickIntervalMs);
  }

  function handleDiceResult(value, session) {
    if (state.sessionId !== session) return;
    const playerIndex = state.currentIndex;
    const p = state.players[playerIndex];
    const needed = 100 - p.position; // langkah pas yang dibutuhkan untuk mencapai finish

    if (value <= needed) {
      // Langkah biasa (termasuk kasus pas mencapai finish)
      movePlayerStepByStep(playerIndex, value, session, () => {
        if (state.sessionId === session) afterMoveCheckSpecial(playerIndex, session);
      });
      return;
    }

    // value > needed -> aturan bounce back: maju sampai finish, lalu mundur sisa langkah
    const overflow = value - needed;
    movePlayerStepByStep(playerIndex, needed, session, () => {
      if (state.sessionId !== session) return;
      setTimeout(() => {
        if (state.sessionId !== session) return;
        movePlayerStepByStep(playerIndex, overflow, session, () => {
          if (state.sessionId === session) afterMoveCheckSpecial(playerIndex, session);
        }, -1);
      }, BOUNCE_PAUSE_MS);
    });
  }

  function movePlayerStepByStep(playerIndex, steps, session, callback, direction) {
    const dir = direction === -1 ? -1 : 1;
    let stepsLeft = steps;
    const p = state.players[playerIndex];

    if (stepsLeft <= 0) {
      callback();
      return;
    }

    function stepOnce() {
      if (state.sessionId !== session) return;
      if (dir > 0) {
        p.position = Math.min(p.position + 1, 100);
      } else {
        p.position = Math.max(p.position - 1, 0);
      }
      stepsLeft -= 1;
      updatePionPositions(false);
      playSoundOverlap('sfx-move');

      if (stepsLeft <= 0 || (dir > 0 && p.position >= 100)) {
        callback();
        return;
      }
      setTimeout(stepOnce, STEP_MOVE_MS);
    }
    stepOnce();
  }

  function afterMoveCheckSpecial(playerIndex, session) {
    if (state.sessionId !== session) return;
    const p = state.players[playerIndex];

    if (p.position === 100) {
      endGameWin(playerIndex);
      return;
    }

    if (BALLOONS[p.position]) {
      const dest = BALLOONS[p.position];
      showToast('Naik menggunakan Balon Udara! 🎈');
      playSound('sfx-balloon');
      setTimeout(() => {
        if (state.sessionId !== session) return;
        p.position = dest;
        updatePionPositions(true);
        setTimeout(() => {
          if (state.sessionId !== session) return;
          if (state.pionEls[playerIndex]) state.pionEls[playerIndex].classList.remove('jump');
          finishTurnOrWin(playerIndex, session);
        }, SPECIAL_ANIM_MS);
      }, SPECIAL_PAUSE_MS);
      return;
    }

    if (TORNADOES[p.position]) {
      const dest = TORNADOES[p.position];
      showToast('Terkena Tornado! 🌪️');
      playSound('sfx-tornado');
      setTimeout(() => {
        if (state.sessionId !== session) return;
        p.position = dest;
        updatePionPositions(true);
        setTimeout(() => {
          if (state.sessionId !== session) return;
          if (state.pionEls[playerIndex]) state.pionEls[playerIndex].classList.remove('jump');
          finishTurnOrWin(playerIndex, session);
        }, SPECIAL_ANIM_MS);
      }, SPECIAL_PAUSE_MS);
      return;
    }

    finishTurnOrWin(playerIndex, session);
  }

  function finishTurnOrWin(playerIndex, session) {
    if (state.sessionId !== session) return;
    const p = state.players[playerIndex];
    if (p.position === 100) {
      endGameWin(playerIndex);
      return;
    }
    nextTurn(session);
  }

  function nextTurn(session) {
    if (state.sessionId !== session) return;
    state.currentIndex = (state.currentIndex + 1) % state.players.length;
    state.busy = false;
    updateTurnIndicator();
    maybeAutoBotRoll(session);
  }

  function maybeAutoBotRoll(session) {
    if (state.sessionId !== session) return;
    if (state.gameOver || state.paused) return;
    const current = state.players[state.currentIndex];
    setDiceEnabled(true);

    if (current.isBot) {
      setTimeout(() => {
        if (state.sessionId !== session) return;
        if (state.paused || state.gameOver) return;
        rollDice();
      }, BOT_THINK_MS);
    }
  }

  diceBtn.addEventListener('click', rollDice);

  /* --- Menang --- */

  function endGameWin(playerIndex) {
    state.gameOver = true;
    state.busy = true;
    setDiceEnabled(false);

    const p = state.players[playerIndex];
    document.getElementById('win-pion-img').src = `assets/${p.color}_pion.png`;
    document.getElementById('win-sub-label').textContent = `${p.label} Menang!`;
    playSound('sfx-win');
    openOverlay('overlay-win');
  }

  document.getElementById('btn-win-menu').addEventListener('click', () => {
    playSound('sfx-click');
    closeOverlay('overlay-win');
    resetSession();
    showScreen('screen-menu');
  });

  function resetSession() {
    state.sessionId += 1;
    state.gameOver = true;
    state.paused = false;
    state.busy = false;
  }

  /* ---------------------------------------------------------------------
     SETTING POPUP (pause, music, info, exit)
     --------------------------------------------------------------------- */

  document.getElementById('btn-setting').addEventListener('click', () => {
    if (state.gameOver) return;
    state.paused = true;
    setDiceEnabled(false);
    openOverlay('overlay-setting');
  });

  document.getElementById('btn-resume').addEventListener('click', () => {
    playSound('sfx-click');
    closeOverlay('overlay-setting');
    state.paused = false;
    const session = state.sessionId;
    updateTurnIndicator();
    maybeAutoBotRoll(session);
  });

  document.getElementById('btn-exit').addEventListener('click', () => {
    playSound('sfx-click');
    closeOverlay('overlay-setting');
    resetSession();
    showScreen('screen-menu');
  });

  document.getElementById('btn-info').addEventListener('click', () => {
    playSound('sfx-click');
    closeOverlay('overlay-setting');
    openOverlay('overlay-info');
  });

  document.getElementById('btn-info-close').addEventListener('click', () => {
    playSound('sfx-click');
    closeOverlay('overlay-info');
    openOverlay('overlay-setting');
  });

  /* --- Musik --- */

  const bgm = document.getElementById('bgm');
  const awalMusic = document.getElementById('awal-music');
  const musicIcon = document.getElementById('music-icon');

  function tryAutoplayAwalMusic() {
    if (!awalMusic) return;
    awalMusic.volume = 0.5;
    const playPromise = awalMusic.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        // Autoplay diblokir browser — halaman awal tetap berjalan normal tanpa error.
      });
    }
  }

  function stopAwalMusic() {
    if (!awalMusic) return;
    awalMusic.pause();
    awalMusic.currentTime = 0;
  }

  function setMusicIcon() {
    musicIcon.src = musicPlaying ? 'assets/mute.png' : 'assets/unmute.png';
  }

  function tryAutoplayMusic() {
    bgm.volume = 0.5;
    const playPromise = bgm.play();
    if (playPromise && typeof playPromise.then === 'function') {
      playPromise
        .then(() => {
          musicPlaying = true;
          setMusicIcon();
        })
        .catch(() => {
          // Autoplay diblokir browser, atau file musik belum tersedia.
          // Tidak masalah — game tetap berjalan normal tanpa error.
          musicPlaying = false;
          setMusicIcon();
        });
    }
  }

  document.getElementById('btn-music').addEventListener('click', () => {
    musicPlaying = !musicPlaying;
    if (musicPlaying) {
      bgm.volume = 0.5;
      const p = bgm.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => { musicPlaying = false; setMusicIcon(); });
      }
    } else {
      bgm.pause();
    }
    setMusicIcon();
  });

  bgm.addEventListener('error', () => {
    // File belum tersedia (placeholder) — abaikan agar game tetap berjalan.
    musicPlaying = false;
    setMusicIcon();
  });

  setMusicIcon();

  /* ---------------------------------------------------------------------
     INISIALISASI
     --------------------------------------------------------------------- */

  showScreen('screen-menu');

  // Browser umumnya memblokir autoplay audio bersuara sebelum ada interaksi
  // pengguna. Percobaan pertama di atas kemungkinan besar diblokir, jadi kita
  // coba lagi begitu pengguna melakukan interaksi pertama kali (tap/klik/keydown)
  // selama masih berada di halaman awal.
  function unlockAwalMusicOnFirstInteraction() {
    const tryStart = () => {
      const menuScreen = document.getElementById('screen-menu');
      if (menuScreen && menuScreen.classList.contains('is-active') && awalMusic && awalMusic.paused) {
        tryAutoplayAwalMusic();
      }
      document.removeEventListener('pointerdown', tryStart);
      document.removeEventListener('keydown', tryStart);
    };
    document.addEventListener('pointerdown', tryStart, { once: true });
    document.addEventListener('keydown', tryStart, { once: true });
  }
  unlockAwalMusicOnFirstInteraction();
})();