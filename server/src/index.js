/**
 * Einstiegspunkt der REST-API der B&E Service Gruppe App.
 *
 * Start:  npm start   (bzw. npm run dev mit automatischem Neustart)
 *
 * Aufbau:
 *   src/config.js      – Konfiguration (Port, Secrets, Pfade)
 *   src/db/            – Datenbank, Schema und Testdaten
 *   src/lib/           – Bausteine (Sicherheit, HTTP-Helfer, E-Mail)
 *   src/middleware/    – Anmeldung/Rechte, Uploads, Fehlerbehandlung
 *   src/routes/        – die eigentlichen API-Endpunkte
 */
import path from 'node:path';
import fs from 'node:fs';
import express from 'express';
import cors from 'cors';
import { config, ROOT_DIR } from './config.js';
import { applySchema, db } from './db/index.js';
import { authRouter } from './routes/auth.js';
import { ordersRouter } from './routes/orders.js';
import { usersRouter } from './routes/users.js';
import { shiftsRouter } from './routes/shifts.js';
import { filesRouter } from './routes/files.js';
import { errorHandler, notFoundHandler } from './middleware/error.js';

applySchema();

const app = express();

// Hinter einem Reverse Proxy (z. B. später beim Hosting) korrekte Client-IPs
app.set('trust proxy', 1);

app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((o) => o.trim()),
  })
);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── API-Routen ───────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

app.use('/api/auth', authRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/users', usersRouter);
app.use('/api/shifts', shiftsRouter);
app.use('/api/files', filesRouter);

// ── Ausgeliefertes Frontend (Produktions-Build) ──────────────────────────────
// Nach `npm run build` im Verzeichnis web/ liegt dort ein Ordner dist/.
// Ist dieser vorhanden, liefert der Server die App gleich mit aus – dann läuft
// alles unter einer einzigen Adresse (praktisch für Tests im WLAN/am Handy).
const webDist = path.resolve(ROOT_DIR, '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // Alle übrigen Pfade an die Single-Page-App weiterreichen (Client-Routing)
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use('/api', notFoundHandler);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  console.log(`\n  B&E Service Gruppe – API läuft auf http://localhost:${config.port}`);
  console.log(`  Datenbank: ${config.databaseFile}`);
  console.log(`  Uploads:   ${config.uploadDir}`);
  if (userCount === 0) {
    console.log('\n  ⚠  Noch keine Benutzer vorhanden. Testdaten anlegen mit:  npm run seed\n');
  } else {
    console.log(`  Benutzerkonten: ${userCount}\n`);
  }
  if (fs.existsSync(webDist)) {
    console.log(`  Frontend wird mit ausgeliefert: http://localhost:${config.port}\n`);
  }
});

// Sauberes Herunterfahren (wichtig, damit die SQLite-Datei konsistent bleibt)
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
