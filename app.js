import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";
import {
  getFirestore,
  doc,
  collection,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "SUA_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  projectId: "SEU_PROJETO",
  storageBucket: "SEU_PROJETO.appspot.com",
  messagingSenderId: "SEU_SENDER_ID",
  appId: "SEU_APP_ID"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const root = document.querySelector("#root");

let user = null;
let profile = null;
let tab = "dashboard";

let users = [];
let clients = [];
let services = [];
let appointments = [];
let transactions = [];

const plans = {
  monthly: "Mensal",
  quarterly: "Trimestral",
  semiannual: "Semestral",
  annual: "Anual"
};

const paymentMethods = {
  pix: "Pix",
  cash: "Dinheiro",
  credit: "Cartao de credito",
  debit: "Cartao de debito",
  transfer: "Transferencia",
  other: "Outro"
};

const today = () => new Date().toISOString().slice(0, 10);

const money = value =>
  Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const onlyDigits = value => String(value || "").replace(/\D/g, "");

const icons = () => {
  if (window.lucide) window.lucide.createIcons();
};

const userRef = uid => doc(db, "users", uid);
const col = name => collection(db, "users", user.uid, name);
const itemRef = (name, id) => doc(db, "users", user.uid, name, id);
const tenantCol = (uid, name) => collection(db, "users", uid, name);
const tenantDoc = (uid, name, id) => doc(db, "users", uid, name, id);

function planExpiration(plan) {
  const d = new Date();
  if (plan === "monthly") d.setMonth(d.getMonth() + 1);
  if (plan === "quarterly") d.setMonth(d.getMonth() + 3);
  if (plan === "semiannual") d.setMonth(d.getMonth() + 6);
  if (plan === "annual") d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().slice(0, 10);
}

function isExpired(date) {
  return date && date < today();
}

function empty(text) {
  return `<div class="empty">${text}</div>`;
}

function renderAuth() {
  root.innerHTML = `
    <section class="auth">
      <div class="auth-box">
        <h1>BQ Agenda</h1>
        <p>Agenda web para estabelecimentos, com painel administrativo BQ.</p>

        <div class="tabs">
          <button id="loginTab" class="active">Entrar</button>
          <button id="registerTab">Cadastrar estabelecimento</button>
        </div>

        <div id="authView"></div>
      </div>
    </section>
  `;

  loginTab.onclick = renderLoginForm;
  registerTab.onclick = renderRegisterForm;

  renderLoginForm();
}

function setAuthTab(active) {
  loginTab.classList.toggle("active", active === "login");
  registerTab.classList.toggle("active", active === "register");
}

function renderLoginForm() {
  setAuthTab("login");

  authView.innerHTML = `
    <form id="loginForm" class="form">
      <input name="email" type="email" placeholder="E-mail" required>
      <input name="password" type="password" placeholder="Senha" required>
      <button class="btn" type="submit">
        <i data-lucide="log-in"></i>
        Entrar
      </button>
    </form>
  `;

  loginForm.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    await signInWithEmailAndPassword(auth, data.email, data.password);
  };

  icons();
}

function renderRegisterForm() {
  setAuthTab("register");

  authView.innerHTML = `
    <form id="registerForm" class="form">
      <input name="ownerName" placeholder="Nome do responsavel" required>
      <input name="businessName" placeholder="Nome do estabelecimento" required>
      <input name="segment" placeholder="Segmento: salao, barbearia, clinica..." required>
      <input name="city" placeholder="Cidade" required>
      <input name="phone" placeholder="WhatsApp" required>
      <select name="plan" required>
        <option value="monthly">Plano mensal</option>
        <option value="quarterly">Plano trimestral</option>
        <option value="semiannual">Plano semestral</option>
        <option value="annual">Plano anual</option>
      </select>
      <input name="email" type="email" placeholder="E-mail" required>
      <input name="password" type="password" placeholder="Senha" minlength="6" required>
      <button class="btn" type="submit">
        <i data-lucide="send"></i>
        Enviar cadastro para analise
      </button>
    </form>
  `;

  registerForm.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const credential = await createUserWithEmailAndPassword(auth, data.email, data.password);

    await setDoc(userRef(credential.user.uid), {
      role: "establishment",
      status: "pending",
      blocked: false,
      paymentStatus: "waiting",
      plan: data.plan,
      planExpiresAt: "",
      ownerName: data.ownerName,
      businessName: data.businessName,
      segment: data.segment,
      city: data.city,
      phone: onlyDigits(data.phone),
      email: data.email,
      publicBooking: true,
      createdAt: serverTimestamp()
    });
  };

  icons();
}

function renderNotice(title, text) {
  root.innerHTML = `
    <section class="notice">
      <h1>${title}</h1>
      <p class="muted">${text}</p>
      <button class="btn secondary" id="logoutBtn">Sair</button>
    </section>
  `;

  logoutBtn.onclick = () => signOut(auth);
}

function canAccessApp() {
  if (!profile) return false;
  if (profile.role === "admin") return true;
  if (profile.blocked) return false;
  if (profile.status !== "active") return false;
  if (profile.paymentStatus !== "paid") return false;
  if (isExpired(profile.planExpiresAt)) return false;
  return true;
}

function renderShell() {
  const isAdmin = profile.role === "admin";

  const titleMap = {
    admin: "Painel BQ",
    dashboard: "Resumo",
    agenda: "Agenda",
    clientes: "Clientes",
    servicos: "Servicos",
    financeiro: "Financeiro",
    online: "Agendamento online"
  };

  root.innerHTML = `
    <section class="app">
      <aside class="sidebar">
        <div class="brand">BQ Agenda</div>
        <nav class="nav">
          ${
            isAdmin
              ? nav("admin", "shield-check", "Admin")
              : `
                ${nav("dashboard", "layout-dashboard", "Resumo")}
                ${nav("agenda", "calendar-days", "Agenda")}
                ${nav("clientes", "users", "Clientes")}
                ${nav("servicos", "scissors", "Servicos")}
                ${nav("financeiro", "wallet", "Financeiro")}
                ${nav("online", "link", "Online")}
              `
          }
        </nav>
      </aside>

      <section class="content">
        <header class="topbar">
          <h2>${titleMap[tab]}</h2>
          <div class="actions">
            <button class="btn secondary" id="logoutBtn">
              <i data-lucide="log-out"></i>
              Sair
            </button>
          </div>
        </header>

        <div id="view"></div>
      </section>
    </section>
  `;

  document.querySelectorAll("[data-tab]").forEach(button => {
    button.onclick = () => {
      tab = button.dataset.tab;
      renderShell();
    };
  });

  logoutBtn.onclick = () => signOut(auth);

  if (isAdmin) renderAdmin();
  if (!isAdmin && tab === "dashboard") renderDashboard();
  if (!isAdmin && tab === "agenda") renderAgenda();
  if (!isAdmin && tab === "clientes") renderClientes();
  if (!isAdmin && tab === "servicos") renderServicos();
  if (!isAdmin && tab === "financeiro") renderFinanceiro();
  if (!isAdmin && tab === "online") renderOnline();

  icons();
}

function nav(id, icon, label) {
  return `
    <button class="${tab === id ? "active" : ""}" data-tab="${id}">
      <i data-lucide="${icon}"></i>
      ${label}
    </button>
  `;
}

function renderDashboard() {
  const paidAppointments = appointments.filter(a => a.paymentStatus === "paid");
  const month = today().slice(0, 7);

  const monthGain = paidAppointments
    .filter(a => (a.date || "").startsWith(month))
    .reduce((sum, a) => sum + Number(a.price || 0), 0);

  const pending = appointments
    .filter(a => a.paymentStatus !== "paid")
    .reduce((sum, a) => sum + Number(a.price || 0), 0);

  view.innerHTML = `
    <div class="grid cards">
      <div class="card"><small>Ganhos do mes</small><strong>${money(monthGain)}</strong></div>
      <div class="card"><small>Valores pendentes</small><strong>${money(pending)}</strong></div>
      <div class="card"><small>Clientes</small><strong>${clients.length}</strong></div>
      <div class="card"><small>Agendamentos</small><strong>${appointments.length}</strong></div>
    </div>

    <div class="panel" style="margin-top:16px">
      <h3>Proximos agendamentos</h3>
      <div class="list">
        ${appointments.slice(0, 8).map(appointmentItem).join("") || empty("Nenhum agendamento.")}
      </div>
    </div>
  `;
}

function renderAgenda() {
  view.innerHTML = `
    <div class="grid two">
      <form id="appointmentForm" class="panel form">
        <h3>Novo agendamento</h3>
        <input name="clientName" placeholder="Nome do cliente" required>
        <input name="clientPhone" placeholder="WhatsApp do cliente" required>
        <select name="serviceId" required>
          <option value="">Servico</option>
          ${services.map(s => `<option value="${s.id}">${s.name} - ${money(s.price)}</option>`).join("")}
        </select>
        <div class="row">
          <input name="date" type="date" value="${today()}" required>
          <input name="time" type="time" required>
        </div>
        <select name="paymentMethod">
          ${Object.entries(paymentMethods).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
        <select name="paymentStatus">
          <option value="pending">Pagamento pendente</option>
          <option value="paid">Pago</option>
          <option value="canceled">Cancelado</option>
        </select>
        <textarea name="notes" placeholder="Observacoes"></textarea>
        <button class="btn" type="submit">Salvar agendamento</button>
      </form>

      <div class="panel">
        <h3>Agenda</h3>
        <div class="list">
          ${appointments.map(appointmentItem).join("") || empty("Nenhum agendamento.")}
        </div>
      </div>
    </div>
  `;

  appointmentForm.onsubmit = saveAppointment;
}

async function saveAppointment(event) {
  event.preventDefault();

  const data = Object.fromEntries(new FormData(event.target));
  const phoneKey = onlyDigits(data.clientPhone);
  const service = services.find(s => s.id === data.serviceId);
  const clientId = phoneKey;

  await setDoc(itemRef("clients", clientId), {
    id: clientId,
    phoneKey,
    name: data.clientName,
    phone: phoneKey,
    updatedAt: serverTimestamp(),
    createdBy: "establishment"
  }, { merge: true });

  await addDoc(col("appointments"), {
    clientId,
    clientName: data.clientName,
    clientPhone: phoneKey,
    serviceId: data.serviceId,
    serviceName: service?.name || "",
    price: Number(service?.price || 0),
    date: data.date,
    time: data.time,
    status: "confirmed",
    paymentMethod: data.paymentMethod,
    paymentStatus: data.paymentStatus,
    notes: data.notes,
    source: "manual",
    createdAt: serverTimestamp()
  });

  event.target.reset();
}

function appointmentItem(a) {
  const phone = onlyDigits(a.clientPhone);
  const msg = encodeURIComponent(
    `Ola ${a.clientName}, seu horario em ${a.date} as ${a.time} esta registrado.`
  );

  return `
    <article class="item">
      <div class="item-head">
        <strong>${a.clientName}</strong>
        <span class="badge ${a.paymentStatus === "paid" ? "paid" : "pending"}">
          ${a.paymentStatus === "paid" ? "Pago" : "Pendente"}
        </span>
      </div>
      <span>${a.date} as ${a.time} - ${a.serviceName || "Servico"}</span>
      <span>${money(a.price)} - ${paymentMethods[a.paymentMethod] || "Sem forma"}</span>
      <div class="actions">
        ${phone ? `<a class="btn secondary" target="_blank" href="https://wa.me/55${phone}?text=${msg}">WhatsApp</a>` : ""}
        <button class="btn ok" onclick="window.markPaid('${a.id}')">Marcar pago</button>
        <button class="btn danger" onclick="window.removeAppointment('${a.id}')">Excluir</button>
      </div>
    </article>
  `;
}

window.markPaid = async id => {
  await setDoc(itemRef("appointments", id), { paymentStatus: "paid" }, { merge: true });
};

window.removeAppointment = async id => {
  if (confirm("Excluir agendamento?")) await deleteDoc(itemRef("appointments", id));
};

function renderClientes() {
  view.innerHTML = `
    <div class="grid two">
      <form id="clientForm" class="panel form">
        <h3>Novo cliente</h3>
        <input name="name" placeholder="Nome" required>
        <input name="phone" placeholder="WhatsApp" required>
        <textarea name="notes" placeholder="Observacoes"></textarea>
        <button class="btn" type="submit">Salvar cliente</button>
      </form>

      <div class="panel">
        <h3>Base de clientes</h3>
        <div class="list">
          ${clients.map(clientItem).join("") || empty("Nenhum cliente.")}
        </div>
      </div>
    </div>
  `;

  clientForm.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    const phoneKey = onlyDigits(data.phone);

    await setDoc(itemRef("clients", phoneKey), {
      id: phoneKey,
      phoneKey,
      name: data.name,
      phone: phoneKey,
      notes: data.notes,
      updatedAt: serverTimestamp()
    }, { merge: true });

    event.target.reset();
  };
}

function clientItem(c) {
  return `
    <article class="item">
      <div class="item-head">
        <strong>${c.name}</strong>
        <button class="btn danger" onclick="window.removeClient('${c.id}')">Excluir</button>
      </div>
      <span class="muted">${c.phone || ""}</span>
      <span>${c.notes || ""}</span>
    </article>
  `;
}

window.removeClient = async id => {
  if (confirm("Excluir cliente?")) await deleteDoc(itemRef("clients", id));
};

function renderServicos() {
  view.innerHTML = `
    <div class="grid two">
      <form id="serviceForm" class="panel form">
        <h3>Novo servico</h3>
        <input name="name" placeholder="Nome do servico" required>
        <div class="row">
          <input name="price" type="number" min="0" step="0.01" placeholder="Preco" required>
          <input name="duration" type="number" min="5" step="5" placeholder="Duracao em minutos" required>
        </div>
        <textarea name="description" placeholder="Descricao"></textarea>
        <button class="btn" type="submit">Salvar servico</button>
      </form>

      <div class="panel">
        <h3>Servicos</h3>
        <div class="list">
          ${services.map(serviceItem).join("") || empty("Nenhum servico.")}
        </div>
      </div>
    </div>
  `;

  serviceForm.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));

    await addDoc(col("services"), {
      name: data.name,
      price: Number(data.price || 0),
      duration: Number(data.duration || 0),
      description: data.description,
      active: true,
      createdAt: serverTimestamp()
    });

    event.target.reset();
  };
}

function serviceItem(s) {
  return `
    <article class="item">
      <div class="item-head">
        <strong>${s.name}</strong>
        <button class="btn danger" onclick="window.removeService('${s.id}')">Excluir</button>
      </div>
      <span>${money(s.price)} - ${s.duration} min</span>
      <span class="muted">${s.description || ""}</span>
    </article>
  `;
}

window.removeService = async id => {
  if (confirm("Excluir servico?")) await deleteDoc(itemRef("services", id));
};

function renderFinanceiro() {
  const paid = appointments.filter(a => a.paymentStatus === "paid");
  const pending = appointments.filter(a => a.paymentStatus !== "paid");

  const totalPaid = paid.reduce((sum, a) => sum + Number(a.price || 0), 0);
  const totalPending = pending.reduce((sum, a) => sum + Number(a.price || 0), 0);
  const expenses = transactions
    .filter(t => t.type === "expense")
    .reduce((sum, t) => sum + Number(t.value || 0), 0);

  const byMethod = Object.keys(paymentMethods).map(method => {
    const total = paid
      .filter(a => a.paymentMethod === method)
      .reduce((sum, a) => sum + Number(a.price || 0), 0);

    return `<div class="item"><strong>${paymentMethods[method]}</strong><span>${money(total)}</span></div>`;
  }).join("");

  view.innerHTML = `
    <div class="grid cards">
      <div class="card"><small>Recebido</small><strong class="ok-text">${money(totalPaid)}</strong></div>
      <div class="card"><small>Pendente</small><strong>${money(totalPending)}</strong></div>
      <div class="card"><small>Despesas</small><strong class="danger-text">${money(expenses)}</strong></div>
      <div class="card"><small>Saldo</small><strong>${money(totalPaid - expenses)}</strong></div>
    </div>

    <div class="grid two" style="margin-top:16px">
      <form id="expenseForm" class="panel form">
        <h3>Nova despesa</h3>
        <input name="description" placeholder="Descricao" required>
        <div class="row">
          <input name="value" type="number" min="0" step="0.01" placeholder="Valor" required>
          <input name="date" type="date" value="${today()}" required>
        </div>
        <button class="btn" type="submit">Salvar despesa</button>
      </form>

      <div class="panel">
        <h3>Ganhos por forma de pagamento</h3>
        <div class="list">${byMethod}</div>
      </div>
    </div>
  `;

  expenseForm.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));

    await addDoc(col("transactions"), {
      type: "expense",
      description: data.description,
      value: Number(data.value || 0),
      date: data.date,
      createdAt: serverTimestamp()
    });

    event.target.reset();
  };
}

function renderOnline() {
  const link = `${location.origin}${location.pathname}#book?pro=${user.uid}`;

  view.innerHTML = `
    <div class="grid two">
      <form id="settingsForm" class="panel form">
        <h3>Dados publicos</h3>
        <input name="businessName" value="${profile.businessName || ""}" placeholder="Nome do estabelecimento">
        <input name="phone" value="${profile.phone || ""}" placeholder="WhatsApp">
        <select name="publicBooking">
          <option value="true" ${profile.publicBooking !== false ? "selected" : ""}>Agendamento ativo</option>
          <option value="false" ${profile.publicBooking === false ? "selected" : ""}>Agendamento pausado</option>
        </select>
        <button class="btn" type="submit">Salvar</button>
      </form>

      <div class="panel">
        <h3>Link publico</h3>
        <input value="${link}" readonly>
        <p class="muted">Envie este link para clientes agendarem sem criar conta.</p>
        <div class="actions">
          <button class="btn" onclick="navigator.clipboard.writeText('${link}')">Copiar link</button>
          <a class="btn secondary" target="_blank" href="${link}">Abrir</a>
        </div>
      </div>
    </div>
  `;

  settingsForm.onsubmit = async event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));

    await setDoc(userRef(user.uid), {
      businessName: data.businessName,
      phone: onlyDigits(data.phone),
      publicBooking: data.publicBooking === "true",
      updatedAt: serverTimestamp()
    }, { merge: true });
  };
}

function renderAdmin() {
  const pending = users.filter(u => u.role === "establishment" && u.status === "pending").length;
  const active = users.filter(u => u.role === "establishment" && u.status === "active" && !u.blocked).length;
  const blocked = users.filter(u => u.role === "establishment" && u.blocked).length;
  const overdue = users.filter(u => isExpired(u.planExpiresAt)).length;

  view.innerHTML = `
    <div class="grid cards">
      <div class="card"><small>Pendentes</small><strong>${pending}</strong></div>
      <div class="card"><small>Ativos</small><strong>${active}</strong></div>
      <div class="card"><small>Bloqueados</small><strong>${blocked}</strong></div>
      <div class="card"><small>Vencidos</small><strong>${overdue}</strong></div>
    </div>

    <div class="panel" style="margin-top:16px">
      <h3>Estabelecimentos</h3>
      <div class="list">
        ${users.filter(u => u.role === "establishment").map(adminUserItem).join("") || empty("Nenhum cadastro.")}
      </div>
    </div>
  `;
}

function adminUserItem(u) {
  return `
    <article class="item">
      <div class="item-head">
        <strong>${u.businessName || "Sem nome"}</strong>
        <span class="badge ${u.blocked ? "blocked" : u.status}">${u.blocked ? "Bloqueado" : u.status}</span>
      </div>

      <span>${u.ownerName || ""} - ${u.email || ""} - ${u.phone || ""}</span>
      <span>Plano: ${plans[u.plan] || "-"} - Pagamento: ${u.paymentStatus || "-"} - Vence: ${u.planExpiresAt || "-"}</span>

      <div class="actions">
        <select id="plan-${u.id}">
          ${Object.entries(plans).map(([k, v]) => `<option value="${k}" ${u.plan === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>

        <button class="btn ok" onclick="window.approveUser('${u.id}')">Aprovar pago</button>
        <button class="btn secondary" onclick="window.savePlan('${u.id}')">Alterar plano</button>
        <button class="btn danger" onclick="window.blockUser('${u.id}', ${!u.blocked})">
          ${u.blocked ? "Desbloquear" : "Bloquear"}
        </button>
      </div>
    </article>
  `;
}

window.approveUser = async uid => {
  const select = document.getElementById(`plan-${uid}`);
  const plan = select.value;

  await setDoc(userRef(uid), {
    status: "active",
    blocked: false,
    paymentStatus: "paid",
    plan,
    planExpiresAt: planExpiration(plan),
    approvedAt: serverTimestamp()
  }, { merge: true });
};

window.savePlan = async uid => {
  const select = document.getElementById(`plan-${uid}`);
  const plan = select.value;

  await setDoc(userRef(uid), {
    plan,
    planExpiresAt: planExpiration(plan),
    paymentStatus: "paid"
  }, { merge: true });
};

window.blockUser = async (uid, blocked) => {
  await setDoc(userRef(uid), { blocked }, { merge: true });
};

async function renderPublicBooking(uid) {
  const profileSnap = await getDoc(userRef(uid));
  const publicProfile = profileSnap.data();

  if (!publicProfile || publicProfile.publicBooking === false || publicProfile.status !== "active" || publicProfile.blocked) {
    root.innerHTML = `
      <section class="notice">
        <h1>Agendamento indisponivel</h1>
        <p class="muted">Este estabelecimento nao esta recebendo agendamentos no momento.</p>
      </section>
    `;
    return;
  }

  const servicesSnap = await getDocs(tenantCol(uid, "services"));
  const publicServices = servicesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  root.innerHTML = `
    <section class="public-page">
      <header class="public-header">
        <h1>${publicProfile.businessName}</h1>
        <p class="muted">Escolha o servico, data e horario. Voce nao precisa criar conta.</p>
      </header>

      <form id="publicForm" class="panel form">
        <input name="clientName" placeholder="Seu nome" required>
        <input name="clientPhone" placeholder="Seu WhatsApp" required>
        <select name="serviceId" required>
          <option value="">Escolha um servico</option>
          ${publicServices.map(s => `<option value="${s.id}">${s.name} - ${money(s.price)}</option>`).join("")}
        </select>
        <div class="row">
          <input name="date" type="date" min="${today()}" required>
          <input name="time" type="time" required>
        </div>
        <select name="paymentMethod">
          ${Object.entries(paymentMethods).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
        </select>
        <textarea name="notes" placeholder="Observacoes"></textarea>
        <button class="btn" type="submit">
          <i data-lucide="calendar-plus"></i>
          Solicitar agendamento
        </button>
      </form>
    </section>
  `;

  publicForm.onsubmit = async event => {
    event.preventDefault();

    const data = Object.fromEntries(new FormData(event.target));
    const phoneKey = onlyDigits(data.clientPhone);
    const service = publicServices.find(s => s.id === data.serviceId);

    await setDoc(tenantDoc(uid, "clients", phoneKey), {
      id: phoneKey,
      phoneKey,
      name: data.clientName,
      phone: phoneKey,
      updatedAt: serverTimestamp(),
      createdBy: "public-booking"
    }, { merge: true });

    await addDoc(tenantCol(uid, "appointments"), {
      clientId: phoneKey,
      clientName: data.clientName,
      clientPhone: phoneKey,
      serviceId: data.serviceId,
      serviceName: service?.name || "",
      price: Number(service?.price || 0),
      date: data.date,
      time: data.time,
      status: "pending",
      paymentMethod: data.paymentMethod,
      paymentStatus: "pending",
      notes: data.notes,
      source: "online",
      createdAt: serverTimestamp()
    });

    event.target.innerHTML = `
      <div class="empty">
        <h2>Solicitacao enviada</h2>
        <p>O estabelecimento recebeu seu pedido de horario.</p>
      </div>
    `;
  };

  icons();
}

function subscribeEstablishment() {
  onSnapshot(col("clients"), snap => {
    clients = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderShell();
  });

  onSnapshot(col("services"), snap => {
    services = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderShell();
  });

  onSnapshot(col("appointments"), snap => {
    appointments = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    renderShell();
  });

  onSnapshot(col("transactions"), snap => {
    transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderShell();
  });
}

function subscribeAdmin() {
  onSnapshot(collection(db, "users"), snap => {
    users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderShell();
  });
}

function hashParams() {
  return new URLSearchParams(location.hash.split("?")[1] || "");
}

onAuthStateChanged(auth, async currentUser => {
  const bookingUid = hashParams().get("pro");

  if (location.hash.startsWith("#book") && bookingUid) {
    await renderPublicBooking(bookingUid);
    return;
  }

  user = currentUser;

  if (!user) {
    renderAuth();
    return;
  }

  const profileSnap = await getDoc(userRef(user.uid));
  profile = profileSnap.data();

  if (!profile) {
    renderNotice("Cadastro incompleto", "Entre em contato com a BQ para configurar sua conta.");
    return;
  }

  if (profile.role === "admin") {
    tab = "admin";
    subscribeAdmin();
    renderShell();
    return;
  }

  if (profile.status === "pending") {
    renderNotice(
      "Cadastro enviado para analise",
      "A equipe BQ entrara em contato para finalizar o pagamento e liberar seu acesso."
    );
    return;
  }

  if (profile.blocked) {
    renderNotice("Acesso bloqueado", "Entre em contato com a BQ para regularizar seu acesso.");
    return;
  }

  if (profile.paymentStatus !== "paid") {
    renderNotice("Pagamento pendente", "Seu acesso ainda nao foi liberado pela BQ.");
    return;
  }

  if (isExpired(profile.planExpiresAt)) {
    renderNotice("Plano vencido", "Entre em contato com a BQ para renovar seu plano.");
    return;
  }

  if (!canAccessApp()) return;

  subscribeEstablishment();
  renderShell();
});
