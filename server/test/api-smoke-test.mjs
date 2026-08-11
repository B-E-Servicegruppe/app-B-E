/**
 * Automatischer Funktions- und Sicherheitstest der API.
 *
 * Aufruf (Server muss laufen):   node test/api-smoke-test.mjs
 * Optional andere Adresse:       API_URL=http://localhost:4000 node test/api-smoke-test.mjs
 *
 * Der Test prüft insbesondere die serverseitige Rollentrennung: Ein Mitarbeiter
 * darf fremde Aufträge, fremde Dienstpläne und die Benutzerverwaltung auch über
 * direkte API-Aufrufe nicht erreichen.
 */
const API = process.env.API_URL || 'http://localhost:4000';

let passed = 0;
let failed = 0;

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function api(path, { token, method = 'GET', body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* z. B. Datei-Downloads */
  }
  return { status: res.status, data };
}

const login = (email, password) => api('/api/auth/login', { method: 'POST', body: { email, password } });

async function run() {
  console.log(`\nAPI-Test gegen ${API}\n`);

  // ── Anmeldung ──────────────────────────────────────────────────────────────
  console.log('Anmeldung & Passwörter');
  const admin = await login('admin@bunde-reinigungsservice.de', 'Admin1234');
  check('Admin kann sich anmelden', admin.status === 200 && !!admin.data.token);
  check('Passwort-Hash wird nicht ausgeliefert', !JSON.stringify(admin.data).includes('$2'));

  const employee = await login('max@bunde-reinigungsservice.de', 'Team1234');
  check('Mitarbeiter kann sich anmelden', employee.status === 200 && !!employee.data.token);

  const wrong = await login('admin@bunde-reinigungsservice.de', 'falsch');
  check('Falsches Passwort wird abgelehnt', wrong.status === 401);

  const unknown = await login('gibtsnicht@example.com', 'egal');
  check(
    'Unbekannte E-Mail liefert dieselbe Meldung (keine Konto-Auskunft)',
    unknown.status === 401 && unknown.data.error === wrong.data.error
  );

  const adminToken = admin.data.token;
  const empToken = employee.data.token;

  const noAuth = await api('/api/orders');
  check('Ohne Token kein Zugriff auf Aufträge', noAuth.status === 401);

  const badToken = await api('/api/orders', { token: 'abc.def.ghi' });
  check('Gefälschtes Token wird abgelehnt', badToken.status === 401);

  // ── Auftragsverwaltung (Admin) ─────────────────────────────────────────────
  console.log('\nAuftragsverwaltung (Admin)');
  const employees = await api('/api/users/assignable', { token: adminToken });
  const maxUser = employees.data.users.find((u) => u.name === 'Max Weber');
  const annaUser = employees.data.users.find((u) => u.name === 'Anna Schmitz');
  check('Mitarbeiterliste für Zuweisung verfügbar', employees.status === 200 && !!maxUser);

  const created = await api('/api/orders', {
    token: adminToken,
    method: 'POST',
    body: {
      customerName: 'Testkunde API',
      address: 'Teststraße 1, 48431 Rheine',
      orderType: 'REINIGUNG',
      scheduledDate: '2026-09-01',
      startTime: '09:00',
      endTime: '12:00',
      notes: 'Vom automatischen Test angelegt',
      materials: [{ name: 'Testmaterial', quantity: '1 Stk' }],
      assigneeIds: [annaUser.id],
    },
  });
  check('Admin kann Auftrag anlegen', created.status === 201, JSON.stringify(created.data));
  const orderId = created.data.order?.id;

  const invalid = await api('/api/orders', {
    token: adminToken,
    method: 'POST',
    body: { customerName: '', address: '', orderType: 'UNSINN' },
  });
  check('Fehlerhafte Eingaben werden abgewiesen', invalid.status === 400 && !!invalid.data.details);

  const detail = await api(`/api/orders/${orderId}`, { token: adminToken });
  check('Auftragsdetail enthält Material', detail.data.order?.materials?.length === 1);
  check('Auftragsdetail enthält Zuweisung', detail.data.order?.assignees?.length === 1);
  check('Statushistorie wird beim Anlegen geschrieben', detail.data.order?.history?.length === 1);

  const duplicated = await api(`/api/orders/${orderId}/duplicate`, {
    token: adminToken,
    method: 'POST',
  });
  check('Admin kann Auftrag duplizieren', duplicated.status === 201);
  const duplicateId = duplicated.data.order?.id;

  const filtered = await api('/api/orders?status=OFFEN&type=REINIGUNG', { token: adminToken });
  check(
    'Filter nach Status und Auftragsart wirkt',
    filtered.status === 200 &&
      filtered.data.orders.every((o) => o.status === 'OFFEN' && o.orderType === 'REINIGUNG')
  );

  const searched = await api('/api/orders?q=Testkunde', { token: adminToken });
  check(
    'Suche nach Kundenname findet den Auftrag',
    searched.data.orders.some((o) => o.id === orderId)
  );

  const stats = await api('/api/orders/stats/summary', { token: adminToken });
  check('Dashboard-Kennzahlen werden geliefert', stats.status === 200 && 'OFFEN' in stats.data.byStatus);

  // ── Rollentrennung ─────────────────────────────────────────────────────────
  console.log('\nRollentrennung (Mitarbeiter)');
  const empOrders = await api('/api/orders', { token: empToken });
  check(
    'Mitarbeiter sieht ausschließlich eigene Aufträge',
    empOrders.status === 200 && empOrders.data.orders.every((o) => o.id !== orderId)
  );

  const foreign = await api(`/api/orders/${orderId}`, { token: empToken });
  check('Fremder Auftrag ist per direkter URL nicht abrufbar (404)', foreign.status === 404);

  const foreignStatus = await api(`/api/orders/${orderId}/status`, {
    token: empToken,
    method: 'PATCH',
    body: { status: 'ERLEDIGT' },
  });
  check('Mitarbeiter kann fremden Auftrag nicht ändern', foreignStatus.status === 404);

  const createAttempt = await api('/api/orders', {
    token: empToken,
    method: 'POST',
    body: {
      customerName: 'Heimlich',
      address: 'X 1',
      orderType: 'GARTEN',
    },
  });
  check('Mitarbeiter kann keine Aufträge anlegen', createAttempt.status === 403);

  const deleteAttempt = await api(`/api/orders/${orderId}`, { token: empToken, method: 'DELETE' });
  check('Mitarbeiter kann keine Aufträge löschen', deleteAttempt.status === 403);

  const userListAttempt = await api('/api/users', { token: empToken });
  check('Mitarbeiter hat keinen Zugriff auf die Benutzerverwaltung', userListAttempt.status === 403);

  const createUserAttempt = await api('/api/users', {
    token: empToken,
    method: 'POST',
    body: { name: 'Hacker', email: 'hacker@example.com', role: 'ADMIN' },
  });
  check('Mitarbeiter kann kein Admin-Konto anlegen', createUserAttempt.status === 403);

  const foreignShifts = await api(`/api/shifts?userId=${annaUser.id}&from=2020-01-01&to=2030-12-31`, {
    token: empToken,
  });
  check(
    'Mitarbeiter sieht trotz userId-Parameter nur den eigenen Dienstplan',
    foreignShifts.status === 200 && foreignShifts.data.shifts.every((s) => s.userId === maxUser.id)
  );

  const shiftCreateAttempt = await api('/api/shifts', {
    token: empToken,
    method: 'POST',
    body: { userId: maxUser.id, date: '2026-09-02' },
  });
  check('Mitarbeiter kann keine Dienstplan-Einträge anlegen', shiftCreateAttempt.status === 403);

  // ── Eigener Auftrag: Mitarbeiter-Funktionen ────────────────────────────────
  console.log('\nMitarbeiter-Funktionen am eigenen Auftrag');
  const own = empOrders.data.orders[0];
  check('Mitarbeiter hat mindestens einen eigenen Auftrag', !!own);

  const ownDetail = await api(`/api/orders/${own.id}`, { token: empToken });
  check('Eigener Auftrag ist abrufbar', ownDetail.status === 200);

  const statusChange = await api(`/api/orders/${own.id}/status`, {
    token: empToken,
    method: 'PATCH',
    body: { status: 'IN_ARBEIT' },
  });
  check('Statuswechsel auf "in Arbeit" möglich', statusChange.status === 200);
  check(
    'Statuswechsel wird mit Zeitstempel protokolliert',
    statusChange.data.history?.[0]?.toStatus === 'IN_ARBEIT' && !!statusChange.data.history[0].changedAt
  );

  const cancelAttempt = await api(`/api/orders/${own.id}/status`, {
    token: empToken,
    method: 'PATCH',
    body: { status: 'STORNIERT' },
  });
  check('Mitarbeiter kann nicht stornieren', cancelAttempt.status === 403);

  const material = ownDetail.data.order.materials[0];
  if (material) {
    const toggled = await api(`/api/orders/${own.id}/materials/${material.id}`, {
      token: empToken,
      method: 'PATCH',
      body: { done: true },
    });
    check(
      'Material kann abgehakt werden',
      toggled.status === 200 && toggled.data.materials.find((m) => m.id === material.id)?.done === true
    );
  }

  const comment = await api(`/api/orders/${own.id}/comments`, {
    token: empToken,
    method: 'POST',
    body: { body: 'Rückmeldung aus dem automatischen Test' },
  });
  check('Rückmeldung kann geschrieben werden', comment.status === 201 && comment.data.comments.length > 0);

  // ── Datei-Upload und Zugriffsschutz ────────────────────────────────────────
  console.log('\nDateien');
  // 1x1-PNG als Testbild
  const pngBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const form = new FormData();
  form.append('files', new Blob([pngBytes], { type: 'image/png' }), 'nachweis.png');
  const uploaded = await api(`/api/orders/${own.id}/files`, {
    token: empToken,
    method: 'POST',
    body: form,
    raw: true,
  });
  check('Mitarbeiter kann Foto hochladen', uploaded.status === 201, JSON.stringify(uploaded.data));
  check(
    'Upload wird als Abschluss-Nachweis gekennzeichnet',
    uploaded.data.files?.some((f) => f.kind === 'PROOF_PHOTO')
  );

  const fileId = uploaded.data.files?.find((f) => f.kind === 'PROOF_PHOTO')?.id;
  const fileRes = await fetch(`${API}/api/files/${fileId}`, {
    headers: { Authorization: `Bearer ${empToken}` },
  });
  check('Eigene Datei kann geöffnet werden', fileRes.status === 200);

  const otherEmployee = await login('lisa@bunde-reinigungsservice.de', 'Team1234');
  const foreignFile = await fetch(`${API}/api/files/${fileId}`, {
    headers: { Authorization: `Bearer ${otherEmployee.data.token}` },
  });
  check('Datei eines fremden Auftrags ist gesperrt (404)', foreignFile.status === 404);

  const badType = new FormData();
  badType.append('files', new Blob([Buffer.from('#!/bin/sh')], { type: 'application/x-sh' }), 'x.sh');
  const rejected = await api(`/api/orders/${own.id}/files`, {
    token: empToken,
    method: 'POST',
    body: badType,
    raw: true,
  });
  check('Unerlaubter Dateityp wird abgelehnt', rejected.status === 400);

  // ── Dienstplan (Admin) ─────────────────────────────────────────────────────
  console.log('\nDienstplan (Admin)');
  const shift = await api('/api/shifts', {
    token: adminToken,
    method: 'POST',
    body: { userId: maxUser.id, orderId, date: '2026-09-01', startTime: '09:00', endTime: '12:00' },
  });
  check('Admin kann Dienstplan-Eintrag anlegen', shift.status === 201, JSON.stringify(shift.data));

  const moved = await api(`/api/shifts/${shift.data.shift.id}/move`, {
    token: adminToken,
    method: 'PATCH',
    body: { date: '2026-09-02', userId: annaUser.id },
  });
  check(
    'Eintrag kann per Drag & Drop verschoben werden',
    moved.status === 200 && moved.data.shift.date === '2026-09-02' && moved.data.shift.userId === annaUser.id
  );

  const allShifts = await api('/api/shifts?from=2026-09-01&to=2026-09-30', { token: adminToken });
  check('Admin sieht den gesamten Dienstplan', allShifts.status === 200 && allShifts.data.shifts.length >= 1);

  await api(`/api/shifts/${shift.data.shift.id}`, { token: adminToken, method: 'DELETE' });

  // ── Mitarbeiterverwaltung ──────────────────────────────────────────────────
  console.log('\nMitarbeiterverwaltung (Admin)');
  const testEmail = `test-${Date.now()}@bunde-reinigungsservice.de`;
  const newUser = await api('/api/users', {
    token: adminToken,
    method: 'POST',
    body: { name: 'Test Mitarbeiter', email: testEmail, phone: '0170 000', role: 'EMPLOYEE' },
  });
  check('Admin kann Mitarbeiter anlegen', newUser.status === 201 && !!newUser.data.initialPassword);

  const duplicateEmail = await api('/api/users', {
    token: adminToken,
    method: 'POST',
    body: { name: 'Doppelt', email: testEmail, role: 'EMPLOYEE' },
  });
  check('Doppelte E-Mail wird abgelehnt', duplicateEmail.status === 409);

  const newLogin = await login(testEmail, newUser.data.initialPassword);
  check('Neues Konto kann sich mit Initialpasswort anmelden', newLogin.status === 200);
  check('Kennzeichen "Passwort ändern" ist gesetzt', newLogin.data.user?.mustChangePassword === true);

  const changed = await api('/api/auth/change-password', {
    token: newLogin.data.token,
    method: 'POST',
    body: { currentPassword: newUser.data.initialPassword, newPassword: 'NeuesPasswort1' },
  });
  check('Passwort kann geändert werden', changed.status === 200);
  check(
    'Anmeldung mit neuem Passwort funktioniert',
    (await login(testEmail, 'NeuesPasswort1')).status === 200
  );

  const deactivated = await api(`/api/users/${newUser.data.user.id}/active`, {
    token: adminToken,
    method: 'PATCH',
    body: { active: false },
  });
  check('Konto kann deaktiviert werden', deactivated.status === 200 && deactivated.data.user.active === false);

  const blockedLogin = await login(testEmail, 'NeuesPasswort1');
  check('Deaktiviertes Konto kann sich nicht mehr anmelden', blockedLogin.status === 401);

  const selfDeactivate = await api(`/api/users/${admin.data.user.id}/active`, {
    token: adminToken,
    method: 'PATCH',
    body: { active: false },
  });
  check('Eigenes Admin-Konto kann nicht deaktiviert werden', selfDeactivate.status === 400);

  // ── Passwort vergessen ─────────────────────────────────────────────────────
  console.log('\nPasswort vergessen');
  const forgot = await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'lisa@bunde-reinigungsservice.de' },
  });
  check('Reset-Link wird erzeugt', forgot.status === 200 && !!forgot.data.devResetUrl);

  const forgotUnknown = await api('/api/auth/forgot-password', {
    method: 'POST',
    body: { email: 'niemand@example.com' },
  });
  check(
    'Unbekannte Adresse liefert dieselbe Antwort',
    forgotUnknown.status === 200 && forgotUnknown.data.message === forgot.data.message
  );

  const resetToken = new URL(forgot.data.devResetUrl).searchParams.get('token');
  const reset = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token: resetToken, newPassword: 'GanzNeu1234' },
  });
  check('Neues Passwort kann gesetzt werden', reset.status === 200);
  check(
    'Anmeldung mit zurückgesetztem Passwort funktioniert',
    (await login('lisa@bunde-reinigungsservice.de', 'GanzNeu1234')).status === 200
  );

  const reuse = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token: resetToken, newPassword: 'NochEins1234' },
  });
  check('Verbrauchter Reset-Link ist ungültig', reuse.status === 400);

  const shortPassword = await api('/api/auth/reset-password', {
    method: 'POST',
    body: { token: 'egal', newPassword: 'kurz' },
  });
  check('Zu kurzes Passwort wird abgelehnt', shortPassword.status === 400);

  // Lisas Passwort wieder auf den Testwert zurücksetzen
  await api(`/api/users/${(await api('/api/users', { token: adminToken })).data.users.find((u) => u.email === 'lisa@bunde-reinigungsservice.de').id}/password`, {
    token: adminToken,
    method: 'POST',
    body: { password: 'Team1234' },
  });

  // ── Aufräumen ──────────────────────────────────────────────────────────────
  await api(`/api/orders/${orderId}`, { token: adminToken, method: 'DELETE' });
  await api(`/api/orders/${duplicateId}`, { token: adminToken, method: 'DELETE' });

  console.log(`\n──────────────────────────────────────────`);
  console.log(`  ${passed} Prüfungen bestanden, ${failed} fehlgeschlagen`);
  console.log(`──────────────────────────────────────────\n`);
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('\nTest abgebrochen:', error);
  process.exit(1);
});
