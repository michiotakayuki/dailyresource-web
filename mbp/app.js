/* Quot-in Pengadaan — CV Makmur Berkah Perkasa
   Aplikasi quotation + invoice multi-perangkat.
   Data: Firebase Firestore (project mbp-quotation), cache lokal penuh supaya tetap jalan tanpa internet. */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js';
import {
  getAuth, setPersistence, indexedDBLocalPersistence, onAuthStateChanged,
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  updateProfile, sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, collection, onSnapshot, query, orderBy, limit,
  runTransaction, serverTimestamp, where, getDocs
} from 'https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js';

/* ===================== KONFIGURASI ===================== */
const firebaseConfig = {
  apiKey: "AIzaSyCLjpFsXHtNDMV9bp4rG3Fd6Q-bmmU3rho",
  authDomain: "mbp-quotation.firebaseapp.com",
  projectId: "mbp-quotation",
  storageBucket: "mbp-quotation.firebasestorage.app",
  messagingSenderId: "520015793218",
  appId: "1:520015793218:web:a9fef573df44e9a9bb71db"
};

/* Satu aplikasi ini dipakai satu perusahaan. */
const CID = 'mbp';
/* Kode undangan untuk daftar akun baru. Ganti baris ini kalau mau menutup pendaftaran. */
const INVITE = 'MBP2026';
/* Nomor quotation berikutnya kalau penghitung belum pernah dipakai.
   361 karena dokumen terakhir mereka 0360/Q-MBP/XI/2026. */
const START_Q = 361, START_I = 1;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

/* ===================== UTIL ===================== */
const $ = id => document.getElementById(id);
const V = id => { const e = $(id); return e ? e.value : ''; };
const SET = (id, v) => { const e = $(id); if (e) e.value = v == null ? '' : v; };
const es = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rp = n => { const v = Math.round(Number(n) || 0); return (v < 0 ? '− Rp' : 'Rp') + Math.abs(v).toLocaleString('id-ID'); };
const pad4 = n => String(n).padStart(4, '0');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
const BLN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const tgl = s => { if (!s) return ''; const [y, m, d] = s.split('-'); return d + ' ' + BLN[+m - 1] + ' ' + y; };
const today = () => new Date().toISOString().slice(0, 10);
const plus = (d, n) => { const t = new Date(d + 'T00:00:00'); t.setDate(t.getDate() + n); return t.toISOString().slice(0, 10); };
const ini = s => (String(s || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2) || '?').toUpperCase();
const AVC = ['#ef5f3c', '#2d6cdf', '#12805a', '#8257c9', '#c2185b', '#00838f', '#ef6c00'];
const avc = s => AVC[Array.from(String(s || '')).reduce((a, c) => a + c.charCodeAt(0), 0) % AVC.length];

let TT;
function toast(m, bad) {
  const t = $('toast'); t.textContent = m; t.className = 'on' + (bad ? ' bad' : '');
  clearTimeout(TT); TT = setTimeout(() => t.className = '', bad ? 5200 : 2800);
}

/* ===================== STATE ===================== */
const COLS_DEF = () => ([
  { k: 'no', nm: 'No', on: 1, lk: 1, w: '30px', al: 'ctr' },
  { k: 'desc', nm: 'Description', on: 1, lk: 1, w: 'auto', al: '' },
  { k: 'qty', nm: 'QTY', on: 1, lk: 1, w: '42px', al: 'ctr' },
  { k: 'uom', nm: 'UOM', on: 1, lk: 1, w: '48px', al: 'ctr' },
  { k: 'pn', nm: 'P/N', on: 1, lk: 0, w: '82px', al: 'ctr' },
  { k: 'maker', nm: 'Maker', on: 1, lk: 0, w: '86px', al: 'ctr' },
  { k: 'price', nm: 'Unit Price', on: 1, lk: 1, w: '98px', al: 'num' },
  { k: 'amount', nm: 'Amount', on: 1, lk: 1, w: '108px', al: 'num' },
  { k: 'lead', nm: 'Lead Time', on: 1, lk: 0, w: '74px', al: 'ctr' },
  { k: 'modal', nm: 'Harga Modal', on: 0, lk: 0, w: '98px', al: 'num', int: 1 },
  { k: 'margin', nm: 'Margin', on: 0, lk: 0, w: '66px', al: 'num', int: 1 }
]);
const ROW_DEF = () => ({ desc: '', qty: 1, uom: 'PCS', pn: '', maker: '', price: 0, lead: '', modal: 0, img: '', extra: {} });

let COLS = COLS_DEF();
let ROWS = [ROW_DEF()];
let TERMIN = [];
let theme = 't-ocean', mode = 'klien', pmode = 'gal', dt = 'quot', paymode = 'full';
let LOGO = '', TTD = '';
let ME = null, COMP = {}, HIST = [], hfilter = 'all';
let CUR = { id: null, no: '', noPending: false, kind: 'quot', by: null };
let dirty = false;

const THEMES = [
  { k: 't-ocean', nm: 'Ocean', d: 'biru korporat, bersih', a: '#1565c0', b: '#e8f1fc' },
  { k: 't-exec', nm: 'Executive', d: 'serif formal — mirip punya mereka', a: '#15202b', b: '#eef1f4' },
  { k: 't-emerald', nm: 'Emerald', d: 'hijau tenang, enak dibaca', a: '#0f7a52', b: '#e7f5ef' },
  { k: 't-steel', nm: 'Steel', d: 'header gelap, tegas industri', a: '#f0b429', b: '#141b23' },
  { k: 't-sunset', nm: 'Sunset', d: 'hangat, ramah', a: '#d4722a', b: '#fdf1e6' },
  { k: 't-mono', nm: 'Mono', d: 'hitam putih, sangat ringkas', a: '#000', b: '#fff' },
  { k: 't-pastel', nm: 'Pastel', d: 'ungu & hijau muda', a: '#C7E89A', b: '#E7DAF8', fun: 1 },
  { k: 't-retro', nm: 'Retro Pastel', d: 'krem, kuning, pink', a: '#F0B32E', b: '#F3B3C6', fun: 1 },
  { k: 't-mint', nm: 'Fresh Mint', d: 'gading & hijau muda', a: '#8FC33F', b: '#D6EBA8', fun: 1 }
];
const isFun = k => !!(THEMES.find(t => t.k === k) || {}).fun;
const vis = () => COLS.filter(c => c.on && (!c.int || mode === 'internal'));
const AR = () => V('ar') || '4/3';

/* ===================== HITUNGAN =====================
   Semua rupiah disimpan dan dihitung sebagai bilangan bulat.
   amount per baris dibulatkan dulu, lalu dijumlahkan — supaya
   angka di kertas persis sama dengan jumlah di bawahnya.          */
const R = n => Math.round(Number(n) || 0);
const lineAmt = r => R((Number(r.qty) || 0) * (Number(r.price) || 0));

function calc() {
  const items = ROWS.map(r => lineAmt(r));
  const subtotal = items.reduce((a, b) => a + b, 0);
  const other = R(V('f_other'));
  const base = subtotal + other;
  const step = R(V('f_round'));
  const rounded = step > 0 ? Math.round(base / step) * step : base;
  const roundAdj = rounded - base;
  const taxPct = Number(V('f_taxp')) || 0;
  const tax = R(rounded * taxPct / 100);
  const total = rounded + tax;

  // Termin: yang terakhir menyerap sisa pembulatan supaya jumlahnya pas.
  let tms = [];
  if (dt === 'inv') {
    const src = paymode === 'full' ? [{ lbl: 'Pelunasan 100%', pct: 100, due: V('f_due') }] : TERMIN;
    let acc = 0;
    tms = src.map((t, i) => {
      let amt;
      if (i === src.length - 1) amt = total - acc;
      else { amt = R(total * (Number(t.pct) || 0) / 100); acc += amt; }
      return { lbl: t.lbl || ('Termin ' + (i + 1)), pct: Number(t.pct) || 0, due: t.due || '', amt };
    });
  }
  const pctSum = (paymode === 'full') ? 100 : TERMIN.reduce((a, t) => a + (Number(t.pct) || 0), 0);
  return { items, subtotal, other, roundAdj, rounded, taxPct, tax, total, tms, pctSum };
}

/* ===================== FOTO ===================== */
function compress(file, maxPx = 1100, targetKB = 75) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('gagal baca file'));
    fr.onload = () => {
      const im = new Image();
      im.onerror = () => rej(new Error('bukan gambar yang bisa dibaca'));
      im.onload = () => {
        let w = im.width, h = im.height;
        const sc = Math.min(1, maxPx / Math.max(w, h));
        w = Math.max(1, Math.round(w * sc)); h = Math.max(1, Math.round(h * sc));
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        const cx = cv.getContext('2d');
        cx.fillStyle = '#fff'; cx.fillRect(0, 0, w, h);
        cx.drawImage(im, 0, 0, w, h);
        let out = '';
        for (const q of [0.82, 0.72, 0.62, 0.5, 0.4, 0.3]) {
          out = cv.toDataURL('image/jpeg', q);
          if (out.length * 0.75 / 1024 <= targetKB) break;
        }
        res(out);
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
const bytesOf = () => ROWS.reduce((a, r) => a + (r.img ? r.img.length * 0.75 : 0), 0) + (LOGO.length + TTD.length) * 0.75;

/* ===================== NOMOR DARI SERVER ===================== */
async function nextNo(kind) {
  const ref = doc(db, 'companies', CID, 'counters', kind);
  const n = await runTransaction(db, async tx => {
    const s = await tx.get(ref);
    const cur = s.exists() && Number(s.data().next) ? Number(s.data().next) : (kind === 'quotation' ? START_Q : START_I);
    tx.set(ref, { next: cur + 1, updatedAt: serverTimestamp() }, { merge: true });
    return cur;
  });
  return n;
}
function fmtNo(n, kind, dateStr) {
  const d = (dateStr || today()).split('-');
  return pad4(n) + (kind === 'quotation' ? '/Q-MBP/' : '/INV-MBP/') + ROMAN[+d[1]] + '/' + d[0];
}
async function allocNo(kind, dateStr) {
  if (!navigator.onLine) return null;
  try {
    const n = await Promise.race([
      nextNo(kind),
      new Promise((_, rj) => setTimeout(() => rj(new Error('timeout')), 9000))
    ]);
    return fmtNo(n, kind, dateStr);
  } catch (e) { return null; }
}

/* ===================== AUTH UI ===================== */
let amode = 'in';
function authUI() {
  const up = amode === 'up';
  $('a_h1').textContent = up ? 'Daftar Akun' : 'Masuk';
  $('a_namebox').style.display = up ? 'block' : 'none';
  $('a_codebox').style.display = up ? 'block' : 'none';
  $('a_go').textContent = up ? 'Buat akun saya' : 'Masuk';
  $('a_forgot').style.display = up ? 'none' : 'block';
  $('a_pass').setAttribute('autocomplete', up ? 'new-password' : 'current-password');
}
function amsg(t, cls) { const m = $('a_msg'); m.textContent = t || ''; m.className = 'msg' + (t ? ' ' + (cls || 'err') : ''); }

document.querySelectorAll('#a_seg button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#a_seg button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); amode = b.dataset.am; amsg(''); authUI();
});

const ERRMAP = {
  'auth/invalid-email': 'Alamat email tidak betul penulisannya.',
  'auth/invalid-credential': 'Email atau password tidak cocok.',
  'auth/wrong-password': 'Password salah.',
  'auth/user-not-found': 'Email ini belum terdaftar. Pilih Daftar Akun dulu.',
  'auth/email-already-in-use': 'Email ini sudah punya akun. Pilih Masuk.',
  'auth/weak-password': 'Password terlalu pendek. Minimal 6 karakter, sebaiknya 8.',
  'auth/too-many-requests': 'Terlalu banyak percobaan. Tunggu beberapa menit.',
  'auth/network-request-failed': 'Tidak ada internet. Untuk masuk pertama kali di perangkat ini, internet harus nyala.'
};
const emsg = e => ERRMAP[e && e.code] || (e && e.message) || 'Ada yang tidak jalan.';

$('a_go').onclick = async () => {
  const em = V('a_email').trim(), pw = V('a_pass');
  if (!em || !pw) return amsg('Email dan password harus diisi.');
  $('a_go').disabled = true;
  try {
    if (amode === 'up') {
      const nm = V('a_name').trim();
      if (!nm) throw new Error('Nama lengkap harus diisi — nama ini yang muncul di riwayat bersama.');
      if (V('a_code').trim().toUpperCase() !== INVITE) throw new Error('Kode undangan tidak betul. Minta ke atasan Anda.');
      if (pw.length < 8) throw new Error('Password minimal 8 karakter.');
      const cr = await createUserWithEmailAndPassword(auth, em, pw);
      await updateProfile(cr.user, { displayName: nm });
      await setDoc(doc(db, 'users', cr.user.uid), {
        name: nm, email: em, companyId: CID, createdAt: serverTimestamp()
      });
    } else {
      await signInWithEmailAndPassword(auth, em, pw);
    }
  } catch (e) { amsg(emsg(e)); }
  $('a_go').disabled = false;
};
$('a_forgot').onclick = async () => {
  const em = V('a_email').trim();
  if (!em) return amsg('Tulis email Anda dulu di kolom Email, lalu klik lagi.');
  try { await sendPasswordResetEmail(auth, em); amsg('Tautan ganti password sudah dikirim ke ' + em + '. Cek inbox dan folder spam.', 'ok'); }
  catch (e) { amsg(emsg(e)); }
};
$('a_pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('a_go').click(); });

/* ===================== MASUK / KELUAR ===================== */
onAuthStateChanged(auth, async u => {
  if (!u) { $('scr-auth').style.display = 'grid'; $('scr-app').style.display = 'none'; ME = null; return; }
  try {
    const us = await getDoc(doc(db, 'users', u.uid));
    if (!us.exists()) {
      await setDoc(doc(db, 'users', u.uid), {
        name: u.displayName || u.email, email: u.email, companyId: CID, createdAt: serverTimestamp()
      });
    }
    ME = { uid: u.uid, name: (us.exists() && us.data().name) || u.displayName || u.email, email: u.email };
  } catch (e) {
    ME = { uid: u.uid, name: u.displayName || u.email, email: u.email };
  }
  $('scr-auth').style.display = 'none'; $('scr-app').style.display = 'block';
  $('t_me').innerHTML = es(ME.name) + '<small>' + es(ME.email) + '</small>';
  $('t_av').textContent = ini(ME.name); $('t_av').style.background = avc(ME.email);
  await boot();
});
$('t_out').onclick = async () => {
  if (dirty && !confirm('Ada perubahan yang belum disimpan. Tetap keluar?')) return;
  await signOut(auth); location.reload();
};

/* ===================== PROFIL PERUSAHAAN ===================== */
const COMP_DEF = {
  nama: 'CV MAKMUR BERKAH PERKASA',
  alamat: 'JL. ARAH PASIR PANJANG, RT005 RW002, KEL. DARUSSALAM, KEC. MERAL BARAT, KAB. KARIMUN, PROV. KEPRI 29635, INDONESIA',
  telp: '+6285264843025', email: 'makmurberkahperkasa@gmail.com',
  deliv: 'Price Basis: DDP (Delivered Duty Paid) — isi lokasi tujuan.',
  pay: 'Payment is due within 30 days of the invoice date.',
  bank: '', cur: 'IDR', bankname: '', bankno: '', swift: '', signer: '',
  logo: '', ttd: ''
};
async function boot() {
  const ref = doc(db, 'companies', CID);
  try {
    const s = await getDoc(ref);
    if (s.exists()) COMP = Object.assign({}, COMP_DEF, s.data());
    else { COMP = Object.assign({}, COMP_DEF); await setDoc(ref, { ...COMP, createdAt: serverTimestamp() }, { merge: true }); }
  } catch (e) { COMP = Object.assign({}, COMP_DEF); }
  $('t_comp').textContent = COMP.nama;
  LOGO = COMP.logo || ''; TTD = COMP.ttd || '';
  applyComp();
  blank(true);
  watchHist();
  claimPending();
  setTimeout(askRestore, 700);
}
function applyComp() {
  SET('f_nama', COMP.nama); SET('f_alamat', COMP.alamat); SET('f_telp', COMP.telp); SET('f_email', COMP.email);
  SET('f_deliv', COMP.deliv); SET('f_pay', COMP.pay); SET('f_bank', COMP.bank); SET('f_cur', COMP.cur);
  SET('f_bankname', COMP.bankname); SET('f_bankno', COMP.bankno); SET('f_swift', COMP.swift); SET('f_signer', COMP.signer);
}
$('b_savekop').onclick = async () => {
  Object.assign(COMP, { nama: V('f_nama'), alamat: V('f_alamat'), telp: V('f_telp'), email: V('f_email') });
  try { await setDoc(doc(db, 'companies', CID), { nama: COMP.nama, alamat: COMP.alamat, telp: COMP.telp, email: COMP.email }, { merge: true }); $('t_comp').textContent = COMP.nama; toast('Kop tersimpan untuk seluruh perusahaan.'); }
  catch (e) { toast('Gagal menyimpan kop: ' + e.message, 1); }
};
$('b_saveterm').onclick = async () => {
  Object.assign(COMP, { deliv: V('f_deliv'), pay: V('f_pay'), bank: V('f_bank'), cur: V('f_cur'), bankname: V('f_bankname'), bankno: V('f_bankno'), swift: V('f_swift'), signer: V('f_signer') });
  try {
    await setDoc(doc(db, 'companies', CID), {
      deliv: COMP.deliv, pay: COMP.pay, bank: COMP.bank, cur: COMP.cur,
      bankname: COMP.bankname, bankno: COMP.bankno, swift: COMP.swift, signer: COMP.signer
    }, { merge: true });
    toast('Syarat & rekening tersimpan untuk seluruh perusahaan.');
  } catch (e) { toast('Gagal menyimpan: ' + e.message, 1); }
};
async function saveBrand() {
  try { await setDoc(doc(db, 'companies', CID), { logo: LOGO, ttd: TTD }, { merge: true }); toast('Tersimpan untuk seluruh perusahaan.'); }
  catch (e) { toast('Gagal menyimpan: ' + e.message, 1); }
}

/* ===================== DOKUMEN BARU ===================== */
function blank(silent) {
  COLS = COLS_DEF(); ROWS = [ROW_DEF()]; TERMIN = []; paymode = 'full';
  mode = 'klien'; pmode = 'gal'; dt = dt || 'quot';
  CUR = { id: null, no: '', noPending: false, kind: dt, by: null };
  SET('f_klien', ''); SET('f_pic', ''); SET('f_ref', '');
  SET('f_tgl', today()); SET('f_valid', plus(today(), 14)); SET('f_due', plus(today(), 30));
  SET('f_no', '— diambil saat disimpan —');
  SET('f_intro', dt === 'inv'
    ? 'Please find below our invoice for the goods delivered. We appreciate your business.'
    : 'Thank you for your interest in our quotation. We sincerely appreciate the opportunity to work with you. In response to your request, here is our best offer:');
  SET('f_other', 0); SET('f_otherlbl', 'Other'); SET('f_taxp', 0); SET('f_taxlbl', 'PPN'); SET('f_round', '0');
  document.querySelectorAll('.seg button[data-mode]').forEach(x => x.classList.toggle('on', x.dataset.mode === 'klien'));
  document.querySelectorAll('#pmode button').forEach(x => x.classList.toggle('on', x.dataset.pm === 'gal'));
  document.querySelectorAll('#paymode button').forEach(x => x.classList.toggle('on', x.dataset.py === 'full'));
  dirty = false; clearDraft(); draw();
  if (!silent) toast('Dokumen baru. Yang lama tetap aman di riwayat.');
}
$('b_blank').onclick = () => {
  if (dirty && !confirm('Perubahan yang belum disimpan akan hilang. Lanjut bikin dokumen baru?')) return;
  blank();
};

/* ===================== DOC TYPE ===================== */
document.querySelectorAll('#doctype button').forEach(b => b.onclick = () => {
  if (b.dataset.dt === dt) return;
  if (dirty && !confirm('Pindah ke ' + (b.dataset.dt === 'inv' ? 'Invoice' : 'Quotation') + '? Perubahan yang belum disimpan akan hilang.')) return;
  document.querySelectorAll('#doctype button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); dt = b.dataset.dt;
  blank(true); drawHist();
});
function dtUI() {
  const inv = dt === 'inv';
  $('card_termin').style.display = inv ? '' : 'none';
  $('box_valid').style.display = inv ? 'none' : 'block';
  $('box_due').style.display = inv ? 'block' : 'none';
  $('box_ref').style.display = inv ? 'block' : 'none';
  $('b_toinv').style.display = (!inv && CUR.id) ? '' : 'none';
}

/* ===================== KOLOM ===================== */
function drawCols() {
  const b = $('cols'); b.innerHTML = '';
  COLS.forEach((c, i) => {
    if (c.int && mode !== 'internal') return;
    const d = document.createElement('div');
    d.className = 'ci' + (c.on ? ' on' : '') + (c.lk ? ' lk' : '');
    d.innerHTML = `<div class="sw" data-i="${i}"></div><span class="nm">${es(c.nm)}</span>
     ${c.lk ? '<span class="badge">WAJIB</span>' : c.int ? '<span class="badge int">INTERNAL</span>' : c.cu ? `<button class="x" data-d="${i}">✕</button>` : '<span class="badge">OPSIONAL</span>'}`;
    b.appendChild(d);
  });
  b.querySelectorAll('.sw[data-i]').forEach(s => s.onclick = () => {
    const c = COLS[+s.dataset.i]; if (c.lk) return; c.on = !c.on; dirty = true; draw();
  });
  b.querySelectorAll('.x[data-d]').forEach(x => x.onclick = () => {
    const i = +x.dataset.d, k = COLS[i].k;
    COLS.splice(i, 1); ROWS.forEach(r => delete r.extra[k]); dirty = true; draw();
  });
  $('cc').textContent = vis().length + ' aktif';
}
$('b_addcol').onclick = () => {
  const el = $('newcol'), nm = el.value.trim(); if (!nm) return;
  const k = 'x' + Date.now();
  COLS.splice(COLS.length - 2, 0, { k, nm, on: 1, lk: 0, w: '86px', al: 'ctr', cu: 1 });
  ROWS.forEach(r => r.extra[k] = ''); el.value = ''; dirty = true; draw();
};

/* ===================== TEMA / BRAND ===================== */
function drawThemes() {
  const b = $('ths'); b.innerHTML = '';
  THEMES.forEach(t => {
    const d = document.createElement('div'); d.className = 'th' + (theme === t.k ? ' on' : '');
    d.innerHTML = `<div class="pv" style="background:${t.b}"><div class="bar" style="background:${t.a};width:58%"></div>
     <div class="ln" style="width:88%"></div><div class="ln" style="width:72%"></div>
     <div class="bar" style="background:${t.a};width:34%;opacity:.45;margin-top:2px"></div></div>
     <div class="lb"><b>${t.nm}</b><small>${t.d}</small></div>`;
    d.onclick = () => { theme = t.k; dirty = true; draw(); };
    b.appendChild(d);
  });
}
function drawBrand() {
  $('logobox').innerHTML = LOGO
    ? `<div class="prev"><img src="${LOGO}"><div class="mt">Logo terpasang</div><button class="x" id="xlogo">✕</button></div>`
    : `<div class="up"><div class="ic">🏷️</div><b>Unggah logo</b><small>PNG latar transparan paling rapi</small><input type="file" accept="image/*" id="iLogo"></div>`;
  $('ttdbox').innerHTML = TTD
    ? `<div class="prev"><img src="${TTD}"><div class="mt">Tanda tangan terpasang</div><button class="x" id="xttd">✕</button></div>`
    : `<div class="up"><div class="ic">✍️</div><b>Unggah tanda tangan</b><small>foto tanda tangan di kertas putih juga bisa</small><input type="file" accept="image/*" id="iTtd"></div>`;
  const a = $('iLogo'), c = $('iTtd');
  if (a) a.onchange = async e => { const f = e.target.files[0]; if (!f) return; try { LOGO = await compress(f, 700, 55); draw(); saveBrand(); } catch (x) { toast('Foto tidak bisa dibaca.', 1); } };
  if (c) c.onchange = async e => { const f = e.target.files[0]; if (!f) return; try { TTD = await compress(f, 700, 45); draw(); saveBrand(); } catch (x) { toast('Foto tidak bisa dibaca.', 1); } };
  const xl = $('xlogo'), xt = $('xttd');
  if (xl) xl.onclick = () => { LOGO = ''; draw(); saveBrand(); };
  if (xt) xt.onclick = () => { TTD = ''; draw(); saveBrand(); };
}

/* ===================== BARIS BARANG ===================== */
function drawRows() {
  const b = $('rows'); b.innerHTML = '';
  const act = vis().filter(c => !['no', 'amount'].includes(c.k));
  ROWS.forEach((r, i) => {
    let h = `<div style="border:1.5px solid var(--bd);border-radius:12px;padding:12px;margin-bottom:10px;background:#fcfdff">
     <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
     <b style="font-size:10.5px;color:var(--mut);letter-spacing:.5px">BARANG ${i + 1} · ${rp(lineAmt(r))}</b>
     <button class="x" data-del="${i}">✕</button></div>`;
    if (pmode !== 'off') {
      h += `<div class="slotwrap"><div class="slot" style="--ar:${AR()}">
       ${r.img ? `<img src="${r.img}">` : '<div class="ph">klik untuk<br>unggah foto</div>'}
       <input type="file" accept="image/*" data-img="${i}"></div>
       <div class="hint"><b style="color:var(--ink);font-size:11px">Slot foto ${AR().replace('/', ' : ')}</b><br>
       Fotonya dipotong otomatis ke rasio ini. Mau foto HP atau tangkapan layar, hasilnya tetap senada.
       ${r.img ? `<br><button class="x" style="padding:0" data-noimg="${i}">hapus foto</button>` : ''}</div></div>`;
    }
    act.forEach(c => {
      const v = c.cu ? (r.extra[c.k] || '') : (r[c.k] == null ? '' : r[c.k]);
      const t = ['qty', 'price', 'modal'].includes(c.k) ? 'number' : 'text';
      h += `<label class="f"><span>${es(c.nm)}</span><input type="${t}" value="${es(v)}" data-r="${i}" data-k="${c.k}" data-c="${c.cu ? 1 : 0}"></label>`;
    });
    b.insertAdjacentHTML('beforeend', h + '</div>');
  });
  b.querySelectorAll('input[data-r]').forEach(p => p.oninput = e => {
    const r = ROWS[+e.target.dataset.r], k = e.target.dataset.k;
    const v = ['qty', 'price', 'modal'].includes(k) ? (Number(e.target.value) || 0) : e.target.value;
    if (e.target.dataset.c === '1') r.extra[k] = v; else r[k] = v;
    dirty = true; paper(); calcBox(); drawTermin();
  });
  b.querySelectorAll('input[data-img]').forEach(p => p.onchange = async e => {
    const i = +e.target.dataset.img, f = e.target.files[0]; if (!f) return;
    try { ROWS[i].img = await compress(f); dirty = true; draw(); }
    catch (x) { toast('Foto tidak bisa dibaca.', 1); }
  });
  b.querySelectorAll('[data-del]').forEach(x => x.onclick = () => {
    if (ROWS.length === 1) { ROWS[0] = ROW_DEF(); } else { ROWS.splice(+x.dataset.del, 1); }
    dirty = true; draw();
  });
  b.querySelectorAll('[data-noimg]').forEach(x => x.onclick = () => { ROWS[+x.dataset.noimg].img = ''; dirty = true; draw(); });
  $('rc').textContent = ROWS.length + ' barang';
  $('pc').textContent = pmode === 'off' ? 'mati' : ROWS.filter(r => r.img).length + '/' + ROWS.length + ' terisi';
  const kb = Math.round(bytesOf() / 1024);
  const el = $('imgsize');
  el.className = 'note' + (kb > 820 ? ' warn' : '');
  el.textContent = kb > 820
    ? 'Ukuran dokumen ' + kb + ' KB — sudah mendekati batas 1.000 KB per dokumen. Kurangi beberapa foto supaya bisa disimpan.'
    : 'Ukuran dokumen sekarang ' + kb + ' KB dari batas 1.000 KB.';
}
$('b_addrow').onclick = () => { ROWS.push(ROW_DEF()); dirty = true; draw(); };

/* ===================== TERMIN ===================== */
function drawTermin() {
  if (dt !== 'inv') return;
  const c = calc();
  $('terminadd').style.display = paymode === 'cust' ? 'block' : 'none';
  const box = $('terminbox');
  if (paymode === 'full') {
    box.innerHTML = `<div class="sumbar good"><span>Lunas 100% — satu kali bayar</span><span>${rp(c.total)}</span></div>`;
    $('terminsum').innerHTML = '';
    $('trc').textContent = 'lunas';
    return;
  }
  if (!TERMIN.length) TERMIN = [{ lbl: 'Down Payment', pct: 50, due: V('f_due') }, { lbl: 'Pelunasan', pct: 50, due: '' }];
  box.innerHTML = TERMIN.map((t, i) => `<div class="tm">
    <input value="${es(t.lbl)}" data-tl="${i}" placeholder="Nama termin">
    <input type="number" value="${t.pct}" data-tp="${i}" step="0.01" min="0" placeholder="%">
    <div class="cal">${rp((c.tms[i] || {}).amt || 0)}</div>
    <button class="x" data-tx="${i}">✕</button>
    </div><label class="f" style="margin:-2px 0 12px"><span>Jatuh tempo termin ${i + 1}</span><input type="date" value="${es(t.due || '')}" data-td="${i}"></label>`).join('');
  box.querySelectorAll('[data-tl]').forEach(e => e.oninput = ev => { TERMIN[+ev.target.dataset.tl].lbl = ev.target.value; dirty = true; paper(); });
  box.querySelectorAll('[data-tp]').forEach(e => e.oninput = ev => { TERMIN[+ev.target.dataset.tp].pct = Number(ev.target.value) || 0; dirty = true; drawTermin(); paper(); });
  box.querySelectorAll('[data-td]').forEach(e => e.onchange = ev => { TERMIN[+ev.target.dataset.td].due = ev.target.value; dirty = true; paper(); });
  box.querySelectorAll('[data-tx]').forEach(e => e.onclick = ev => {
    if (TERMIN.length <= 1) return toast('Minimal satu termin.', 1);
    TERMIN.splice(+ev.target.dataset.tx, 1); dirty = true; drawTermin(); paper();
  });
  const ok = Math.abs(c.pctSum - 100) < 0.005;
  $('terminsum').innerHTML = `<div class="sumbar ${ok ? 'good' : 'bad'}">
    <span>Jumlah persen: ${(Math.round(c.pctSum * 100) / 100)}%${ok ? ' — pas' : ' — harus 100%'}</span>
    <span>${rp(c.tms.reduce((a, t) => a + t.amt, 0))}</span></div>`;
  $('trc').textContent = TERMIN.length + ' termin';
}
document.querySelectorAll('#paymode button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#paymode button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); paymode = b.dataset.py; dirty = true; drawTermin(); paper();
});
$('b_addtm').onclick = () => { TERMIN.push({ lbl: 'Termin ' + (TERMIN.length + 1), pct: 0, due: '' }); dirty = true; drawTermin(); paper(); };
$('b_tm5050').onclick = () => { TERMIN = [{ lbl: 'Down Payment 50%', pct: 50, due: V('f_due') }, { lbl: 'Pelunasan 50%', pct: 50, due: '' }]; dirty = true; drawTermin(); paper(); };
$('b_tm304030').onclick = () => { TERMIN = [{ lbl: 'Down Payment 30%', pct: 30, due: V('f_due') }, { lbl: 'Progress 40%', pct: 40, due: '' }, { lbl: 'Pelunasan 30%', pct: 30, due: '' }]; dirty = true; drawTermin(); paper(); };

/* ===================== KOTAK HITUNGAN ===================== */
function calcBox() {
  const c = calc();
  const L = (a, b, w) => `<div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12.5px${w ? ';font-weight:800' : ''}"><span style="color:${w ? 'var(--ink)' : 'var(--mut)'}">${a}</span><span style="font-weight:700">${b}</span></div>`;
  let h = L('Jumlah ' + ROWS.length + ' baris barang', rp(c.subtotal));
  if (c.other) h += L(es(V('f_otherlbl') || 'Other'), rp(c.other));
  if (c.roundAdj) h += L('Pembulatan', (c.roundAdj > 0 ? '+ ' : '') + rp(c.roundAdj));
  if (c.tax) h += L(es(V('f_taxlbl') || 'Pajak') + ' ' + c.taxPct + '%', rp(c.tax));
  h += '<div style="height:1px;background:var(--bd);margin:5px 0"></div>' + L('TOTAL', rp(c.total), 1);
  $('calcbox').innerHTML = h;
  $('tc').textContent = rp(c.total);
}

/* ===================== KERTAS ===================== */
function paper() {
  const c = calc(), act = vis(), ar = AR();
  const adaFoto = ROWS.some(r => r.img);
  const inTab = pmode === 'tab' && adaFoto;
  const inv = dt === 'inv';

  let th = (inTab ? '<th class="ctr" style="width:62px">Foto</th>' : '')
    + act.map(x => `<th class="${x.al}" style="width:${x.w}">${es(x.nm)}</th>`).join('');
  const tb = ROWS.map((r, i) => {
    let cells = inTab ? `<td class="pic">${r.img ? `<div class="fr" style="--ar:${ar}"><img src="${r.img}"></div>` : ''}</td>` : '';
    cells += act.map(x => {
      let v = '';
      if (x.k === 'no') v = i + 1;
      else if (x.k === 'amount') v = rp(c.items[i]);
      else if (x.k === 'price') v = rp(r.price);
      else if (x.k === 'modal') v = rp(r.modal);
      else if (x.k === 'margin') v = r.price ? Math.round((1 - (Number(r.modal) || 0) / Number(r.price)) * 100) + '%' : '—';
      else v = x.cu ? es(r.extra[x.k] || '') : es(r[x.k]);
      return `<td class="${x.al}">${v === '' || v == null ? '&nbsp;' : v}</td>`;
    }).join('');
    return '<tr>' + cells + '</tr>';
  }).join('');

  let gal = '';
  if (pmode === 'gal' && adaFoto) {
    gal = `<div class="gal"><h4>Product Reference</h4><div class="gg" style="--gc:${V('gc') || 3}">`
      + ROWS.map((r, i) => r.img ? `<div class="gi"><div class="fr" style="--ar:${ar}"><img src="${r.img}"></div>
        <div class="cap"><b>${i + 1}. ${es(r.desc) || '—'}</b>${r.pn ? 'P/N ' + es(r.pn) : ''}${r.pn && r.maker ? ' · ' : ''}${es(r.maker)}</div></div>` : '').join('')
      + '</div></div>';
  }

  let sumrows = `<tr><td>Subtotal</td><td>${rp(c.subtotal)}</td></tr>`;
  if (c.other) sumrows += `<tr><td>${es(V('f_otherlbl') || 'Other')}</td><td>${rp(c.other)}</td></tr>`;
  if (c.roundAdj) sumrows += `<tr><td>Round-off</td><td>${(c.roundAdj > 0 ? '+ ' : '') + rp(c.roundAdj)}</td></tr>`;
  if (c.tax) sumrows += `<tr><td>${es(V('f_taxlbl') || 'Pajak')} ${c.taxPct}%</td><td>${rp(c.tax)}</td></tr>`;
  sumrows += `<tr class="tt"><td>TOTAL</td><td>${rp(c.total)}</td></tr>`;

  let trm = '';
  if (inv) {
    trm = `<table class="trm"><thead><tr><th style="width:36px">No</th><th>Payment Schedule</th><th class="ctr" style="width:70px">Portion</th><th class="ctr" style="width:110px">Due Date</th><th class="num" style="width:120px">Amount</th></tr></thead><tbody>`
      + c.tms.map((t, i) => `<tr><td class="ctr">${i + 1}</td><td>${es(t.lbl)}</td><td class="ctr">${t.pct}%</td><td class="ctr">${tgl(t.due) || '—'}</td><td class="num">${rp(t.amt)}</td></tr>`).join('')
      + `<tr class="tt"><td></td><td>TOTAL TAGIHAN</td><td class="ctr">${Math.round(c.pctSum * 100) / 100}%</td><td></td><td class="num">${rp(c.tms.reduce((a, t) => a + t.amt, 0))}</td></tr>`
      + `</tbody></table>`;
  }

  const lh = V('logoh') || 46, fun = isFun(theme);
  const P = $('paper');
  P.className = 'paper ' + theme + (fun ? ' fun' : '');
  P.innerHTML = `
  ${mode === 'internal' ? '<div class="wm">● SALINAN INTERNAL — jangan dikirim ke klien</div>' : ''}
  <div class="kop">
    <div class="lf">
      ${LOGO ? `<img src="${LOGO}" style="height:${lh}px">` : ''}
      <div><h2>${es(V('f_nama'))}</h2><p>${es(V('f_alamat'))}<br>${es(V('f_telp'))} &nbsp;·&nbsp; ${es(V('f_email'))}</p></div>
    </div>
    <div class="qn"><em>${inv ? 'INVOICE NO.' : 'QUOTE NO.'}</em><b>${es(V('f_no'))}</b><i>${tgl(V('f_tgl'))}</i></div>
  </div>
  <div class="bigt">${inv ? 'INVOICE' : 'QUOTATION'}</div>
  <div class="meta">
    <div><em>TO</em><b>${es(V('f_klien'))}</b>${V('f_pic') ? '<br>Attn: ' + es(V('f_pic')) : ''}</div>
    <div style="text-align:right"><em>${inv ? 'PAYMENT DUE' : 'VALID UNTIL'}</em>${tgl(inv ? V('f_due') : V('f_valid'))}
    ${inv && V('f_ref') ? `<em style="margin-top:7px">REF. QUOTATION</em>${es(V('f_ref'))}` : ''}</div>
  </div>
  <p class="intro">${es(V('f_intro'))}</p>
  <table class="it"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>
  <table class="sum">${sumrows}</table>
  ${trm}
  ${gal}
  <div class="terms">
   <div><h4>${inv ? 'Delivery' : 'Delivery Terms'}</h4>${es(V('f_deliv'))}
        <h4 style="margin-top:14px">Payment Terms</h4>${es(V('f_pay'))}</div>
   <div><h4>Bank Details</h4><div class="bk">
     <i>Bank</i><div>${es(V('f_bank')) || '—'}</div>
     <i>Account Name</i><div>${es(V('f_bankname')) || '—'}</div>
     <i>Account No.</i><div>${es(V('f_bankno')) || '—'}</div>
     <i>Currency</i><div>${es(V('f_cur')) || '—'}</div>
     <i>BIC / SWIFT</i><div>${es(V('f_swift')) || '—'}</div>
   </div></div>
  </div>
  <div class="sign">${inv ? 'ISSUED BY' : 'SIGN BELOW TO ACCEPT QUOTE'}
    <div class="sbox">${TTD ? `<img src="${TTD}">` : ''}</div>
    <div class="ln"></div><b>${es(V('f_signer'))}</b></div>`;
}

/* ===================== SIMPAN ===================== */
function payload() {
  return {
    cols: COLS, rows: ROWS, termin: TERMIN, paymode, theme, mode, pmode, kind: dt,
    ar: V('ar'), gc: V('gc'), logoh: V('logoh'),
    info: {
      klien: V('f_klien'), pic: V('f_pic'), no: V('f_no'), tgl: V('f_tgl'),
      valid: V('f_valid'), due: V('f_due'), ref: V('f_ref'), intro: V('f_intro'),
      round: V('f_round'), other: V('f_other'), otherlbl: V('f_otherlbl'),
      taxp: V('f_taxp'), taxlbl: V('f_taxlbl'),
      nama: V('f_nama'), alamat: V('f_alamat'), telp: V('f_telp'), email: V('f_email'),
      deliv: V('f_deliv'), pay: V('f_pay'), bank: V('f_bank'), cur: V('f_cur'),
      bankname: V('f_bankname'), bankno: V('f_bankno'), swift: V('f_swift'), signer: V('f_signer')
    }
  };
}
function load(p) {
  COLS = (p.cols && p.cols.length) ? p.cols : COLS_DEF();
  ROWS = (p.rows && p.rows.length) ? p.rows.map(r => Object.assign(ROW_DEF(), r, { extra: r.extra || {} })) : [ROW_DEF()];
  TERMIN = p.termin || []; paymode = p.paymode || 'full';
  theme = p.theme || 't-ocean'; mode = p.mode || 'klien'; pmode = p.pmode || 'gal';
  dt = p.kind || 'quot';
  SET('ar', p.ar || '4/3'); SET('gc', p.gc || '3'); SET('logoh', p.logoh || '46');
  const i = p.info || {};
  ['klien', 'pic', 'no', 'tgl', 'valid', 'due', 'ref', 'intro', 'round', 'other', 'otherlbl', 'taxp', 'taxlbl',
    'nama', 'alamat', 'telp', 'email', 'deliv', 'pay', 'bank', 'cur', 'bankname', 'bankno', 'swift', 'signer']
    .forEach(k => SET('f_' + k, i[k]));
  document.querySelectorAll('#doctype button').forEach(x => x.classList.toggle('on', x.dataset.dt === dt));
  document.querySelectorAll('.seg button[data-mode]').forEach(x => x.classList.toggle('on', x.dataset.mode === mode));
  document.querySelectorAll('#pmode button').forEach(x => x.classList.toggle('on', x.dataset.pm === pmode));
  document.querySelectorAll('#paymode button').forEach(x => x.classList.toggle('on', x.dataset.py === paymode));
}

async function save(asNew) {
  if (!ME) return;
  const kb = bytesOf() / 1024;
  if (kb > 900) return toast('Dokumen ' + Math.round(kb) + ' KB, batasnya 1.000 KB. Kurangi atau hapus beberapa foto dulu.', 1);
  const c = calc();
  if (dt === 'inv' && paymode === 'cust' && Math.abs(c.pctSum - 100) >= 0.005)
    return toast('Jumlah persen termin ' + (Math.round(c.pctSum * 100) / 100) + '%, harus pas 100% sebelum disimpan.', 1);
  if (!V('f_klien').trim()) return toast('Kolom "Kepada" masih kosong.', 1);

  $('b_save').disabled = true; $('b_save').textContent = 'Menyimpan…';
  try {
    const isNew = asNew || !CUR.id;
    const id = isNew ? (doc(collection(db, 'companies', CID, 'docs')).id) : CUR.id;
    let no = CUR.no, pend = CUR.noPending;
    if (isNew || !no || pend) {
      const got = await allocNo(dt === 'inv' ? 'invoice' : 'quotation', V('f_tgl'));
      if (got) { no = got; pend = false; }
      else if (!no) { no = 'MENUNGGU NOMOR'; pend = true; }
    }
    SET('f_no', no);
    const by = isNew ? { uid: ME.uid, name: ME.name, email: ME.email } : (CUR.by || { uid: ME.uid, name: ME.name, email: ME.email });
    const at = isNew ? new Date().toISOString() : (CUR.at || new Date().toISOString());

    const p = payload(); p.info.no = no;
    await setDoc(doc(db, 'companies', CID, 'payloads', id), { data: p, updatedAt: serverTimestamp() });
    await setDoc(doc(db, 'companies', CID, 'docs', id), {
      id, no, noPending: pend, kind: dt, status: 'aktif',
      klien: V('f_klien'), pic: V('f_pic'), tgl: V('f_tgl'),
      total: c.total, rowCount: ROWS.length, theme,
      createdByUid: by.uid, createdByName: by.name, createdByEmail: by.email, at,
      editedByName: ME.name, editedByEmail: ME.email, editedAt: new Date().toISOString(),
      serverAt: serverTimestamp()
    });
    CUR = { id, no, noPending: pend, kind: dt, by, at };
    dirty = false; clearDraft(); saveState();
    $('b_new').style.display = ''; $('b_arsip').style.display = '';
    toast(navigator.onLine
      ? (pend ? 'Tersimpan. Nomor resmi diambil begitu internet nyala.' : 'Tersimpan — rekan di laptop lain langsung melihatnya.')
      : 'Tersimpan di perangkat ini. Terkirim sendiri begitu internet nyala.');
  } catch (e) {
    toast('Gagal menyimpan: ' + (e.message || e), 1);
  }
  $('b_save').disabled = false; $('b_save').textContent = CUR.id ? 'Simpan perubahan' : 'Simpan ke riwayat bersama';
}
$('b_save').onclick = () => save(false);
$('b_new').onclick = () => save(true);
$('b_arsip').onclick = async () => {
  if (!CUR.id) return;
  if (!confirm('Pindahkan ' + CUR.no + ' ke arsip? Dokumennya tidak dihapus, hanya disembunyikan dari daftar utama.')) return;
  try {
    await setDoc(doc(db, 'companies', CID, 'docs', CUR.id), { status: 'arsip', editedByName: ME.name, editedAt: new Date().toISOString() }, { merge: true });
    toast('Dipindahkan ke arsip.'); blank(true);
  } catch (e) { toast('Gagal: ' + e.message, 1); }
};
function saveState() {
  dtUI();
  $('b_save').textContent = CUR.id ? 'Simpan perubahan' : 'Simpan ke riwayat bersama';
  $('savestate').textContent = CUR.id
    ? 'Sedang membuka ' + CUR.no + (CUR.by ? ' — dibuat oleh ' + CUR.by.name : '') + '. "Simpan perubahan" menimpa dokumen ini; "Simpan sebagai dokumen baru" membuat nomor baru dan tidak mengubah yang ini.'
    : 'Dokumen baru, belum tersimpan.';
}

/* ===================== RIWAYAT ===================== */
let unsubHist = null;
function watchHist() {
  if (unsubHist) unsubHist();
  const q = query(collection(db, 'companies', CID, 'docs'), orderBy('at', 'desc'), limit(300));
  unsubHist = onSnapshot(q, s => { HIST = s.docs.map(d => d.data()); drawHist(); }, e => {
    $('hist').innerHTML = '<p class="note">Riwayat belum bisa dibaca: ' + es(e.message) + '</p>';
  });
}
function drawHist() {
  const qq = (V('hq') || '').toLowerCase();
  const list = HIST.filter(h => {
    if (hfilter === 'arsip') { if (h.status !== 'arsip') return false; }
    else {
      if (h.status === 'arsip') return false;
      if (hfilter !== 'all' && (h.kind || 'quot') !== hfilter) return false;
    }
    if (!qq) return true;
    return [h.no, h.klien, h.createdByName, h.createdByEmail, h.pic].some(x => String(x || '').toLowerCase().includes(qq));
  });
  const nq = list.filter(h => (h.kind || 'quot') === 'quot').length, ni = list.length - nq;
  $('hcnt').textContent = hfilter === 'all'
    ? nq + ' quotation · ' + ni + ' invoice'
    : list.length + ' dokumen';
  $('hist').innerHTML = list.length ? list.map(h => `<div class="hi2${CUR.id === h.id ? ' cur' : ''}" data-o="${h.id}">
    <div><div class="no"><span class="tp ${h.status === 'arsip' ? 'a' : (h.kind || 'quot') === 'inv' ? 'i' : 'q'}">${h.status === 'arsip' ? 'ARSIP' : (h.kind || 'quot') === 'inv' ? 'INVOICE' : 'QUOTATION'}</span>${es(h.no)}${h.noPending ? ' <span class="tp w">NOMOR MENUNGGU</span>' : ''}</div>
    <div class="who">${es(h.klien || '—')}</div>
    <div class="who">${es(h.createdByName)} · ${es(h.createdByEmail)}</div>
    <div class="who">${tgl(h.tgl)}</div></div>
    <div class="amt">${rp(h.total)}<small>${h.rowCount || 0} baris</small></div></div>`).join('')
    : '<p class="note">Belum ada dokumen di daftar ini.</p>';
  $('hist').querySelectorAll('[data-o]').forEach(e => e.onclick = () => open(e.dataset.o));
}
$('hq').oninput = drawHist;
document.querySelectorAll('#hfilter button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#hfilter button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); hfilter = b.dataset.hf; drawHist();
});
async function open(id) {
  if (dirty && !confirm('Perubahan yang belum disimpan akan hilang. Buka dokumen ini?')) return;
  const h = HIST.find(x => x.id === id); if (!h) return;
  try {
    const s = await getDoc(doc(db, 'companies', CID, 'payloads', id));
    if (!s.exists()) return toast('Isi dokumen belum tersedia di perangkat ini. Sambungkan internet lalu coba lagi.', 1);
    load(s.data().data || {});
    CUR = { id, no: h.no, noPending: !!h.noPending, kind: h.kind || 'quot', at: h.at, by: { uid: h.createdByUid, name: h.createdByName, email: h.createdByEmail } };
    dt = CUR.kind;
    dirty = false; draw(); saveState();
    $('b_new').style.display = ''; $('b_arsip').style.display = '';
    toast('Dibuka: ' + h.no);
  } catch (e) { toast('Gagal membuka: ' + e.message, 1); }
}

/* Nomor yang tertunda karena dibuat saat offline. */
async function claimPending() {
  if (!navigator.onLine) return;
  try {
    const s = await getDocs(query(collection(db, 'companies', CID, 'docs'), where('noPending', '==', true), limit(20)));
    for (const d of s.docs) {
      const h = d.data();
      const no = await allocNo((h.kind || 'quot') === 'inv' ? 'invoice' : 'quotation', h.tgl);
      if (!no) continue;
      await setDoc(doc(db, 'companies', CID, 'docs', h.id), { no, noPending: false }, { merge: true });
      const ps = await getDoc(doc(db, 'companies', CID, 'payloads', h.id));
      if (ps.exists()) {
        const p = ps.data().data || {}; if (p.info) p.info.no = no;
        await setDoc(doc(db, 'companies', CID, 'payloads', h.id), { data: p, updatedAt: serverTimestamp() }, { merge: true });
      }
      if (CUR.id === h.id) { CUR.no = no; CUR.noPending = false; SET('f_no', no); paper(); saveState(); }
    }
  } catch (e) { /* diam saja — akan dicoba lagi saat online berikutnya */ }
}

/* ===================== CSV ===================== */
$('b_csv').onclick = () => {
  const c = calc(), act = vis();
  const L = a => a.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',');
  const o = [
    L([dt === 'inv' ? 'INVOICE' : 'QUOTATION', V('f_no')]),
    L(['Kepada', V('f_klien')]), L(['PIC', V('f_pic')]), L(['Tanggal', V('f_tgl')]), L([]),
    L(act.map(x => x.nm))
  ];
  ROWS.forEach((r, i) => o.push(L(act.map(x =>
    x.k === 'no' ? i + 1 :
      x.k === 'amount' ? c.items[i] :
        x.k === 'margin' ? (r.price ? Math.round((1 - (Number(r.modal) || 0) / Number(r.price)) * 100) + '%' : '') :
          (x.cu ? (r.extra[x.k] || '') : (r[x.k] == null ? '' : r[x.k]))))));
  o.push(L([]));
  o.push(L(['Subtotal', c.subtotal]));
  if (c.other) o.push(L([V('f_otherlbl') || 'Other', c.other]));
  if (c.roundAdj) o.push(L(['Round-off', c.roundAdj]));
  if (c.tax) o.push(L([(V('f_taxlbl') || 'Pajak') + ' ' + c.taxPct + '%', c.tax]));
  o.push(L(['TOTAL', c.total]));
  if (dt === 'inv') { o.push(L([])); o.push(L(['Termin', 'Persen', 'Jatuh tempo', 'Nominal'])); c.tms.forEach(t => o.push(L([t.lbl, t.pct + '%', t.due, t.amt]))); }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + o.join('\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = (V('f_no') || 'dokumen').replace(/[^\w]+/g, '-') + '.csv';
  a.click();
};
$('b_print').onclick = () => window.print();

/* ===================== PDF =====================
   Dibuat aplikasi sendiri, bukan lewat dialog cetak browser.
   Alasannya: dialog cetak menempelkan tanggal, judul tab, dan alamat
   berkas di pinggir halaman, dan secara bawaan membuang semua warna
   latar — jadi hasilnya beda dari yang terlihat di layar.            */
/* Lebar kertas A4 dikurangi margin kiri-kanan, dalam piksel layar (96 dpi).
   Salinan untuk PDF harus dibuat persis selebar ini. Kalau dibiarkan selebar
   tampilan layar (880 px), sisi kanannya terpotong di PDF. */
const PDF_MM = { w: 210, ml: 9, mr: 9, mt: 10, mb: 10 };
const PDF_PX = Math.round((PDF_MM.w - PDF_MM.ml - PDF_MM.mr) * 96 / 25.4);

$('b_pdf').onclick = async () => {
  if (typeof html2pdf === 'undefined')
    return toast('Pembuat PDF belum termuat. Sambungkan internet sekali, setelah itu bisa dipakai offline.', 1);
  const btn = $('b_pdf'); btn.disabled = true; btn.textContent = 'Membuat PDF…';
  const src = $('paper');
  const sw = src.getBoundingClientRect().width || 880;
  const k = PDF_PX / sw;
  const bgEl = getComputedStyle(src).backgroundColor;

  const clone = src.cloneNode(true);
  clone.style.cssText += ';width:' + PDF_PX + 'px;max-width:none;margin:0;box-shadow:none;min-height:0;padding:26px 28px';
  const hold = document.createElement('div');
  hold.style.cssText = 'position:fixed;left:0;top:0;width:' + PDF_PX + 'px;z-index:-1;opacity:0;pointer-events:none';
  hold.appendChild(clone); document.body.appendChild(hold);

  // aspect-ratio tidak dipahami mesin penggambar — ubah jadi tinggi tetap,
  // diukur dari elemen asli yang sedang tampil lalu dikecilkan sesuai skala.
  const oF = [...src.querySelectorAll('.fr')], cF = [...clone.querySelectorAll('.fr')];
  oF.forEach((o, i) => {
    const r = o.getBoundingClientRect();
    if (cF[i] && r.height) { cF[i].style.height = Math.round(r.height * k) + 'px'; cF[i].style.aspectRatio = 'auto'; }
  });
  clone.querySelectorAll('tr,.gi,.terms>div,.sign,.gal,table.sum,table.trm').forEach(e => e.style.pageBreakInside = 'avoid');

  const nama = (V('f_no') || (dt === 'inv' ? 'invoice' : 'quotation')).replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'dokumen';
  try {
    const wk = html2pdf().set({
      margin: [PDF_MM.mt, PDF_MM.mr, PDF_MM.mb, PDF_MM.ml],
      filename: nama + '.pdf',
      image: { type: 'jpeg', quality: 0.96 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: bgEl || '#ffffff', logging: false },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
      pagebreak: { mode: ['css', 'legacy'] }
    }).from(clone);
    await wk.toPdf();
    const pdf = wk.prop.pdf;
    showPreview(pdf, nama);
  } catch (e) {
    toast('Gagal membuat PDF: ' + (e.message || e) + ' — pakai tombol Cetak lewat browser.', 1);
  }
  hold.remove(); btn.disabled = false; btn.textContent = 'Download PDF';
};

/* Intip dulu sebelum tersimpan — tidak langsung mengunduh. */
let PVURL = '', PVPDF = null, PVNAME = '';
function showPreview(pdf, nama) {
  if (PVURL) { try { URL.revokeObjectURL(PVURL); } catch (e) { } }
  PVPDF = pdf; PVNAME = nama;
  const blob = pdf.output('blob');
  PVURL = URL.createObjectURL(blob);
  const n = pdf.internal.getNumberOfPages();
  $('pvname').textContent = nama + '.pdf';
  $('pvinfo').textContent = n + ' halaman · ' + Math.round(blob.size / 1024) + ' KB · belum tersimpan';
  $('pvframe').src = PVURL;
  $('pv').classList.add('on');
}
function hidePreview() {
  $('pv').classList.remove('on'); $('pvframe').src = 'about:blank';
  if (PVURL) { try { URL.revokeObjectURL(PVURL); } catch (e) { } PVURL = ''; }
  PVPDF = null;
}
$('pv_close').onclick = hidePreview;
$('pv_save').onclick = () => {
  if (!PVPDF) return;
  PVPDF.save(PVNAME + '.pdf');
  toast('Tersimpan: ' + PVNAME + '.pdf');
  hidePreview();
};
addEventListener('keydown', e => { if (e.key === 'Escape' && $('pv').classList.contains('on')) hidePreview(); });

/* ===================== QUOTATION -> INVOICE ===================== */
$('b_toinv').onclick = () => {
  if (dt !== 'quot') return;
  const ref = V('f_no'), p = payload();
  p.kind = 'inv';
  p.info.ref = ref;
  p.info.no = '— diambil saat disimpan —';
  p.info.due = plus(today(), 30);
  p.info.tgl = today();
  p.info.intro = 'Please find below our invoice for the goods delivered. We appreciate your business.';
  p.paymode = 'full'; p.termin = [];
  CUR = { id: null, no: '', noPending: false, kind: 'inv', by: null };
  load(p); dt = 'inv'; hfilter = 'all';
  dirty = true; draw(); saveState(); drawHist();
  $('b_new').style.display = 'none'; $('b_arsip').style.display = 'none';
  toast('Invoice baru dibuat dari ' + ref + '. Quotation aslinya tidak berubah.');
};

/* ===================== STATUS SINKRON ===================== */
function sync() {
  const p = $('syncpill');
  if (navigator.onLine) { p.className = 'pill'; p.innerHTML = '<span class="dot"></span> Tersinkron'; }
  else { p.className = 'pill off'; p.innerHTML = '<span class="dot"></span> Offline — tersimpan di perangkat'; }
}
addEventListener('online', () => { sync(); claimPending(); });
addEventListener('offline', sync);
addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

/* ===================== GAMBAR ULANG ===================== */
function draw() { dtUI(); drawCols(); drawThemes(); drawBrand(); drawRows(); drawTermin(); calcBox(); paper(); }
['ar'].forEach(id => $(id).onchange = () => { dirty = true; draw(); });
['gc', 'logoh'].forEach(id => $(id).onchange = () => { dirty = true; paper(); });
['f_round', 'f_other', 'f_otherlbl', 'f_taxp', 'f_taxlbl'].forEach(id => $(id).addEventListener('input', () => { dirty = true; calcBox(); drawTermin(); paper(); }));
['f_nama', 'f_alamat', 'f_telp', 'f_email', 'f_klien', 'f_pic', 'f_tgl', 'f_valid', 'f_due', 'f_ref', 'f_intro',
  'f_deliv', 'f_pay', 'f_bank', 'f_cur', 'f_bankname', 'f_bankno', 'f_swift', 'f_signer']
  .forEach(id => $(id).addEventListener('input', () => { dirty = true; paper(); }));
document.querySelectorAll('.seg button[data-mode]').forEach(b => b.onclick = () => {
  document.querySelectorAll('.seg button[data-mode]').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); mode = b.dataset.mode;
  COLS.forEach(c => { if (c.int) c.on = (mode === 'internal'); });
  dirty = true; draw();
});
document.querySelectorAll('#pmode button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#pmode button').forEach(x => x.classList.remove('on'));
  b.classList.add('on'); pmode = b.dataset.pm; dirty = true; draw();
});

/* ===================== HURUF BESAR ===================== */
function bigUI() {
  const on = localStorage.getItem('mbp_big') === '1';
  document.body.classList.toggle('big', on);
  $('t_big').textContent = on ? 'A− Huruf normal' : 'A+ Huruf besar';
}
$('t_big').onclick = () => { localStorage.setItem('mbp_big', localStorage.getItem('mbp_big') === '1' ? '0' : '1'); bigUI(); };
bigUI();

/* ===================== JARING PENGAMAN LOKAL =====================
   Isian disalin ke perangkat tiap beberapa detik. Kalau laptop mati,
   browser tertutup, atau listrik padam, isinya bisa dikembalikan.     */
const DK = 'mbp_draft';
setInterval(() => {
  if (!ME || !dirty) return;
  try { localStorage.setItem(DK, JSON.stringify({ cur: CUR, p: payload(), at: Date.now() })); } catch (e) { }
}, 4000);
function askRestore() {
  let d; try { d = JSON.parse(localStorage.getItem(DK) || 'null'); } catch (e) { return; }
  if (!d || !d.p) return;
  const jam = Math.round((Date.now() - (d.at || 0)) / 60000);
  const nm = (d.p.info && d.p.info.klien) || 'tanpa nama klien';
  if (!confirm('Ada isian yang belum sempat disimpan (' + nm + ', ' + (jam < 1 ? 'baru saja' : jam + ' menit lalu') + ').\n\nKembalikan isian itu sekarang?\n\nOK = kembalikan.  Batal = buang dan mulai bersih.')) {
    localStorage.removeItem(DK); return;
  }
  load(d.p); CUR = d.cur || CUR; dirty = true; draw(); saveState();
  toast('Isian dikembalikan. Jangan lupa tekan Simpan.');
}
function clearDraft() { try { localStorage.removeItem(DK); } catch (e) { } }

/* ===================== PWA ===================== */
setPersistence(auth, indexedDBLocalPersistence).catch(() => { });
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
}
sync(); authUI();
