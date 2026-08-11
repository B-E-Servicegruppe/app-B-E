/**
 * Testdaten für den lokalen Betrieb.
 *
 * Aufruf:  npm run seed        (im Verzeichnis server/)
 *
 * Legt zwei Admin-Konten, vier Mitarbeiter sowie einige Beispielaufträge und
 * Dienstplan-Einträge an. Bereits vorhandene Konten (gleiche E-Mail) werden
 * nicht überschrieben – der Aufruf ist also gefahrlos wiederholbar.
 *
 * ACHTUNG: Die hier gesetzten Passwörter sind reine Testzugänge. Vor einem
 * echten Einsatz unbedingt über die Mitarbeiterverwaltung ändern.
 */
import { applySchema, db } from './index.js';
import { hashPassword } from '../lib/security.js';

applySchema();

/** Datum relativ zu heute als 'YYYY-MM-DD'. */
function day(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const USERS = [
  { name: 'Bunde (Geschäftsführung)', email: 'admin@bunde-reinigungsservice.de', role: 'ADMIN', password: 'Admin1234', phone: '0170 1111111' },
  { name: 'Geschäftspartner', email: 'partner@bunde-reinigungsservice.de', role: 'ADMIN', password: 'Admin1234', phone: '0170 2222222' },
  { name: 'Max Weber', email: 'max@bunde-reinigungsservice.de', role: 'EMPLOYEE', password: 'Team1234', phone: '0171 3333333' },
  { name: 'Anna Schmitz', email: 'anna@bunde-reinigungsservice.de', role: 'EMPLOYEE', password: 'Team1234', phone: '0171 4444444' },
  { name: 'Tomasz Nowak', email: 'tomasz@bunde-reinigungsservice.de', role: 'EMPLOYEE', password: 'Team1234', phone: '0171 5555555' },
  { name: 'Lisa Brand', email: 'lisa@bunde-reinigungsservice.de', role: 'EMPLOYEE', password: 'Team1234', phone: '0171 6666666' },
];

const ORDERS = [
  {
    customerName: 'Hausverwaltung Meyer GmbH',
    address: 'Bahnhofstraße 12, 48431 Rheine',
    contactPhone: '05971 123456',
    orderType: 'REINIGUNG',
    status: 'OFFEN',
    scheduledDate: day(0),
    startTime: '08:00',
    endTime: '11:00',
    notes: 'Treppenhaus A–C, bitte Schlüssel im Büro abholen. Fahrstuhl ist außer Betrieb.',
    materials: [
      { name: 'Wischmopp + Eimer', quantity: '2 Sets' },
      { name: 'Allzweckreiniger', quantity: '5 L' },
      { name: 'Müllsäcke 120 L', quantity: '10 Stk' },
    ],
    assignees: ['max@bunde-reinigungsservice.de', 'anna@bunde-reinigungsservice.de'],
  },
  {
    customerName: 'Familie Grothaus',
    address: 'Lindenweg 5, 48429 Rheine',
    orderType: 'GARTEN',
    status: 'IN_ARBEIT',
    scheduledDate: day(0),
    startTime: '13:00',
    endTime: '17:00',
    notes: 'Hecke auf 1,60 m kürzen, Schnittgut mitnehmen.',
    materials: [
      { name: 'Heckenschere (Akku)', quantity: '1', done: true },
      { name: 'Laubsauger', quantity: '1' },
      { name: 'Anhänger für Grünschnitt', quantity: '1' },
    ],
    assignees: ['tomasz@bunde-reinigungsservice.de'],
  },
  {
    customerName: 'Stadtwerke Rheine',
    address: 'Hafenstraße 40, 48431 Rheine',
    orderType: 'WINTERDIENST',
    status: 'OFFEN',
    scheduledDate: day(2),
    startTime: '05:30',
    endTime: '08:00',
    notes: 'Bereitschaft: Parkplatz P2 und Zufahrt räumen und streuen.',
    materials: [
      { name: 'Streusalz', quantity: '4 Sack' },
      { name: 'Schneeschieber', quantity: '2' },
    ],
    assignees: ['max@bunde-reinigungsservice.de'],
  },
  {
    customerName: 'Immobilien Kortmann',
    address: 'Emsstraße 88, 48282 Emsdetten',
    orderType: 'ENTRUEMPELUNG',
    status: 'OFFEN',
    scheduledDate: day(3),
    startTime: '09:00',
    endTime: '15:00',
    notes: 'Dachgeschosswohnung komplett räumen, besenrein übergeben.',
    materials: [
      { name: 'Big Bags', quantity: '6' },
      { name: 'Sackkarre', quantity: '2' },
      { name: 'Transporter 3,5 t', quantity: '1' },
    ],
    assignees: ['anna@bunde-reinigungsservice.de', 'lisa@bunde-reinigungsservice.de'],
  },
  {
    customerName: 'Bauunternehmen Vosskamp',
    address: 'Industriering 3, 48432 Rheine',
    orderType: 'ABRISS',
    status: 'ERLEDIGT',
    scheduledDate: day(-4),
    startTime: '07:00',
    endTime: '16:00',
    notes: 'Innenwände im Erdgeschoss entfernt, Bauschutt abgefahren.',
    materials: [{ name: 'Abbruchhammer', quantity: '2', done: true }],
    assignees: ['tomasz@bunde-reinigungsservice.de', 'max@bunde-reinigungsservice.de'],
  },
  {
    customerName: 'Praxis Dr. Lammers',
    address: 'Münsterstraße 21, 48431 Rheine',
    orderType: 'REINIGUNG',
    status: 'OFFEN',
    scheduledDate: day(1),
    startTime: '18:00',
    endTime: '20:00',
    notes: 'Unterhaltsreinigung nach Praxisschluss. Desinfektion Behandlungsräume.',
    materials: [
      { name: 'Flächendesinfektion', quantity: '3 L' },
      { name: 'Mikrofasertücher', quantity: '20' },
    ],
    assignees: ['lisa@bunde-reinigungsservice.de'],
  },
];

async function seed() {
  const insertUser = db.prepare(
    `INSERT INTO users (name, email, password_hash, role, phone, active, must_change_password)
     VALUES (?, ?, ?, ?, ?, 1, 0)`
  );

  /** @type {Record<string, number>} E-Mail -> Benutzer-ID */
  const userIds = {};

  for (const user of USERS) {
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(user.email);
    if (existing) {
      userIds[user.email] = existing.id;
      continue;
    }
    const info = insertUser.run(
      user.name,
      user.email,
      await hashPassword(user.password),
      user.role,
      user.phone
    );
    userIds[user.email] = Number(info.lastInsertRowid);
  }

  const adminId = userIds['admin@bunde-reinigungsservice.de'];

  // Aufträge nur anlegen, wenn die Tabelle noch leer ist
  const orderCount = db.prepare('SELECT COUNT(*) AS c FROM orders').get().c;
  if (orderCount === 0) {
    db.transaction(() => {
      for (const order of ORDERS) {
        const info = db
          .prepare(
            `INSERT INTO orders
               (customer_name, address, contact_phone, order_type, status,
                scheduled_date, start_time, end_time, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            order.customerName,
            order.address,
            order.contactPhone ?? null,
            order.orderType,
            order.status,
            order.scheduledDate,
            order.startTime,
            order.endTime,
            order.notes,
            adminId
          );
        const orderId = Number(info.lastInsertRowid);

        order.materials?.forEach((m, index) => {
          db.prepare(
            'INSERT INTO order_materials (order_id, name, quantity, done, position) VALUES (?, ?, ?, ?, ?)'
          ).run(orderId, m.name, m.quantity ?? null, m.done ? 1 : 0, index);
        });

        for (const email of order.assignees) {
          db.prepare('INSERT INTO order_assignments (order_id, user_id) VALUES (?, ?)').run(
            orderId,
            userIds[email]
          );
          // Passenden Dienstplan-Eintrag gleich mit anlegen
          db.prepare(
            `INSERT INTO shifts (user_id, order_id, date, start_time, end_time, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(userIds[email], orderId, order.scheduledDate, order.startTime, order.endTime, adminId);
        }

        db.prepare(
          'INSERT INTO order_status_history (order_id, from_status, to_status, changed_by) VALUES (?, NULL, ?, ?)'
        ).run(orderId, order.status, adminId);
      }

      // Ein freier Dienstplan-Eintrag ohne Auftrag (z. B. Urlaub)
      db.prepare(
        `INSERT INTO shifts (user_id, date, start_time, end_time, title, note, created_by)
         VALUES (?, ?, NULL, NULL, ?, ?, ?)`
      ).run(userIds['lisa@bunde-reinigungsservice.de'], day(4), 'Urlaub', 'Genehmigt', adminId);
    })();
  }

  console.log('\n  Testdaten angelegt.\n');
  console.log('  Zugänge:');
  console.log('    Admin:      admin@bunde-reinigungsservice.de   /  Admin1234');
  console.log('    Admin:      partner@bunde-reinigungsservice.de /  Admin1234');
  console.log('    Mitarbeiter: max@bunde-reinigungsservice.de    /  Team1234');
  console.log('    Mitarbeiter: anna@bunde-reinigungsservice.de   /  Team1234');
  console.log('    Mitarbeiter: tomasz@bunde-reinigungsservice.de /  Team1234');
  console.log('    Mitarbeiter: lisa@bunde-reinigungsservice.de   /  Team1234\n');
}

seed()
  .then(() => db.close())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
