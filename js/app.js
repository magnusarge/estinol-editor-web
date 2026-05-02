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
  showHtmlSource: false,
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
  langSelect: document.getElementById('lang-select'),
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
  sisuHtmlSource: document.getElementById('sisu-html-source'),
  btnToggleHtml: document.getElementById('btn-toggle-html'),
  btnBold: document.getElementById('btn-bold'),
  btnItalic: document.getElementById('btn-italic'),
  btnDelete: document.getElementById('btn-delete'),
  btnCancel: document.getElementById('btn-cancel'),
  btnSave: document.getElementById('btn-save'),
  btnBackToList: document.getElementById('btn-back-to-list'),
  
  // Footer
  footerLang: document.getElementById('footer-lang'),
  footerTotalWords: document.getElementById('footer-total-words'),
  footerLastModified: document.getElementById('footer-last-modified'),
  networkStatus: document.getElementById('network-status'),
  btnDownloadDb: document.getElementById('btn-download-db'),
  
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

  // Loome kohandatud keelevaliku menüü
  window.updateCustomDropdown = setupCustomDropdown();

  // Event Listeners
  els.loginBtn.addEventListener('click', handleLogin);
  els.passwordInput.addEventListener('keypress', (e) => { if(e.key === 'Enter') handleLogin(); });
  els.logoutBtn.addEventListener('click', () => safeExecute(handleLogout));

  els.langSelect.addEventListener('change', async (e) => {
    const newLang = e.target.value;
    const oldLang = state.currentLang;

    if (state.hasUnsavedChanges) {
      if (isExecuting) {
        e.target.value = oldLang;
        return;
      }
      isExecuting = true;
      try {
        const proceed = await confirmDialog(
          'Salvestamata muudatused', 
          'Sul on salvestamata muudatusi. Kas soovid jätkata ja muudatused kaotada?'
        );
        if (!proceed) {
          e.target.value = oldLang;
          return;
        }
        state.hasUnsavedChanges = false;
      } finally {
        isExecuting = false;
      }
    }

    await changeLanguage(newLang);
  });

  els.newWordBtn.addEventListener('click', () => safeExecute(startAddingNewWord));  
  // Editor inputs
  els.algvormInput.addEventListener('input', handleEditorInput);
  els.sisuInput.addEventListener('input', () => {
    els.sisuHtmlSource.value = els.sisuInput.innerHTML;
    handleEditorInput();
  });
  els.sisuHtmlSource.addEventListener('input', () => {
    els.sisuInput.innerHTML = els.sisuHtmlSource.value;
    handleEditorInput();
  });
  
  // Segmented buttons
  els.raskusasteBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      els.raskusasteBtns.forEach(b => b.classList.remove('selected'));
      e.target.classList.add('selected');
      handleEditorInput();
    });
  });

  // Visuaalredaktori tööriistariba
  els.btnToggleHtml.addEventListener('click', toggleHtmlSource);
  
  els.btnToggleHtml.addEventListener('click', toggleHtmlSource);
  
  els.btnBold.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Väldib fookuse kaotamist
    if (state.showHtmlSource) return;
    document.execCommand('bold', false, null);
    els.sisuHtmlSource.value = els.sisuInput.innerHTML;
    handleEditorInput();
  });
  els.btnItalic.addEventListener('mousedown', (e) => {
    e.preventDefault(); // Väldib fookuse kaotamist
    if (state.showHtmlSource) return;
    document.execCommand('italic', false, null);
    els.sisuHtmlSource.value = els.sisuInput.innerHTML;
    handleEditorInput();
  });

  // Editor Actions
  els.btnSave.addEventListener('click', saveForm);
  els.btnCancel.addEventListener('click', cancelEditing);
  els.btnDelete.addEventListener('click', deleteWord);
  if (els.btnBackToList) {
    els.btnBackToList.addEventListener('click', hideMobileEditor);
  }

  // Footer Actions
  els.btnDownloadDb.addEventListener('click', downloadDatabase);

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

function showMobileEditor() {
  if (window.innerWidth <= 768) {
    document.body.classList.add('show-editor-mobile');
  }
}

function hideMobileEditor() {
  document.body.classList.remove('show-editor-mobile');
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
    hideMobileEditor();
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
          sisuHtml: wData.sisu_html || wData.sisu_md || '',
          raskusaste: typeof wData.raskusaste === 'number' ? wData.raskusaste : 0
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
  els.langSelect.value = state.currentLang;
  if (window.updateCustomDropdown) window.updateCustomDropdown(state.currentLang);
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
      showMobileEditor();
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
      els.sisuInput.innerHTML = '';
      els.sisuHtmlSource.value = '';
      setRaskusaste(0);
      els.duplicateWarning.classList.add('hidden');
      els.btnCancel.classList.add('hidden');
      els.btnSave.disabled = true;
    }

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
      els.sisuInput.innerHTML = word.sisuHtml;
      els.sisuHtmlSource.value = word.sisuHtml;
      setRaskusaste(word.raskusaste);
      els.btnCancel.classList.add('hidden');
      els.btnSave.disabled = true;
    }
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
    isDirty = inputAlgvorm.length > 0 || (els.sisuInput.innerHTML && els.sisuInput.innerHTML.trim().length > 0);
  } else if (state.selectedWordId) {
    const word = state.words.find(w => w.id === state.selectedWordId);
    if (word) {
      isDirty = els.algvormInput.value !== word.algvorm ||
                els.sisuInput.innerHTML !== word.sisuHtml ||
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
    sisuHtml: els.sisuInput.innerHTML.trim(),
    raskusaste: getRaskusaste()
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

    // Uuenda muudatuste logi
    const changesRef = doc(db, 'data', 'changes');
    await setDoc(changesRef, { [`${state.currentLang}_${letter}`]: Date.now() }, { merge: true });

    state.words = state.words.filter(w => w.id !== word.id);
    state.selectedWordId = null;
    state.hasUnsavedChanges = false;
    
    renderUI();
    hideMobileEditor();
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
    els.sisuInput.innerHTML = '';
    els.sisuHtmlSource.value = '';
    setRaskusaste(0);
  }
  renderEditor();
}

function toggleHtmlSource() {
  state.showHtmlSource = !state.showHtmlSource;
  if (state.showHtmlSource) {
    els.sisuInput.classList.add('hidden');
    els.sisuHtmlSource.classList.remove('hidden');
    els.btnToggleHtml.textContent = 'Näita visuaalset';
    els.btnBold.disabled = true;
    els.btnItalic.disabled = true;
  } else {
    els.sisuHtmlSource.classList.add('hidden');
    els.sisuInput.classList.remove('hidden');
    els.btnToggleHtml.textContent = 'Näita HTML-i';
    els.btnBold.disabled = false;
    els.btnItalic.disabled = false;
  }
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
    showMobileEditor();
    
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
    sisu_html: word.sisuHtml,
    raskusaste: word.raskusaste
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

async function changeLanguage(newLang) {
  state.currentLang = newLang;
  state.selectedLetter = 'a';
  state.selectedWordId = null;
  state.isAddingNew = false;
  state.hasUnsavedChanges = false;

  calculateLastModified();
  await loadDictionary();
  hideMobileEditor();
}
function startAddingNewWord() {
  state.selectedWordId = null;
  state.isAddingNew = true;
  state.hasUnsavedChanges = false;
  
  // Unselect word list items
  document.querySelectorAll('.word-list-item').forEach(el => el.classList.remove('selected'));
  
  renderEditor();
  showMobileEditor();
}

async function downloadDatabase() {
  const confirmed = await confirmDialog(
    'Andmebaasi allalaadimine', 
    'Kas soovid terve andmebaasi JSON failina alla laadida? See võib võtta veidi aega.'
  );
  if (!confirmed) return;

  setLoading(true);
  try {
    const dbData = { words_es: {}, words_et: {}, data: {} };
    
    // Fetch Spanish words
    const esCol = collection(db, 'words_es');
    const esSnap = await getDocs(esCol);
    esSnap.forEach(doc => { dbData.words_es[doc.id] = doc.data(); });
    
    // Fetch Estonian words
    const etCol = collection(db, 'words_et');
    const etSnap = await getDocs(etCol);
    etSnap.forEach(doc => { dbData.words_et[doc.id] = doc.data(); });
    
    // Fetch metadata (changes)
    const dataCol = collection(db, 'data');
    const dataSnap = await getDocs(dataCol);
    dataSnap.forEach(doc => { dbData.data[doc.id] = doc.data(); });

    // Format Date: estinol-db-<YYYY-MM-DD-HHMM>
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const MM = String(now.getMinutes()).padStart(2, '0');
    const fileName = `estinol-db-${yyyy}-${mm}-${dd}-${HH}${MM}.json`;

    // Create Blob and trigger download
    const blob = new Blob([JSON.stringify(dbData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
  } catch (error) {
    console.error('Download DB error:', error);
    alert('Viga andmebaasi allalaadimisel: ' + error.message);
  } finally {
    setLoading(false);
  }
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

// --- Custom Dropdown Setup ---
function setupCustomDropdown() {
  const originalSelect = els.langSelect;
  originalSelect.classList.add('hidden'); // Peidame vana inetu <select> elemendi
  
  const wrapper = document.createElement('div');
  wrapper.className = 'custom-select-wrapper';
  
  const trigger = document.createElement('div');
  trigger.className = 'custom-select-trigger';
  
  const options = document.createElement('div');
  options.className = 'custom-select-options';
  
  const langs = [
    { code: 'es', label: 'Hispaania', flag: 'https://flagcdn.com/es.svg' },
    { code: 'et', label: 'Eesti', flag: 'https://flagcdn.com/ee.svg' } // 'ee' on Eesti riigikood piltide jaoks
  ];

  function updateTrigger(code) {
    const lang = langs.find(l => l.code === code) || langs[0];
    trigger.innerHTML = `<div class="flex items-center"><img src="${lang.flag}" class="flag-icon" alt="${lang.code}"> ${lang.label}</div> <span style="font-size:0.8em; margin-left:8px;">▼</span>`;
  }

  langs.forEach(lang => {
    const opt = document.createElement('div');
    opt.className = 'custom-select-option';
    opt.innerHTML = `<img src="${lang.flag}" class="flag-icon" alt="${lang.code}"> ${lang.label}`;
    opt.addEventListener('click', () => {
      options.classList.remove('open');
      if (originalSelect.value !== lang.code) {
        originalSelect.value = lang.code;
        originalSelect.dispatchEvent(new Event('change')); // Käivitame vana loogika
      }
    });
    options.appendChild(opt);
  });

  trigger.addEventListener('click', (e) => {
    options.classList.toggle('open');
  });

  document.addEventListener('click', (e) => {
    if (!wrapper.contains(e.target)) {
      options.classList.remove('open');
    }
  });

  wrapper.appendChild(trigger);
  wrapper.appendChild(options);
  originalSelect.parentNode.insertBefore(wrapper, originalSelect.nextSibling);
  
  return updateTrigger;
}

// Bootstrap
document.addEventListener('DOMContentLoaded', init);