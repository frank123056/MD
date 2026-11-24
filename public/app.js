(() => {
  const socket = io();

  // Per-tab session ID so opening 2 tabs on one machine lets you test 2 distinct players
  let sessionId = sessionStorage.getItem('modernArtSessionId');
  if (!sessionId) {
    sessionId = 'p_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
    sessionStorage.setItem('modernArtSessionId', sessionId);
  }

  const CDN_ASSETS_BASE = 'https://cdn.jsdelivr.net/gh/frank123056/MD@main/public/assets';

  // Automatic local fallback if jsDelivr CDN is unreachable (e.g. offline local testing)
  document.addEventListener(
    'error',
    (e) => {
      const el = e.target;
      if (el && el.tagName === 'IMG' && el.dataset.fallback) {
        const fallback = el.dataset.fallback;
        delete el.dataset.fallback;
        const fallbackHref = new URL(fallback, window.location.origin).href;
        if (el.src !== fallbackHref) {
          el.src = fallback;
        }
      }
    },
    true
  );

  function getAvatarUrls(name) {
    const seed = String(name || 'guest').slice(0, 64);
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    const idx = hash % 10;
    return {
      cdn: `${CDN_ASSETS_BASE}/avatars/avatar_${idx}.png`,
      local: `/assets/avatars/avatar_${idx}.png`,
    };
  }

  function renderAvatarImgHtml(name) {
    const av = getAvatarUrls(name);
    return `<img class="player-avatar" src="${escapeHtml(av.cdn)}" data-fallback="${escapeHtml(av.local)}" alt="" loading="lazy" />`;
  }

  const AUCTION_META = {
    open: { icon: '📢', label: '公開競標', rule: '所有玩家自由喊價加碼，無人加價（全員 Pass 或倒數結束）由最高價得標；無人出價則拍賣官免費獲得。' },
    once_around: { icon: '🔄', label: '一輪競標', rule: '由拍賣官下一位起依序每人只有一次出價或 Pass 機會，拍賣官本人排在最後一位壓軸決定加價買下或讓最高價者得標。' },
    hidden: { icon: '✊', label: '暗標競標', rule: '所有人同時秘密輸入出價（0～現有現金）後同時揭曉。最高價平手時，離拍賣官（含本人）順時針較近者勝出。' },
    fixed_price: { icon: '🏷️', label: '定價拍賣', rule: '拍賣官喊出固定價格，順時針詢問誰要買，第一位買家直接成交；若全員放棄，拍賣官必須自己付錢向銀行買下！' },
    double: { icon: '🖼️', label: '聯合拍賣', rule: '可再打出一張同畫家非聯合牌綁定拍賣（依第二張牌決定規則）。若別人補牌則成為新拍賣官並平分收益。' },
  };

  let roomState = null;
  let handFilter = 'all';
  let selectedCardId = null;
  let soundEnabled = true;
  let lastOpenedModalKey = null;
  let audioCtx = null;
  let pendingReconnectRoomCode = null;

  // DOM refs
  const lobbyView = document.getElementById('lobby-view');
  const waitingView = document.getElementById('waiting-view');
  const gameView = document.getElementById('game-view');

  const inputPlayerName = document.getElementById('input-player-name');
  const inputRoomCode = document.getElementById('input-room-code');
  const publicRoomsList = document.getElementById('public-rooms-list');

  const roomPill = document.getElementById('room-pill');
  const seasonPill = document.getElementById('season-pill');
  const deckPill = document.getElementById('deck-pill');
  const headerRoomCode = document.getElementById('header-room-code');
  const headerSeason = document.getElementById('header-season');
  const headerDeck = document.getElementById('header-deck');

  const btnLeaveRoom = document.getElementById('btn-leave-room');
  const btnOpenSettlement = document.getElementById('btn-open-settlement');
  const btnToggleSound = document.getElementById('btn-toggle-sound');
  const btnToggleLogs = document.getElementById('btn-toggle-logs');
  const logCountBadge = document.getElementById('log-count-badge');
  const logPopover = document.getElementById('log-popover');
  const btnCloseLogs = document.getElementById('btn-close-logs');

  const rulesDialog = document.getElementById('rules-dialog');
  const settlementDialog = document.getElementById('settlement-dialog');
  const settlementBody = document.getElementById('settlement-dialog-body');
  const settlementFooter = document.getElementById('settlement-dialog-footer');
  const collectorDialog = document.getElementById('collector-dialog');
  const collectorTitle = document.getElementById('collector-dialog-title');
  const collectorBody = document.getElementById('collector-dialog-body');
  const idleDialog = document.getElementById('idle-dialog');
  const idleDialogMessage = document.getElementById('idle-dialog-message');
  const btnIdleReconnect = document.getElementById('btn-idle-reconnect');

  // Restore saved nickname & optional ?room=XXXX invite param
  const savedName = localStorage.getItem('modernArtPlayerName');
  if (savedName) inputPlayerName.value = savedName;

  const urlParams = new URLSearchParams(window.location.search);
  const urlRoom = urlParams.get('room');
  if (urlRoom) {
    inputRoomCode.value = urlRoom.toUpperCase();
  }

  // Mandatory light-dismiss fallback for browsers lacking <dialog closedby="any">
  if (!('closedBy' in HTMLDialogElement.prototype)) {
    const isOutsideDialog = (e, dialog) => {
      const r = dialog.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
      let pressedOutside = false;
      dialog.addEventListener('pointerdown', (e) => {
        pressedOutside = isOutsideDialog(e, dialog);
      });
      dialog.addEventListener('pointerup', (e) => {
        if (pressedOutside && isOutsideDialog(e, dialog)) {
          dialog.close();
        }
      });
    }
  }

  for (const dlg of [rulesDialog, settlementDialog, collectorDialog]) {
    dlg.addEventListener('close', () => {
      dlg.returnValue = '';
    });
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(msg, isError = false) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${isError ? 'error' : ''}`;
    el.textContent = msg;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 3600);
  }

  function playTone(freq = 540, duration = 0.08, type = 'triangle') {
    if (!soundEnabled) return;
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + duration);
    } catch {
      // Ignore audio failures
    }
  }

  function emitAction(event, payload = {}) {
    socket.emit(event, payload, (res) => {
      if (res && !res.ok) {
        showToast(res.error || '操作失敗', true);
      }
    });
  }

  function getPlayerName() {
    const val = inputPlayerName.value.trim() || `畫商_${sessionId.slice(2, 6).toUpperCase()}`;
    localStorage.setItem('modernArtPlayerName', val);
    return val;
  }

  // Procedural Modern Art SVG generator for each artist style
  function buildCardSvg(card) {
    const s = card.artSeed || 1;
    const c = card.color || '#eab308';
    const bg = '#0f1320';
    const x1 = 16 + (s * 17) % 45;
    const y1 = 12 + (s * 23) % 35;
    const x2 = 55 + (s * 13) % 50;
    const y2 = 20 + (s * 19) % 45;
    const r1 = 12 + (s * 7) % 22;

    let shapes = '';
    if (card.style === 'geometric') {
      shapes = `
        <rect x="${x1}" y="${y1}" width="44" height="44" fill="${c}" opacity="0.82" transform="rotate(${(s * 11) % 35} ${x1 + 22} ${y1 + 22})"/>
        <circle cx="${x2}" cy="${y2}" r="${r1}" fill="#fef08a" opacity="0.72"/>
        <line x1="10" y1="78" x2="130" y2="18" stroke="#fff" stroke-width="2" opacity="0.45"/>
      `;
    } else if (card.style === 'brush') {
      shapes = `
        <path d="M12,${y1 + 25} Q65,${y1 - 15} 128,${y2 + 12}" stroke="${c}" stroke-width="14" fill="none" stroke-linecap="round" opacity="0.85"/>
        <path d="M22,${y2 + 20} Q75,${y2 + 40} 118,${y1 + 8}" stroke="#fbcfe8" stroke-width="6" fill="none" stroke-linecap="round" opacity="0.75"/>
        <circle cx="${x1}" cy="${y2}" r="9" fill="#fff" opacity="0.6"/>
      `;
    } else if (card.style === 'collage') {
      shapes = `
        <polygon points="${x1},14 ${x2 + 25},28 ${x1 + 10},82" fill="${c}" opacity="0.85"/>
        <rect x="${x2 - 10}" y="${y1}" width="38" height="28" fill="#a7f3d0" opacity="0.68"/>
        <circle cx="32" cy="64" r="14" fill="#047857" opacity="0.85"/>
      `;
    } else if (card.style === 'grid') {
      shapes = `
        <rect x="16" y="14" width="108" height="64" fill="none" stroke="${c}" stroke-width="3"/>
        <line x1="54" y1="14" x2="54" y2="78" stroke="#fff" stroke-width="2.5" opacity="0.8"/>
        <line x1="16" y1="44" x2="124" y2="44" stroke="#fff" stroke-width="2.5" opacity="0.8"/>
        <rect x="18" y="16" width="34" height="26" fill="${c}" opacity="0.9"/>
        <rect x="${56 + (s % 2) * 32}" y="46" width="34" height="30" fill="#fde047" opacity="0.8"/>
      `;
    } else {
      shapes = `
        <path d="M0,52 C35,${15 + (s % 25)} 95,${85 - (s % 25)} 140,42 L140,92 L0,92 Z" fill="${c}" opacity="0.78"/>
        <circle cx="${x2}" cy="28" r="${r1}" fill="#e9d5ff" opacity="0.75"/>
        <circle cx="${x1}" cy="64" r="10" fill="#fff" opacity="0.45"/>
      `;
    }

    return `<svg class="card-art" viewBox="0 0 140 92" aria-hidden="true">
      <rect width="140" height="92" fill="${bg}"/>
      ${shapes}
    </svg>`;
  }

  function renderCardHtml(card, options = {}) {
    const meta = AUCTION_META[card.auctionType] || { icon: '🎨', label: card.auctionType };
    const cls = ['painting-card'];
    if (options.playable) cls.push('playable');
    if (options.selected) cls.push('selected');
    if (options.dimmed) cls.push('dimmed');
    const tag = options.playable ? 'button' : 'div';
    const extraAttrs = options.playable
      ? `type="button" data-card-id="${escapeHtml(card.id)}" aria-pressed="${options.selected ? 'true' : 'false'}"`
      : '';
    const num = card.cardNumber || (String(card.id || '').replace(/\D+/g, '') || 1);
    const rawImg = card.image || `/assets/cards/card_${num}.jpg`;
    const localSrc = rawImg.includes('?') ? rawImg : `${rawImg}?v=fix7`;
    const cleanRel = rawImg.split('?')[0].replace(/^\/assets\//, '');
    const cdnSrc = `${CDN_ASSETS_BASE}/${cleanRel}`;
    const serialLabel = `#${String(num).padStart(2, '0')}`;

    return `<${tag} class="${cls.join(' ')}" style="--card-color:${card.color}" ${extraAttrs}>
      <div class="card-art-wrap">
        <img class="card-art-character" src="${escapeHtml(cdnSrc)}" data-fallback="${escapeHtml(localSrc)}" alt="${escapeHtml(card.artistName)}" loading="lazy" />
        <span class="card-serial-tag">${serialLabel}</span>
      </div>
      <div class="card-meta">
        <div class="card-artist">${escapeHtml(card.artistName)}</div>
        <div class="card-title">${escapeHtml(card.title)}</div>
        <span class="card-type-pill">${meta.icon} ${meta.label}</span>
      </div>
    </${tag}>`;
  }

  // Render Public Rooms List
  function renderPublicRooms(rooms) {
    if (!rooms || rooms.length === 0) {
      publicRoomsList.innerHTML = '<p class="muted">目前尚無房間，建立一個新拍賣廳吧！</p>';
      return;
    }

    publicRoomsList.innerHTML = rooms
      .map((r) => {
        const statusText = r.started ? `進行中 (第${r.season}季)` : '等待玩家中';
        const disabled = r.started || r.playerCount >= r.maxPlayers ? 'disabled' : '';
        return `<div class="room-row">
          <div>
            <strong>${escapeHtml(r.code)}</strong>
            <span class="muted-sm"> · 房主：${escapeHtml(r.hostName)} · ${r.playerCount}/${r.maxPlayers} 人 · ${statusText}</span>
          </div>
          <button type="button" class="btn btn-accent btn-sm btn-quick-join" data-code="${escapeHtml(r.code)}" ${disabled}>
            ${r.started ? '已開局' : '加入'}
          </button>
        </div>`;
      })
      .join('');

    publicRoomsList.querySelectorAll('.btn-quick-join').forEach((btn) => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        inputRoomCode.value = code;
        emitAction('join_room', { roomCode: code, playerName: getPlayerName(), sessionId });
      });
    });
  }

  function renderChatFeed(container, messages) {
    if (!messages) return;
    container.innerHTML = messages
      .map((m) => {
        const cls = m.system ? 'log-item season' : 'log-item';
        return `<div class="${cls}">
          <strong>${escapeHtml(m.sender)}：</strong><span>${escapeHtml(m.text)}</span>
        </div>`;
      })
      .join('');
    container.scrollTop = container.scrollHeight;
  }

  function renderWaitingRoom(room) {
    document.getElementById('waiting-room-code').textContent = room.code;
    const seatsContainer = document.getElementById('waiting-seats');

    const seatCards = [];
    for (let i = 0; i < 5; i++) {
      const seat = room.seats[i];
      if (!seat) {
        seatCards.push(`<div class="seat-card empty"><span>空位 #${i + 1}</span></div>`);
      } else {
        const isMe = seat.id === room.mySessionId;
        const isHost = seat.id === room.hostSessionId;
        seatCards.push(`<div class="seat-card ${isMe ? 'is-me' : ''}">
          <div class="seat-card-head">
            ${renderAvatarImgHtml(seat.name)}
            <strong>${escapeHtml(seat.name)}</strong>
          </div>
          <div class="seat-badges">
            <span class="badge">座位 ${i + 1}</span>
            ${isHost ? '<span class="badge gold">房主</span>' : ''}
            ${seat.isAI ? '<span class="badge blue">🤖 電腦 AI</span>' : '<span class="badge green">真人</span>'}
            ${isMe ? '<span class="badge pink">你</span>' : ''}
          </div>
        </div>`);
      }
    }
    seatsContainer.innerHTML = seatCards.join('');

    const hostControls = document.getElementById('host-controls');
    const guestMsg = document.getElementById('guest-wait-msg');
    if (room.isHost) {
      hostControls.classList.remove('hidden');
      guestMsg.classList.add('hidden');
      document.getElementById('btn-add-bot').disabled = room.seats.length >= 5;
      document.getElementById('btn-remove-bot').disabled = !room.seats.some((s) => s.isAI);
      const startBtn = document.getElementById('btn-start-game');
      startBtn.disabled = room.seats.length < 3 || room.seats.length > 5;
      startBtn.textContent = room.seats.length < 3
        ? `🔨 開始拍賣會（還差 ${3 - room.seats.length} 人）`
        : `🔨 開始拍賣會（${room.seats.length} 人局）`;
    } else {
      hostControls.classList.add('hidden');
      guestMsg.classList.remove('hidden');
    }

    renderChatFeed(document.getElementById('waiting-chat-log'), room.chat);
  }

  function renderArtistBoard(game) {
    const tbody = document.getElementById('artist-board-body');
    tbody.innerHTML = game.artists
      .map((a) => {
        const played = game.seasonCounts[a.index];
        const seasonCells = [0, 1, 2, 3]
          .map((sIdx) => {
            const v = game.seasonValues[sIdx][a.index];
            const cls = v === 30 ? 'val-30' : v === 20 ? 'val-20' : v === 10 ? 'val-10' : 'val-0';
            const display = sIdx + 1 > game.season ? '—' : v > 0 ? `+$${v}` : '$0';
            return `<td><span class="val-badge ${cls}">${display}</span></td>`;
          })
          .join('');

        const pips = Array.from({ length: 5 }, (_, idx) => {
          const filled = idx < played;
          const danger = filled && played >= 4;
          return `<span class="pip ${filled ? 'filled' : ''} ${danger ? 'danger' : ''}" style="--artist-color:${a.color}"></span>`;
        }).join('');

        return `<tr>
          <th scope="row" title="${escapeHtml(a.name)} (${escapeHtml(a.zhName)}) - 平手優先順位 #${a.index + 1}">
            <div class="artist-name-cell">
              <span class="artist-dot" style="background:${a.color}"></span>
              <span class="priority-tag">#${a.index + 1}</span>
              <span>${escapeHtml(a.zhName)}</span>
            </div>
          </th>
          <td>${a.count}</td>
          ${seasonCells}
          <td><strong>$${game.cumulativeValues[a.index]}</strong></td>
          <td>
            <div class="progress-pips" aria-label="本季 ${played} / 5 張">
              ${pips}
              <span><strong>${played}</strong>/5</span>
            </div>
          </td>
        </tr>`;
      })
      .join('');
  }

  function computeProjectedValues(game) {
    // Estimate current season payout based on current counts (live indicator for player convenience)
    const ranked = game.artists
      .map((a) => ({ idx: a.index, count: game.seasonCounts[a.index] }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count || a.idx - b.idx);

    const bonuses = [0, 0, 0, 0, 0];
    [30, 20, 10].forEach((b, r) => {
      if (ranked[r]) bonuses[ranked[r].idx] = b;
    });

    return game.artists.map((a) => {
      if (bonuses[a.index] === 0) return 0;
      let hist = 0;
      for (let s = 0; s < game.season - 1; s++) hist += game.seasonValues[s][a.index];
      return hist + bonuses[a.index];
    });
  }

  /** Compute a player's turn position and badge/style state in a once-around auction. */
  function getOnceAroundPlayerStatus(auc, playerCount, playerIndex) {
    const step = (playerIndex - auc.auctioneerIndex - 1 + playerCount) % playerCount;
    const entry = auc.onceAroundBids?.[playerIndex];
    if (step < auc.askedCount) {
      if (entry?.action === 'bid') {
        const isTop = playerIndex === auc.highestBidderIndex;
        return {
          step,
          stateClass: 'is-done is-bid',
          stageBadge: `<span class="badge ${isTop ? 'gold' : 'green'}">${isTop ? '🏆 ' : ''}已出 $${entry.amount}</span>`,
          listBadge: `<span class="badge green">已出 $${entry.amount}</span>`,
        };
      }
      return {
        step,
        stateClass: 'is-done is-pass',
        stageBadge: '<span class="badge">已 Pass</span>',
        listBadge: '<span class="badge">已 Pass</span>',
      };
    }
    if (step === auc.askedCount) {
      return {
        step,
        stateClass: 'is-current',
        stageBadge: '<span class="badge gold">👉 目前出價</span>',
        listBadge: '<span class="badge gold">👉 出價中</span>',
      };
    }
    if (step === auc.askedCount + 1) {
      return {
        step,
        stateClass: 'is-next',
        stageBadge: '<span class="badge blue">⏭️ 下一個出價</span>',
        listBadge: '<span class="badge blue">⏭️ 下一個</span>',
      };
    }
    return {
      step,
      stateClass: 'is-waiting',
      stageBadge: '<span class="badge">尚未出價</span>',
      listBadge: '<span class="badge">尚未出價</span>',
    };
  }

  function renderPlayersList(room, game) {
    const list = document.getElementById('players-list');
    const myIdx = room.mySeatIndex;
    const auc = game.activeAuction;
    const dbl = game.doubleState;

    list.innerHTML = game.players
      .map((p, idx) => {
        const isMe = idx === myIdx;
        const isTurn =
          (game.phase === 'PLAY_CARD' && game.turnPlayerIndex === idx) ||
          (game.phase === 'DOUBLE_OFFER' && dbl?.askingPlayerIndex === idx) ||
          (game.phase === 'AUCTION' &&
            ((auc?.auctionType === 'once_around' && auc.askingPlayerIndex === idx) ||
              (auc?.auctionType === 'fixed_price' && auc.askingPlayerIndex === idx)));

        const reveal = game.phase === 'HIDDEN_REVEAL' ? game.hiddenReveal : null;
        const isAuctioneer =
          (game.phase === 'PLAY_CARD' && game.turnPlayerIndex === idx) ||
          (auc && auc.auctioneerIndex === idx) ||
          (reveal && reveal.auctioneerIndex === idx);
        const isCoAuctioneer =
          (auc && auc.coAuctioneerIndex === idx) ||
          (reveal && reveal.coAuctioneerIndex === idx);
        const isHighest = auc && auc.highestBidderIndex === idx;
        const hasPassed = auc && auc.auctionType === 'open' && !isHighest && auc.passedPlayers.includes(idx);
        const onceBadgeHtml =
          game.phase === 'AUCTION' && auc && auc.auctionType === 'once_around'
            ? getOnceAroundPlayerStatus(auc, game.players.length, idx).listBadge
            : '';
        const hiddenSubmitted = auc && auc.auctionType === 'hidden' && auc.hiddenSubmittedIndexes.includes(idx);
        const revealConfirmed = reveal && reveal.confirmedPlayerIndexes.includes(idx);

        const counts = [0, 0, 0, 0, 0];
        for (const c of p.purchased) {
          counts[c.artistIndex] += 1;
        }
        const purchasedChips = game.artists
          .filter((a) => counts[a.index] > 0)
          .map(
            (a) =>
              `<span class="color-count-chip" style="--chip-color:${a.color}" title="${escapeHtml(a.zhName)} ${counts[a.index]} 張"><span class="color-swatch"></span>×${counts[a.index]}</span>`
          )
          .join('');
        const purchasedHtml =
          p.purchased.length === 0
            ? '<span class="muted-sm">尚無購入</span>'
            : `${purchasedChips}<span class="inspect-hint" aria-hidden="true">🔍</span>`;

        return `<button type="button" class="player-row ${isTurn ? 'active-turn' : ''} ${isMe ? 'is-me' : ''}" data-player-index="${idx}" title="點擊查看 ${escapeHtml(p.name)} 本季購入的原畫">
          <div class="player-row-identity">
            ${renderAvatarImgHtml(p.name)}
            <strong>${escapeHtml(p.name)}</strong>
            ${isMe ? '<span class="badge pink">你</span>' : ''}
            ${p.isAI ? '<span class="badge blue">AI</span>' : ''}
            ${isAuctioneer ? '<span class="badge gold">🔨 拍賣官</span>' : ''}
            ${isCoAuctioneer ? '<span class="badge gold">🤝 合拍</span>' : ''}
            ${isHighest ? '<span class="badge green">最高出價</span>' : ''}
            ${hasPassed ? '<span class="badge">已 Pass</span>' : ''}
            ${onceBadgeHtml}
            ${hiddenSubmitted ? '<span class="badge green">✓ 已出暗標</span>' : ''}
            ${revealConfirmed ? '<span class="badge green">✓ 已確認</span>' : ''}
          </div>
          <span class="player-row-stat">🃏 <strong>${p.handCount}</strong></span>
          <div class="purchased-strip">${purchasedHtml}</div>
        </button>`;
      })
      .join('');

    list.querySelectorAll('.player-row').forEach((row) => {
      row.addEventListener('click', () => {
        openCollectorModal(room, Number(row.dataset.playerIndex));
      });
    });
  }

  function openCollectorModal(room, playerIndex) {
    const game = room.game;
    if (!game) return;
    const player = game.players[playerIndex];
    if (!player) return;

    collectorTitle.textContent = `${player.name} — 本季購入原畫（共 ${player.purchased.length} 張）`;

    if (player.purchased.length === 0) {
      collectorBody.innerHTML = '<p class="muted">這位收藏家在本季尚未購入任何原畫。</p>';
    } else {
      const counts = [0, 0, 0, 0, 0];
      for (const c of player.purchased) counts[c.artistIndex] += 1;
      const summaryHtml = game.artists
        .filter((a) => counts[a.index] > 0)
        .map(
          (a) =>
            `<span class="color-count-chip" style="--chip-color:${a.color}"><span class="color-swatch"></span>${escapeHtml(a.zhName)} ×${counts[a.index]}</span>`
        )
        .join(' ');

      collectorBody.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-bottom:0.85rem;">${summaryHtml}</div>
        <div class="collector-cards-grid">
          ${player.purchased.map((c) => renderCardHtml(c)).join('')}
        </div>`;
    }

    if (!collectorDialog.open) {
      collectorDialog.showModal();
    }
  }

  function submitSelectedCard(room, game, cardId) {
    const isPlayTurn = game.phase === 'PLAY_CARD' && game.turnPlayerIndex === room.mySeatIndex;
    const isDoubleTurn =
      game.phase === 'DOUBLE_OFFER' &&
      game.doubleState &&
      game.doubleState.askingPlayerIndex === room.mySeatIndex;

    playTone(620, 0.08);
    selectedCardId = null;
    if (isPlayTurn) {
      emitAction('play_card', { cardId });
    } else if (isDoubleTurn) {
      emitAction('double_response', { cardId });
    }
  }

  function renderStage(room, game) {
    const stage = document.getElementById('auction-stage');
    const myIdx = room.mySeatIndex;
    const me = game.players[myIdx];

    if (game.phase === 'PLAY_CARD') {
      const turnPlayer = game.players[game.turnPlayerIndex];
      const isMyTurn = game.turnPlayerIndex === myIdx;
      const summaryHtml = game.lastAuctionSummary
        ? `<div class="auction-rule-box">上一筆成交：<strong>${escapeHtml(game.lastAuctionSummary.winnerName)}</strong> 以 <strong>$${game.lastAuctionSummary.price}</strong> 得標（${escapeHtml(game.lastAuctionSummary.paymentNote)}）</div>`
        : '';

      const selectedCard =
        isMyTurn && selectedCardId ? me?.hand?.find((c) => c.id === selectedCardId) : null;

      if (selectedCard) {
        const meta = AUCTION_META[selectedCard.auctionType];
        stage.innerHTML = `
          <div class="stage-grid">
            <div class="stage-cards">${renderCardHtml(selectedCard)}</div>
            <div class="stage-info">
              <h3>🎨 預覽待出畫作：${escapeHtml(selectedCard.artistName)}</h3>
              <div class="auction-rule-box">${meta.icon} <strong>${meta.label}</strong>：${meta.rule}</div>
              <div class="controls-bar">
                <button type="button" class="btn btn-primary" id="btn-stage-confirm-play">🔨 確認打出「${escapeHtml(selectedCard.title)}」</button>
                <button type="button" class="btn btn-ghost" id="btn-stage-cancel-select">取消重選</button>
              </div>
              ${summaryHtml}
            </div>
          </div>`;
        document.getElementById('btn-stage-confirm-play').addEventListener('click', () => {
          submitSelectedCard(room, game, selectedCard.id);
        });
        document.getElementById('btn-stage-cancel-select').addEventListener('click', () => {
          selectedCardId = null;
          renderMyHand(room, game);
          renderStage(room, game);
        });
        return;
      }

      stage.innerHTML = `
        <div class="stage-info">
          <h3>${isMyTurn ? '🎨 輪到你出牌擔任拍賣官！' : `⏳ 等待 ${escapeHtml(turnPlayer.name)} 出牌...`}</h3>
          <p class="muted-sm">
            ${isMyTurn ? '請從下方「我的畫廊屏風」點選一張畫作預覽，再按確認打出進行拍賣。' : '拍賣官正在從手牌挑選畫作準備拍賣。'}
          </p>
          ${summaryHtml}
        </div>`;
      return;
    }

    if (game.phase === 'DOUBLE_OFFER' && game.doubleState) {
      const dbl = game.doubleState;
      const askPlayer = game.players[dbl.askingPlayerIndex];
      const isMyAsk = dbl.askingPlayerIndex === myIdx;
      const eligibleCards = isMyAsk
        ? me.hand.filter((c) => c.artistIndex === dbl.primaryCard.artistIndex && c.auctionType !== 'double')
        : [];
      const doubleSelected =
        isMyAsk && selectedCardId ? eligibleCards.find((c) => c.id === selectedCardId) : null;

      stage.innerHTML = `
        <div class="stage-grid">
          <div class="stage-cards">
            ${renderCardHtml(dbl.primaryCard)}
            ${doubleSelected ? renderCardHtml(doubleSelected, { selected: true }) : ''}
          </div>
          <div class="stage-info">
            <h3>🖼️ 聯合拍賣：徵求第二張 ${escapeHtml(dbl.primaryCard.artistName)} 的畫作</h3>
            <div class="auction-rule-box">${AUCTION_META.double.rule}</div>
            <p>${isMyAsk ? '<strong>輪到你決定</strong>是否補出一張同畫家（非聯合拍賣）的畫作：' : `正在詢問 <strong>${escapeHtml(askPlayer.name)}</strong> 是否補牌...`}</p>
            ${
              isMyAsk
                ? doubleSelected
                  ? `<div class="controls-bar">
                      <button type="button" class="btn btn-primary" id="btn-stage-confirm-play">🤝 確認補出「${escapeHtml(doubleSelected.title)}」</button>
                      <button type="button" class="btn btn-ghost" id="btn-stage-cancel-select">取消重選</button>
                      <button type="button" class="btn btn-ghost" id="btn-double-pass">不補牌 / Pass</button>
                    </div>`
                  : `<div class="controls-bar">
                      ${
                        eligibleCards.length > 0
                          ? eligibleCards
                              .map(
                                (c) =>
                                  `<button type="button" class="btn btn-secondary btn-double-pick" data-card-id="${escapeHtml(c.id)}">預覽「${escapeHtml(c.title)}」(${AUCTION_META[c.auctionType].label})</button>`
                              )
                              .join('')
                          : '<span class="muted-sm">你手上沒有符合條件的同畫家畫作</span>'
                      }
                      <button type="button" class="btn btn-ghost" id="btn-double-pass">不補牌 / Pass</button>
                    </div>`
                : ''
            }
          </div>
        </div>`;

      stage.querySelectorAll('.btn-double-pick').forEach((btn) => {
        btn.addEventListener('click', () => {
          selectedCardId = btn.dataset.cardId;
          renderMyHand(room, game);
          renderStage(room, game);
        });
      });
      const confirmBtn = document.getElementById('btn-stage-confirm-play');
      if (confirmBtn && doubleSelected) {
        confirmBtn.addEventListener('click', () => submitSelectedCard(room, game, doubleSelected.id));
      }
      const cancelBtn = document.getElementById('btn-stage-cancel-select');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
          selectedCardId = null;
          renderMyHand(room, game);
          renderStage(room, game);
        });
      }
      const passBtn = document.getElementById('btn-double-pass');
      if (passBtn) passBtn.addEventListener('click', () => emitAction('double_response', { pass: true }));
      return;
    }

    if (game.phase === 'AUCTION' && game.activeAuction) {
      const a = game.activeAuction;
      const meta = AUCTION_META[a.auctionType];
      const aucPlayer = game.players[a.auctioneerIndex];
      const coPlayer = a.coAuctioneerIndex !== null ? game.players[a.coAuctioneerIndex] : null;
      const highestPlayer = a.highestBidderIndex !== null ? game.players[a.highestBidderIndex] : null;
      const cardsHtml = a.cards.map((c) => renderCardHtml(c)).join('');

      let controlsHtml = '';
      let statusBanner = '';

      if (a.auctionType === 'open') {
        const iAmHighest = a.highestBidderIndex === myIdx;
        const iPassed = !iAmHighest && a.passedPlayers.includes(myIdx);
        const canBid = !iAmHighest && me.money > a.currentBid;
        const openDurationMs = a.openDurationMs || 90000;
        const openRemainingMs = Math.max(0, (a.openExpiresAt || 0) - Date.now());
        const openRemainSec = Math.ceil(openRemainingMs / 1000);
        const openPct = Math.min(100, (openRemainingMs / openDurationMs) * 100);
        statusBanner = `
          <div class="bid-banner">
            <span class="bid-amount">$${a.currentBid}</span>
            <span>${highestPlayer ? `目前最高出價：<strong>${escapeHtml(highestPlayer.name)}</strong>` : '尚無人出價'}</span>
            <span class="badge" id="open-auction-seconds">⏳ ${openRemainSec}s</span>
          </div>
          <div class="countdown-track" aria-label="公開競標倒數"><div class="countdown-fill" id="open-countdown-fill" style="width:${openPct.toFixed(1)}%"></div></div>
        `;
        controlsHtml = `
          <div class="controls-bar">
            <button type="button" class="btn btn-primary btn-quick-bid" data-bid="${a.currentBid + 1}" ${!canBid || me.money < a.currentBid + 1 ? 'disabled' : ''}>+1 ($${a.currentBid + 1})</button>
            <button type="button" class="btn btn-primary btn-quick-bid" data-bid="${a.currentBid + 5}" ${!canBid || me.money < a.currentBid + 5 ? 'disabled' : ''}>+5 ($${a.currentBid + 5})</button>
            <button type="button" class="btn btn-primary btn-quick-bid" data-bid="${a.currentBid + 10}" ${!canBid || me.money < a.currentBid + 10 ? 'disabled' : ''}>+10 ($${a.currentBid + 10})</button>
            <div class="custom-bid-group">
              <input type="number" id="input-custom-bid" min="${a.currentBid + 1}" max="${me.money}" value="${Math.min(me.money, a.currentBid + 2)}" aria-label="自訂出價金額" />
              <button type="button" class="btn btn-accent" id="btn-custom-bid" ${!canBid ? 'disabled' : ''}>出價</button>
            </div>
            <button type="button" class="btn btn-ghost" id="btn-pass-bid" ${iAmHighest || iPassed ? 'disabled' : ''}>${iPassed ? '已 Pass' : 'Pass / 不加價'}</button>
          </div>`;
      } else if (a.auctionType === 'once_around') {
        const n = game.players.length;
        const askPlayer = game.players[a.askingPlayerIndex];
        const isMyTurn = a.askingPlayerIndex === myIdx;
        const canBid = isMyTurn && me.money > a.currentBid;
        const nextStep = a.askedCount + 1;
        const nextPlayer = nextStep < n ? game.players[(a.auctioneerIndex + 1 + nextStep) % n] : null;

        const onceOrderHtml = `
          <div class="once-order-list" aria-label="一輪競標出價順序">
            ${Array.from({ length: n }, (_, step) => {
              const pIdx = (a.auctioneerIndex + 1 + step) % n;
              const p = game.players[pIdx];
              const isMe = pIdx === myIdx;
              const isAuc = pIdx === a.auctioneerIndex;
              const status = getOnceAroundPlayerStatus(a, n, pIdx);
              return `
                <div class="once-order-item ${status.stateClass}">
                  <div class="once-order-player">
                    <span class="once-step-num">#${step + 1}${isAuc ? ' 壓軸' : ''}</span>
                    <strong>${escapeHtml(p.name)}</strong>
                    ${isMe ? '<span class="badge pink">你</span>' : ''}
                  </div>
                  <div class="once-order-status">${status.stageBadge}</div>
                </div>`;
            }).join('')}
          </div>`;

        statusBanner = `
          <div class="bid-banner">
            <span class="bid-amount">$${a.currentBid}</span>
            <span>
              ${highestPlayer ? `最高出價：<strong>${escapeHtml(highestPlayer.name)}</strong>` : '尚無人出價'}
              · 目前出價：<strong>${escapeHtml(askPlayer.name)}</strong>
              · 下一個出價：<strong>${nextPlayer ? escapeHtml(nextPlayer.name) : '無（本輪壓軸）'}</strong>
            </span>
          </div>
          ${onceOrderHtml}`;
        controlsHtml = isMyTurn
          ? `<div class="controls-bar">
              <button type="button" class="btn btn-primary btn-quick-bid" data-bid="${a.currentBid + 1}" ${!canBid || me.money < a.currentBid + 1 ? 'disabled' : ''}>+1 ($${a.currentBid + 1})</button>
              <button type="button" class="btn btn-primary btn-quick-bid" data-bid="${a.currentBid + 5}" ${!canBid || me.money < a.currentBid + 5 ? 'disabled' : ''}>+5 ($${a.currentBid + 5})</button>
              <button type="button" class="btn btn-primary btn-quick-bid" data-bid="${a.currentBid + 10}" ${!canBid || me.money < a.currentBid + 10 ? 'disabled' : ''}>+10 ($${a.currentBid + 10})</button>
              <div class="custom-bid-group">
                <input type="number" id="input-custom-bid" min="${a.currentBid + 1}" max="${me.money}" value="${Math.min(me.money, a.currentBid + 1)}" aria-label="自訂出價金額" />
                <button type="button" class="btn btn-accent" id="btn-custom-bid" ${!canBid ? 'disabled' : ''}>出價</button>
              </div>
              <button type="button" class="btn btn-ghost" id="btn-pass-bid">Pass</button>
            </div>`
          : `<p class="muted-sm">等待 ${escapeHtml(askPlayer.name)} 決定出價或 Pass...</p>`;
      } else if (a.auctionType === 'hidden') {
        const submitted = a.myHiddenBid !== null;
        statusBanner = `
          <div class="bid-banner">
            <span class="badge gold">已提交人數：${a.hiddenSubmittedIndexes.length} / ${game.players.length}</span>
            ${submitted ? `<span class="badge green">你已秘密出價：$${a.myHiddenBid}</span>` : '<span>請秘密輸入你的出價（可填 0 表示棄標）</span>'}
          </div>`;
        controlsHtml = submitted
          ? '<p class="muted-sm">已鎖定你的暗標金額，等待其他玩家完成出價後同時揭曉...</p>'
          : `<div class="controls-bar">
              <div class="custom-bid-group">
                <input type="number" id="input-hidden-bid" min="0" max="${me.money}" value="0" aria-label="暗標金額" />
                <button type="button" class="btn btn-primary" id="btn-submit-hidden">✊ 送出暗標</button>
              </div>
              <button type="button" class="btn btn-ghost" id="btn-hidden-zero">出 $0 棄標</button>
            </div>`;
      } else if (a.auctionType === 'fixed_price') {
        if (a.fixedPrice === null) {
          const isAuc = a.auctioneerIndex === myIdx;
          const minP = me.money > 0 ? 1 : 0;
          statusBanner = `<div class="bid-banner"><span class="badge gold">拍賣官 ${escapeHtml(aucPlayer.name)} 正在設定一口價...</span></div>`;
          controlsHtml = isAuc
            ? `<div class="controls-bar">
                <button type="button" class="btn btn-secondary btn-preset-fixed" data-price="${Math.min(me.money, 10)}" ${me.money < 1 ? 'disabled' : ''}>定價 $10</button>
                <button type="button" class="btn btn-secondary btn-preset-fixed" data-price="${Math.min(me.money, 20)}" ${me.money < 1 ? 'disabled' : ''}>定價 $20</button>
                <button type="button" class="btn btn-secondary btn-preset-fixed" data-price="${Math.min(me.money, 30)}" ${me.money < 1 ? 'disabled' : ''}>定價 $30</button>
                <div class="custom-bid-group">
                  <input type="number" id="input-fixed-price" min="${minP}" max="${me.money}" value="${Math.min(me.money, 15)}" aria-label="設定定價金額" />
                  <button type="button" class="btn btn-primary" id="btn-set-fixed">🏷️ 確定定價</button>
                </div>
              </div>`
            : `<p class="muted-sm">等待拍賣官設定價格...</p>`;
        } else {
          const askPlayer = game.players[a.askingPlayerIndex];
          const isMyTurn = a.askingPlayerIndex === myIdx;
          statusBanner = `
            <div class="bid-banner">
              <span class="bid-amount">$${a.fixedPrice}</span>
              <span>一口價 · 詢問中：<strong>${escapeHtml(askPlayer.name)}</strong></span>
            </div>`;
          controlsHtml = isMyTurn
            ? `<div class="controls-bar">
                <button type="button" class="btn btn-primary" id="btn-buy-fixed" ${me.money < a.fixedPrice ? 'disabled' : ''}>
                  ${me.money < a.fixedPrice ? `現金不足 ($${me.money} < $${a.fixedPrice})` : `💰 以 $${a.fixedPrice} 直接買下`}
                </button>
                <button type="button" class="btn btn-ghost" id="btn-pass-fixed">不買 / Pass</button>
              </div>`
            : `<p class="muted-sm">等待 ${escapeHtml(askPlayer.name)} 決定是否以 $${a.fixedPrice} 買下...</p>`;
        }
      }

      stage.innerHTML = `
        <div class="stage-grid">
          <div class="stage-cards">${cardsHtml}</div>
          <div class="stage-info">
            <h3>
              ${meta.icon} ${meta.label}
              <span class="muted-sm"> · 拍賣官：${escapeHtml(aucPlayer.name)}${coPlayer ? ` & 合拍：${escapeHtml(coPlayer.name)}` : ''}</span>
            </h3>
            <div class="auction-rule-box">${meta.rule}</div>
            ${statusBanner}
            ${controlsHtml}
          </div>
        </div>`;

      // Bind stage action listeners
      stage.querySelectorAll('.btn-quick-bid').forEach((btn) => {
        btn.addEventListener('click', () => emitAction('place_bid', { amount: Number(btn.dataset.bid) }));
      });
      const customBidBtn = document.getElementById('btn-custom-bid');
      if (customBidBtn) {
        customBidBtn.addEventListener('click', () => {
          const val = Number(document.getElementById('input-custom-bid').value);
          emitAction('place_bid', { amount: val });
        });
      }
      const passBidBtn = document.getElementById('btn-pass-bid');
      if (passBidBtn) {
        passBidBtn.addEventListener('click', () => emitAction('place_bid', { pass: true }));
      }
      const hiddenBtn = document.getElementById('btn-submit-hidden');
      if (hiddenBtn) {
        hiddenBtn.addEventListener('click', () => {
          const val = Number(document.getElementById('input-hidden-bid').value);
          emitAction('submit_hidden_bid', { amount: val });
        });
      }
      const hiddenZeroBtn = document.getElementById('btn-hidden-zero');
      if (hiddenZeroBtn) {
        hiddenZeroBtn.addEventListener('click', () => emitAction('submit_hidden_bid', { amount: 0 }));
      }
      stage.querySelectorAll('.btn-preset-fixed').forEach((btn) => {
        btn.addEventListener('click', () => emitAction('set_fixed_price', { price: Number(btn.dataset.price) }));
      });
      const setFixedBtn = document.getElementById('btn-set-fixed');
      if (setFixedBtn) {
        setFixedBtn.addEventListener('click', () => {
          const val = Number(document.getElementById('input-fixed-price').value);
          emitAction('set_fixed_price', { price: val });
        });
      }
      const buyFixedBtn = document.getElementById('btn-buy-fixed');
      if (buyFixedBtn) {
        buyFixedBtn.addEventListener('click', () => emitAction('buy_fixed_price', { buy: true }));
      }
      const passFixedBtn = document.getElementById('btn-pass-fixed');
      if (passFixedBtn) {
        passFixedBtn.addEventListener('click', () => emitAction('buy_fixed_price', { buy: false }));
      }
      return;
    }

    if (game.phase === 'HIDDEN_REVEAL' && game.hiddenReveal) {
      const rev = game.hiddenReveal;
      const aucPlayer = game.players[rev.auctioneerIndex];
      const coPlayer = rev.coAuctioneerIndex !== null ? game.players[rev.coAuctioneerIndex] : null;
      const confirmedSet = new Set(rev.confirmedPlayerIndexes || []);
      const iConfirmed = confirmedSet.has(myIdx);
      const durationMs = rev.durationMs || 30000;
      const remainingMs = Math.max(0, (rev.expiresAt || 0) - Date.now());
      const remainSec = Math.ceil(remainingMs / 1000);
      const pct = Math.min(100, (remainingMs / durationMs) * 100);

      const bidsRowsHtml = (rev.revealedBids || [])
        .map((entry) => {
          const isWinner = entry.playerIndex === rev.winnerIndex;
          const isMe = entry.playerIndex === myIdx;
          const hasConfirmed = confirmedSet.has(entry.playerIndex);
          return `
            <div class="hidden-reveal-row ${isWinner ? 'is-winner' : ''} ${hasConfirmed ? 'is-confirmed' : ''}">
              <div class="hidden-reveal-player">
                <strong>${escapeHtml(entry.playerName)}</strong>
                ${isMe ? '<span class="badge pink">你</span>' : ''}
                ${isWinner ? '<span class="badge gold">🏆 得標</span>' : ''}
              </div>
              <div class="hidden-reveal-right">
                <span class="hidden-reveal-bid">$${entry.amount}</span>
                <span class="badge ${hasConfirmed ? 'green' : ''}">${hasConfirmed ? '✓ 已確認' : '待確認'}</span>
              </div>
            </div>`;
        })
        .join('');

      stage.innerHTML = `
        <div class="stage-grid">
          <div class="stage-cards">
            ${rev.cards.map((c) => renderCardHtml(c)).join('')}
          </div>
          <div class="stage-info">
            <h3>✊ 暗標開標結果</h3>
            <p class="muted-sm">
              拍賣官：<strong>${escapeHtml(aucPlayer.name)}</strong>
              ${coPlayer ? ` · 合拍者：<strong>${escapeHtml(coPlayer.name)}</strong>` : ''}
              · ${escapeHtml(rev.paymentNote)}
            </p>
            <div class="bid-banner">
              <span class="bid-amount">$${rev.price}</span>
              <span>得標：<strong>${escapeHtml(rev.winnerName)}</strong></span>
              <span class="badge gold">已確認：${confirmedSet.size} / ${game.players.length}</span>
              <span class="badge" id="hidden-reveal-seconds">⏳ ${remainSec}s 後自動繼續</span>
            </div>
            <div class="countdown-track" aria-label="暗標開標確認倒數">
              <div class="countdown-fill" id="hidden-countdown-fill" style="width:${pct.toFixed(1)}%"></div>
            </div>
            <div class="hidden-reveal-list" aria-label="所有玩家暗標出價">
              ${bidsRowsHtml}
            </div>
            <div class="controls-bar">
              <button type="button" class="btn btn-primary" id="btn-confirm-hidden-reveal" ${iConfirmed ? 'disabled' : ''}>
                ${iConfirmed ? '✓ 已確定，等待其他玩家或倒數結束...' : '✅ 確定繼續'}
              </button>
            </div>
          </div>
        </div>`;

      const confirmRevealBtn = document.getElementById('btn-confirm-hidden-reveal');
      if (confirmRevealBtn) {
        confirmRevealBtn.addEventListener('click', () => emitAction('confirm_hidden_reveal'));
      }
      return;
    }

    if (game.phase === 'SEASON_SETTLEMENT') {
      stage.innerHTML = `
        <div class="stage-info">
          <h3>📊 第 ${game.season} 季拍賣已結束並完成結算！</h3>
          <p class="muted-sm">所有玩家已依本季前 3 名畫家的累積市價賣畫變現，桌面已買下的畫作已清空。</p>
          <div class="controls-bar">
            <button type="button" class="btn btn-secondary" id="btn-stage-report">查看結算明細</button>
            <button type="button" class="btn btn-primary" id="btn-stage-next-season">➡️ 進入第 ${game.season + 1} 季</button>
          </div>
        </div>`;
      document.getElementById('btn-stage-report').addEventListener('click', () => openSettlementModal(room));
      document.getElementById('btn-stage-next-season').addEventListener('click', () => emitAction('next_season'));
      return;
    }

    if (game.phase === 'GAME_OVER') {
      const champ = game.rankings?.[0];
      stage.innerHTML = `
        <div class="stage-info">
          <h3>🏆 拍賣會圓滿落幕！總冠軍：${escapeHtml(champ?.name || '')}（總資產 $${champ?.money ?? 0}）</h3>
          <p class="muted-sm">所有屏風後資金已公開。感謝遊玩！</p>
          <div class="controls-bar">
            <button type="button" class="btn btn-secondary" id="btn-stage-final-report">查看最終排名與結算</button>
            ${room.isHost ? '<button type="button" class="btn btn-primary" id="btn-stage-restart">🔄 原班人馬再戰一局</button>' : ''}
          </div>
        </div>`;
      document.getElementById('btn-stage-final-report').addEventListener('click', () => openSettlementModal(room));
      const restartBtn = document.getElementById('btn-stage-restart');
      if (restartBtn) restartBtn.addEventListener('click', () => emitAction('restart_game'));
    }
  }

  function renderMyHand(room, game) {
    const me = game.players[room.mySeatIndex];
    if (!me) return;

    document.getElementById('my-money-value').textContent = me.money !== null ? `$${me.money}` : '—';

    const projectedPrices = computeProjectedValues(game);
    const projectedEarned = me.purchased.reduce((sum, c) => sum + (projectedPrices[c.artistIndex] || 0), 0);
    document.getElementById('my-projected-value').textContent = `$${projectedEarned}`;

    const filtersContainer = document.getElementById('hand-filters');
    filtersContainer.innerHTML =
      `<button type="button" class="filter-chip ${handFilter === 'all' ? 'active' : ''}" data-artist="all">全部 (${me.hand.length})</button>` +
      game.artists
        .map((a) => {
          const cnt = me.hand.filter((c) => c.artistIndex === a.index).length;
          return `<button type="button" class="filter-chip ${handFilter === a.id ? 'active' : ''}" data-artist="${a.id}">${escapeHtml(a.zhName)} (${cnt})</button>`;
        })
        .join('');

    filtersContainer.querySelectorAll('.filter-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        handFilter = btn.dataset.artist;
        renderMyHand(room, game);
      });
    });

    const isPlayTurn = game.phase === 'PLAY_CARD' && game.turnPlayerIndex === room.mySeatIndex;
    const isDoubleTurn =
      game.phase === 'DOUBLE_OFFER' &&
      game.doubleState &&
      game.doubleState.askingPlayerIndex === room.mySeatIndex;

    const isCardEligible = (card) => {
      if (isPlayTurn) return true;
      if (isDoubleTurn) {
        return (
          card.artistIndex === game.doubleState.primaryCard.artistIndex &&
          card.auctionType !== 'double'
        );
      }
      return false;
    };

    let selectedCard = selectedCardId ? me.hand.find((c) => c.id === selectedCardId) : null;
    if (!selectedCard || !isCardEligible(selectedCard)) {
      selectedCardId = null;
      selectedCard = null;
    }

    const confirmBar = document.getElementById('hand-confirm-bar');
    if (selectedCard) {
      const meta = AUCTION_META[selectedCard.auctionType];
      const actionLabel = isDoubleTurn ? '🤝 確認補出此畫作' : '🔨 確認打出此畫作';
      confirmBar.classList.remove('hidden');
      confirmBar.innerHTML = `
        <span>
          已選擇：<strong>${escapeHtml(selectedCard.artistName)}</strong>「${escapeHtml(selectedCard.title)}」
          <span class="badge gold">${meta.icon} ${meta.label}</span>
        </span>
        <div class="hand-confirm-actions">
          <button type="button" class="btn btn-primary btn-sm" id="btn-confirm-play-card">${actionLabel}</button>
          <button type="button" class="btn btn-ghost btn-sm" id="btn-cancel-select-card">取消</button>
        </div>`;
      document.getElementById('btn-confirm-play-card').addEventListener('click', () => {
        submitSelectedCard(room, game, selectedCard.id);
      });
      document.getElementById('btn-cancel-select-card').addEventListener('click', () => {
        selectedCardId = null;
        renderMyHand(room, game);
        renderStage(room, game);
      });
    } else {
      confirmBar.classList.add('hidden');
      confirmBar.innerHTML = '';
    }

    const visibleHand =
      handFilter === 'all' ? me.hand : me.hand.filter((c) => c.artistId === handFilter);

    const handContainer = document.getElementById('my-hand-cards');
    if (visibleHand.length === 0) {
      handContainer.innerHTML = '<p class="muted-sm">此分類目前沒有手牌。</p>';
      return;
    }

    handContainer.innerHTML = visibleHand
      .map((card) => {
        const playable = isCardEligible(card);
        const dimmed = isDoubleTurn && !playable;
        const selected = selectedCardId === card.id;
        return renderCardHtml(card, { playable, selected, dimmed });
      })
      .join('');

    handContainer.querySelectorAll('button.painting-card.playable').forEach((btn) => {
      btn.addEventListener('click', () => {
        const cardId = btn.dataset.cardId;
        playTone(580, 0.05);
        selectedCardId = selectedCardId === cardId ? null : cardId;
        renderMyHand(room, game);
        renderStage(room, game);
      });
    });
  }

  function openSettlementModal(room) {
    const game = room.game;
    if (!game) return;
    const report = game.lastSeasonReport;
    if (!report) return;

    const titleEl = document.getElementById('settlement-dialog-title');
    titleEl.textContent =
      game.phase === 'GAME_OVER' ? '🏆 遊戲結束 — 最終資產排行榜' : `📊 第 ${report.season} 季拍賣結算`;

    const artistRows = report.ranking
      .map((r) => {
        const payout = report.payoutsPerArtist[r.artistIndex];
        return `<tr>
          <td>${r.rank ? `第 ${r.rank} 名` : '未入榜'}</td>
          <td>${escapeHtml(r.name)}</td>
          <td>${r.count} 張</td>
          <td>${r.bonus ? `+$${r.bonus}` : '$0'}</td>
          <td><strong>$${payout} / 張</strong></td>
        </tr>`;
      })
      .join('');

    const playerRows = report.playerPayouts
      .map(
        (pp) => `<tr>
          <td>${escapeHtml(pp.playerName)}</td>
          <td>${pp.soldCount} 張</td>
          <td><strong>+$${pp.earned}</strong></td>
        </tr>`
      )
      .join('');

    let rankingsHtml = '';
    if (game.phase === 'GAME_OVER' && game.rankings) {
      rankingsHtml = `
        <h4>🏆 最終總冠軍排名</h4>
        <table class="settlement-table">
          <thead><tr><th>名次</th><th>玩家</th><th>總買畫數</th><th>最終現金</th></tr></thead>
          <tbody>
            ${game.rankings
              .map(
                (rk) => `<tr>
                  <td>${rk.rank === 1 ? '🥇 第1名' : `第 ${rk.rank} 名`}</td>
                  <td>${escapeHtml(rk.name)}</td>
                  <td>${rk.totalPaintingsBought} 張</td>
                  <td><strong>$${rk.money}</strong></td>
                </tr>`
              )
              .join('')}
          </tbody>
        </table>`;
    }

    settlementBody.innerHTML = `
      ${rankingsHtml}
      <h4>🎨 第 ${report.season} 季畫家排名與累積單價</h4>
      <table class="settlement-table">
        <thead><tr><th>名次</th><th>畫家</th><th>出場張數</th><th>本季加成</th><th>本季賣價</th></tr></thead>
        <tbody>${artistRows}</tbody>
      </table>
      <h4>💰 本季賣畫入帳明細</h4>
      <table class="settlement-table">
        <thead><tr><th>玩家</th><th>賣出畫作</th><th>本季總收益</th></tr></thead>
        <tbody>${playerRows}</tbody>
      </table>
    `;

    if (game.phase === 'SEASON_SETTLEMENT') {
      settlementFooter.innerHTML = `
        <form method="dialog"><button type="submit" class="btn btn-ghost" value="close">先看桌面</button></form>
        <button type="button" class="btn btn-primary" id="btn-modal-next-season" autofocus>➡️ 進入第 ${game.season + 1} 季</button>
      `;
      document.getElementById('btn-modal-next-season').addEventListener('click', () => {
        settlementDialog.close();
        emitAction('next_season');
      });
    } else if (game.phase === 'GAME_OVER') {
      settlementFooter.innerHTML = `
        <form method="dialog"><button type="submit" class="btn btn-ghost" value="close" autofocus>檢視最終牌桌</button></form>
        ${room.isHost ? '<button type="button" class="btn btn-primary" id="btn-modal-restart">🔄 再來一局</button>' : ''}
      `;
      const restartBtn = document.getElementById('btn-modal-restart');
      if (restartBtn) {
        restartBtn.addEventListener('click', () => {
          settlementDialog.close();
          emitAction('restart_game');
        });
      }
    } else {
      settlementFooter.innerHTML =
        '<form method="dialog"><button type="submit" class="btn btn-primary" value="ok" autofocus>關閉</button></form>';
    }

    if (!settlementDialog.open) {
      settlementDialog.showModal();
    }
  }

  function renderGame(room) {
    const game = room.game;
    headerSeason.textContent = `第 ${game.season} / 4 季`;
    headerDeck.textContent = String(game.deckRemaining);
    seasonPill.classList.remove('hidden');
    deckPill.classList.remove('hidden');

    if (game.lastSeasonReport) {
      btnOpenSettlement.classList.remove('hidden');
    } else {
      btnOpenSettlement.classList.add('hidden');
    }

    renderArtistBoard(game);
    renderStage(room, game);
    renderPlayersList(room, game);
    renderMyHand(room, game);

    btnToggleLogs.classList.remove('hidden');
    logCountBadge.textContent = String(game.logs.length);

    const logFeed = document.getElementById('game-logs');
    logFeed.innerHTML = game.logs
      .map((l) => `<div class="log-item ${escapeHtml(l.type)}">[第${l.season}季] ${escapeHtml(l.message)}</div>`)
      .join('');
    logFeed.scrollTop = logFeed.scrollHeight;

    renderChatFeed(document.getElementById('game-chat-log'), room.chat);

    const modalKey =
      game.phase === 'SEASON_SETTLEMENT'
        ? `S${game.season}`
        : game.phase === 'GAME_OVER'
        ? 'GAME_OVER'
        : null;
    if (modalKey && modalKey !== lastOpenedModalKey) {
      lastOpenedModalKey = modalKey;
      playTone(440, 0.15);
      openSettlementModal(room);
    }
    if (!modalKey) {
      lastOpenedModalKey = null;
    }
  }

  function renderRoom(room) {
    roomState = room;
    if (!room) {
      selectedCardId = null;
      lobbyView.classList.remove('hidden');
      waitingView.classList.add('hidden');
      gameView.classList.add('hidden');
      roomPill.classList.add('hidden');
      seasonPill.classList.add('hidden');
      deckPill.classList.add('hidden');
      btnLeaveRoom.classList.add('hidden');
      btnOpenSettlement.classList.add('hidden');
      btnToggleLogs.classList.add('hidden');
      if (logPopover?.matches(':popover-open')) logPopover.hidePopover?.();
      return;
    }

    lobbyView.classList.add('hidden');
    roomPill.classList.remove('hidden');
    headerRoomCode.textContent = room.code;
    btnLeaveRoom.classList.remove('hidden');

    if (!room.game) {
      selectedCardId = null;
      waitingView.classList.remove('hidden');
      gameView.classList.add('hidden');
      seasonPill.classList.add('hidden');
      deckPill.classList.add('hidden');
      btnToggleLogs.classList.add('hidden');
      if (logPopover?.matches(':popover-open')) logPopover.hidePopover?.();
      renderWaitingRoom(room);
    } else {
      waitingView.classList.add('hidden');
      gameView.classList.remove('hidden');
      renderGame(room);
    }
  }

  // Socket listeners
  socket.on('idle_disconnect', (data = {}) => {
    pendingReconnectRoomCode = roomState?.code || null;
    if (idleDialogMessage) {
      const minutes = data.idleMinutes || 15;
      idleDialogMessage.textContent = `超過 ${minutes} 分鐘未有操作，為節省雲端連線資源已自動暫停連線。點擊下方按鈕即可重新連線${pendingReconnectRoomCode ? `並嘗試回到房間 ${pendingReconnectRoomCode}` : ''}。`;
    }
    if (idleDialog && !idleDialog.open) {
      idleDialog.showModal();
    }
  });

  socket.on('connect', () => {
    if (idleDialog?.open) {
      idleDialog.close();
    }
    if (pendingReconnectRoomCode) {
      const code = pendingReconnectRoomCode;
      pendingReconnectRoomCode = null;
      socket.emit('join_room', { roomCode: code, playerName: getPlayerName(), sessionId }, (res) => {
        if (res && !res.ok) {
          showToast(res.error || '房間已逾期關閉，已返回大廳', true);
          renderRoom(null);
        }
      });
    }
  });

  socket.on('rooms_updated', (data) => {
    renderPublicRooms(data.rooms || []);
  });

  socket.on('room_state', (room) => {
    playTone(520, 0.04);
    renderRoom(room);
  });

  // UI Event Bindings
  document.getElementById('btn-create-room').addEventListener('click', () => {
    emitAction('create_room', { playerName: getPlayerName(), sessionId });
  });

  document.getElementById('btn-join-room').addEventListener('click', () => {
    const code = inputRoomCode.value.trim().toUpperCase();
    if (!code) {
      showToast('請先輸入房號', true);
      return;
    }
    emitAction('join_room', { roomCode: code, playerName: getPlayerName(), sessionId });
  });

  if (btnIdleReconnect) {
    btnIdleReconnect.addEventListener('click', () => {
      if (idleDialog?.open) idleDialog.close();
      const returningToRoom = Boolean(pendingReconnectRoomCode);
      socket.connect();
      if (!returningToRoom) {
        fetch('/api/rooms')
          .then((res) => res.json())
          .then((data) => renderPublicRooms(data.rooms || []))
          .catch(() => {});
      }
    });
  }

  document.getElementById('btn-refresh-rooms').addEventListener('click', async () => {
    const res = await fetch('/api/rooms');
    const data = await res.json();
    renderPublicRooms(data.rooms || []);
  });

  document.getElementById('btn-add-bot').addEventListener('click', () => emitAction('add_bot'));
  document.getElementById('btn-remove-bot').addEventListener('click', () => emitAction('remove_bot'));
  document.getElementById('btn-start-game').addEventListener('click', () => emitAction('start_game'));

  btnLeaveRoom.addEventListener('click', () => {
    socket.emit('leave_room', {}, () => {
      renderRoom(null);
    });
  });

  function copyInviteLink() {
    if (!roomState) return;
    const url = `${window.location.origin}/?room=${roomState.code}`;
    navigator.clipboard?.writeText(url).then(
      () => showToast(`已複製邀請連結！房號：${roomState.code}`),
      () => showToast(`房號：${roomState.code}（可手動分享網址）`)
    );
  }

  document.getElementById('btn-copy-room').addEventListener('click', copyInviteLink);
  document.getElementById('btn-copy-invite').addEventListener('click', copyInviteLink);

  document.getElementById('btn-open-new-tab').addEventListener('click', () => {
    if (!roomState) return;
    window.open(`${window.location.origin}/?room=${roomState.code}`, '_blank');
  });

  document.getElementById('btn-open-rules').addEventListener('click', () => {
    rulesDialog.showModal();
  });

  btnOpenSettlement.addEventListener('click', () => {
    if (roomState) openSettlementModal(roomState);
  });

  btnToggleSound.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    btnToggleSound.setAttribute('aria-pressed', String(soundEnabled));
    btnToggleSound.textContent = soundEnabled ? '🔊 音效開' : '🔇 靜音';
  });

  btnCloseLogs.addEventListener('click', () => {
    btnToggleLogs.focus();
  });

  function bindChatForm(formId, inputId) {
    document.getElementById(formId).addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById(inputId);
      const text = input.value.trim();
      if (!text) return;
      emitAction('send_chat', { text });
      input.value = '';
    });
  }

  bindChatForm('waiting-chat-form', 'waiting-chat-input');
  bindChatForm('game-chat-form', 'game-chat-input');

  document.querySelectorAll('.emote-btn').forEach((btn) => {
    btn.addEventListener('click', () => emitAction('send_chat', { text: btn.dataset.emote }));
  });

  // Smoothly update open auction & hidden reveal countdown bars without re-rendering DOM inputs
  setInterval(() => {
    const g = roomState?.game;
    if (!g) return;
    const now = Date.now();

    const a = g.activeAuction;
    if (a && a.auctionType === 'open' && a.openExpiresAt) {
      const remaining = Math.max(0, a.openExpiresAt - now);
      const bar = document.getElementById('open-countdown-fill');
      if (bar) {
        const pct = Math.min(100, (remaining / (a.openDurationMs || 90000)) * 100);
        bar.style.width = `${pct.toFixed(1)}%`;
      }
      const secEl = document.getElementById('open-auction-seconds');
      if (secEl) {
        secEl.textContent = `⏳ ${Math.ceil(remaining / 1000)}s`;
      }
    }

    const r = g.phase === 'HIDDEN_REVEAL' ? g.hiddenReveal : null;
    if (r && r.expiresAt) {
      const remaining = Math.max(0, r.expiresAt - now);
      const bar = document.getElementById('hidden-countdown-fill');
      if (bar) {
        const pct = Math.min(100, (remaining / (r.durationMs || 30000)) * 100);
        bar.style.width = `${pct.toFixed(1)}%`;
      }
      const secEl = document.getElementById('hidden-reveal-seconds');
      if (secEl) {
        secEl.textContent = `⏳ ${Math.ceil(remaining / 1000)}s 後自動繼續`;
      }
    }
  }, 200);
})();
