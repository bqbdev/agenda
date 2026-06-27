import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import { getFirestore, doc, collection, collectionGroup, getDoc, getDocs, setDoc, addDoc, deleteDoc, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDLrhdAsAJYt68QKm6DDDRHCG2TT0eQXLQ",
  authDomain: "bq-agenda.firebaseapp.com",
  projectId: "bq-agenda",
  storageBucket: "bq-agenda.firebasestorage.app",
  messagingSenderId: "915157737983",
  appId: "1:915157737983:web:cd5c5be43789a8afce87ca"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const root = document.querySelector("#root");

let user = null, profile = null, tab = "dashboard";
let users = [], clients = [], services = [], appointments = [], transactions = [];
let adminAppointments = [], adminTransactions = [];

const plans = { monthly: "Mensal", quarterly: "Trimestral", semiannual: "Semestral", annual: "Anual" };
const planPrices = { monthly: 49.9, quarterly: 129.9, semiannual: 239.9, annual: 399.9 };
const paymentMethods = { pix: "Pix", cash: "Dinheiro", credit: "Cartao de credito", debit: "Cartao de debito", transfer: "Transferencia", other: "Outro" };
const weekKeys = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const $ = id => document.getElementById(id);
const today = () => new Date().toISOString().slice(0, 10);
const onlyDigits = value => String(value || "").replace(/\D/g, "");
const money = value => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const icons = () => window.lucide && window.lucide.createIcons();
const userRef = uid => doc(db, "users", uid);
const col = name => collection(db, "users", user.uid, name);
const itemRef = (name, id) => doc(db, "users", user.uid, name, id);
const tenantCol = (uid, name) => collection(db, "users", uid, name);
const tenantDoc = (uid, name, id) => doc(db, "users", uid, name, id);
const empty = text => `<div class="empty">${text}</div>`;

function makeSlug(text) {
  return String(text || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function fileToCompressedDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Envie apenas arquivos de imagem."));
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      reject(new Error("A imagem deve ter no maximo 5MB."));
      return;
    }

    const reader = new FileReader();

    reader.onload = () => {
      const img = new Image();

      img.onload = () => {
        const maxSize = 900;
        let { width, height } = img;

        if (width > height && width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        }

        if (height >= width && height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        resolve(canvas.toDataURL("image/jpeg", 0.78));
      };

      img.onerror = () => reject(new Error("Nao foi possivel ler a imagem."));
      img.src = reader.result;
    };

    reader.onerror = () => reject(new Error("Nao foi possivel carregar o arquivo."));
    reader.readAsDataURL(file);
  });
}

function planExpiration(plan) {
  const d = new Date();
  if (plan === "monthly") d.setMonth(d.getMonth() + 1);
  if (plan === "quarterly") d.setMonth(d.getMonth() + 3);
  if (plan === "semiannual") d.setMonth(d.getMonth() + 6);
  if (plan === "annual") d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function isExpired(date) { return Boolean(date && date < today()); }
function timeToMinutes(time) { const [h, m] = String(time || "00:00").split(":").map(Number); return h * 60 + m; }
function minutesToTime(minutes) { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; }
function dateToWeekKey(dateString) { const [y, m, d] = dateString.split("-").map(Number); return weekKeys[new Date(y, m - 1, d).getDay()]; }
function lastDayOfCurrentMonth() { const now = new Date(); return new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10); }
function lastDayOfCurrentYear() { return `${new Date().getFullYear()}-12-31`; }
function overlaps(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd; }

function getAvailableSlots({ date, service, availability, appointments, bookingWindow }) {
  if (!date || !service) return [];
  if (date < today()) return [];
  if ((bookingWindow || "month") === "month" && date > lastDayOfCurrentMonth()) return [];
  if (bookingWindow === "year" && date > lastDayOfCurrentYear()) return [];

  const dayConfig = availability?.[dateToWeekKey(date)];
  if (!dayConfig || !dayConfig.enabled) return [];

  const start = timeToMinutes(dayConfig.start);
  const end = timeToMinutes(dayConfig.end);
  const slot = Number(dayConfig.slot || 30);
  const duration = Number(service.duration || 30);

  const busy = appointments
    .filter(a => a.date === date && a.status !== "canceled")
    .map(a => ({
      start: Number(a.startMinutes ?? timeToMinutes(a.time)),
      end: Number(a.endMinutes ?? (timeToMinutes(a.time) + Number(a.duration || 30)))
    }));

  const result = [];
  for (let current = start; current + duration <= end; current += slot) {
    const currentEnd = current + duration;
    if (!busy.some(b => overlaps(current, currentEnd, b.start, b.end))) result.push(minutesToTime(current));
  }
  return result;
}

function renderAuth() {
  root.innerHTML = `
    <section class="auth-page">
      <div class="auth-hero">
        <div class="auth-brand">BQ Agenda</div>
        <div class="auth-copy">
          <h1>Gestao de agenda para negocios que vivem de horario.</h1>
          <p>Controle estabelecimentos, clientes, servicos, pagamentos e indicadores em uma plataforma web simples de operar.</p>
          <div class="auth-points">
            <div class="auth-point"><strong>Agenda online</strong><span>Clientes agendam pelo link publico.</span></div>
            <div class="auth-point"><strong>Painel BQ</strong><span>Aprove, bloqueie e monitore planos.</span></div>
            <div class="auth-point"><strong>BI do negocio</strong><span>Acompanhe uso, pendencias e crescimento.</span></div>
          </div>
        </div>
        <small>100% web, pronto para GitHub Pages e Firebase.</small>
      </div>
      <div class="auth-panel-wrap">
        <div class="auth-box">
          <h2>Acessar plataforma</h2>
          <p>Entre ou envie o cadastro do estabelecimento para analise.</p>
          <div class="tabs"><button id="loginTab" class="active">Entrar</button><button id="registerTab">Cadastrar estabelecimento</button></div>
          <div id="authView"></div>
        </div>
      </div>
    </section>`;
  $("loginTab").onclick = renderLoginForm;
  $("registerTab").onclick = renderRegisterForm;
  renderLoginForm();
}

function setAuthTab(active) {
  $("loginTab").classList.toggle("active", active === "login");
  $("registerTab").classList.toggle("active", active === "register");
}

function renderLoginForm() {
  setAuthTab("login");
  $("authView").innerHTML = `
    <form id="loginForm" class="form">
      <input name="email" type="email" placeholder="E-mail" required>
      <input name="password" type="password" placeholder="Senha" required>
      <button class="btn" type="submit"><i data-lucide="log-in"></i>Entrar</button>
    </form>`;
  $("loginForm").onsubmit = async event => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.target));
      await signInWithEmailAndPassword(auth, data.email, data.password);
    } catch (error) {
      alert("Erro ao entrar: " + error.message);
      console.error(error);
    }
  };
  icons();
}

function renderRegisterForm() {
  setAuthTab("register");
  $("authView").innerHTML = `
    <form id="registerForm" class="form">
      <input name="ownerName" placeholder="Nome do responsavel" required>
      <input name="businessName" placeholder="Nome do estabelecimento" required>
      <input name="segment" placeholder="Segmento" required>
      <div class="row"><input name="city" placeholder="Cidade" required><input name="phone" placeholder="WhatsApp" required></div>
      <select name="plan" required><option value="monthly">Plano mensal</option><option value="quarterly">Plano trimestral</option><option value="semiannual">Plano semestral</option><option value="annual">Plano anual</option></select>
      <input name="email" type="email" placeholder="E-mail" required>
      <input name="password" type="password" placeholder="Senha" minlength="6" required>
      <button class="btn" type="submit"><i data-lucide="send"></i>Enviar para analise</button>
    </form>`;
  $("registerForm").onsubmit = async event => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.target));
      const credential = await createUserWithEmailAndPassword(auth, data.email, data.password);
      const slug = makeSlug(data.businessName);
      await setDoc(userRef(credential.user.uid), {
        role: "establishment", status: "pending", blocked: false, paymentStatus: "waiting",
        plan: data.plan, planExpiresAt: "", ownerName: data.ownerName, businessName: data.businessName,
        segment: data.segment, city: data.city, phone: onlyDigits(data.phone), email: data.email,
        publicBooking: true, photoURL: "", slug, bookingWindow: "month", availability: {}, createdAt: serverTimestamp()
      });
      await setDoc(doc(db, "publicEstablishments", slug), {
        uid: credential.user.uid, businessName: data.businessName, segment: data.segment, city: data.city,
        photoURL: "", publicBooking: true, updatedAt: serverTimestamp()
      });
      alert("Cadastro enviado com sucesso. Aguarde a aprovacao da BQ.");
    } catch (error) {
      if (error.code === "auth/email-already-in-use") alert("Este e-mail ja esta cadastrado. Clique em Entrar e use sua senha.");
      else alert("Erro ao cadastrar: " + error.message);
      console.error(error);
    }
  };
  icons();
}

function renderNotice(title, text) {
  root.innerHTML = `<section class="notice"><h1>${title}</h1><p class="muted">${text}</p><button class="btn secondary" id="logoutBtn">Sair</button></section>`;
  $("logoutBtn").onclick = () => signOut(auth);
}

function canAccessApp() {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  return !profile.blocked && profile.status === "active" && profile.paymentStatus === "paid" && !isExpired(profile.planExpiresAt);
}

function nav(id, icon, label) {
  return `<button class="${tab === id ? "active" : ""}" data-tab="${id}"><i data-lucide="${icon}"></i>${label}</button>`;
}

function renderShell() {
  const isAdmin = profile.role === "admin";
  const titleMap = {
    admin: "BI Administrativo BQ", dashboard: "Resumo", agenda: "Agenda", clientes: "Clientes",
    servicos: "Servicos", financeiro: "Financeiro", disponibilidade: "Disponibilidade", online: "Perfil e agendamento"
  };

  root.innerHTML = `
    <section class="app">
      <aside class="sidebar">
        <div class="brand"><strong>BQ Agenda</strong><span>${isAdmin ? "Painel administrativo" : profile.businessName || "Estabelecimento"}</span></div>
        <nav class="nav">
          ${isAdmin ? nav("admin", "chart-no-axes-combined", "BI") : `
            ${nav("dashboard", "layout-dashboard", "Resumo")}
            ${nav("agenda", "calendar-days", "Agenda")}
            ${nav("clientes", "users", "Clientes")}
            ${nav("servicos", "scissors", "Servicos")}
            ${nav("financeiro", "wallet", "Financeiro")}
            ${nav("disponibilidade", "clock", "Disponibilidade")}
            ${nav("online", "image", "Perfil")}
          `}
        </nav>
      </aside>
      <section class="content">
        <header class="topbar">
          <div><h2>${titleMap[tab]}</h2><p>${isAdmin ? "Acompanhe operacao, planos, pendencias e uso da plataforma." : "Gerencie sua rotina em um unico lugar."}</p></div>
          <button class="btn secondary" id="logoutBtn"><i data-lucide="log-out"></i>Sair</button>
        </header>
        <div id="view"></div>
      </section>
    </section>`;

  document.querySelectorAll("[data-tab]").forEach(button => {
    button.onclick = () => { tab = button.dataset.tab; renderShell(); };
  });
  $("logoutBtn").onclick = () => signOut(auth);

  if (isAdmin) renderAdmin();
  if (!isAdmin && tab === "dashboard") renderDashboard();
  if (!isAdmin && tab === "agenda") renderAgenda();
  if (!isAdmin && tab === "clientes") renderClientes();
  if (!isAdmin && tab === "servicos") renderServicos();
  if (!isAdmin && tab === "financeiro") renderFinanceiro();
  if (!isAdmin && tab === "disponibilidade") renderDisponibilidade();
  if (!isAdmin && tab === "online") renderOnline();
  icons();
}

function renderDashboard() {
  const month = today().slice(0, 7);
  const paidMonth = appointments.filter(a => (a.date || "").startsWith(month) && a.paymentStatus === "paid").reduce((s, a) => s + Number(a.price || 0), 0);
  const pendingMoney = appointments.filter(a => a.paymentStatus !== "paid").reduce((s, a) => s + Number(a.price || 0), 0);
  view.innerHTML = `
    <div class="grid cards">
      <div class="card"><small>Ganhos do mes</small><strong>${money(paidMonth)}</strong></div>
      <div class="card"><small>Valores pendentes</small><strong>${money(pendingMoney)}</strong></div>
      <div class="card"><small>Clientes</small><strong>${clients.length}</strong></div>
      <div class="card"><small>Agendamentos</small><strong>${appointments.length}</strong></div>
    </div>
    <div class="panel" style="margin-top:16px"><h3>Proximos agendamentos</h3><div class="list">${appointments.slice(0, 8).map(appointmentItem).join("") || empty("Nenhum agendamento.")}</div></div>`;
}

function renderAgenda() {
  view.innerHTML = `
    <div class="grid two">
      <form id="appointmentForm" class="panel form">
        <h3>Novo agendamento</h3>
        <input name="clientName" placeholder="Nome do cliente" required>
        <input name="clientPhone" placeholder="WhatsApp do cliente" required>
        <select name="serviceId" required><option value="">Servico</option>${services.map(s => `<option value="${s.id}">${s.name} - ${money(s.price)} - ${s.duration} min</option>`).join("")}</select>
        <div class="row"><input name="date" type="date" value="${today()}" required><input name="time" type="time" required></div>
        <select name="paymentMethod">${Object.entries(paymentMethods).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <select name="paymentStatus"><option value="pending">Pagamento pendente</option><option value="paid">Pago</option><option value="canceled">Cancelado</option></select>
        <textarea name="notes" placeholder="Observacoes"></textarea>
        <button class="btn" type="submit">Salvar agendamento</button>
      </form>
      <div class="panel"><h3>Agenda</h3><div class="list">${appointments.map(appointmentItem).join("") || empty("Nenhum agendamento.")}</div></div>
    </div>`;
  $("appointmentForm").onsubmit = saveAppointment;
}

async function saveAppointment(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.target));
  const phoneKey = onlyDigits(data.clientPhone);
  const service = services.find(s => s.id === data.serviceId);
  if (!service) return alert("Selecione um servico.");

  const availableSlots = getAvailableSlots({
    date: data.date, service, availability: profile.availability || {}, appointments, bookingWindow: profile.bookingWindow || "month"
  });

  if (!availableSlots.includes(data.time)) {
    alert("Este horario nao esta disponivel para a duracao desse servico.");
    return;
  }

  await setDoc(itemRef("clients", phoneKey), {
    id: phoneKey, phoneKey, name: data.clientName, phone: phoneKey, updatedAt: serverTimestamp(), createdBy: "establishment"
  }, { merge: true });

  await addDoc(col("appointments"), {
    clientId: phoneKey, clientName: data.clientName, clientPhone: phoneKey,
    serviceId: data.serviceId, serviceName: service.name || "", price: Number(service.price || 0),
    duration: Number(service.duration || 30), date: data.date, time: data.time,
    startMinutes: timeToMinutes(data.time), endMinutes: timeToMinutes(data.time) + Number(service.duration || 30),
    status: "confirmed", paymentMethod: data.paymentMethod, paymentStatus: data.paymentStatus,
    notes: data.notes, source: "manual", createdAt: serverTimestamp()
  });

  event.target.reset();
}

function appointmentItem(a) {
  const phone = onlyDigits(a.clientPhone);
  const msg = encodeURIComponent(`Ola ${a.clientName}, seu horario em ${a.date} as ${a.time} esta registrado.`);
  return `
    <article class="item">
      <div class="item-head"><strong>${a.clientName}</strong><span class="badge ${a.paymentStatus === "paid" ? "paid" : "pending"}">${a.paymentStatus === "paid" ? "Pago" : "Pendente"}</span></div>
      <span>${a.date || ""} as ${a.time || ""} - ${a.serviceName || "Servico"} (${a.duration || 30} min)</span>
      <span>${money(a.price)} - ${paymentMethods[a.paymentMethod] || "Sem forma"}</span>
      <div class="actions">
        ${phone ? `<a class="btn secondary" target="_blank" href="https://wa.me/55${phone}?text=${msg}">WhatsApp</a>` : ""}
        <button class="btn ok" onclick="window.markPaid('${a.id}')">Marcar pago</button>
        <button class="btn danger" onclick="window.removeAppointment('${a.id}')">Excluir</button>
      </div>
    </article>`;
}

window.markPaid = async id => setDoc(itemRef("appointments", id), { paymentStatus: "paid" }, { merge: true });
window.removeAppointment = async id => { if (confirm("Excluir agendamento?")) await deleteDoc(itemRef("appointments", id)); };

function renderClientes() {
  view.innerHTML = `
    <div class="grid two">
      <form id="clientForm" class="panel form"><h3>Novo cliente</h3><input name="name" placeholder="Nome" required><input name="phone" placeholder="WhatsApp" required><textarea name="notes" placeholder="Observacoes"></textarea><button class="btn" type="submit">Salvar cliente</button></form>
      <div class="panel"><h3>Base de clientes</h3><div class="list">${clients.map(clientItem).join("") || empty("Nenhum cliente.")}</div></div>
    </div>`;
  $("clientForm").onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const phoneKey = onlyDigits(data.phone);
    await setDoc(itemRef("clients", phoneKey), { id: phoneKey, phoneKey, name: data.name, phone: phoneKey, notes: data.notes, updatedAt: serverTimestamp() }, { merge: true });
    event.target.reset();
  };
}

function clientItem(c) {
  return `<article class="item"><div class="item-head"><strong>${c.name}</strong><button class="btn danger" onclick="window.removeClient('${c.id}')">Excluir</button></div><span class="muted">${c.phone || ""}</span><span>${c.notes || ""}</span></article>`;
}
window.removeClient = async id => { if (confirm("Excluir cliente?")) await deleteDoc(itemRef("clients", id)); };

function renderServicos() {
  view.innerHTML = `
    <div class="grid two">
      <form id="serviceForm" class="panel form">
        <h3>Novo servico</h3><input name="name" placeholder="Nome do servico" required>
        <div class="row"><input name="price" type="number" min="0" step="0.01" placeholder="Preco" required><input name="duration" type="number" min="5" step="5" placeholder="Duracao em minutos" required></div>
        <textarea name="description" placeholder="Descricao"></textarea><button class="btn" type="submit">Salvar servico</button>
      </form>
      <div class="panel"><h3>Servicos</h3><div class="list">${services.map(serviceItem).join("") || empty("Nenhum servico.")}</div></div>
    </div>`;
  $("serviceForm").onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    await addDoc(col("services"), { name: data.name, price: Number(data.price || 0), duration: Number(data.duration || 0), description: data.description, active: true, createdAt: serverTimestamp() });
    event.target.reset();
  };
}

function serviceItem(s) {
  return `<article class="item"><div class="item-head"><strong>${s.name}</strong><button class="btn danger" onclick="window.removeService('${s.id}')">Excluir</button></div><span>${money(s.price)} - ${s.duration} min</span><span class="muted">${s.description || ""}</span></article>`;
}
window.removeService = async id => { if (confirm("Excluir servico?")) await deleteDoc(itemRef("services", id)); };

function renderFinanceiro() {
  const paid = appointments.filter(a => a.paymentStatus === "paid");
  const pending = appointments.filter(a => a.paymentStatus !== "paid");
  const totalPaid = paid.reduce((s, a) => s + Number(a.price || 0), 0);
  const totalPending = pending.reduce((s, a) => s + Number(a.price || 0), 0);
  const expenses = transactions.filter(t => t.type === "expense").reduce((s, t) => s + Number(t.value || 0), 0);
  const byMethod = Object.keys(paymentMethods).map(method => {
    const total = paid.filter(a => a.paymentMethod === method).reduce((s, a) => s + Number(a.price || 0), 0);
    return `<div class="item"><strong>${paymentMethods[method]}</strong><span>${money(total)}</span></div>`;
  }).join("");

  view.innerHTML = `
    <div class="grid cards"><div class="card"><small>Recebido</small><strong class="ok-text">${money(totalPaid)}</strong></div><div class="card"><small>Pendente</small><strong>${money(totalPending)}</strong></div><div class="card"><small>Despesas</small><strong class="danger-text">${money(expenses)}</strong></div><div class="card"><small>Saldo</small><strong>${money(totalPaid - expenses)}</strong></div></div>
    <div class="grid two" style="margin-top:16px">
      <form id="expenseForm" class="panel form"><h3>Nova despesa</h3><input name="description" placeholder="Descricao" required><div class="row"><input name="value" type="number" min="0" step="0.01" placeholder="Valor" required><input name="date" type="date" value="${today()}" required></div><button class="btn" type="submit">Salvar despesa</button></form>
      <div class="panel"><h3>Ganhos por pagamento</h3><div class="list">${byMethod}</div></div>
    </div>`;
  $("expenseForm").onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    await addDoc(col("transactions"), { type: "expense", description: data.description, value: Number(data.value || 0), date: data.date, createdAt: serverTimestamp() });
    event.target.reset();
  };
}

function renderDisponibilidade() {
  const availability = profile.availability || {};
  const bookingWindow = profile.bookingWindow || "month";
  const days = [["monday","Segunda"],["tuesday","Terca"],["wednesday","Quarta"],["thursday","Quinta"],["friday","Sexta"],["saturday","Sabado"],["sunday","Domingo"]];

  view.innerHTML = `
    <form id="availabilityForm" class="panel form">
      <h3>Horarios disponiveis</h3>
      <select name="bookingWindow">
        <option value="month" ${bookingWindow === "month" ? "selected" : ""}>Liberar agenda mes a mes</option>
        <option value="year" ${bookingWindow === "year" ? "selected" : ""}>Liberar agenda para o ano todo</option>
      </select>
      ${days.map(([key, label]) => {
        const item = availability[key] || {};
        return `<div class="item"><strong>${label}</strong><div class="row"><select name="${key}_enabled"><option value="false" ${!item.enabled ? "selected" : ""}>Indisponivel</option><option value="true" ${item.enabled ? "selected" : ""}>Disponivel</option></select><input name="${key}_slot" type="number" min="10" step="5" value="${item.slot || 30}" placeholder="Intervalo em minutos"></div><div class="row"><input name="${key}_start" type="time" value="${item.start || "09:00"}"><input name="${key}_end" type="time" value="${item.end || "18:00"}"></div></div>`;
      }).join("")}
      <button class="btn" type="submit">Salvar disponibilidade</button>
    </form>`;

  $("availabilityForm").onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const nextAvailability = {};
    days.forEach(([key]) => {
      nextAvailability[key] = { enabled: data[`${key}_enabled`] === "true", start: data[`${key}_start`], end: data[`${key}_end`], slot: Number(data[`${key}_slot`] || 30) };
    });
    await setDoc(userRef(user.uid), { bookingWindow: data.bookingWindow, availability: nextAvailability, updatedAt: serverTimestamp() }, { merge: true });
    alert("Disponibilidade salva.");
  };
}

function renderOnline() {
  const slug = profile.slug || makeSlug(profile.businessName || user.uid);
  const link = `${location.origin}${location.pathname}#book/${slug}`;
  const cover = profile.photoURL ? `<div class="profile-cover" style="background-image:url('${profile.photoURL}')"></div>` : `<div class="profile-cover empty-cover">Sem imagem do estabelecimento</div>`;

  view.innerHTML = `
    <div class="grid two">
      <form id="settingsForm" class="panel form">
        <h3>Perfil publico</h3>${cover}
        <label>Imagem do estabelecimento<input name="photo" type="file" accept="image/*"></label>
        <input name="businessName" value="${profile.businessName || ""}" placeholder="Nome do estabelecimento">
        <input name="phone" value="${profile.phone || ""}" placeholder="WhatsApp">
        <select name="publicBooking"><option value="true" ${profile.publicBooking !== false ? "selected" : ""}>Agendamento ativo</option><option value="false" ${profile.publicBooking === false ? "selected" : ""}>Agendamento pausado</option></select>
        <button class="btn" type="submit">Salvar perfil</button>
      </form>
      <div class="panel"><h3>Link publico</h3><input value="${link}" readonly><p class="muted">Envie este link para clientes agendarem sem criar conta.</p><div class="actions"><button class="btn" onclick="navigator.clipboard.writeText('${link}')">Copiar link</button><a class="btn secondary" target="_blank" href="${link}">Abrir</a></div></div>
    </div>`;

  $("settingsForm").onsubmit = async event => {
    event.preventDefault();
    try {
      const form = event.target;
      const data = Object.fromEntries(new FormData(form));
      let photoURL = profile.photoURL || "";
      const file = form.photo.files[0];

      if (file) {
        photoURL = await fileToCompressedDataUrl(file);
      }

      const nextSlug = makeSlug(data.businessName || profile.businessName || user.uid);
      const slugSnap = await getDoc(doc(db, "publicEstablishments", nextSlug));
      if (slugSnap.exists() && slugSnap.data().uid !== user.uid) {
        alert("Este nome de link ja esta em uso. Altere um pouco o nome do estabelecimento.");
        return;
      }

      await setDoc(userRef(user.uid), {
        businessName: data.businessName,
        phone: onlyDigits(data.phone),
        publicBooking: data.publicBooking === "true",
        photoURL,
        slug: nextSlug,
        updatedAt: serverTimestamp()
      }, { merge: true });

      await setDoc(doc(db, "publicEstablishments", nextSlug), {
        uid: user.uid,
        businessName: data.businessName,
        segment: profile.segment || "",
        city: profile.city || "",
        photoURL,
        publicBooking: data.publicBooking === "true",
        updatedAt: serverTimestamp()
      }, { merge: true });

      alert("Perfil salvo com sucesso.");
    } catch (error) {
      alert("Erro ao salvar perfil: " + error.message);
      console.error(error);
    }
  };
}

function renderAdmin() {
  const establishments = users.filter(u => u.role === "establishment");
  const pending = establishments.filter(u => u.status === "pending").length;
  const active = establishments.filter(u => u.status === "active" && !u.blocked && !isExpired(u.planExpiresAt)).length;
  const blocked = establishments.filter(u => u.blocked).length;
  const expired = establishments.filter(u => isExpired(u.planExpiresAt)).length;
  const month = today().slice(0, 7);
  const appointmentsToday = adminAppointments.filter(a => a.date === today()).length;
  const appointmentsMonth = adminAppointments.filter(a => (a.date || "").startsWith(month)).length;
  const paidMonth = adminAppointments.filter(a => (a.date || "").startsWith(month) && a.paymentStatus === "paid").reduce((s, a) => s + Number(a.price || 0), 0);
  const pendingMoney = adminAppointments.filter(a => a.paymentStatus !== "paid").reduce((s, a) => s + Number(a.price || 0), 0);
  const bqMonthlyRevenue = establishments.filter(u => u.status === "active" && !u.blocked && !isExpired(u.planExpiresAt)).reduce((s, u) => s + Number(planPrices[u.plan] || 0), 0);
  const planCount = { monthly: establishments.filter(u => u.plan === "monthly").length, quarterly: establishments.filter(u => u.plan === "quarterly").length, semiannual: establishments.filter(u => u.plan === "semiannual").length, annual: establishments.filter(u => u.plan === "annual").length };
  const ranking = establishments.map(est => {
    const estAppointments = adminAppointments.filter(a => a.establishmentId === est.id);
    const revenue = estAppointments.filter(a => a.paymentStatus === "paid").reduce((s, a) => s + Number(a.price || 0), 0);
    return { ...est, appointmentsCount: estAppointments.length, revenue };
  }).sort((a, b) => b.appointmentsCount - a.appointmentsCount).slice(0, 8);

  view.innerHTML = `
    <div class="grid cards"><div class="card"><small>Ativos</small><strong>${active}</strong></div><div class="card"><small>Pendentes</small><strong>${pending}</strong></div><div class="card"><small>Bloqueados</small><strong>${blocked}</strong></div><div class="card"><small>Vencidos</small><strong>${expired}</strong></div></div>
    <div class="grid cards" style="margin-top:16px"><div class="card"><small>Agendamentos hoje</small><strong>${appointmentsToday}</strong></div><div class="card"><small>Agendamentos no mes</small><strong>${appointmentsMonth}</strong></div><div class="card"><small>Movimentado no mes</small><strong>${money(paidMonth)}</strong></div><div class="card"><small>Pendente nos estabelecimentos</small><strong>${money(pendingMoney)}</strong></div></div>
    <div class="grid cards" style="margin-top:16px"><div class="card"><small>Receita BQ estimada</small><strong>${money(bqMonthlyRevenue)}</strong></div><div class="card"><small>Mensais</small><strong>${planCount.monthly}</strong></div><div class="card"><small>Trimestrais</small><strong>${planCount.quarterly}</strong></div><div class="card"><small>Anuais</small><strong>${planCount.annual}</strong></div></div>
    <div class="grid two" style="margin-top:16px"><div class="panel"><h3>Ranking de uso</h3><div class="list">${ranking.map(adminRankingItem).join("") || empty("Nenhum dado ainda.")}</div></div><div class="panel"><h3>Pendencias</h3><div class="list">${establishments.filter(u => u.status === "pending" || u.blocked || isExpired(u.planExpiresAt) || u.paymentStatus !== "paid").map(adminPendingItem).join("") || empty("Nenhuma pendencia.")}</div></div></div>
    <div class="panel" style="margin-top:16px"><h3>Estabelecimentos</h3><div class="list">${establishments.map(adminUserItem).join("") || empty("Nenhum estabelecimento cadastrado.")}</div></div>`;
}

function adminRankingItem(est) {
  return `<article class="item"><div class="item-head"><strong>${est.businessName || "Sem nome"}</strong><span class="badge active">${est.appointmentsCount} agendamentos</span></div><span class="muted">${est.city || ""} - ${plans[est.plan] || "Sem plano"}</span><span>Faturamento registrado: ${money(est.revenue)}</span></article>`;
}

function adminPendingItem(est) {
  let reason = "Pendente";
  if (est.blocked) reason = "Bloqueado";
  else if (isExpired(est.planExpiresAt)) reason = "Plano vencido";
  else if (est.paymentStatus !== "paid") reason = "Pagamento pendente";
  else if (est.status === "pending") reason = "Aguardando aprovacao";
  return `<article class="item"><div class="item-head"><strong>${est.businessName || "Sem nome"}</strong><span class="badge pending">${reason}</span></div><span>${est.ownerName || ""} - ${est.phone || ""}</span><span>Plano: ${plans[est.plan] || "-"} - Vence: ${est.planExpiresAt || "-"}</span></article>`;
}

function adminUserItem(u) {
  return `
    <article class="item">
      <div class="item-head"><strong>${u.businessName || "Sem nome"}</strong><span class="badge ${u.blocked ? "blocked" : u.status}">${u.blocked ? "Bloqueado" : u.status}</span></div>
      <span>${u.ownerName || ""} - ${u.email || ""} - ${u.phone || ""}</span>
      <span>Plano: ${plans[u.plan] || "-"} - Pagamento: ${u.paymentStatus || "-"} - Vence: ${u.planExpiresAt || "-"}</span>
      <div class="actions">
        <select id="plan-${u.id}">${Object.entries(plans).map(([k, v]) => `<option value="${k}" ${u.plan === k ? "selected" : ""}>${v}</option>`).join("")}</select>
        <button class="btn ok" onclick="window.approveUser('${u.id}')">Aprovar pago</button>
        <button class="btn secondary" onclick="window.savePlan('${u.id}')">Alterar plano</button>
        <button class="btn danger" onclick="window.blockUser('${u.id}', ${!u.blocked})">${u.blocked ? "Desbloquear" : "Bloquear"}</button>
      </div>
    </article>`;
}

window.approveUser = async uid => {
  const plan = $(`plan-${uid}`).value;
  await setDoc(userRef(uid), { status: "active", blocked: false, paymentStatus: "paid", plan, planExpiresAt: planExpiration(plan), approvedAt: serverTimestamp() }, { merge: true });
};
window.savePlan = async uid => {
  const plan = $(`plan-${uid}`).value;
  await setDoc(userRef(uid), { plan, planExpiresAt: planExpiration(plan), paymentStatus: "paid" }, { merge: true });
};
window.blockUser = async (uid, blocked) => setDoc(userRef(uid), { blocked }, { merge: true });

async function renderPublicBooking(uid) {
  const profileSnap = await getDoc(userRef(uid));
  const publicProfile = profileSnap.data();

  if (!publicProfile || publicProfile.publicBooking === false || publicProfile.status !== "active" || publicProfile.blocked || isExpired(publicProfile.planExpiresAt)) {
    root.innerHTML = `<section class="notice"><h1>Agendamento indisponivel</h1><p class="muted">Este estabelecimento nao esta recebendo agendamentos no momento.</p></section>`;
    return;
  }

  const servicesSnap = await getDocs(tenantCol(uid, "services"));
  const publicServices = servicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const appointmentsSnap = await getDocs(tenantCol(uid, "appointments"));
  const publicAppointments = appointmentsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const heroPhoto = publicProfile.photoURL || "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1600&q=80";

  root.innerHTML = `
    <section class="public-page">
      <header class="public-hero" style="--photo:url('${heroPhoto}')"><div><h1>${publicProfile.businessName}</h1><p>${publicProfile.segment || "Agendamento online"} · ${publicProfile.city || ""}</p></div></header>
      <div class="public-content">
        <form id="publicForm" class="panel form">
          <h3>Solicitar horario</h3>
          <input name="clientName" placeholder="Seu nome" required>
          <input name="clientPhone" placeholder="Seu WhatsApp" required>
          <select id="publicService" name="serviceId" required><option value="">Escolha um servico</option>${publicServices.map(s => `<option value="${s.id}">${s.name} - ${money(s.price)} - ${s.duration} min</option>`).join("")}</select>
          <div class="row"><input id="publicDate" name="date" type="date" min="${today()}" max="${publicProfile.bookingWindow === "year" ? lastDayOfCurrentYear() : lastDayOfCurrentMonth()}" required><select id="publicTime" name="time" required><option value="">Escolha servico e data</option></select></div>
          <select name="paymentMethod">${Object.entries(paymentMethods).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
          <textarea name="notes" placeholder="Observacoes"></textarea>
          <button class="btn" type="submit"><i data-lucide="calendar-plus"></i>Solicitar agendamento</button>
        </form>
      </div>
    </section>`;

  function refreshPublicTimes() {
    const service = publicServices.find(s => s.id === $("publicService").value);
    const slots = getAvailableSlots({
      date: $("publicDate").value, service, availability: publicProfile.availability || {},
      appointments: publicAppointments, bookingWindow: publicProfile.bookingWindow || "month"
    });
    $("publicTime").innerHTML = slots.length
      ? `<option value="">Escolha um horario</option>${slots.map(time => `<option value="${time}">${time}</option>`).join("")}`
      : `<option value="">Nenhum horario disponivel</option>`;
  }

  $("publicService").onchange = refreshPublicTimes;
  $("publicDate").onchange = refreshPublicTimes;

  $("publicForm").onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const phoneKey = onlyDigits(data.clientPhone);
    const service = publicServices.find(s => s.id === data.serviceId);

    const slots = getAvailableSlots({
      date: data.date, service, availability: publicProfile.availability || {},
      appointments: publicAppointments, bookingWindow: publicProfile.bookingWindow || "month"
    });

    if (!slots.includes(data.time)) {
      alert("Este horario acabou de ficar indisponivel. Escolha outro horario.");
      return;
    }

    await setDoc(tenantDoc(uid, "clients", phoneKey), { id: phoneKey, phoneKey, name: data.clientName, phone: phoneKey, updatedAt: serverTimestamp(), createdBy: "public-booking" }, { merge: true });

    await addDoc(tenantCol(uid, "appointments"), {
      clientId: phoneKey, clientName: data.clientName, clientPhone: phoneKey,
      serviceId: data.serviceId, serviceName: service?.name || "", price: Number(service?.price || 0),
      duration: Number(service?.duration || 30), date: data.date, time: data.time,
      startMinutes: timeToMinutes(data.time), endMinutes: timeToMinutes(data.time) + Number(service?.duration || 30),
      status: "pending", paymentMethod: data.paymentMethod, paymentStatus: "pending",
      notes: data.notes, source: "online", createdAt: serverTimestamp()
    });

    event.target.innerHTML = `<div class="empty"><h2>Solicitacao enviada</h2><p>O estabelecimento recebeu seu pedido de horario.</p></div>`;
  };

  icons();
}

function subscribeEstablishment() {
  onSnapshot(userRef(user.uid), snap => { profile = snap.data(); renderShell(); });
  onSnapshot(col("clients"), snap => { clients = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderShell(); });
  onSnapshot(col("services"), snap => { services = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderShell(); });
  onSnapshot(col("appointments"), snap => {
    appointments = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    renderShell();
  });
  onSnapshot(col("transactions"), snap => { transactions = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderShell(); });
}

function subscribeAdmin() {
  onSnapshot(collection(db, "users"), snap => { users = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderShell(); });
  onSnapshot(collectionGroup(db, "appointments"), snap => {
    adminAppointments = snap.docs.map(d => ({ id: d.id, establishmentId: d.ref.path.split("/")[1], ...d.data() }));
    renderShell();
  });
  onSnapshot(collectionGroup(db, "transactions"), snap => {
    adminTransactions = snap.docs.map(d => ({ id: d.id, establishmentId: d.ref.path.split("/")[1], ...d.data() }));
    renderShell();
  });
}

function bookingSlugFromHash() {
  if (!location.hash.startsWith("#book/")) return "";
  return location.hash.replace("#book/", "").split("?")[0];
}

async function getUidFromBookingHash() {
  const oldUid = new URLSearchParams(location.hash.split("?")[1] || "").get("pro");
  if (oldUid) return oldUid;
  const slug = bookingSlugFromHash();
  if (!slug) return "";
  const publicSnap = await getDoc(doc(db, "publicEstablishments", slug));
  return publicSnap.exists() ? publicSnap.data().uid : "";
}

onAuthStateChanged(auth, async currentUser => {
  const bookingUid = await getUidFromBookingHash();

  if (location.hash.startsWith("#book") && bookingUid) {
    await renderPublicBooking(bookingUid);
    return;
  }

  user = currentUser;
  if (!user) return renderAuth();

  const profileSnap = await getDoc(userRef(user.uid));
  profile = profileSnap.data();

  if (!profile) return renderNotice("Cadastro incompleto", "Entre em contato com a BQ para configurar sua conta.");

  if (profile.role === "admin") {
    tab = "admin";
    subscribeAdmin();
    renderShell();
    return;
  }

  if (profile.status === "pending") return renderNotice("Cadastro enviado para analise", "A equipe BQ entrara em contato para finalizar o pagamento e liberar seu acesso.");
  if (profile.blocked) return renderNotice("Acesso bloqueado", "Entre em contato com a BQ para regularizar seu acesso.");
  if (profile.paymentStatus !== "paid") return renderNotice("Pagamento pendente", "Seu acesso ainda nao foi liberado pela BQ.");
  if (isExpired(profile.planExpiresAt)) return renderNotice("Plano vencido", "Entre em contato com a BQ para renovar seu plano.");
  if (!canAccessApp()) return;

  subscribeEstablishment();
  renderShell();
});
