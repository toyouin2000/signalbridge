# SignalBridge 🚀
### Bridging CRM Data with Meta Conversions API

**SignalBridge** is a CRM-to-Meta integration platform designed to connect CRM systems with Meta's Conversions API (CAPI), enabling businesses to synchronize lead lifecycle events and send meaningful conversion signals back to Meta.

It helps businesses close the gap between lead generation and actual business outcomes by connecting CRM data with Meta's advertising ecosystem.

[![Next.js](https://img.shields.io/badge/Next.js-TypeScript-black?logo=next.js)](https://nextjs.org/)
[![Node.js](https://img.shields.io/badge/Node.js-Backend-green?logo=node.js)](https://nodejs.org/)
[![Supabase](https://img.shields.io/badge/Database-Supabase-3ECF8E?logo=supabase)](https://supabase.com/)
[![Meta](https://img.shields.io/badge/Integration-Meta%20CAPI-0866FF?logo=meta)](https://developers.facebook.com/docs/marketing-api/conversions-api/)

---

## 📌 Table of Contents

- [Overview](#-overview)
- [The Problem](#-the-problem)
- [How SignalBridge Works](#-how-signalbridge-works)
- [System Architecture](#-system-architecture)
- [Core Features](#-core-features)
- [Integration Workflow](#-integration-workflow)
- [Technology Stack](#-technology-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Environment Variables](#-environment-variables)
- [CRM Event Processing](#-crm-event-processing)
- [Security and Reliability](#-security-and-reliability)
- [Future Enhancements](#-future-enhancements)

---

## 🎯 Overview

Modern businesses generate leads through advertising platforms such as Facebook and Instagram. However, a lead's journey doesn't end when a form is submitted.

A lead may subsequently become:

- Contacted
- Qualified
- Converted
- Disqualified

These lifecycle events are typically stored in CRM platforms such as HubSpot.

SignalBridge connects this CRM lifecycle information to Meta, allowing businesses to send downstream conversion events through Meta's Conversions API.

### The big picture

```mermaid
flowchart LR
    A["Meta Lead Ads"] --> B["CRM Platform"]
    B --> C["SignalBridge"]
    C --> D["Meta Conversions API"]
    D --> E["Meta Ads Optimization"]

    style C fill:#14532d,color:#fff,stroke:#22c55e
    style E fill:#1877F2,color:#fff,stroke:#1877F2
```

**The goal:** Transform raw lead generation data into actionable conversion signals.

---

## ⚠️ The Problem

Traditional lead generation campaigns primarily optimize around form submissions.

But a submitted lead does not necessarily mean a successful business outcome.

Consider this example:

| Lead | CRM Status | Business Outcome |
|---|---|---|
| Lead A | New | Not contacted |
| Lead B | Contacted | Follow-up pending |
| Lead C | Qualified | High-intent prospect |
| Lead D | Converted | Successful customer |
| Lead E | Disqualified | Not a potential customer |

Without CRM feedback, advertising platforms have limited visibility into what happens after lead acquisition.

### How SignalBridge solves this

1. Connect the CRM with SignalBridge.
2. Retrieve and process lead lifecycle information.
3. Identify relevant status changes.
4. Map CRM statuses to Meta conversion events.
5. Send conversion events to Meta CAPI.
6. Allow Meta to use eligible conversion signals for campaign optimization.

---

## 🔄 How SignalBridge Works

The platform follows a simple integration pipeline.

```mermaid
flowchart TD
    A(["Start"]) --> B["Connect HubSpot CRM"]
    B --> C["Authorize using OAuth 2.0"]
    C --> D["Fetch CRM Leads"]
    D --> E["Read Lead Lifecycle Status"]
    E --> F{"Status Changed?"}
    F -->|No| G["Skip Event"]
    F -->|Yes| H["Map CRM Status to Meta Event"]
    H --> I["Normalize and Hash User Data"]
    I --> J["Build CAPI Payload"]
    J --> K["Send Event to Meta"]
    K --> L{"API Successful?"}
    L -->|Yes| M["Log Successful Delivery"]
    L -->|No| N["Record Error and Retry"]
    N --> K
    M --> O(["Complete"])
    G --> O

    style B fill:#334155,color:#fff
    style H fill:#14532d,color:#fff
    style K fill:#1877F2,color:#fff
```

---

## 🏗️ System Architecture

SignalBridge uses a modular architecture consisting of the frontend, backend, database, CRM integration, and Meta integration layers.

```mermaid
flowchart TB
    subgraph CLIENT["Presentation Layer"]
        UI["Next.js Dashboard"]
        WIZARD["Integration Setup Wizard"]
    end

    subgraph BACKEND["Application Layer"]
        API["Node.js / TypeScript API"]
        AUTH["OAuth Manager"]
        SYNC["CRM Sync Engine"]
        EVENT["Event Processing Engine"]
        RETRY["Retry and Error Handler"]
    end

    subgraph DATA["Data Layer"]
        DB[("Supabase / PostgreSQL")]
        LOG["Event and Sync Logs"]
        CRED["Encrypted Integration Credentials"]
    end

    subgraph EXTERNAL["External Integrations"]
        HUB["HubSpot CRM"]
        META["Meta Conversions API"]
    end

    UI --> API
    WIZARD --> AUTH
    AUTH <--> HUB
    API --> SYNC
    SYNC <--> HUB
    SYNC --> EVENT
    EVENT --> META
    EVENT --> RETRY
    RETRY --> META
    API <--> DB
    SYNC --> LOG
    EVENT --> LOG
    AUTH --> CRED

    style CLIENT fill:#172554,color:#fff
    style BACKEND fill:#14532d,color:#fff
    style DATA fill:#334155,color:#fff
    style EXTERNAL fill:#1e3a8a,color:#fff
```

### Architecture responsibilities

| Component | Responsibility |
|---|---|
| Next.js Frontend | Dashboard and integration configuration |
| Node.js Backend | Business logic and API orchestration |
| OAuth Manager | Secure CRM authorization |
| CRM Sync Engine | Retrieves and synchronizes lead data |
| Event Processor | Maps CRM changes into Meta events |
| Supabase | Persistent storage |
| Retry Handler | Handles transient API failures |
| Logging | Tracks synchronization and delivery outcomes |

---

## ✨ Core Features

### 1. CRM Integration

Connect HubSpot using OAuth 2.0.

- Secure authorization.
- Access token management.
- CRM lead retrieval.
- Lead lifecycle synchronization.

### 2. Meta Conversions API Integration

Send CRM conversion events to Meta.

- Dataset ID configuration.
- Access token configuration.
- Event payload generation.
- Customer information hashing.
- API response handling.

### 3. Lead Lifecycle Tracking

Track the progression of leads throughout the sales funnel.

```mermaid
flowchart LR
    A["New"] --> B["Contacted"]
    B --> C["Qualified"]
    C --> D["Converted"]

    B --> E["Disqualified"]
    C --> E

    style D fill:#166534,color:#fff
    style E fill:#991b1b,color:#fff
```

### 4. Event Processing

SignalBridge converts CRM lifecycle updates into standardized Meta event payloads.

Example mapping:

| CRM Status | Meta Event |
|---|---|
| Qualified | QualifiedLead |
| Converted | Purchase / custom conversion event |
| Other lifecycle stages | Configurable custom events |

Event mapping should be configurable according to the advertiser's Meta dataset and optimization requirements.

### 5. Monitoring and Error Handling

- Track synchronization attempts.
- Record successful event deliveries.
- Capture API errors.
- Retry transient failures.
- Maintain processing logs.

---

## 🔌 Integration Workflow

### HubSpot OAuth Integration

```mermaid
sequenceDiagram
    participant U as User
    participant S as SignalBridge
    participant H as HubSpot

    U->>S: Click Connect HubSpot
    S->>H: Redirect to OAuth Authorization
    H->>U: Request Permissions
    U->>H: Approve Access
    H->>S: Authorization Code
    S->>H: Exchange Code for Tokens
    H-->>S: Access and Refresh Tokens
    S->>S: Securely Store Credentials
    S-->>U: HubSpot Connected
```

### Meta CAPI Integration

```mermaid
sequenceDiagram
    participant CRM as HubSpot CRM
    participant SB as SignalBridge
    participant DB as Supabase
    participant META as Meta CAPI

    CRM->>SB: Lead Status Update
    SB->>DB: Check Existing Event
    DB-->>SB: Event Processing State
    SB->>SB: Validate and Map Event
    SB->>SB: Hash Customer Identifiers
    SB->>META: Send Conversion Event
    META-->>SB: API Response
    SB->>DB: Update Delivery Log
```

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js |
| Language | TypeScript / JavaScript |
| Backend | Node.js |
| Database | Supabase / PostgreSQL |
| CRM Integration | HubSpot API |
| Advertising Integration | Meta Conversions API |
| Authentication | OAuth 2.0 |
| API Communication | REST APIs |
| Version Control | Git / GitHub |

---

## 📁 Project Structure

The following is a suggested logical organization; adjust it to match the actual repository.

```text
signalbridge/
│
├── frontend/
│   ├── app/
│   ├── components/
│   ├── hooks/
│   └── lib/
│
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── controllers/
│   │   ├── routes/
│   │   ├── services/
│   │   │   ├── hubspot/
│   │   │   └── meta/
│   │   ├── middleware/
│   │   ├── jobs/
│   │   └── utils/
│   │
│   └── package.json
│
├── docs/
│   └── architecture.md
│
├── .env.example
├── .gitignore
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

Before running SignalBridge, ensure you have:

- Node.js (LTS recommended)
- npm
- Git
- Supabase project
- HubSpot Developer App
- Meta Business Portfolio
- Meta Events Manager dataset

### 1. Clone the repository

```bash
git clone https://github.com/toyouin2000/signalbridge.git

cd signalbridge
```

### 2. Install dependencies

Install dependencies in the relevant frontend and backend directories.

```bash
cd frontend
npm install
```

```bash
cd ../backend
npm install
```

Adjust these commands if your actual repository uses a monorepo or a different directory structure.

### 3. Configure environment variables

Create `.env` files for the respective applications.

Refer to the Environment Variables section below.

### 4. Start the application

Frontend:

```bash
cd frontend
npm run dev
```

Backend:

```bash
cd backend
npm run dev
```

### 5. Open the application

```text
Frontend: http://localhost:3000
```

Use the backend URL configured in your environment.

---

## 🔐 Environment Variables

Example configuration:

```env
# Application
PORT=5000
NODE_ENV=development

# Supabase
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# HubSpot OAuth
HUBSPOT_CLIENT_ID=
HUBSPOT_CLIENT_SECRET=
HUBSPOT_OAUTH_REDIRECT_URI=

# Meta CRM CAPI
META_CRM_DATASET_ID=
META_CRM_ACCESS_TOKEN=

# Frontend
NEXT_PUBLIC_API_URL=
```

**Security recommendations:**

- Never commit `.env` files.
- Keep Meta access tokens on the backend.
- Never expose Supabase service-role credentials to the frontend.
- Encrypt OAuth credentials at rest.
- Use HTTPS for production OAuth redirects.
- Rotate credentials if they are exposed.

---

## 📊 CRM Event Processing

A typical CRM conversion event contains:

| Field | Description |
|---|---|
| event_name | Conversion event name |
| event_time | Unix timestamp of conversion |
| action_source | Source of the conversion |
| event_id | Unique event identifier |
| user_data | Hashed customer identifiers |
| custom_data | Optional conversion metadata |

### Example Meta CAPI Payload

```json
{
  "data": [
    {
      "event_name": "QualifiedLead",
      "event_time": 1794499200,
      "event_id": "lead_123_qualified",
      "action_source": "system_generated",
      "user_data": {
        "em": [
          "SHA256_HASHED_EMAIL"
        ]
      }
    }
  ]
}
```

The timestamp and customer data above are illustrative. Production events should use the actual CRM conversion timestamp and correctly normalized, SHA-256-hashed customer identifiers.

---

## 🛡️ Security and Reliability

SignalBridge is designed around the following engineering principles:

| Principle | Implementation |
|---|---|
| Authentication | OAuth 2.0 |
| Credential Security | Backend-only secrets and encryption |
| Data Privacy | Normalization and hashing of identifiers |
| Reliability | Retry handling |
| Observability | API and event logs |
| Data Integrity | Event identifiers and duplicate prevention |
| Scalability | Modular integration architecture |

### Important reliability considerations

- Use idempotency controls to avoid duplicate conversion events.
- Respect Meta API rate limits.
- Retry transient failures with exponential backoff.
- Avoid retrying permanent validation errors.
- Store event delivery status for troubleshooting.
- Use least-privilege CRM permissions.

---

## 🔮 Future Enhancements

- [ ] Support additional CRMs such as Salesforce and Zoho.
- [ ] Support Meta Lead Ads ingestion.
- [ ] Configurable CRM-to-Meta event mapping.
- [ ] Automated scheduled synchronization.
- [ ] Advanced event delivery dashboard.
- [ ] Dead-letter queue for failed events.
- [ ] Webhook-based real-time synchronization.
- [ ] Multi-tenant organization management.
- [ ] Event match quality monitoring.
- [ ] Integration health monitoring.

---

## 💡 Product Vision

SignalBridge aims to make CRM-to-advertising integrations easier, more reliable, and more accessible.

By connecting lead acquisition data with actual business outcomes, businesses can build a more complete feedback loop between their CRM and advertising platforms.

**From lead generation to revenue intelligence.**

---

## 👨‍💻 Author

**Dishank Ojha**

Product Engineer | Full-Stack Developer | AI & Integration Systems

GitHub: [@toyouin2000](https://github.com/toyouin2000)

Project: [SignalBridge](https://github.com/toyouin2000/signalbridge)

---

⭐ If you find this project interesting, consider giving the repository a star!
