import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
const root = document.getElementById("root");
const bqWhatsapp = "5511996785799";

let currentUser = null;
let profile = null;
let activeTab = "dashboard";
let unsubscribers = [];
let users = [];
let clients = [];
let services = [];
let appointments = [];
let transactions = [];
let adminSelectedUserId = null;
let adminSelectedData = { clients: [], appointments: [], services: [], transactions: [] };

const plans = {
  monthly: "Plano mensal",
  quarterly: "Plano trimestral",
  semiannual: "Plano semestral",
  annual: "Plano anual"
};

const planPrices = {
  monthly: 29.99,
  quarterly: 59.99,
  semiannual: 0,
  annual: 0
};

const paymentMethods = ["Pix", "Dinheiro", "Cartao de credito", "Cartao de debito", "Transferencia"];

const weekKeys = [
  ["mon", "Segunda"],
  ["tue", "Terca"],
  ["wed", "Quarta"],
  ["thu", "Quinta"],
  ["fri", "Sexta"],
  ["sat", "Sabado"],
  ["sun", "Domingo"]
];

function $(id) {
  return document.getElementById(id);
}

function money(value) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDateBR(dateString) {
  if (!dateString || !dateString.includes("-")) return dateString || "";
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
}

function makeSlug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function whatsappUrl(phone, text) {
  const clean = onlyDigits(phone);
  const finalPhone = clean.startsWith("55") ? clean : `55${clean}`;
  return `https://wa.me/${finalPhone}?text=${encodeURIComponent(text)}`;
}

function icon(name) {
  return `<i data-lucide="${name}"></i>`;
}

function renderIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function tenantDoc(uid, name, id) {
  return doc(db, "users", uid, name, id);
}

function tenantCol(uid, name) {
  return collection(db, "users", uid, name);
}

function clearSubscriptions() {
  unsubscribers.forEach(unsub => unsub && unsub());
  unsubscribers = [];
}

function empty(title, text) {
  return `<div class="empty"><strong>${title}</strong><span>${text}</span></div>`;
}

function timeToMinutes(time) {
  const [h, m] = String(time || "00:00").split(":").map(Number);
  return h * 60 + m;
}

function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function overlaps(startA, endA, startB, endB) {
  return startA < endB && endA > startB;
}

function dateToWeekKey(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][date.getDay()];
}

function lastDayOfCurrentMonth() {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}

function lastDayOfCurrentYear() {
  const d = new Date();
  return `${d.getFullYear()}-12-31`;
}

function getDayIntervals(dayConfig) {
  if (!dayConfig || dayConfig.enabled !== true) return [];
  let intervals = [];
  if (Array.isArray(dayConfig.intervals) && dayConfig.intervals.length) intervals = dayConfig.intervals;
  else if (dayConfig.start && dayConfig.end) intervals = [{ start: dayConfig.start, end: dayConfig.end }];

  return intervals
    .map(item => ({ start: item.start, end: item.end }))
    .filter(item => item.start && item.end && timeToMinutes(item.start) < timeToMinutes(item.end))
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
}

function getAppointmentBusyRange(appointment) {
  const start = Number.isFinite(Number(appointment.startMinutes))
    ? Number(appointment.startMinutes)
    : timeToMinutes(appointment.time);

  const duration = Number(appointment.duration || appointment.serviceDuration || 30);

  const end = Number.isFinite(Number(appointment.endMinutes)) && Number(appointment.endMinutes) > start
    ? Number(appointment.endMinutes)
    : start + duration;

  return { start, end };
}

function getAvailableSlots({ date, service, availability, appointments: list, bookingWindow }) {
  if (!date || !service) return [];
  if (date < today()) return [];
  if ((bookingWindow || "month") === "month" && date > lastDayOfCurrentMonth()) return [];
  if (bookingWindow === "year" && date > lastDayOfCurrentYear()) return [];

  const weekKey = dateToWeekKey(date);
  const dayConfig = availability?.[weekKey];
  const intervals = getDayIntervals(dayConfig);
  if (!intervals.length) return [];

  const slot = Number(dayConfig.slot || 30);
  const duration = Number(service.duration || 30);

  const busy = list
    .filter(item => item.date === date && item.status !== "canceled")
    .map(getAppointmentBusyRange)
    .filter(range => range.end > range.start);

  const result = new Set();

  intervals.forEach(interval => {
    const intervalStart = timeToMinutes(interval.start);
    const intervalEnd = timeToMinutes(interval.end);

    for (let current = intervalStart; current + duration <= intervalEnd; current += slot) {
      const end = current + duration;
      const conflict = busy.some(range => overlaps(current, end, range.start, range.end));
      if (!conflict) result.add(minutesToTime(current));
    }
  });

  return Array.from(result).sort();
}

function fileToCompressedDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    const reader = new FileReader();

    reader.onload = () => {
      const image = new Image();

      image.onload = () => {
        const max = 800;
        const ratio = Math.min(max / image.width, max / image.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * ratio);
        canvas.height = Math.round(image.height * ratio);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/jpeg", 0.72));
      };

      image.onerror = reject;
      image.src = reader.result;
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function defaultAvailability() {
  return {
    mon: { enabled: true, slot: 30, intervals: [{ start: "09:00", end: "18:00" }] },
    tue: { enabled: true, slot: 30, intervals: [{ start: "09:00", end: "18:00" }] },
    wed: { enabled: true, slot: 30, intervals: [{ start: "09:00", end: "18:00" }] },
    thu: { enabled: true, slot: 30, intervals: [{ start: "09:00", end: "18:00" }] },
    fri: { enabled: true, slot: 30, intervals: [{ start: "09:00", end: "18:00" }] },
    sat: { enabled: false, slot: 30, intervals: [{ start: "09:00", end: "12:00" }] },
    sun: { enabled: false, slot: 30, intervals: [{ start: "09:00", end: "12:00" }] }
  };
}

function addMonthsToDate(dateString, months) {
  const base = dateString ? new Date(dateString + "T12:00:00") : new Date();
  base.setMonth(base.getMonth() + months);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

function planMonths(plan) {
  if (plan === "quarterly") return 3;
  if (plan === "semiannual") return 6;
  if (plan === "annual") return 12;
  return 1;
}

function billingStatusLabel(user) {
  if (user.blocked) return "Bloqueado";
  if (!user.billingDueDate) return "Sem vencimento";
  if (user.billingStatus === "paid" && user.billingDueDate >= today()) return "Em dia";
  if (user.billingDueDate < today()) return "Vencido";
  return "Pendente";
}

function publicBookingLink(user) {
  const slug = user.slug || user.id;
  return `${location.origin}${location.pathname}#book/${slug}`;
}

function renderAuth() {
  const mode = location.hash === "#register" ? "register" : "login";

  root.innerHTML = `
    <section class="auth-page modern-auth">
      <div class="auth-hero">
        <img src="logo.png" alt="BQ Agenda" class="auth-logo">
        <h1>Agenda online para negócios que vivem de horário.</h1>
        <p>Organize seus agendamentos, confirme pelo WhatsApp, acompanhe seus clientes e controle seus ganhos em uma plataforma simples, web e pronta para usar.</p>

        <div class="auth-benefits">
          <div><strong>Agenda online</strong><span>Seu cliente escolhe serviço, data e horário pelo link público.</span></div>
          <div><strong>Confirmação rápida</strong><span>O cliente envia os dados do agendamento direto para o WhatsApp do estabelecimento.</span></div>
          <div><strong>Gestão completa</strong><span>Controle clientes, serviços, pagamentos, agenda e financeiro.</span></div>
        </div>

        <small>100% web, pronto para GitHub Pages e Firebase.</small>
      </div>

      <div class="auth-card">
        <div class="auth-card-head">
          <h2>${mode === "register" ? "Cadastrar estabelecimento" : "Acessar plataforma"}</h2>
          <p>${mode === "register" ? "Envie seu cadastro para análise e fale com a BQ pelo WhatsApp." : "Entre na sua conta ou envie o cadastro do estabelecimento para análise."}</p>
        </div>

        <div class="auth-tabs">
          <button class="${mode === "login" ? "active" : ""}" onclick="location.hash='#login'">Entrar</button>
          <button class="${mode === "register" ? "active" : ""}" onclick="location.hash='#register'">Cadastrar estabelecimento</button>
        </div>

        <div id="authForm"></div>
      </div>
    </section>
  `;

  mode === "register" ? renderRegisterForm() : renderLoginForm();
  renderIcons();
}

function renderLoginForm() {
  $("authForm").innerHTML = `
    <form id="loginForm" class="form-stack">
      <input id="loginEmail" type="email" placeholder="E-mail" required>
      <input id="loginPassword" type="password" placeholder="Senha" required>
      <button class="btn primary" type="submit">${icon("log-in")} Entrar</button>
      <div id="authMessage" class="form-message"></div>
    </form>
  `;

  $("loginForm").onsubmit = async event => {
    event.preventDefault();
    $("authMessage").textContent = "Entrando...";

    try {
      await signInWithEmailAndPassword(auth, $("loginEmail").value, $("loginPassword").value);
    } catch (error) {
      $("authMessage").textContent = "Erro ao entrar: " + error.message;
    }
  };

  renderIcons();
}

function renderRegisterForm() {
  $("authForm").innerHTML = `
    <form id="registerForm" class="form-stack">
      <input id="ownerName" placeholder="Nome do responsável" required>
      <input id="businessName" placeholder="Nome do estabelecimento" required>
      <input id="segment" placeholder="Segmento" required>
      <div class="grid-2">
        <input id="city" placeholder="Cidade" required>
        <input id="whatsapp" placeholder="WhatsApp" required>
      </div>
      <select id="plan" required>
        <option value="monthly">Plano mensal - R$ 29,99</option>
        <option value="quarterly">Plano trimestral - R$ 59,99</option>
      </select>
      <input id="registerEmail" type="email" placeholder="E-mail" required>
      <input id="registerPassword" type="password" placeholder="Senha" minlength="6" required>
      <button class="btn primary" type="submit">${icon("send")} Enviar para análise</button>
      <a class="btn whatsapp" target="_blank" rel="noopener" href="${whatsappUrl(bqWhatsapp, "Olá, BQ Agenda! Tenho interesse em cadastrar meu estabelecimento.")}">${icon("message-circle")} Falar com a BQ</a>
      <div id="authMessage" class="form-message"></div>
    </form>
  `;

  $("registerForm").onsubmit = async event => {
    event.preventDefault();

    const data = {
      ownerName: $("ownerName").value.trim(),
      businessName: $("businessName").value.trim(),
      segment: $("segment").value.trim(),
      city: $("city").value.trim(),
      whatsapp: onlyDigits($("whatsapp").value),
      plan: $("plan").value,
      email: $("registerEmail").value.trim(),
      password: $("registerPassword").value
    };

    $("authMessage").textContent = "Criando cadastro...";

    try {
      const credential = await createUserWithEmailAndPassword(auth, data.email, data.password);
      const uid = credential.user.uid;
      const slug = makeSlug(data.businessName);

      await setDoc(doc(db, "users", uid), {
        uid,
        ownerName: data.ownerName,
        businessName: data.businessName,
        segment: data.segment,
        city: data.city,
        whatsapp: data.whatsapp,
        plan: data.plan,
        planLabel: plans[data.plan],
        planPrice: planPrices[data.plan],
        email: data.email,
        role: "establishment",
        status: "pending",
        billingStatus: "pending",
        billingDueDate: "",
        blocked: false,
        slug,
        bookingWindow: "month",
        availability: defaultAvailability(),
        createdAt: serverTimestamp()
      });

      await setDoc(doc(db, "publicEstablishments", slug), {
        uid,
        slug,
        businessName: data.businessName,
        segment: data.segment,
        city: data.city,
        whatsapp: data.whatsapp,
        status: "pending",
        blocked: false,
        createdAt: serverTimestamp()
      });

      const message = [
        "Olá, BQ Agenda!",
        "",
        "Acabei de solicitar meu cadastro na plataforma.",
        "",
        `Responsável: ${data.ownerName}`,
        `Estabelecimento: ${data.businessName}`,
        `Segmento: ${data.segment}`,
        `Cidade: ${data.city}`,
        `WhatsApp: ${data.whatsapp}`,
        `Plano escolhido: ${plans[data.plan]}`,
        `Valor: ${money(planPrices[data.plan])}`,
        `E-mail: ${data.email}`,
        "",
        "Aguardo contato para aprovação do meu cadastro."
      ].join("\n");

      window.open(whatsappUrl(bqWhatsapp, message), "_blank");
      $("authMessage").textContent = "Cadastro enviado. Aguarde aprovação da BQ.";
    } catch (error) {
      $("authMessage").textContent = "Erro ao cadastrar: " + error.message;
    }
  };

  renderIcons();
}

function renderShell() {
  const admin = profile?.role === "admin";

  root.innerHTML = `
    <section class="app-shell">
      <aside class="sidebar">
        <div class="brand"><img src="logo.png" alt="BQ Agenda"></div>

        <nav>
          ${navButton("dashboard", "layout-dashboard", "Dashboard")}
          ${admin ? navButton("admin", "shield-check", "Admin BQ") : ""}
          ${!admin ? navButton("agenda", "calendar-days", "Agenda") : ""}
          ${!admin ? navButton("clientes", "users", "Clientes") : ""}
          ${!admin ? navButton("servicos", "scissors", "Serviços") : ""}
          ${!admin ? navButton("financeiro", "wallet", "Financeiro") : ""}
          ${!admin ? navButton("disponibilidade", "clock", "Disponibilidade") : ""}
          ${!admin ? navButton("online", "globe", "Link online") : ""}
        </nav>

        <button class="btn secondary" id="logoutBtn">${icon("log-out")} Sair</button>
      </aside>

      <main class="content"><div id="view"></div></main>
    </section>
  `;

  $("logoutBtn").onclick = () => signOut(auth);
  renderView();
  renderIcons();
}

function navButton(id, iconName, label) {
  return `<button class="${activeTab === id ? "active" : ""}" onclick="window.changeTab('${id}')">${icon(iconName)} ${label}</button>`;
}

window.changeTab = tab => {
  activeTab = tab;
  renderShell();
};

function renderView() {
  if (activeTab === "admin") return renderAdmin();
  if (activeTab === "agenda") return renderAgenda();
  if (activeTab === "clientes") return renderClientes();
  if (activeTab === "servicos") return renderServicos();
  if (activeTab === "financeiro") return renderFinanceiro();
  if (activeTab === "disponibilidade") return renderDisponibilidade();
  if (activeTab === "online") return renderOnline();
  return renderDashboard();
}

function renderDashboard() {
  const future = appointments.filter(a => a.date >= today() && a.status !== "canceled").length;
  const totalClients = clients.length;
  const paid = transactions.filter(t => t.type === "income").reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const pending = appointments.filter(a => a.status === "pending").length;

  $("view").innerHTML = `
    <header class="page-head">
      <div><h1>Dashboard</h1><p>${profile.businessName || "BQ Agenda"}</p></div>
    </header>

    <section class="metrics">
      <div class="metric"><span>Agenda futura</span><strong>${future}</strong></div>
      <div class="metric"><span>Clientes</span><strong>${totalClients}</strong></div>
      <div class="metric"><span>Receita registrada</span><strong>${money(paid)}</strong></div>
      <div class="metric"><span>Pendentes</span><strong>${pending}</strong></div>
    </section>

    <section class="panel">
      <h2>Próximos agendamentos</h2>
      <div class="list">
        ${
          appointments
            .filter(a => a.date >= today() && a.status !== "canceled")
            .sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))
            .slice(0, 8)
            .map(appointmentItem)
            .join("") || empty("Nada por enquanto", "Os novos agendamentos aparecerão aqui.")
        }
      </div>
    </section>
  `;

  renderIcons();
}

function renderAgenda() {
  $("view").innerHTML = `
    <header class="page-head"><div><h1>Agenda</h1><p>Crie e acompanhe os atendimentos.</p></div></header>

    <section class="panel">
      <form id="appointmentForm" class="form-grid">
        <input id="apClientName" placeholder="Nome do cliente" required>
        <input id="apPhone" placeholder="WhatsApp" required>
        <select id="apService" required>
          <option value="">Serviço</option>
          ${services.map(s => `<option value="${s.id}">${s.name} - ${money(s.price)} - ${s.duration} min</option>`).join("")}
        </select>
        <input id="apDate" type="date" min="${today()}" required>
        <select id="apTime" required><option value="">Escolha data e serviço</option></select>
        <select id="apPayment">${paymentMethods.map(p => `<option>${p}</option>`).join("")}</select>
        <textarea id="apNotes" placeholder="Observações"></textarea>
        <button class="btn primary" type="submit">${icon("calendar-plus")} Salvar agendamento</button>
      </form>
    </section>

    <section class="panel">
      <h2>Agendamentos</h2>
      <div class="list">${appointments.map(appointmentItem).join("") || empty("Sem agendamentos", "Cadastre ou divulgue seu link online.")}</div>
    </section>
  `;

  const updateTimes = () => {
    const service = services.find(s => s.id === $("apService").value);
    const date = $("apDate").value;
    const slots = getAvailableSlots({
      date,
      service,
      availability: profile.availability || defaultAvailability(),
      appointments,
      bookingWindow: profile.bookingWindow || "month"
    });

    $("apTime").innerHTML = `<option value="">Escolha um horário</option>${slots.map(t => `<option>${t}</option>`).join("")}`;
  };

  $("apService").onchange = updateTimes;
  $("apDate").onchange = updateTimes;

  $("appointmentForm").onsubmit = async event => {
    event.preventDefault();

    await saveAppointment({
      clientName: $("apClientName").value.trim(),
      phone: $("apPhone").value,
      serviceId: $("apService").value,
      date: $("apDate").value,
      time: $("apTime").value,
      paymentMethod: $("apPayment").value,
      notes: $("apNotes").value.trim(),
      source: "manual",
      status: "confirmed"
    });

    $("appointmentForm").reset();
  };

  renderIcons();
}

async function saveAppointment(data) {
  const service = services.find(s => s.id === data.serviceId);
  const phoneKey = onlyDigits(data.phone);
  const startMinutes = timeToMinutes(data.time);
  const duration = Number(service?.duration || 30);
  const endMinutes = startMinutes + duration;

  await setDoc(tenantDoc(currentUser.uid, "clients", phoneKey), {
    phoneKey,
    name: data.clientName,
    phone: phoneKey,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  }, { merge: true });

  await addDoc(tenantCol(currentUser.uid, "appointments"), {
    ...data,
    phone: phoneKey,
    phoneKey,
    serviceName: service?.name || "",
    servicePrice: Number(service?.price || 0),
    duration,
    startMinutes,
    endMinutes,
    createdAt: serverTimestamp()
  });
}

function appointmentItem(a) {
  return `
    <article class="item">
      <div>
        <strong>${a.clientName || "Cliente"}</strong>
        <span>${formatDateBR(a.date)} às ${a.time} • ${a.serviceName || ""} • ${a.status || "pending"}</span>
      </div>
      <div class="item-actions">
        <span>${money(a.servicePrice || 0)}</span>
        <button class="icon-btn" onclick="window.removeAppointment('${a.id}')">${icon("trash-2")}</button>
      </div>
    </article>
  `;
}

window.removeAppointment = async id => {
  if (!confirm("Remover agendamento?")) return;
  await deleteDoc(tenantDoc(currentUser.uid, "appointments", id));
};

function renderClientes() {
  $("view").innerHTML = `
    <header class="page-head"><div><h1>Clientes</h1><p>Base criada automaticamente pelo WhatsApp.</p></div></header>
    <section class="panel">
      <div class="list">
        ${clients.map(c => `
          <article class="item">
            <div><strong>${c.name || "Cliente"}</strong><span>${c.phone || c.phoneKey || ""}</span></div>
            <button class="icon-btn" onclick="window.removeClient('${c.id}')">${icon("trash-2")}</button>
          </article>
        `).join("") || empty("Sem clientes", "Quando alguém agendar, o cliente será salvo aqui.")}
      </div>
    </section>
  `;

  renderIcons();
}

window.removeClient = async id => {
  if (!confirm("Remover cliente?")) return;
  await deleteDoc(tenantDoc(currentUser.uid, "clients", id));
};

function renderServicos() {
  $("view").innerHTML = `
    <header class="page-head"><div><h1>Serviços</h1><p>Configure preços e duração para evitar conflitos de horário.</p></div></header>

    <section class="panel">
      <form id="serviceForm" class="form-grid">
        <input id="serviceName" placeholder="Nome do serviço" required>
        <input id="servicePrice" type="number" step="0.01" min="0" placeholder="Valor" required>
        <input id="serviceDuration" type="number" min="5" step="5" placeholder="Duração em minutos" required>
        <button class="btn primary" type="submit">${icon("plus")} Adicionar serviço</button>
      </form>
    </section>

    <section class="panel">
      <div class="list">
        ${services.map(s => `
          <article class="item">
            <div><strong>${s.name}</strong><span>${money(s.price)} • ${s.duration} min</span></div>
            <button class="icon-btn" onclick="window.removeService('${s.id}')">${icon("trash-2")}</button>
          </article>
        `).join("") || empty("Sem serviços", "Adicione os serviços que seus clientes poderão escolher.")}
      </div>
    </section>
  `;

  $("serviceForm").onsubmit = async event => {
    event.preventDefault();

    await addDoc(tenantCol(currentUser.uid, "services"), {
      name: $("serviceName").value.trim(),
      price: Number($("servicePrice").value),
      duration: Number($("serviceDuration").value),
      active: true,
      createdAt: serverTimestamp()
    });

    $("serviceForm").reset();
  };

  renderIcons();
}

window.removeService = async id => {
  if (!confirm("Remover serviço?")) return;
  await deleteDoc(tenantDoc(currentUser.uid, "services", id));
};

function renderFinanceiro() {
  const income = transactions.filter(t => t.type === "income").reduce((sum, t) => sum + Number(t.amount || 0), 0);
  const expense = transactions.filter(t => t.type === "expense").reduce((sum, t) => sum + Number(t.amount || 0), 0);

  $("view").innerHTML = `
    <header class="page-head"><div><h1>Financeiro</h1><p>Acompanhe ganhos e meios de pagamento.</p></div></header>

    <section class="metrics">
      <div class="metric"><span>Entradas</span><strong>${money(income)}</strong></div>
      <div class="metric"><span>Saídas</span><strong>${money(expense)}</strong></div>
      <div class="metric"><span>Saldo</span><strong>${money(income - expense)}</strong></div>
    </section>

    <section class="panel">
      <form id="transactionForm" class="form-grid">
        <select id="trType"><option value="income">Entrada</option><option value="expense">Saída</option></select>
        <input id="trDescription" placeholder="Descrição" required>
        <input id="trAmount" type="number" step="0.01" min="0" placeholder="Valor" required>
        <select id="trMethod">${paymentMethods.map(p => `<option>${p}</option>`).join("")}</select>
        <input id="trDate" type="date" value="${today()}" required>
        <button class="btn primary" type="submit">${icon("plus")} Registrar</button>
      </form>
    </section>

    <section class="panel">
      <div class="list">
        ${transactions.map(t => `
          <article class="item">
            <div><strong>${t.description}</strong><span>${formatDateBR(t.date)} • ${t.method} • ${t.type === "income" ? "Entrada" : "Saída"}</span></div>
            <span>${money(t.amount)}</span>
          </article>
        `).join("") || empty("Sem lançamentos", "Registre entradas e saídas do negócio.")}
      </div>
    </section>
  `;

  $("transactionForm").onsubmit = async event => {
    event.preventDefault();

    await addDoc(tenantCol(currentUser.uid, "transactions"), {
      type: $("trType").value,
      description: $("trDescription").value.trim(),
      amount: Number($("trAmount").value),
      method: $("trMethod").value,
      date: $("trDate").value,
      createdAt: serverTimestamp()
    });

    $("transactionForm").reset();
    $("trDate").value = today();
  };

  renderIcons();
}

function renderDisponibilidade() {
  const availability = profile.availability || defaultAvailability();

  $("view").innerHTML = `
    <header class="page-head"><div><h1>Disponibilidade</h1><p>Cadastre um ou mais intervalos por dia.</p></div></header>

    <section class="panel">
      <label class="field-label">Liberação da agenda</label>
      <select id="bookingWindow">
        <option value="month" ${profile.bookingWindow !== "year" ? "selected" : ""}>Liberar agenda mês a mês</option>
        <option value="year" ${profile.bookingWindow === "year" ? "selected" : ""}>Liberar agenda ano a ano</option>
      </select>

      <div class="availability-list">
        ${weekKeys.map(([key, label]) => {
          const day = availability[key] || { enabled: false, slot: 30, intervals: [{ start: "09:00", end: "18:00" }] };
          const rawIntervals = Array.isArray(day.intervals) && day.intervals.length ? day.intervals : getDayIntervals(day);
          const intervals = rawIntervals.length ? rawIntervals : [{ start: "09:00", end: "18:00" }];

          return `
            <div class="availability-day">
              <strong>${label}</strong>
              <div class="grid-2">
                <select id="${key}Enabled">
                  <option value="true" ${day.enabled ? "selected" : ""}>Disponível</option>
                  <option value="false" ${!day.enabled ? "selected" : ""}>Indisponível</option>
                </select>
                <input id="${key}Slot" type="number" min="5" step="5" value="${day.slot || 30}" placeholder="Intervalo dos horários">
              </div>

              <div id="${key}Intervals">
                ${intervals.map((interval, index) => `
                  <div class="interval-row">
                    <input type="time" id="${key}Start${index}" value="${interval.start}">
                    <input type="time" id="${key}End${index}" value="${interval.end}">
                    <button class="btn danger" type="button" onclick="window.removeAvailabilityInterval('${key}', ${index})">Remover</button>
                  </div>
                `).join("")}
              </div>

              <button class="btn secondary full" type="button" onclick="window.addAvailabilityInterval('${key}')">Adicionar intervalo</button>
            </div>
          `;
        }).join("")}
      </div>

      <button id="saveAvailability" class="btn primary">${icon("save")} Salvar disponibilidade</button>
      <div id="availabilityMessage" class="form-message"></div>
    </section>
  `;

  $("saveAvailability").onclick = async () => {
    const newAvailability = {};

    weekKeys.forEach(([key]) => {
      const rows = Array.from(document.querySelectorAll(`#${key}Intervals .interval-row`));
      const intervals = [];

      rows.forEach((row, index) => {
        const start = $(`${key}Start${index}`)?.value;
        const end = $(`${key}End${index}`)?.value;

        if (start && end && timeToMinutes(start) < timeToMinutes(end)) {
          intervals.push({ start, end });
        }
      });

      newAvailability[key] = {
        enabled: $(`${key}Enabled`).value === "true",
        slot: Number($(`${key}Slot`).value || 30),
        intervals
      };
    });

    await updateDoc(doc(db, "users", currentUser.uid), {
      availability: newAvailability,
      bookingWindow: $("bookingWindow").value
    });

    $("availabilityMessage").textContent = "Disponibilidade salva.";
  };

  renderIcons();
}

window.addAvailabilityInterval = async key => {
  const availability = profile.availability || defaultAvailability();
  const day = availability[key] || { enabled: true, slot: 30, intervals: [] };
  const intervals = Array.isArray(day.intervals) && day.intervals.length ? [...day.intervals] : getDayIntervals(day);
  intervals.push({ start: "13:00", end: "18:00" });

  await updateDoc(doc(db, "users", currentUser.uid), {
    [`availability.${key}.enabled`]: day.enabled ?? true,
    [`availability.${key}.slot`]: day.slot || 30,
    [`availability.${key}.intervals`]: intervals
  });
};

window.removeAvailabilityInterval = async (key, index) => {
  const availability = profile.availability || defaultAvailability();
  const day = availability[key] || {};
  const intervals = Array.isArray(day.intervals) ? [...day.intervals] : getDayIntervals(day);
  intervals.splice(index, 1);
  if (!intervals.length) intervals.push({ start: "09:00", end: "18:00" });

  await updateDoc(doc(db, "users", currentUser.uid), {
    [`availability.${key}.intervals`]: intervals
  });
};

function renderOnline() {
  const publicUrl = `${location.origin}${location.pathname}#book/${profile.slug || currentUser.uid}`;

  $("view").innerHTML = `
    <header class="page-head"><div><h1>Link online</h1><p>Personalize seu perfil público.</p></div></header>

    <section class="panel">
      <form id="profileForm" class="form-grid">
        <input id="businessName" value="${profile.businessName || ""}" placeholder="Nome do estabelecimento" required>
        <input id="slug" value="${profile.slug || ""}" placeholder="Link personalizado">
        <input id="segment" value="${profile.segment || ""}" placeholder="Segmento">
        <input id="city" value="${profile.city || ""}" placeholder="Cidade">
        <input id="whatsappProfile" value="${profile.whatsapp || ""}" placeholder="WhatsApp">
        <input id="instagram" value="${profile.instagram || ""}" placeholder="Instagram">
        <input id="address" value="${profile.address || ""}" placeholder="Endereço">
        <input id="photo" type="file" accept="image/*">
        ${profile.photoURL ? `<img class="profile-preview" src="${profile.photoURL}" alt="Foto do estabelecimento">` : ""}
        <button class="btn primary" type="submit">${icon("save")} Salvar perfil</button>
      </form>

      <div class="share-box">
        <strong>Seu link de agendamento</strong>
        <input readonly value="${publicUrl}">
        <a class="btn whatsapp" target="_blank" rel="noopener" href="${whatsappUrl(profile.whatsapp, `Olá! Agende seu horário pelo link: ${publicUrl}`)}">${icon("message-circle")} Divulgar no WhatsApp</a>
      </div>
    </section>
  `;

  $("profileForm").onsubmit = async event => {
    event.preventDefault();

    const oldSlug = profile.slug;
    const slug = makeSlug($("slug").value || $("businessName").value);
    const photoFile = $("photo").files[0];
    const photoURL = photoFile ? await fileToCompressedDataUrl(photoFile) : profile.photoURL || "";

    const data = {
      businessName: $("businessName").value.trim(),
      slug,
      segment: $("segment").value.trim(),
      city: $("city").value.trim(),
      whatsapp: onlyDigits($("whatsappProfile").value),
      instagram: $("instagram").value.trim(),
      address: $("address").value.trim(),
      photoURL,
      status: profile.status,
      blocked: profile.blocked || false,
      updatedAt: serverTimestamp()
    };

    await updateDoc(doc(db, "users", currentUser.uid), data);

    await setDoc(doc(db, "publicEstablishments", slug), {
      uid: currentUser.uid,
      slug,
      ...data
    }, { merge: true });

    if (oldSlug && oldSlug !== slug) {
      try {
        await deleteDoc(doc(db, "publicEstablishments", oldSlug));
      } catch (error) {
        console.warn(error);
      }
    }

    alert("Perfil salvo.");
  };

  renderIcons();
}

async function loadAdminBusinessData(userId) {
  const [clientSnap, appointmentSnap, serviceSnap, transactionSnap] = await Promise.all([
    getDocs(collection(db, "users", userId, "clients")),
    getDocs(collection(db, "users", userId, "appointments")),
    getDocs(collection(db, "users", userId, "services")),
    getDocs(collection(db, "users", userId, "transactions"))
  ]);

  adminSelectedData = {
    clients: clientSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    appointments: appointmentSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    services: serviceSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    transactions: transactionSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  };
}

function adminBusinessDetails(user) {
  if (!user) return "";

  const totalAppointments = adminSelectedData.appointments.length;
  const pendingAppointments = adminSelectedData.appointments.filter(a => a.status === "pending").length;
  const confirmedAppointments = adminSelectedData.appointments.filter(a => a.status === "confirmed").length;
  const revenue = adminSelectedData.transactions
    .filter(t => t.type === "income")
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const lastAppointments = [...adminSelectedData.appointments]
    .sort((a, b) => `${b.date || ""}${b.time || ""}`.localeCompare(`${a.date || ""}${a.time || ""}`))
    .slice(0, 8);

  return `
    <section class="panel admin-detail-panel">
      <div class="admin-detail-head">
        <div>
          <h2>${user.businessName || "Estabelecimento"}</h2>
          <p>${user.segment || "Sem segmento"} • ${user.city || "Sem cidade"}</p>
        </div>

        <div class="admin-detail-actions">
          <button class="btn whatsapp" onclick="window.sendBillingReminder('${user.id}')">${icon("message-circle")} Cobrança</button>
          <button class="btn secondary" onclick="window.markBusinessPaid('${user.id}')">${icon("check-circle")} Marcar pago</button>
          <button class="btn danger" onclick="window.blockUser('${user.id}', ${!user.blocked})">${user.blocked ? "Desbloquear" : "Bloquear"}</button>
        </div>
      </div>

      <div class="admin-detail-grid">
        <div><span>Responsável</span><strong>${user.ownerName || "-"}</strong></div>
        <div><span>E-mail</span><strong>${user.email || "-"}</strong></div>
        <div><span>WhatsApp</span><strong>${user.whatsapp || "-"}</strong></div>
        <div><span>Plano</span><strong>${plans[user.plan] || user.plan || "-"}</strong></div>
        <div><span>Valor</span><strong>${money(user.planPrice || planPrices[user.plan] || 0)}</strong></div>
        <div><span>Vencimento</span><strong>${user.billingDueDate ? formatDateBR(user.billingDueDate) : "-"}</strong></div>
        <div><span>Cobrança</span><strong>${billingStatusLabel(user)}</strong></div>
        <div><span>Status</span><strong>${user.status || "pending"}</strong></div>
      </div>

      <div class="share-box">
        <strong>Link público do estabelecimento</strong>
        <input readonly value="${publicBookingLink(user)}">
      </div>

      <div class="metrics compact-metrics">
        <div class="metric"><span>Clientes</span><strong>${adminSelectedData.clients.length}</strong></div>
        <div class="metric"><span>Agendamentos</span><strong>${totalAppointments}</strong></div>
        <div class="metric"><span>Pendentes</span><strong>${pendingAppointments}</strong></div>
        <div class="metric"><span>Confirmados</span><strong>${confirmedAppointments}</strong></div>
        <div class="metric"><span>Serviços</span><strong>${adminSelectedData.services.length}</strong></div>
        <div class="metric"><span>Financeiro</span><strong>${money(revenue)}</strong></div>
      </div>

      <div class="admin-columns">
        <div>
          <h3>Clientes cadastrados</h3>
          <div class="list">
            ${
              adminSelectedData.clients.map(client => `
                <article class="item">
                  <div><strong>${client.name || "Cliente"}</strong><span>${client.phone || client.phoneKey || ""}</span></div>
                  <a class="icon-btn" target="_blank" rel="noopener" href="${whatsappUrl(client.phone || client.phoneKey, "Olá! Tudo bem?")}">${icon("message-circle")}</a>
                </article>
              `).join("") || empty("Sem clientes", "Nenhum cliente cadastrado ainda.")
            }
          </div>
        </div>

        <div>
          <h3>Últimos agendamentos</h3>
          <div class="list">
            ${
              lastAppointments.map(a => `
                <article class="item">
                  <div><strong>${a.clientName || "Cliente"}</strong><span>${formatDateBR(a.date)} às ${a.time} • ${a.serviceName || ""} • ${a.status || "pending"}</span></div>
                  <span>${money(a.servicePrice || 0)}</span>
                </article>
              `).join("") || empty("Sem agendamentos", "Nenhum agendamento encontrado.")
            }
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderAdmin() {
  const establishments = users.filter(u => u.role !== "admin");
  const active = establishments.filter(u => u.status === "active" && !u.blocked).length;
  const pending = establishments.filter(u => u.status === "pending").length;
  const blocked = establishments.filter(u => u.blocked).length;
  const overdue = establishments.filter(u => u.billingDueDate && u.billingDueDate < today() && u.billingStatus !== "paid").length;
  const estimatedRevenue = establishments
    .filter(u => u.status === "active" && !u.blocked)
    .reduce((sum, u) => sum + Number(u.planPrice || planPrices[u.plan] || 0), 0);

  const selectedUser = establishments.find(u => u.id === adminSelectedUserId);

  $("view").innerHTML = `
    <header class="page-head">
      <div><h1>Painel administrativo</h1><p>Controle estabelecimentos, planos, cobranças, clientes e uso da plataforma.</p></div>
    </header>

    <section class="metrics">
      <div class="metric"><span>Ativos</span><strong>${active}</strong></div>
      <div class="metric"><span>Pendentes</span><strong>${pending}</strong></div>
      <div class="metric"><span>Bloqueados</span><strong>${blocked}</strong></div>
      <div class="metric"><span>Vencidos</span><strong>${overdue}</strong></div>
      <div class="metric"><span>Receita prevista</span><strong>${money(estimatedRevenue)}</strong></div>
      <div class="metric"><span>Total</span><strong>${establishments.length}</strong></div>
    </section>

    <section class="panel">
      <h2>Estabelecimentos</h2>
      <div class="list">
        ${
          establishments.map(u => `
            <article class="item admin-item ${adminSelectedUserId === u.id ? "selected" : ""}">
              <div>
                <strong>${u.businessName || u.email}</strong>
                <span>${u.ownerName || "Sem responsável"} • ${u.city || "Sem cidade"} • ${plans[u.plan] || u.plan || "Sem plano"} • ${billingStatusLabel(u)}</span>
              </div>

              <div class="admin-actions">
                <select id="plan-${u.id}">
                  ${Object.entries(plans).map(([value, label]) => `<option value="${value}" ${u.plan === value ? "selected" : ""}>${label}</option>`).join("")}
                </select>

                <input id="due-${u.id}" type="date" value="${u.billingDueDate || ""}">
                <button class="btn secondary" onclick="window.openAdminDetails('${u.id}')">Ver dados</button>
                <button class="btn secondary" onclick="window.savePlan('${u.id}')">Salvar</button>
                <button class="btn primary" onclick="window.approveUser('${u.id}')">Aprovar</button>
                <button class="btn whatsapp" onclick="window.sendBillingReminder('${u.id}')">WhatsApp</button>
                <button class="btn danger" onclick="window.blockUser('${u.id}', ${!u.blocked})">${u.blocked ? "Desbloquear" : "Bloquear"}</button>
              </div>
            </article>
          `).join("") || empty("Sem estabelecimentos", "Novos cadastros aparecerão aqui.")
        }
      </div>
    </section>

    ${selectedUser ? adminBusinessDetails(selectedUser) : ""}
  `;

  renderIcons();
}

window.openAdminDetails = async id => {
  adminSelectedUserId = id;
  $("view").innerHTML = `<section class="panel"><h2>Carregando dados do estabelecimento...</h2></section>`;
  await loadAdminBusinessData(id);
  renderAdmin();
};

window.approveUser = async id => {
  const selected = users.find(u => u.id === id);
  const dueInput = $(`due-${id}`)?.value || selected?.billingDueDate || addMonthsToDate(today(), planMonths(selected?.plan));

  await updateDoc(doc(db, "users", id), {
    status: "active",
    blocked: false,
    billingStatus: "paid",
    billingDueDate: dueInput,
    lastPaymentDate: today()
  });

  if (selected?.slug) {
    await setDoc(doc(db, "publicEstablishments", selected.slug), {
      uid: id,
      slug: selected.slug,
      businessName: selected.businessName || "",
      segment: selected.segment || "",
      city: selected.city || "",
      whatsapp: selected.whatsapp || "",
      photoURL: selected.photoURL || "",
      status: "active",
      blocked: false
    }, { merge: true });
  }
};

window.savePlan = async id => {
  const selected = users.find(u => u.id === id);
  const plan = $(`plan-${id}`)?.value || selected?.plan || "monthly";
  const dueDate = $(`due-${id}`)?.value || selected?.billingDueDate || "";

  await updateDoc(doc(db, "users", id), {
    plan,
    planLabel: plans[plan],
    planPrice: planPrices[plan] || 0,
    billingDueDate: dueDate,
    updatedAt: serverTimestamp()
  });

  alert("Plano e cobrança salvos.");
};

window.markBusinessPaid = async id => {
  const selected = users.find(u => u.id === id);
  const nextDueDate = addMonthsToDate(today(), planMonths(selected?.plan));

  await updateDoc(doc(db, "users", id), {
    billingStatus: "paid",
    billingDueDate: nextDueDate,
    lastPaymentDate: today(),
    blocked: false,
    updatedAt: serverTimestamp()
  });

  if (selected?.slug) {
    await setDoc(doc(db, "publicEstablishments", selected.slug), {
      blocked: false,
      status: "active"
    }, { merge: true });
  }

  alert(`Pagamento marcado. Próximo vencimento: ${formatDateBR(nextDueDate)}`);
};

window.sendBillingReminder = id => {
  const selected = users.find(u => u.id === id);
  if (!selected) return alert("Estabelecimento não encontrado.");
  if (!selected.whatsapp) return alert("Este estabelecimento não possui WhatsApp cadastrado.");

  const plan = plans[selected.plan] || selected.plan || "Plano";
  const value = money(selected.planPrice || planPrices[selected.plan] || 0);
  const dueDate = selected.billingDueDate ? formatDateBR(selected.billingDueDate) : "não informado";

  const message = [
    `Olá, ${selected.ownerName || selected.businessName || "tudo bem"}!`,
    "",
    "Aqui é da BQ Agenda.",
    "",
    `Identificamos uma pendência no cadastro do estabelecimento ${selected.businessName || ""}.`,
    "",
    `Plano: ${plan}`,
    `Valor: ${value}`,
    `Vencimento: ${dueDate}`,
    "",
    "Para manter sua agenda online ativa, regularize seu pagamento.",
    "",
    "Qualquer dúvida, estamos à disposição."
  ].join("\n");

  window.open(whatsappUrl(selected.whatsapp, message), "_blank");
};

window.blockUser = async (id, blocked) => {
  const selected = users.find(u => u.id === id);

  await updateDoc(doc(db, "users", id), {
    blocked,
    billingStatus: blocked ? "blocked" : "pending",
    updatedAt: serverTimestamp()
  });

  if (selected?.slug) {
    await setDoc(doc(db, "publicEstablishments", selected.slug), { blocked }, { merge: true });
  }
};

async function renderPublicBooking() {
  root.innerHTML = `<section class="splash"><div><strong>BQ Agenda</strong><span>Carregando agenda...</span></div></section>`;

  try {
    const uid = await resolveBookingUid();
    if (!uid) throw new Error("Estabelecimento não encontrado.");

    const profileSnap = await getDoc(doc(db, "users", uid));
    if (!profileSnap.exists()) throw new Error("Estabelecimento não encontrado.");

    const publicProfile = { id: uid, ...profileSnap.data() };
    if (publicProfile.status !== "active" || publicProfile.blocked) throw new Error("Agenda indisponível no momento.");

    const serviceSnap = await getDocs(collection(db, "users", uid, "services"));
    const publicServices = serviceSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(s => s.active !== false);

    const appointmentSnap = await getDocs(collection(db, "users", uid, "appointments"));
    const publicAppointments = appointmentSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    const savedPhone = localStorage.getItem(`bqClientPhone:${uid}`) || "";
    const savedName = localStorage.getItem(`bqClientName:${uid}`) || "";

    root.innerHTML = `
      <section class="booking-page">
        <header class="booking-hero">
          ${publicProfile.photoURL ? `<img src="${publicProfile.photoURL}" alt="${publicProfile.businessName}">` : ""}
          <div><strong>${publicProfile.businessName}</strong><span>${publicProfile.segment || ""} ${publicProfile.city ? `• ${publicProfile.city}` : ""}</span></div>
        </header>

        <form id="bookingForm" class="booking-card">
          <h1>Solicitar horário</h1>
          <input id="bookPhone" value="${savedPhone}" placeholder="Seu WhatsApp" required>
          <input id="bookName" value="${savedName}" placeholder="Seu nome" required>
          <select id="bookService" required>
            <option value="">Escolha um serviço</option>
            ${publicServices.map(s => `<option value="${s.id}">${s.name} - ${money(s.price)} - ${s.duration} min</option>`).join("")}
          </select>
          <div class="grid-2">
            <input id="bookDate" type="date" min="${today()}" required>
            <select id="bookTime" required><option value="">Escolha um horário</option></select>
          </div>
          <select id="bookPayment">${paymentMethods.map(p => `<option>${p}</option>`).join("")}</select>
          <textarea id="bookNotes" placeholder="Observações"></textarea>
          <button class="btn primary" type="submit">${icon("calendar-plus")} Solicitar agendamento</button>
          <div id="bookingMessage" class="form-message"></div>
        </form>
      </section>
    `;

    const updateSlots = () => {
      const service = publicServices.find(s => s.id === $("bookService").value);
      const slots = getAvailableSlots({
        date: $("bookDate").value,
        service,
        availability: publicProfile.availability || defaultAvailability(),
        appointments: publicAppointments,
        bookingWindow: publicProfile.bookingWindow || "month"
      });

      $("bookTime").innerHTML = `<option value="">Escolha um horário</option>${slots.map(t => `<option>${t}</option>`).join("")}`;
    };

    $("bookService").onchange = updateSlots;
    $("bookDate").onchange = updateSlots;

    $("bookPhone").onblur = async () => {
      const phoneKey = onlyDigits($("bookPhone").value);
      if (!phoneKey) return;

      try {
        const clientSnap = await getDoc(doc(db, "users", uid, "clients", phoneKey));
        if (clientSnap.exists() && clientSnap.data().name) $("bookName").value = clientSnap.data().name;
      } catch (error) {
        console.warn(error);
      }
    };

    $("bookingForm").onsubmit = async event => {
      event.preventDefault();

      const service = publicServices.find(s => s.id === $("bookService").value);
      const phoneKey = onlyDigits($("bookPhone").value);
      const time = $("bookTime").value;
      const date = $("bookDate").value;
      const startMinutes = timeToMinutes(time);
      const duration = Number(service?.duration || 30);
      const endMinutes = startMinutes + duration;

      const stillAvailable = getAvailableSlots({
        date,
        service,
        availability: publicProfile.availability || defaultAvailability(),
        appointments: publicAppointments,
        bookingWindow: publicProfile.bookingWindow || "month"
      }).includes(time);

      if (!stillAvailable) {
        $("bookingMessage").textContent = "Esse horário não está mais disponível.";
        return;
      }

      const clientName = $("bookName").value.trim();

      await setDoc(doc(db, "users", uid, "clients", phoneKey), {
        phoneKey,
        phone: phoneKey,
        name: clientName,
        updatedAt: serverTimestamp(),
        createdAt: serverTimestamp()
      }, { merge: true });

      await addDoc(collection(db, "users", uid, "appointments"), {
        clientName,
        phone: phoneKey,
        phoneKey,
        serviceId: service.id,
        serviceName: service.name,
        servicePrice: Number(service.price || 0),
        duration,
        startMinutes,
        endMinutes,
        date,
        time,
        paymentMethod: $("bookPayment").value,
        notes: $("bookNotes").value.trim(),
        source: "online",
        status: "pending",
        createdAt: serverTimestamp()
      });

      localStorage.setItem(`bqClientPhone:${uid}`, phoneKey);
      localStorage.setItem(`bqClientName:${uid}`, clientName);

      const text = [
        `Olá, ${publicProfile.businessName}!`,
        "",
        "Acabei de solicitar um agendamento pelo link online.",
        "",
        `Cliente: ${clientName}`,
        `WhatsApp: ${phoneKey}`,
        `Serviço: ${service.name}`,
        `Data: ${formatDateBR(date)}`,
        `Horário: ${time}`,
        `Duração: ${duration} minutos`,
        `Valor: ${money(service.price || 0)}`,
        `Pagamento: ${$("bookPayment").value}`,
        "",
        "Por favor, confirme meu horário."
      ].join("\n");

      $("bookingMessage").innerHTML = `Agendamento solicitado. <a target="_blank" rel="noopener" href="${whatsappUrl(publicProfile.whatsapp, text)}">Enviar confirmação pelo WhatsApp</a>`;
      window.open(whatsappUrl(publicProfile.whatsapp, text), "_blank");
      $("bookingForm").reset();
    };

    renderIcons();
  } catch (error) {
    root.innerHTML = `<section class="splash"><div><strong>Erro ao carregar</strong><span>${error.message}</span></div></section>`;
  }
}

async function resolveBookingUid() {
  const hash = decodeURIComponent(location.hash || "");

  if (hash.includes("?pro=")) {
    return new URLSearchParams(hash.split("?")[1]).get("pro");
  }

  const slug = hash.replace("#book/", "").replace("#book", "").replace("/", "").trim();
  if (!slug) return null;

  const publicSnap = await getDoc(doc(db, "publicEstablishments", slug));
  if (publicSnap.exists()) return publicSnap.data().uid;

  return slug;
}

function subscribeEstablishment(uid) {
  clearSubscriptions();

  unsubscribers.push(onSnapshot(doc(db, "users", uid), snap => {
    profile = { id: uid, ...snap.data() };
    renderShell();
  }));

  unsubscribers.push(onSnapshot(query(tenantCol(uid, "clients")), snap => {
    clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (profile) renderView();
  }));

  unsubscribers.push(onSnapshot(query(tenantCol(uid, "services")), snap => {
    services = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (profile) renderView();
  }));

  unsubscribers.push(onSnapshot(query(tenantCol(uid, "appointments")), snap => {
    appointments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (profile) renderView();
  }));

  unsubscribers.push(onSnapshot(query(tenantCol(uid, "transactions")), snap => {
    transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (profile) renderView();
  }));
}

function subscribeAdmin(uid) {
  clearSubscriptions();

  unsubscribers.push(onSnapshot(doc(db, "users", uid), snap => {
    profile = { id: uid, ...snap.data() };
    activeTab = "admin";
    renderShell();
  }));

  unsubscribers.push(onSnapshot(collection(db, "users"), snap => {
    users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (profile) renderView();
  }));
}

function renderBlockedOrPending() {
  root.innerHTML = `
    <section class="status-page">
      <div class="status-card">
        <img src="logo.png" alt="BQ Agenda">
        <h1>${profile?.blocked ? "Conta bloqueada" : "Cadastro em análise"}</h1>
        <p>${profile?.blocked ? "Entre em contato com a BQ para regularizar seu acesso." : "Seu cadastro foi recebido. A BQ entrará em contato para aprovação mediante pagamento."}</p>
        <a class="btn whatsapp" target="_blank" rel="noopener" href="${whatsappUrl(bqWhatsapp, "Olá, BQ Agenda! Quero falar sobre meu cadastro.")}">${icon("message-circle")} Falar com a BQ</a>
        <button class="btn secondary" onclick="window.logoutNow()">Sair</button>
      </div>
    </section>
  `;

  renderIcons();
}

window.logoutNow = () => signOut(auth);

async function handleAuthState(user) {
  currentUser = user;
  clearSubscriptions();

  if (location.hash.startsWith("#book")) {
    await renderPublicBooking();
    return;
  }

  if (!user) {
    renderAuth();
    return;
  }

  root.innerHTML = `<section class="splash"><div><strong>BQ Agenda</strong><span>Carregando seu painel...</span></div></section>`;

  const snap = await getDoc(doc(db, "users", user.uid));

  if (!snap.exists()) {
    await signOut(auth);
    renderAuth();
    return;
  }

  profile = { id: user.uid, ...snap.data() };

  if (profile.role === "admin") {
    subscribeAdmin(user.uid);
    return;
  }

  if (profile.status !== "active" || profile.blocked) {
    renderBlockedOrPending();
    return;
  }

  subscribeEstablishment(user.uid);
}

function renderFatalError(error) {
  root.innerHTML = `<section class="splash"><div><strong>Erro ao carregar</strong><span>${error.message}</span></div></section>`;
}

window.addEventListener("hashchange", () => {
  handleAuthState(auth.currentUser).catch(renderFatalError);
});

onAuthStateChanged(auth, user => {
  handleAuthState(user).catch(renderFatalError);
});
