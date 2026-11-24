'use strict';
const $ = id => document.getElementById(id);
const detail = $('detail');
const settings = $('imageSettings');
const impact = $('impact');
const shrimpPlates = $('shrimpPlates');
const potatoPlates = $('potatoPlates');
const dateFormat = new Intl.DateTimeFormat('ja-JP', {dateStyle:'full'});
const keyOf = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
const firstOf = date => new Date(date.getFullYear(), date.getMonth(), 1);
const days = new Map();
const ownedUrls = new WeakMap();
let month = firstOf(new Date());
let selectedKey;
let draft;
let dirty = false;
let busy = false;
let customImage = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('stamp-calendar-details', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('days');
      request.result.createObjectStore('settings');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function access(store, mode, action) {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode);
    const request = action(transaction.objectStore(store));
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(transaction.error);
  });
}

function clearVisuals(container) {
  for (const url of ownedUrls.get(container) ?? []) URL.revokeObjectURL(url);
  ownedUrls.set(container, []);
  container.replaceChildren();
}

function imageFor(blob, owner, alt = '') {
  const url = URL.createObjectURL(blob);
  const urls = ownedUrls.get(owner) ?? [];
  urls.push(url);
  ownedUrls.set(owner, urls);
  const image = new Image();
  image.src = url;
  image.alt = alt;
  return image;
}

function stampArt(blob, owner) {
  if (blob) {
    const image = imageFor(blob, owner);
    image.className = 'art';
    return image;
  }
  const seal = document.createElement('span');
  seal.className = 'art seal';
  seal.setAttribute('aria-hidden', 'true');
  seal.textContent = '★';
  return seal;
}

function showStamp(container, blob) {
  clearVisuals(container);
  container.append(stampArt(blob, container));
}

function renderCalendar() {
  const grid = $('grid');
  const focusKey = grid.contains(document.activeElement) ? document.activeElement.dataset.key : null;
  clearVisuals(grid);
  const year = month.getFullYear();
  const index = month.getMonth();
  const length = new Date(year, index + 1, 0).getDate();
  const today = keyOf(new Date());
  let count = 0;
  $('month').textContent = year + '年' + (index + 1) + '月';
  for (let i = 0; i < month.getDay(); i++) grid.append(document.createElement('span'));
  for (let day = 1; day <= length; day++) {
    const date = new Date(year, index, day);
    const key = keyOf(date);
    const record = days.get(key);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'day';
    button.dataset.key = key;
    if (date.getDay() === 0) button.classList.add('sun');
    if (date.getDay() === 6) button.classList.add('sat');
    button.textContent = day;
    button.setAttribute('aria-label', dateFormat.format(date) + (record?.stamped ? '、スタンプ済み' : ''));
    if (key === today) button.setAttribute('aria-current','date');
    if (record?.stamped) {
      count++;
      button.classList.add('marked');
      button.append(stampArt(record.stampImage, grid));
    }
    button.onclick = () => openDay(date);
    grid.append(button);
    if (key === focusKey) button.focus();
  }
  $('count').textContent = count;
  renderFiscalTotals(year, index);
}

function openDay(date) {
  selectedKey = keyOf(date);
  const entry = days.get(selectedKey);
  draft = entry ? {...entry, photos:[...entry.photos]} : {stamped:false, stampImage:null, memo:'', photos:[]};
  dirty = false;
  $('dateTitle').textContent = dateFormat.format(date);
  $('memo').value = draft.memo;
  shrimpPlates.value = plateCount(draft, 'shrimpPlates', 'えびグラタン') ?? '';
  potatoPlates.value = plateCount(draft, 'potatoPlates', 'ポテトグラタン') ?? '';
  const unclassified = draft.plates != null && !['えびグラタン', 'ポテトグラタン'].includes(draft.meal);
  $('legacyPlates').hidden = !unclassified;
  $('legacyPlates').textContent = unclassified ? '以前の記録（種類未選択） ' + draft.plates + '皿' : '';
  $('detailStatus').textContent = '';
  renderDay();
  detail.showModal();
}

function renderDay() {
  showStamp($('stampPreview'), draft.stamped ? draft.stampImage : customImage);
  $('stamp').textContent = draft.stamped ? 'もう一度押す' : 'スタンプを押す';
  $('removeStamp').hidden = !draft.stamped;
  $('photoCount').textContent = draft.photos.length + ' / 5';
  $('photos').disabled = busy || draft.photos.length === 5;
  const list = $('photoList');
  clearVisuals(list);
  draft.photos.forEach((photo, index) => {
    const figure = document.createElement('figure');
    const remove = document.createElement('button');
    remove.textContent = '削除';
    remove.setAttribute('aria-label', '添付画像' + (index + 1) + 'を削除');
    remove.disabled = busy;
    remove.onclick = () => {
      draft.photos.splice(index, 1);
      dirty = true;
      renderDay();
      $('photos').focus();
    };
    figure.append(imageFor(photo, list, '添付画像 ' + (index + 1)), remove);
    list.append(figure);
  });
}

function lockDay(lock) {
  busy = lock;
  for (const field of detail.querySelectorAll('button, input, textarea')) field.disabled = lock;
  $('photos').disabled = lock || draft.photos.length === 5;
}

function plateCount(record, field, legacyMeal) {
  return Object.hasOwn(record, field) ? record[field] : record.meal === legacyMeal ? record.plates : null;
}

function fiscalTotals(records, year) {
  let shrimp = 0;
  let potato = 0;
  let legacy = 0;
  for (const [key, record] of records) {
    const [recordYear, recordMonth] = key.split('-').map(Number);
    if (recordYear - (recordMonth < 4 ? 1 : 0) !== year) continue;
    const shrimpCount = plateCount(record, 'shrimpPlates', 'えびグラタン');
    const potatoCount = plateCount(record, 'potatoPlates', 'ポテトグラタン');
    shrimp += shrimpCount ?? 0;
    potato += potatoCount ?? 0;
    if (shrimpCount == null && potatoCount == null && !['えびグラタン', 'ポテトグラタン'].includes(record.meal)) {
      legacy += record.plates ?? 0;
    }
  }
  return {shrimp, potato, legacy, total:shrimp + potato + legacy};
}

function renderFiscalTotals(year, monthIndex) {
  const fiscalYear = year - (monthIndex < 3 ? 1 : 0);
  const totals = fiscalTotals(days, fiscalYear);
  $('fiscalPeriod').textContent = fiscalYear + '年4月1日〜' + (fiscalYear + 1) + '年3月31日';
  $('fiscalTotal').textContent = totals.total.toLocaleString('ja-JP');
  $('fiscalShrimp').textContent = totals.shrimp.toLocaleString('ja-JP');
  $('fiscalPotato').textContent = totals.potato.toLocaleString('ja-JP');
  $('fiscalLegacy').textContent = totals.legacy.toLocaleString('ja-JP');
  $('fiscalLegacyRow').hidden = totals.legacy === 0;
}

function validPlateCounts() {
  return shrimpPlates.reportValidity() && potatoPlates.reportValidity();
}

async function saveDay(changes = {}) {
  if (busy || !validPlateCounts()) return false;
  const record = {...draft, ...changes, memo:$('memo').value,
    shrimpPlates:shrimpPlates.value === '' ? null : shrimpPlates.valueAsNumber,
    potatoPlates:potatoPlates.value === '' ? null : potatoPlates.valueAsNumber};
  lockDay(true);
  try {
    await access('days','readwrite', store => store.put({...record, dateKey:selectedKey}, selectedKey));
    draft = record;
    days.set(selectedKey, record);
    dirty = false;
    renderCalendar();
    $('detailStatus').textContent = '保存しました。';
    return true;
  } catch {
    $('detailStatus').textContent = '保存できませんでした。ブラウザの空き容量や設定を確認してください。';
    return false;
  } finally {
    lockDay(false);
    renderDay();
  }
}

async function validateImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const pressSurface = $('pressSurface');
let impactPhase = 'ready';
let impactTimer;

$('stamp').onclick = () => {
  if (!validPlateCounts()) return;
  impact.showModal();
};

pressSurface.onclick = async () => {
  if (impactPhase !== 'ready') return;
  impactPhase = 'saving';
  const stampImage = customImage;
  if (!await saveDay({stamped:true, stampImage})) {
    impactPhase = 'ready';
    impact.close();
    return;
  }
  impactPhase = 'stamped';
  showStamp($('impactArt'), stampImage);
  impact.classList.add('stamped');
  impactTimer = setTimeout(() => impact.close(), 1050);
};
impact.oncancel = event => {
  if (impactPhase === 'saving') event.preventDefault();
};
impact.onclose = () => {
  clearTimeout(impactTimer);
  clearVisuals($('impactArt'));
  impact.classList.remove('stamped');
  impactPhase = 'ready';
  $('stamp').focus();
};
$('removeStamp').onclick = () => saveDay({stamped:false, stampImage:null});
$('save').onclick = async () => {
  if (await saveDay()) detail.close();
};
detail.oninput = event => {
  if (event.target === $('memo') || event.target === shrimpPlates || event.target === potatoPlates) dirty = true;
};
detail.querySelector('.close').onclick = () => {
  if (!busy && (!dirty || confirm('保存していない変更を破棄しますか？'))) detail.close();
};
detail.oncancel = event => {
  if (busy || (dirty && !confirm('保存していない変更を破棄しますか？'))) event.preventDefault();
};
detail.onclose = () => {
  clearVisuals($('stampPreview'));
  clearVisuals($('photoList'));
  Array.from($('grid').children).find(button => button.dataset.key === selectedKey)?.focus();
};
$('photos').onchange = async event => {
  const files = Array.from(event.target.files);
  event.target.value = '';
  const remaining = 5 - draft.photos.length;
  lockDay(true);
  const results = await Promise.allSettled(files.slice(0, remaining).map(validateImage));
  const valid = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  draft.photos.push(...valid);
  if (valid.length) dirty = true;
  const messages = [];
  if (files.length > remaining) messages.push('添付できる画像は1日5枚までです。');
  if (valid.length < results.length) messages.push('読み込めない画像がありました。');
  $('detailStatus').textContent = messages.join(' ');
  lockDay(false);
  renderDay();
};

function showSettings() {
  showStamp($('customPreview'), customImage);
  $('resetImage').disabled = !customImage;
}
$('settings').onclick = () => {
  showSettings();
  $('settingsStatus').textContent = '';
  settings.showModal();
};
settings.querySelector('.close').onclick = () => settings.close();
settings.oncancel = event => {
  if ($('customFile').disabled) event.preventDefault();
};
settings.onclose = () => clearVisuals($('customPreview'));

async function changeImage(file) {
  $('customFile').disabled = true;
  $('resetImage').disabled = true;
  settings.querySelector('.close').disabled = true;
  try {
    const image = file ? await validateImage(file) : null;
    await access('settings','readwrite', store => store.put(image, 'stampImage'));
    customImage = image;
    $('settingsStatus').textContent = image ? 'スタンプ画像を設定しました。' : '標準のスタンプに戻しました。';
  } catch {
    $('settingsStatus').textContent = '画像を設定できませんでした。別の画像を選ぶか、ブラウザの空き容量を確認してください。';
  } finally {
    $('customFile').disabled = false;
    settings.querySelector('.close').disabled = false;
    showSettings();
  }
}
$('customFile').onchange = event => {
  const file = event.target.files[0];
  event.target.value = '';
  if (file) changeImage(file);
};
$('resetImage').onclick = () => changeImage(null);

function navigate(delta) {
  month = delta === 0 ? firstOf(new Date()) : new Date(month.getFullYear(), month.getMonth() + delta, 1);
  renderCalendar();
}
$('prev').onclick = () => navigate(-1);
$('home').onclick = () => navigate(0);
$('next').onclick = () => navigate(1);

const database = openDatabase();
async function initialize() {
  $('settings').disabled = true;
  try {
    const [records, image] = await Promise.all([
      access('days','readonly', store => store.getAll()),
      access('settings','readonly', store => store.get('stampImage'))
    ]);
    records.forEach(record => days.set(record.dateKey, record));
    customImage = image ?? null;
  } catch {
    $('calendarStatus').textContent = 'ブラウザの保存領域にアクセスできません。記録の保存は利用できません。';
  }
  try {
    const previous = JSON.parse(localStorage.getItem('stamp-calendar-v1') ?? '[]');
    if (Array.isArray(previous)) {
      for (const key of previous) {
        if (!days.has(key)) days.set(key, {stamped:true, stampImage:null, memo:'', photos:[]});
      }
    }
  } catch {
    // Older records are optional. The current database remains available.
  }
  $('settings').disabled = false;
  renderCalendar();
}
initialize();
