// js/app.js
import { auth, db } from './firebase-config.js';
import { 
  signInWithEmailAndPassword, 
  onAuthStateChanged, 
  signOut 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { 
  collection, 
  doc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  deleteField,
  onSnapshot 
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

// --- State Management ---
const state = {
  user: null,
  words: [],
  currentLang: 'es',
  selectedLetter: 'a',
  selectedWordId: null,
  isAddingNew: false,
  hasUnsavedChanges: false,
  showPreview: true,
  isLoading: false,
  latestChangesData: {},
  lastModifiedLang: null,
  isNetworkOnline: navigator.onLine
};

// Alphabets matching Flutter
const ALPHABETS = {
  es: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'ñ', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z'],
  et: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 'š', 'z', 'ž', 't', 'u', 'v', 'w', 'õ', 'ä', 'ö', 'ü', 'x', 'y']
};

// --- DOM Elements ---
const els = {
  // Views
  loginView: document.getElementById('login-view'),
  editorView: document.getElementById('editor-view'),
  globalLoader: document.getElementById('global-loader'),
  
  // Login
  emailInput: document.getElementById('email'),
  passwordInput: document.getElementById('password'),
  rememberMeCheck: document.getElementById('remember-me'),
  loginBtn: document.getElementById('login-btn'),
  loginError: document.getElementById('login-error'),
  logoutBtn: document.getElementById('logout-btn'),
  
  // Sidebar
  langToggleBtn: document.getElementById('lang-toggle-btn'),
  newWordBtn: document.getElementById('new-word-btn'),
  alphabetContainer: document.getElementById('alphabet-container'),
  wordList: document.getElementById('word-list'),
  selectedLetterDisplay: document.getElementById('selected-letter-display'),
  letterWordCount: document.getElementById('letter-word-count'),
  
  // Editor
  emptyState: document.getElementById('empty-state'),
  editorForm: document.getElementById('editor-form'),
  duplicateWarning: document.getElementById('duplicate-warning'),
  algvormInput: document.getElementById('algvorm-input'),
  otsingvormInput: document.getElementById('otsingvorm-input'),
  raskusasteBtns: document.querySelectorAll('.segment-btn'),
  sisuInput: document.getElementById('sisu-input'),
  markdownPreview: document.getElementById('markdown-preview-container'),
  btnBold: document.getElementById('btn-bold'),
  btnItalic: document.getElementById('btn-italic'),
  btnTogglePreview: document.getElementById('btn-toggle-preview'),
  btnDelete: document.getElementById('btn-delete'),
  btnCancel: document.getElementById('btn-cancel'),
  btnSave: document.getElementById('btn-save'),
  
  // Footer
  footerLang: document.getElementById('footer-lang'),
  footerTotalWords: document.getElementById('footer-total-words'),
  footerLastModified: document.getElementById('footer-last-modified'),
  networkStatus: document.getElementById('network-status'),
  
  // Dialog
  dialogOverlay: document.getElementById('dialog-overlay'),
  dialogTitle: document.getElementById('dialog-title'),
  dialogMessage: document.getElementById('dialog-message'),
  dialogBtnCancel: document.getElementById('dialog-btn-cancel'),
  dialogBtnConfirm: document.getElementById('dialog-btn-confirm')
};

// --- String Utils (from Flutter) ---
const StringUtils = {
  normalize: (text) => {
    let str = text.toLowerCase();
    const withDia = 'áéíóúüñäöõšž';
    const withoutDia = 'aeiouunaoosz';
    for (let i = 0; i < withDia.length; i++) {
      str = str.split(withDia[i]).join(withoutDia[i]);
    }
    return str;
  },
  sortKey: (text, lang) => {
    let str = text.toLowerCase().trim();
    if (lang === 'es') {
      str = str.split('ñ').join('n{');
      const withDia = 'áéíóúü';
      const withoutDia = 'aeiouu';
      for (let i = 0; i < withDia.length; i++) {
        str = str.split(withDia[i]).join(withoutDia[i]);
      }
      return str;
    }
    return StringUtils.normalize(str);
  }
};

// --- Initialization ---
function init() {
  // Load saved email
  const savedEmail = localStorage.getItem('saved_email');
  if (savedEmail) {
    els.emailInput.value = savedEmail;
    els.rememberMeCheck.checked = true;
  }

  // Setup Auth Listener
  if(auth) {
    onAuthStateChanged(auth, (user) => {
      state.user = user;
      if (user) {
        showView('editor');
        loadDictionary();
        setupChangesListener();
      } else {
        showView('login');
      }
    });
  } else {
    // Show error if Firebase is not configured
    els.loginError.textContent = "Firebase is not configured. Please add your config in js/firebase-config.js";
    els.loginError.classList.remove('hidden');
  }

  // Event Listeners
  els.loginBtn.addEventListener('click', handleLogin);
  els.passwordInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') handleLogin(); });
  els.logoutBtn.addEventListener('click', () => safeExecute(handleLogout));
  
  els.langToggleBtn.addEventListener('click', () => safeExecute(toggleLanguage));
  els.newWordBtn.addEventListener('click', () => safeExecute(startAddingNewWord));
  
  // Editor inputs
  els.algvormInput.addEventListener('input', handleEditorInput);
  els.sisuInput.addEventListener('input', handleEditorInput);
  
  // Segmented buttons
  els.raskusasteBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      els.raskusasteBtns.forEach(b => b.classList.remove('selected'));
      e.target.classList.add('selected');
      handleEditorInput();
    });
  });

  // Markdown toolbar
  els.btnTogglePreview.addEventListener('click', togglePreview);
  els.btnBold.addEventListener('click', () => applyMarkdown('**', '**'));
  els.btnItalic.addEventListener('click', () => applyMarkdown('*', '*'));

  // Markdown keyboard shortcuts (Ctrl+B / Cmd+B and Ctrl+I / Cmd+I)
  els.sisuInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      applyMarkdown('**', '**');
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      applyMarkdown('*', '*');
    }
  });

  // Editor Actions
  els.btnSave.addEventListener('click', saveForm);
  els.btnCancel.addEventListener('click', cancelEditing);
  els.btnDelete.addEventListener('click', deleteWord);

  // Global keyboard shortcuts (Word List Navigation)
  document.addEventListener('keydown', (e) => {
    // Ignore if user is typing in an input or textarea
    if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateWordList(-1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateWordList(1);
    }
  });

  // Network status
  window.addEventListener('online', updateNetworkStatus);
  window.addEventListener('offline', updateNetworkStatus);
}

function showView(view) {
  if (view === 'login') {
    els.loginView.classList.remove('hidden');
    els.editorView.classList.add('hidden');
  } else {
    els.loginView.classList.add('hidden');
    els.editorView.classList.remove('hidden');
  }
}

function updateNetworkStatus() {
  state.isNetworkOnline = navigator.onLine;
  if (state.isNetworkOnline) {
    els.networkStatus.classList.remove('offline');
    els.networkStatus.classList.add('online');
    els.networkStatus.title = 'Internet on olemas';
  } else {
    els.networkStatus.classList.remove('online');
    els.networkStatus.classList.add('offline');
    els.networkStatus.title = 'Internetiühendus puudub';
  }
}

// --- Auth ---
async function handleLogin() {
  const email = els.emailInput.value.trim();
  const password = els.passwordInput.value.trim();
  const rememberMe = els.rememberMeCheck.checked;

  if (!email || !password) {
    showLoginError("Palun sisesta e-post ja parool");
    return;
  }

  els.loginBtn.disabled = true;
  els.loginBtn.textContent = 'Laadin...';
  hideLoginError();

  try {
    await signInWithEmailAndPassword(auth, email, password);
    if (rememberMe) {
      localStorage.setItem('saved_email', email);
    } else {
      localStorage.removeItem('saved_email');
    }
  } catch (error) {
    showLoginError(error.message);
    els.loginBtn.disabled = false;
    els.loginBtn.textContent = 'Logi sisse';
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    els.loginBtn.disabled = false;
    els.loginBtn.textContent = 'Logi sisse';
    // Clear state
    state.words = [];
    state.selectedWordId = null;
    state.isAddingNew = false;
  } catch (error) {
    console.error("Logout error", error);
  }
}

function showLoginError(msg) {
  els.loginError.textContent = msg;
  els.loginError.classList.remove('hidden');
}
function hideLoginError() {
  els.loginError.classList.add('hidden');
}

// --- Data Fetching ---
async function loadDictionary() {
  setLoading(true);
  try {
    const wordsCol = collection(db, `words_${state.currentLang}`);
    const snapshot = await getDocs(wordsCol);
    
    let allWords = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      Object.keys(data).forEach(id => {
        const wData = data[id];
        allWords.push({
          id: id,
          algvorm: wData.algvorm || '',
          otsingVorm: wData.otsing_vorm || '',
          sisuMd: wData.sisu_md || '',
          raskusaste: typeof wData.raskusaste === 'number' ? wData.raskusaste : 0,
          viimatiMuudetud: wData.viimati_muudetud ? new Date(wData.viimati_muudetud) : new Date()
        });
      });
    });
    
    state.words = allWords;
    renderUI();
  } catch (error) {
    console.error("Error loading dictionary:", error);
    alert("Viga andmete laadimisel: " + error.message);
  } finally {
    setLoading(false);
  }
}

let changesUnsubscribe = null;
function setupChangesListener() {
  if (changesUnsubscribe) changesUnsubscribe();
  
  const docRef = doc(db, 'data', 'changes');
  changesUnsubscribe = onSnapshot(docRef, (docSnap) => {
    if (docSnap.exists()) {
      state.latestChangesData = docSnap.data();
      calculateLastModified();
    }
  }, (error) => {
    console.error("Changes listener error:", error);
  });
}

function calculateLastModified() {
  let maxTime = 0;
  Object.keys(state.latestChangesData).forEach(key => {
    if (key.startsWith(`${state.currentLang}_`) && typeof state.latestChangesData[key] === 'number') {
      if (state.latestChangesData[key] > maxTime) maxTime = state.latestChangesData[key];
    }
  });
  
  if (maxTime > 0) {
    state.lastModifiedLang = new Date(maxTime);
    els.footerLastModified.textContent = formatDate(state.lastModifiedLang);
  } else {
    els.footerLastModified.textContent = '-';
  }
}

// --- UI Rendering ---
function renderUI() {
  // Update Header
  els.langToggleBtn.textContent = state.currentLang === 'es' ? '🇪🇸 ES' : '🇪🇪 ET';
  els.footerLang.textContent = state.currentLang === 'es' ? 'Hispaania' : 'Eesti';
  els.footerTotalWords.textContent = state.words.length;
  
  renderAlphabet();
  renderWordList();
  renderEditor();
}

function renderAlphabet() {
  const alphabet = ALPHABETS[state.currentLang];
  els.alphabetContainer.innerHTML = '';
  
  alphabet.forEach(letter => {
    const count = getCountByLetter(letter);
    const hasWords = count > 0;
    const isSelected = state.selectedLetter === letter;
    
    const btn = document.createElement('button');
    btn.className = `letter-btn ${isSelected ? 'selected' : (hasWords ? 'has-words' : 'empty')}`;
    btn.textContent = letter.toUpperCase();
    
    btn.onclick = () => safeExecute(() => {
      state.selectedLetter = letter;
      renderAlphabet();
      renderWordList();
      updateSidebarFooter();
    });
    
    els.alphabetContainer.appendChild(btn);
  });
  updateSidebarFooter();
}

function updateSidebarFooter() {
  els.selectedLetterDisplay.textContent = state.selectedLetter.toUpperCase();
  els.letterWordCount.textContent = getCountByLetter(state.selectedLetter);
}

function renderWordList() {
  const filteredWords = getWordsByLetter(state.selectedLetter);
  els.wordList.innerHTML = '';
  
  filteredWords.forEach(word => {
    const isSelected = state.selectedWordId === word.id && !state.isAddingNew;
    
    const div = document.createElement('div');
    div.className = `word-list-item ${isSelected ? 'selected' : ''}`;
    
    const title = document.createElement('div');
    title.className = 'bold';
    title.textContent = word.algvorm;
    
    const subtitle = document.createElement('div');
    subtitle.className = 'text-muted';
    subtitle.style.fontSize = '0.85rem';
    subtitle.textContent = word.otsingVorm;
    
    div.appendChild(title);
    div.appendChild(subtitle);
    
    div.onclick = () => safeExecute(() => {
      state.selectedWordId = word.id;
      state.isAddingNew = false;
      state.hasUnsavedChanges = false;
      renderWordList();
      renderEditor();
    });
    
    els.wordList.appendChild(div);
  });
}

function renderEditor() {
  if (state.isAddingNew) {
    els.emptyState.classList.add('hidden');
    els.editorForm.classList.remove('hidden');
    els.editorForm.classList.add('flex');
    
    els.algvormInput.readOnly = false;
    els.btnDelete.classList.add('hidden');
    
    if (!state.hasUnsavedChanges) {
      els.algvormInput.value = '';
      els.otsingvormInput.value = '';
      els.sisuInput.value = '';
      setRaskusaste(0);
      els.duplicateWarning.classList.add('hidden');
      els.btnCancel.classList.add('hidden');
      els.btnSave.disabled = true;
    }
    
    updateMarkdownPreview();
    
  } else if (state.selectedWordId) {
    els.emptyState.classList.add('hidden');
    els.editorForm.classList.remove('hidden');
    els.editorForm.classList.add('flex');
    
    const word = state.words.find(w => w.id === state.selectedWordId);
    if (!word) return;
    
    els.algvormInput.readOnly = true;
    els.btnDelete.classList.remove('hidden');
    els.duplicateWarning.classList.add('hidden');
    
    if (!state.hasUnsavedChanges) {
      els.algvormInput.value = word.algvorm;
      els.otsingvormInput.value = word.otsingVorm;
      els.sisuInput.value = word.sisuMd;
      setRaskusaste(word.raskusaste);
      els.btnCancel.classList.add('hidden');
      els.btnSave.disabled = true;
    }
    
    updateMarkdownPreview();
  } else {
    els.emptyState.classList.remove('hidden');
    els.editorForm.classList.add('hidden');
    els.editorForm.classList.remove('flex');
  }
}

// --- Editor Logic ---
function handleEditorInput() {
  // Generate otsingVorm if new
  if (state.isAddingNew) {
    els.otsingvormInput.value = StringUtils.normalize(els.algvormInput.value);
  }
  
  updateMarkdownPreview();
  checkChangesAndDuplicates();
}

function checkChangesAndDuplicates() {
  const inputAlgvorm = els.algvormInput.value.trim();
  let isDirty = false;
  let isDuplicate = false;
  
  if (state.isAddingNew) {
    // Duplicate check
    const lowerInput = inputAlgvorm.toLowerCase();
    isDuplicate = state.words.some(w => w.algvorm.toLowerCase() === lowerInput);
    
    if (isDuplicate) els.duplicateWarning.classList.remove('hidden');
    else els.duplicateWarning.classList.add('hidden');
    
    // Dirty check
    isDirty = inputAlgvorm.length > 0 || els.sisuInput.value.length > 0;
  } else if (state.selectedWordId) {
    const word = state.words.find(w => w.id === state.selectedWordId);
    if (word) {
      isDirty = els.algvormInput.value !== word.algvorm ||
                els.sisuInput.value !== word.sisuMd ||
                getRaskusaste() !== word.raskusaste;
    }
  }
  
  state.hasUnsavedChanges = isDirty;
  
  // UI Updates for buttons
  if (isDirty) {
    els.btnCancel.classList.remove('hidden');
  } else {
    els.btnCancel.classList.add('hidden');
  }
  
  // Save button logic
  if (isDuplicate || inputAlgvorm === '') {
    els.btnSave.disabled = true;
  } else {
    els.btnSave.disabled = !isDirty;
  }
}

async function saveForm() {
  const isNew = state.isAddingNew;
  const algvorm = els.algvormInput.value.trim();
  
  if(!algvorm) return;

  const word = {
    id: isNew ? `word_${Date.now()}` : state.selectedWordId,
    algvorm: algvorm,
    otsingVorm: els.otsingvormInput.value.trim(),
    sisuMd: els.sisuInput.value.trim(),
    raskusaste: getRaskusaste(),
    viimatiMuudetud: new Date()
  };

  setLoading(true);
  try {
    const letter = word.algvorm.toLowerCase()[0];
    const docRef = doc(db, `words_${state.currentLang}`, letter);
    
    // Save word
    await setDoc(docRef, { [word.id]: mapWordForDb(word) }, { merge: true });
    
    // Update log
    const changesRef = doc(db, 'data', 'changes');
    await setDoc(changesRef, { [`${state.currentLang}_${letter}`]: Date.now() }, { merge: true });
    
    // Update local state
    const index = state.words.findIndex(w => w.id === word.id);
    if (index !== -1) {
      state.words[index] = word;
    } else {
      state.words.push(word);
    }
    
    // Switch to letter if applicable
    if (ALPHABETS[state.currentLang].includes(letter)) {
      state.selectedLetter = letter;
    }
    
    state.hasUnsavedChanges = false;
    state.isAddingNew = false;
    state.selectedWordId = word.id;
    
    renderUI();
  } catch(error) {
    console.error("Save error:", error);
    alert("Viga salvestamisel: " + error.message);
  } finally {
    setLoading(false);
  }
}

async function deleteWord() {
  const word = state.words.find(w => w.id === state.selectedWordId);
  if (!word) return;

  const confirmed = await confirmDialog('Kustuta sõna', `Kas oled kindel, et soovid sõna "${word.algvorm}" kustutada? Seda tegevust ei saa tagasi võtta.`);
  if (!confirmed) return;

  setLoading(true);
  try {
    const letter = word.algvorm.toLowerCase()[0];
    const docRef = doc(db, `words_${state.currentLang}`, letter);
    
    await updateDoc(docRef, {
      [word.id]: deleteField()
    });

    state.words = state.words.filter(w => w.id !== word.id);
    state.selectedWordId = null;
    state.hasUnsavedChanges = false;
    
    renderUI();
  } catch (error) {
    console.error("Delete error:", error);
    alert("Viga kustutamisel: " + error.message);
  } finally {
    setLoading(false);
  }
}

function cancelEditing() {
  state.hasUnsavedChanges = false;
  if (state.isAddingNew) {
    // Reset to new form
    els.algvormInput.value = '';
    els.otsingvormInput.value = '';
    els.sisuInput.value = '';
    setRaskusaste(0);
  }
  renderEditor();
}

function togglePreview() {
  state.showPreview = !state.showPreview;
  if (state.showPreview) {
    els.markdownPreview.classList.remove('hidden');
    els.btnTogglePreview.textContent = 'Peida eelvaade';
  } else {
    els.markdownPreview.classList.add('hidden');
    els.btnTogglePreview.textContent = 'Näita eelvaadet';
  }
}

function updateMarkdownPreview() {
  if (state.showPreview) {
    // Using marked.js loaded via CDN in index.html
    if (window.marked) {
      els.markdownPreview.innerHTML = marked.parse(els.sisuInput.value);
    } else {
      els.markdownPreview.innerHTML = els.sisuInput.value; // Fallback
    }
  }
}

function applyMarkdown(prefix, suffix) {
  const textarea = els.sisuInput;
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const text = textarea.value;
  
  if (start === end) return; // No selection
  
  const selectedText = text.substring(start, end);
  const newText = text.substring(0, start) + prefix + selectedText + suffix + text.substring(end);
  
  textarea.value = newText;
  handleEditorInput();
  
  // Restore selection
  textarea.focus();
  textarea.setSelectionRange(start + prefix.length + selectedText.length + suffix.length, start + prefix.length + selectedText.length + suffix.length);
}

// --- Helpers & Utilities ---

let isNavigating = false;

function navigateWordList(direction) {
  if (isNavigating) return;

  const filteredWords = getWordsByLetter(state.selectedLetter);
  if (filteredWords.length === 0) return;

  let currentIndex = filteredWords.findIndex(w => w.id === state.selectedWordId);
  
  let newIndex = currentIndex === -1 ? 0 : currentIndex + direction;
  if (newIndex < 0) newIndex = 0;
  if (newIndex >= filteredWords.length) newIndex = filteredWords.length - 1;

  if (currentIndex === newIndex) return;

  const nextWord = filteredWords[newIndex];

  safeExecute(() => {
    state.selectedWordId = nextWord.id;
    state.isAddingNew = false;
    state.hasUnsavedChanges = false;
    renderWordList();
    renderEditor();
    
    // Scroll into view
    setTimeout(() => {
      const selectedEl = els.wordList.querySelector('.word-list-item.selected');
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }, 0);
  });
}

function getWordsByLetter(letter) {
  return state.words.filter(w => {
    const wordForm = w.algvorm.toLowerCase();
    return wordForm && wordForm.startsWith(letter.toLowerCase());
  }).sort((a, b) => {
    const ak = StringUtils.sortKey(a.algvorm, state.currentLang);
    const bk = StringUtils.sortKey(b.algvorm, state.currentLang);
    const primary = ak.localeCompare(bk);
    if (primary !== 0) return primary;
    return a.algvorm.localeCompare(b.algvorm);
  });
}

function getCountByLetter(letter) {
  return state.words.filter(w => {
    const wordForm = w.algvorm.toLowerCase();
    return wordForm && wordForm.startsWith(letter.toLowerCase());
  }).length;
}

function setRaskusaste(value) {
  els.raskusasteBtns.forEach(btn => {
    if(parseInt(btn.dataset.value) === value) {
      btn.classList.add('selected');
    } else {
      btn.classList.remove('selected');
    }
  });
}

function getRaskusaste() {
  const selectedBtn = document.querySelector('.segment-btn.selected');
  return selectedBtn ? parseInt(selectedBtn.dataset.value) : 0;
}

function mapWordForDb(word) {
  return {
    algvorm: word.algvorm,
    otsing_vorm: word.otsingVorm,
    sisu_md: word.sisuMd,
    raskusaste: word.raskusaste,
    viimati_muudetud: word.viimatiMuudetud.getTime()
  };
}

// --- Actions requiring confirmation if dirty ---
let isExecuting = false;
async function safeExecute(actionFn) {
  if (isExecuting) return;
  isExecuting = true;
  try {
    if (state.hasUnsavedChanges) {
      const proceed = await confirmDialog(
        'Salvestamata muudatused', 
        'Sul on salvestamata muudatusi. Kas soovid jätkata ja muudatused kaotada?'
      );
      if (!proceed) return;
      state.hasUnsavedChanges = false;
    }
    actionFn();
  } finally {
    isExecuting = false;
  }
}

async function toggleLanguage() {
  state.currentLang = state.currentLang === 'es' ? 'et' : 'es';
  state.selectedLetter = 'a';
  state.selectedWordId = null;
  state.isAddingNew = false;
  state.hasUnsavedChanges = false;
  
  calculateLastModified();
  await loadDictionary();
}

function startAddingNewWord() {
  state.selectedWordId = null;
  state.isAddingNew = true;
  state.hasUnsavedChanges = false;
  
  // Unselect word list items
  document.querySelectorAll('.word-list-item').forEach(el => el.classList.remove('selected'));
  
  renderEditor();
}

// --- Dialog & Loading ---
function confirmDialog(title, message) {
  return new Promise((resolve) => {
    els.dialogTitle.textContent = title;
    els.dialogMessage.textContent = message;
    els.dialogOverlay.classList.remove('hidden');
    
    const cleanup = () => {
      els.dialogBtnCancel.removeEventListener('click', onCancel);
      els.dialogBtnConfirm.removeEventListener('click', onConfirm);
      els.dialogOverlay.classList.add('hidden');
    };
    
    const onCancel = () => { cleanup(); resolve(false); };
    const onConfirm = () => { cleanup(); resolve(true); };
    
    els.dialogBtnCancel.addEventListener('click', onCancel);
    els.dialogBtnConfirm.addEventListener('click', onConfirm);
  });
}

function setLoading(isLoading) {
  state.isLoading = isLoading;
  if (isLoading) {
    els.globalLoader.classList.remove('hidden');
  } else {
    els.globalLoader.classList.add('hidden');
  }
}

function formatDate(date) {
  if (!date) return '-';
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  const hr = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${d}.${m}.${y} ${hr}:${min}`;
}

// Bootstrap
document.addEventListener('DOMContentLoaded', init);