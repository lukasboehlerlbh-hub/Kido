# Kido App – PRD

## Projektübersicht
**App-Name:** Kido  
**Zweck:** Wochenend- und Ferienplanung für Eltern in Betreuungsketten (4–8+ Personen)  
**Zielgruppe:** Getrennte Eltern in Patchwork-Konstellationen, Schweiz (DACH erweiterbar)  
**Motto:** "Kido ist Mediator, nicht Richter. Warmherzig, empathisch, nie urteilend."  
**Architektur:** Expo (React Native) Frontend + FastAPI Backend + MongoDB

---

## Implementiert (v1.0 – Stand 2026-04)

### Backend (FastAPI + MongoDB)
- User-Verwaltung (Erstellen, Abrufen per Telefon, Aktualisieren)
- Chain-Erstellung (Host + erster ChainMember)
- Einladungssystem (Token-basiert, 8-stellig alphanumerisch)
- Einladung annehmen (Token validieren → User + Member erstellen)
- ChainMember-Präferenzen (Gerichtsurteil, Wochenendlogik, Flex-Stufe)
- Wochenendplan-Berechnung (gerade/ungerade Wochen + Flex-Score-Algorithmus)
- Plan-Voting (Accept/Decline mit Auflösung bei Konsens)
- Ferienwünsche (CRUD, Teilen-Option)
- Chat (Kido-Kanal, Direkt-Chat, Gruppenkanal)
- Ton-Moderation im Frontend
- Schweizer Schulferiendaten (ZH, BE, SG, AG, BS – 2025 & 2026)
- Kido-AI-Antworten (lokal, keyword-basiert)

### Frontend (Expo / expo-router)
- **index.tsx** – Willkommen/Intro (Feature-Karten, Zitat)
- **onboarding.tsx** – Neue Kette gründen oder per Token beitreten
- **setup-prefs.tsx** – Präferenzen (Gerichtsurteil, Logik, Flexibilität)
- **(tabs)/home.tsx** – Hauptübersicht (Mitglieder, Wochenendplan-Karte, Ferien, Offene Punkte, Einladen)
- **(tabs)/weekends.tsx** – Kalenderraster (Mitglieder × 8 WE) + Plan berechnen + Voting
- **(tabs)/holidays.tsx** – Schulferien nach Kanton/Jahr + Ferienwünsche
- **(tabs)/chat.tsx** – Kido-Chat / Direkt / Gruppe mit Ton-Moderation
- **settings.tsx** – Profil, Avatar-Farbe, Kanton
- **conflict.tsx** – Konfliktlösung (3 Stufen: Clean / Ungern / Blockade)

### Design
- Primärfarbe: #1D9E75 (Teal)
- Sekundär: #CECBF6 (Lila, Kido-Nachrichten)
- Warnung: #FAEEDA / #BA7517
- Fehler: #FCEBEB / #E24B4A
- Hintergrund: #F7F9F8

---

## Offene Punkte / Backlog

### P0 (kritisch für nächste Phase)
- Twilio SMS für Einladungsversand
- Real-time Chat (WebSockets / SSE)
- Push-Benachrichtigungen

### P1 (wichtig)
- Claude API für Kido-Chat-Antworten (Anthropic)
- Mehrsprachigkeit (DE / FR / IT)
- Jahresrotations-Logik für Ferienplanung
- Schulferiendaten 2027

### P2 (nice-to-have)
- Mediationsempfehlung mit Links zu Schweizer Mediatoren
- Onboarding-Tutorial für neue Nutzer
- P2P-Verschlüsselung
- Datenschutzerklärung + AGB (DSG Schweiz)

---

## Test-Zugangsdaten
Siehe /app/memory/test_credentials.md
