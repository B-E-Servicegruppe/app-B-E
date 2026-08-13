# B&E Service Gruppe – Auftrags- und Dienstplan-App

Web-App zur Verwaltung von Aufträgen, Materialbedarf, Kundenadressen und
Dienstplan für die B&E Service Gruppe (Reinigung, Garten, Abriss, Winterdienst,
Entrümpelung).

Die App läuft im Browser auf dem Desktop **und** auf dem Smartphone
(mobile-first). Sie lässt sich später ohne Umbau als App-Store-Version
(iOS/Android) nachrüsten – siehe [Spätere App-Version](#spätere-app-version).

---

## Schnellstart (lokaler Test)

Voraussetzung: **Node.js 20 oder neuer** ([nodejs.org](https://nodejs.org)).

Zwei Terminalfenster öffnen:

**Terminal 1 – Server (Backend):**

```bash
cd server
npm install     # nur beim ersten Mal
npm run seed    # nur beim ersten Mal: Testdaten anlegen
npm start
```

**Terminal 2 – App (Frontend):**

```bash
cd web
npm install     # nur beim ersten Mal
npm run dev
```

Danach im Browser öffnen: **http://localhost:5173**

### Testzugänge

| Rolle | E-Mail | Passwort |
| --- | --- | --- |
| Administration | `admin@bunde-reinigungsservice.de` | `Admin1234` |
| Administration | `partner@bunde-reinigungsservice.de` | `Admin1234` |
| Mitarbeiter | `max@bunde-reinigungsservice.de` | `Team1234` |
| Mitarbeiter | `anna@bunde-reinigungsservice.de` | `Team1234` |
| Mitarbeiter | `tomasz@bunde-reinigungsservice.de` | `Team1234` |
| Mitarbeiter | `lisa@bunde-reinigungsservice.de` | `Team1234` |

> Das sind reine Testzugänge. Vor einem echten Einsatz die Passwörter über
> **Mein Konto → Passwort ändern** bzw. die Mitarbeiterverwaltung ändern.

### Auf dem Handy testen

Der Entwicklungsserver ist auch im WLAN erreichbar. Beim Start von `npm run dev`
wird eine Adresse wie `http://192.168.x.x:5173` angezeigt – diese am Smartphone
im gleichen WLAN öffnen. Über „Zum Home-Bildschirm hinzufügen" verhält sich die
App fast wie eine native App.

### Alles unter einer Adresse (Vorschau-Modus)

Für eine Vorführung reicht ein einziger Prozess:

```bash
cd web && npm run build     # erzeugt web/dist
cd ../server && npm start   # liefert API + App aus
```

Dann ist alles unter **http://localhost:4000** erreichbar.

---

## Rollen und Rechte

**Administration** (Geschäftsführung)
- Vollzugriff auf alle Aufträge, alle Mitarbeiter und den gesamten Dienstplan
- Legt Benutzerkonten an, bearbeitet und deaktiviert sie
- Legt Aufträge an, weist zu, verteilt um, dupliziert, löscht

**Mitarbeiter**
- Sieht ausschließlich die ihm zugewiesenen Aufträge und den eigenen Dienstplan
- Startseite nach dem Login: „Meine Aufträge"
- Kein Zugriff auf Verwaltungsfunktionen und auf Daten anderer Mitarbeiter

**Wichtig:** Diese Trennung ist serverseitig abgesichert. Das Frontend blendet
Funktionen nur zusätzlich aus. Ein Mitarbeiter erreicht fremde Aufträge, Dateien
oder Dienstpläne auch dann nicht, wenn er die URL oder die API direkt aufruft –
in dem Fall antwortet der Server mit „nicht gefunden" bzw. „keine Berechtigung".
Geprüft wird das automatisiert (siehe [Tests](#tests)).

---

## Funktionsumfang

### Auftragsverwaltung (nur Administration)
- Neuer Auftrag mit Kundenname, Adresse, Auftragsart (Reinigung / Garten /
  Abriss / Winterdienst / Entrümpelung), Termin und Zeitfenster, Material-Liste
  (beliebig viele Positionen), Notizen, Zuweisung an mehrere Mitarbeiter
- Optionale **Unterart** je Auftragsart (z. B. Grundreinigung oder
  Bauendreinigung bei Reinigung, Räum- oder Streudienst bei Winterdienst):
  freies Textfeld mit Vorschlagsliste passend zur gewählten Auftragsart –
  neue Unterarten brauchen also keine Programmierung. Wird in Auftragsliste
  und Detailansicht angezeigt und beim Duplizieren übernommen
- Upload von PDFs und Bildern direkt beim Anlegen (Angebot, Grundriss, Fotos)
- Gespeicherte Kunden lassen sich im Formular auswählen – Name, Adresse und
  Telefon werden dann automatisch übernommen (siehe „Kunden & Objekte")
- Auftragsliste mit Suche (Kunde, Adresse, Notiz, Auftragsnummer) und Filtern
  (Status, Auftragsart, Mitarbeiter, Zeitraum)
- Bearbeiten, Duplizieren, Löschen, Umverteilen
- **Auswahlmodus zum Sammel-Löschen:** Über den Button „Auswählen" lassen
  sich mehrere Aufträge per Checkbox markieren und nach Sicherheitsabfrage
  gemeinsam löschen – inklusive zugehöriger Dateien und
  Dienstplan-Einträge. Praktisch z. B. zum Aufräumen der stornierten
  Termine nach dem Beenden einer Serie. Gruppierte Serien-Karten sind von
  der Auswahl ausgenommen; serverseitig `POST /api/orders/bulk-delete`
  (nur Admin, max. 500 auf einmal)
- Dashboard mit Anzahl offen / in Arbeit / erledigt

### Wiederkehrende Aufträge / Serien (nur Administration)
- Im Formular „Neuer Auftrag" die Option **Wiederkehrender Auftrag** wählen:
  wöchentlich oder alle 2 Wochen mit **einem oder mehreren Wochentagen**
  (z. B. jeden Montag und Donnerstag für zweimal wöchentlich), oder monatlich
  am selben Tag wie das Startdatum (bei kurzen Monaten automatisch der
  Monatsletzte)
- Beim 14-tägigen Rhythmus bleiben alle gewählten Wochentage synchron in
  derselben Woche – Montag und Donnerstag driften also nicht in verschiedene
  Wochen auseinander
- Auch die Unterart (siehe Auftragsverwaltung) lässt sich an der Serie
  hinterlegen und wird auf alle erzeugten Termine übernommen
- Beim Speichern werden sofort alle Einzeltermine bis zum gewählten Enddatum
  als eigenständige Aufträge angelegt (maximal 2 Jahre im Voraus) – bewusst
  ohne Hintergrundjob, damit jeder Termin sofort sichtbar und planbar ist
- **Ohne festes Enddatum („bis auf Weiteres"):** Häkchen „Kein Enddatum" im
  Formular – es werden zunächst Termine für ein Jahr angelegt. In der
  Serienansicht lässt sich die Serie danach per Klick auf „Weitere Termine
  anlegen" (`POST /api/order-series/:id/extend`) beliebig oft um je ein
  weiteres Jahr verlängern – im selben Rhythmus, mit denselben zugewiesenen
  Mitarbeitern und ohne doppelte Termine
- **Gruppierte Darstellung:** In Auftragsliste und Übersicht erscheint eine
  Serie nur als **eine** Karte („Wiederkehrend · N Termine"), vertreten durch
  den nächsten anstehenden Termin; auch die Kennzahlen im Dashboard zählen
  eine Serie als einen Auftrag, damit 50 Wochentermine eines Kunden die
  Zahlen nicht verzerren. Klick auf die Karte öffnet alle Einzeltermine der
  Serie – dort sitzen auch „Weitere Termine anlegen" und „Serie beenden"
- Jeder Termin ist danach ein ganz normaler Auftrag: einzeln bearbeitbar,
  verschiebbar, zuweisbar oder stornierbar, ohne die übrigen zu beeinflussen
- Serie beenden (`DELETE /api/order-series/:id`) storniert nur die noch
  offenen zukünftigen Termine – erledigte und laufende bleiben als echte
  Arbeitshistorie unangetastet

### Kunden & Objekte (nur Administration)
- Wiederverwendbare Stammdaten unter „Kunden": Name, Adresse, Telefon, Notizen
- Beim Anlegen eines Auftrags per Auswahl übernehmbar; die Angaben bleiben
  zusätzlich als Momentaufnahme am Auftrag gespeichert – spätere Änderungen am
  Kunden wirken sich nicht rückwirkend auf alte Aufträge aus
- Anlegen, Bearbeiten, Suchen; Löschen ist gesperrt, solange noch Aufträge mit
  dem Kunden verknüpft sind
- Mitarbeiter sehen den Bereich nicht (Leserechte auf die Liste bestehen nur,
  damit Auswahlfelder funktionieren – Verwaltung ist der Administration
  vorbehalten)

### Meine Aufträge (Mitarbeiter)
- Tabs: Heute / Diese Woche / Alle
- Detailansicht mit Adresse und Direktlink zu Google Maps, Material als
  Checkliste zum Abhaken, Zeitfenster, Notizen, angehängte PDFs/Bilder
- Status ändern (offen → in Arbeit → erledigt), jeder Schritt mit Zeitstempel
  und Namen im Verlauf
- Fotos hochladen als Abschluss-Nachweis, auf dem Smartphone direkt über die
  Kamera
- Kommentarfeld für Rückmeldungen an die Administration

### Dienstplan
- Kalender mit Wochen- und Monatsumschaltung
- **Automatische Synchronisation mit den Aufträgen:** Sobald ein Auftrag
  einen Termin und zugewiesene Mitarbeiter hat, erscheint er von selbst im
  Dienstplan – je Mitarbeiter ein Eintrag. Terminänderungen verschieben den
  Eintrag mit, eine Umverteilung wechselt den Mitarbeiter, Stornieren oder
  Löschen entfernt ihn (Reaktivieren legt ihn wieder an). Das gilt auch für
  alle Termine einer Serie
- **Abgleich beim Serverstart:** Beim Hochfahren gleicht der Server die
  Dienstplan-Einträge aller bestehenden Aufträge einmal ab
  (`backfillShiftsForExistingOrders()` in `server/src/routes/orders.js`).
  So tauchen auch Aufträge im Plan auf, die vor Einführung der
  Synchronisation angelegt und seitdem nicht mehr angefasst wurden. Der
  Abgleich legt nur an bzw. korrigiert, was wirklich fehlt, und lässt freie
  Einträge unberührt – er ist daher bei jedem Start unbedenklich
- Administration: zusätzlich freie Einträge anlegen (z. B. Urlaub,
  Werkstatt, Bereitschaft), bearbeiten, löschen; per Drag & Drop auf andere
  Tage ziehen; auch manuell mit einem Auftrag verknüpfbar (Termin und
  Zeitfenster werden dann übernommen)
- Hinweis: Auftragsgebundene Einträge verwaltet die Synchronisation – wer im
  Dienstplan zusätzlich eingeplant werden soll, wird am besten direkt dem
  Auftrag zugewiesen. Freie Einträge ohne Auftragsbezug bleiben unangetastet
- Mitarbeiter: sieht ausschließlich die eigene Einteilung, ohne Bearbeitung
- Farbliche Kennzeichnung wahlweise nach Auftragsart oder Status

### Mitarbeiterverwaltung (nur Administration)
- Liste aller Konten mit Status (aktiv / deaktiviert)
- Neues Konto mit Name, E-Mail, Telefon, Rolle; Startpasswort wird automatisch
  erzeugt und einmalig angezeigt
- Bearbeiten, Passwort zurücksetzen, deaktivieren – bewusst **kein Löschen**,
  damit die Auftragshistorie vollständig erhalten bleibt

### Anmeldung
- Login mit E-Mail und Passwort, Logo zentriert darüber
- Keine Selbstregistrierung – Konten legt ausschließlich ein Admin an
- Passwörter werden nur als bcrypt-Hash gespeichert, nie im Klartext
- „Passwort vergessen" mit Reset-Link (im Testbetrieb wird der Link in der
  Server-Konsole ausgegeben und direkt in der App angezeigt)
- Jeder kann unter „Mein Konto" eine private E-Mail-Adresse hinterlegen –
  der Reset-Link geht dann bevorzugt dorthin, unabhängig von der Firmenmail.
  Die Adresse ist außer für die Person selbst nur für die Administration
  sichtbar; zum Ändern wird das aktuelle Passwort verlangt (die Adresse ist
  der Kanal für den Passwort-Reset)

---

## Datenmodell

SQLite-Datenbank, Schema mit Kommentaren:
[`server/src/db/schema.sql`](server/src/db/schema.sql)

Bestehende Datenbanken werden beim Serverstart automatisch aktualisiert:
Später hinzugekommene Spalten (z. B. `private_email`, `customer_id`,
`series_id`) ergänzt `migrateAddColumns()` in
[`server/src/db/index.js`](server/src/db/index.js) per `ALTER TABLE` –
vorhandene Daten bleiben dabei unverändert.

| Tabelle | Zweck |
| --- | --- |
| `users` | Benutzerkonten: Name, E-Mail, Passwort-Hash, Rolle (`ADMIN`/`EMPLOYEE`), Telefon, private E-Mail (für Passwort-Reset), aktiv/deaktiviert |
| `password_reset_tokens` | Tokens für „Passwort vergessen" (nur als Hash gespeichert, mit Ablaufzeit) |
| `customers` | Wiederverwendbare Kunden-/Objektstammdaten für die Auswahl im Auftragsformular |
| `order_series` | Vorlagen für wiederkehrende Aufträge: Intervall, ein oder mehrere Wochentage, Unterart, Zeitraum, Zeitfenster; `open_ended` kennzeichnet Serien ohne festes Enddatum (endDate ist dann nur der aktuelle Terminhorizont), `assignee_ids` merkt sich die Zuweisungen fürs Verlängern |
| `orders` | Aufträge: Kunde, Adresse, Auftragsart, Unterart, Status, Termin, Zeitfenster, Notizen; optional mit Verweis auf `customers` und die erzeugende `order_series` |
| `order_assignments` | Zuweisung Auftrag ↔ Mitarbeiter (n:m). **Grundlage der Rechteprüfung** |
| `order_materials` | Materialpositionen je Auftrag, zugleich Checkliste (`done`) |
| `order_files` | Hochgeladene PDFs/Bilder: `ATTACHMENT` (vom Admin) oder `PROOF_PHOTO` (Nachweis vom Mitarbeiter) |
| `order_status_history` | Lückenlose Statushistorie: von → nach, wer, wann |
| `order_comments` | Rückmeldungen zwischen Mitarbeiter und Administration |
| `shifts` | Dienstplan-Einträge: Mitarbeiter, Datum, Zeitfenster, optional mit Auftrag verknüpft. Auftragsgebundene Einträge werden automatisch mit Termin, Status und Zuweisungen des Auftrags synchron gehalten (`syncShiftsForOrder` in `server/src/routes/orders.js`); freie Einträge (Urlaub, Werkstatt …) verwaltet die Administration von Hand |

Ein Auftrag kann mehreren Mitarbeitern zugewiesen sein und ein Mitarbeiter
mehreren Aufträgen. Genau über `order_assignments` entscheidet der Server, ob
ein Mitarbeiter einen Auftrag sehen darf.

Dateien liegen als Datei unter `server/uploads/` mit einem zufälligen Namen; in
der Datenbank stehen nur die Metadaten. Ausgeliefert werden sie ausschließlich
über `/api/files/:id` – mit Rechteprüfung bei jedem Abruf.

---

## Projektstruktur

```
.
├── assets/                  Logo (SVG + JPG)
├── server/                  Backend (Node.js + Express + SQLite)
│   ├── src/
│   │   ├── config.js        Konfiguration (Port, Secrets, Pfade)
│   │   ├── index.js         Serverstart und Routen-Einbindung
│   │   ├── db/              Datenbankverbindung, Schema, Testdaten
│   │   ├── lib/             Sicherheit (Hashing/JWT), HTTP-Helfer, E-Mail
│   │   ├── middleware/      Anmeldung und Rechte, Uploads, Fehlerbehandlung
│   │   └── routes/          auth, orders, order-series, customers, shifts, users, files
│   ├── test/                automatischer API- und Sicherheitstest
│   ├── data/                SQLite-Datei (wird automatisch angelegt)
│   └── uploads/             hochgeladene PDFs und Bilder
└── web/                     Frontend (React + Vite + TypeScript)
    ├── public/              Logo für Browser-Tab und App
    └── src/
        ├── api/             Zugriff auf die REST-API + Datentypen
        ├── auth/            Anmeldezustand (Kontext)
        ├── components/      Layout, Icons, Dialoge, Auftragskachel
        ├── pages/           die einzelnen Bildschirme
        ├── styles/          Farben und Grundgestaltung
        └── utils/           Datum, Beschriftungen, Maps-Link
```

---

## Design

Farben aus dem Logo, zentral gepflegt in
[`web/src/styles/theme.css`](web/src/styles/theme.css):

| Farbe | Wert | Verwendung |
| --- | --- | --- |
| Dunkelblau/Navy | `#14213D` | Kopfzeile, Navigation, primäre Buttons |
| Hellblau | `#4FC3F7` | Akzente, aktive Zustände, Links, Status „offen" |
| Weiß | `#FFFFFF` | Hintergrund der Inhaltsflächen |

Das Logo steht zentriert auf dem Login-Screen und in der Kopfzeile jeder Seite.
In der Kopfzeile liegt es auf einer weißen Fläche, weil seine dunkelblauen
Anteile auf navyfarbenem Grund sonst nicht erkennbar wären.

Jeder Status hat ein eigenes Icon und eine eigene Farbe (offen, in Arbeit,
erledigt, storniert), jede Auftragsart eine eigene Farbe – identisch in Listen,
Detailansicht und Dienstplan.

**Mobile-first:** Auf dem Smartphone gibt es unten eine Tab-Leiste im
Daumenbereich, Dialoge öffnen als Blatt von unten, Buttons und Checkboxen sind
großzügig dimensioniert (Statusbutton 54 px hoch). Ab Tablet-Breite wechselt die
Navigation in die Kopfzeile und Inhalte werden mehrspaltig.

---

## Tests

**API- und Sicherheitstest** (Server muss laufen):

```bash
cd server
node test/api-smoke-test.mjs
```

Der Test prüft 56 Punkte, darunter besonders die Rollentrennung: dass ein
Mitarbeiter fremde Aufträge, fremde Dateien und fremde Dienstpläne auch über
direkte API-Aufrufe nicht erreicht, keine Aufträge anlegen oder löschen kann und
keinen Zugriff auf die Benutzerverwaltung hat.

**Typprüfung des Frontends:**

```bash
cd web
npm run typecheck
```

---

## Konfiguration

Für den lokalen Test ist keine Konfiguration nötig. Für einen echten Betrieb
`server/.env.example` nach `server/.env` kopieren und anpassen – insbesondere:

- `JWT_SECRET` – langer Zufallswert (sonst sind Anmelde-Tokens fälschbar)
- `APP_BASE_URL` – Adresse des Frontends für den Link in der Reset-E-Mail
- `CORS_ORIGIN` – erlaubte Herkunft der Browser-Anfragen
- `RESEND_API_KEY` – API-Key von [Resend](https://resend.com) für den
  E-Mail-Versand (Reset-Links). Ohne Key wird im Produktionsbetrieb keine
  E-Mail verschickt; im Testbetrieb erscheint der Inhalt in der Server-Konsole
- `MAIL_FROM` – Absenderadresse; die Domain muss bei Resend verifiziert sein

---

## Spätere App-Version

Das Frontend ist eine reine React-App und kommuniziert ausschließlich über die
REST-API. Für eine App-Store-Version genügt daher:

```bash
cd web
npm install @capacitor/core @capacitor/cli
npx cap init
npx cap add ios      # bzw. android
VITE_API_URL=https://api.example.de npm run build
npx cap sync
```

Der Ordner `web/dist` wird unverändert in die native Hülle übernommen. Wichtig
ist nur, beim Build `VITE_API_URL` auf die Serveradresse zu setzen, weil in der
nativen App der Entwicklungs-Proxy fehlt. Das Anmelde-Token liegt bereits im
lokalen Speicher (nicht in einem Cookie) – das funktioniert in der nativen Hülle
unverändert.

---

## Vorbereitet für spätere Erweiterungen

- **Push-Benachrichtigungen:** Die Statushistorie (`order_status_history`) und
  die Zuweisungen liegen bereits strukturiert vor; ein Versand lässt sich in
  `server/src/routes/orders.js` an den Stellen anknüpfen, an denen Status und
  Zuweisung geändert werden.
- **Rechnungsmodul:** Aufträge haben Kunde, Adresse, Material, Zeitfenster und
  eine vollständige Historie – eine Tabelle `invoices` mit Bezug auf `orders`
  genügt als Ergänzung.
- **E-Mail-Versand:** Bereits angebunden (Resend, siehe
  `server/src/lib/mailer.js`) – im Produktionsbetrieb nur `RESEND_API_KEY`
  und `MAIL_FROM` setzen. Ein anderer Anbieter lässt sich an derselben Stelle
  austauschen, ohne den restlichen Code anzufassen.
- **PostgreSQL statt SQLite:** Der Datenbankzugriff ist in
  `server/src/db/index.js` gekapselt, das Schema ist portabel gehalten.
